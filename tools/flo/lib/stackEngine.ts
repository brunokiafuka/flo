import { existsSync } from "node:fs";
import { join } from "node:path";

import { git, gitFetch, localBranches } from "./git.js";
import {
  buildForest,
  clearParent,
  floManagedBranches,
  type Forest,
  getParentSha,
  planPrune,
  readBranchInfo,
  readParents,
  readRecordedBases,
  setParent,
  setParentSha,
  tipsFrom,
} from "./stack.js";
import { detectTrunk, findMergedBranches, ghMergedHeads } from "./trunk.js";
import { fail } from "./ui.js";

// ─────────────────────────────────────────────────────────────────────────────
// Shared rebase engine for `flo stack restack` and `flo sync`. Both pull trunk,
// prune merged branches, re-parent, and replay branches onto their parents; they
// differ only in scope (one stack vs. the forest) and conflict policy (pause &
// resume vs. abort & report). The common machinery lives here.
// ─────────────────────────────────────────────────────────────────────────────

export async function revParse(ref: string): Promise<string> {
  return (await git(["rev-parse", ref])).stdout.trim();
}

export async function isAncestor(maybeAncestor: string, ref: string): Promise<boolean> {
  const r = await git(["merge-base", "--is-ancestor", maybeAncestor, ref], { allowFail: true });
  return r.exitCode === 0;
}

export async function gitDir(): Promise<string> {
  return (await git(["rev-parse", "--absolute-git-dir"])).stdout.trim();
}

export async function rebaseInProgress(): Promise<boolean> {
  const dir = await gitDir();
  return existsSync(join(dir, "rebase-merge")) || existsSync(join(dir, "rebase-apply"));
}

export async function loadForest(): Promise<Forest> {
  const [trunk, info, parents, recordedBases] = await Promise.all([
    detectTrunk(),
    readBranchInfo(),
    readParents(),
    readRecordedBases(),
  ]);
  // Scope the forest to branches flo owns — never sweep plain local branches
  // (a coworker's checkout, a scratch branch) into a sync/restack or prune.
  const tips = tipsFrom(info);
  const owned = floManagedBranches(trunk, tips, parents);
  const ownedTips = new Map([...tips].filter(([branch]) => owned.has(branch)));
  return buildForest({ trunk, tips: ownedTips, parents, recordedBases });
}

/** Fetch origin and fast-forward local trunk (without a checkout when off-trunk). */
export async function pullTrunk(
  trunk: string,
  current: string,
): Promise<"updated" | "current" | "diverged" | "no-remote"> {
  const hasOrigin = (await git(["remote", "get-url", "origin"], { allowFail: true })).exitCode === 0;
  if (!hasOrigin) return "no-remote";

  const fetched = await gitFetch(["origin", "--prune"]);
  if (fetched.exitCode !== 0) fail(`Couldn't reach origin — ${fetched.stderr.trim()}`);

  const local = await revParse(trunk);
  const remote = (await git(["rev-parse", `origin/${trunk}`], { allowFail: true })).stdout.trim();
  if (!remote || local === remote) return "current";
  if (!(await isAncestor(trunk, `origin/${trunk}`))) return "diverged";

  if (current === trunk) {
    await git(["merge", "--ff-only", `origin/${trunk}`], { allowFail: true });
  } else {
    await git(["update-ref", `refs/heads/${trunk}`, `origin/${trunk}`]);
  }
  return "updated";
}

/** Union of git-based and GitHub-based merged detection, excluding trunk. */
export async function detectMerged(trunk: string): Promise<Set<string>> {
  const [gitMerged, prMerged, locals] = await Promise.all([
    findMergedBranches(trunk),
    ghMergedHeads(),
    localBranches(),
  ]);
  const localSet = new Set(locals);
  const merged = new Set(gitMerged);
  for (const head of prMerged) if (localSet.has(head) && head !== trunk) merged.add(head);
  merged.delete(trunk);
  return merged;
}

/**
 * Re-parent the live children of merged branches onto their nearest live
 * ancestor (keeping each child's recorded base so the rebase replays only its
 * own commits). Mutates git config. Returns the branches that are now deletable.
 */
export async function applyPrune(forest: Forest, merged: Set<string>): Promise<string[]> {
  const plan = planPrune(forest, merged);
  for (const op of plan.repoint) {
    const base = (await getParentSha(op.branch)) ?? (await revParse(op.newParent));
    await setParent(op.branch, op.newParent, base);
  }
  return plan.deletable;
}

/** Force-delete merged branches (skipping `keep`) and clear their config. Returns deleted names. */
export async function deleteMerged(deletable: string[], keep: string): Promise<string[]> {
  const deleted: string[] = [];
  for (const m of deletable) {
    if (m === keep) continue;
    const del = await git(["branch", "-D", m], { allowFail: true });
    if (del.exitCode === 0) {
      await clearParent(m);
      deleted.push(m);
    }
  }
  return deleted;
}

export type StepOutcome = { status: "skipped" | "rebased" | "conflict"; parentTip: string };

/**
 * Replay one branch onto its parent's current tip with `rebase --onto`, so only
 * the branch's own commits move. On success records the new base. On conflict it
 * leaves the rebase **in progress** — the caller decides whether to pause
 * (restack) or abort (sync).
 */
export async function rebaseStep(branch: string, parent: string): Promise<StepOutcome> {
  const parentTip = await revParse(parent);
  const recordedBase = await getParentSha(branch);

  if (recordedBase === parentTip) return { status: "skipped", parentTip };
  if (recordedBase === null && (await isAncestor(parentTip, branch))) {
    await setParentSha(branch, parentTip); // adopt an already-current branch
    return { status: "skipped", parentTip };
  }

  const args = recordedBase ? ["rebase", "--onto", parentTip, recordedBase, branch] : ["rebase", parentTip, branch];
  const r = await git(args, { allowFail: true });
  if (r.exitCode !== 0) return { status: "conflict", parentTip };

  await setParentSha(branch, parentTip);
  return { status: "rebased", parentTip };
}
