import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  branchExists,
  currentBranch,
  git,
  hasUncommittedChanges,
} from "../git.js";
import {
  buildForest,
  descendantsNeedingRestack,
  type Forest,
  getParentSha,
  readBranchInfo,
  readParents,
  readRecordedBases,
  restackScope,
  setParentSha,
  tipsFrom,
} from "../stack.js";
import { detectTrunk } from "../trunk.js";
import { colors, fail, info, success, warn } from "../ui.js";

export type StackRestackOpts = {
  branch?: string;
  stack?: boolean; // -s/--stack: include descendants (the whole stack)
  continue?: boolean;
};

/** One branch to replay onto its parent's (live) tip. */
type Step = { branch: string; parent: string };

type RestackState = {
  version: 1;
  target: string;
  includeDescendants: boolean;
  pending: Step[];
  /** The branch whose rebase conflicted; its base bookkeeping is finished on resume. */
  inflight: { branch: string; parentTip: string };
};

// ─── small git helpers ───────────────────────────────────────────────────────

async function revParse(ref: string): Promise<string> {
  return (await git(["rev-parse", ref])).stdout.trim();
}

async function isAncestor(maybeAncestor: string, ref: string): Promise<boolean> {
  const r = await git(["merge-base", "--is-ancestor", maybeAncestor, ref], { allowFail: true });
  return r.exitCode === 0;
}

async function gitDir(): Promise<string> {
  return (await git(["rev-parse", "--absolute-git-dir"])).stdout.trim();
}

async function rebaseInProgress(): Promise<boolean> {
  const dir = await gitDir();
  return existsSync(join(dir, "rebase-merge")) || existsSync(join(dir, "rebase-apply"));
}

// ─── resume state (.git/flo-restack-state.json) ──────────────────────────────

async function statePath(): Promise<string> {
  return join(await gitDir(), "flo-restack-state.json");
}

async function readState(): Promise<RestackState | null> {
  const p = await statePath();
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as RestackState;
  } catch {
    return null;
  }
}

async function writeState(state: RestackState): Promise<void> {
  writeFileSync(await statePath(), JSON.stringify(state, null, 2));
}

async function clearState(): Promise<void> {
  const p = await statePath();
  if (existsSync(p)) rmSync(p);
}

// ─── the walk ────────────────────────────────────────────────────────────────

/**
 * Replay each step bottom-up. Returns on success; on the first conflict it
 * persists the remaining work, prints the resume hint, and exits the process.
 */
async function runSteps(steps: Step[], target: string, includeDescendants: boolean): Promise<void> {
  for (let i = 0; i < steps.length; i++) {
    const { branch, parent } = steps[i];
    const parentTip = await revParse(parent);
    const recordedBase = await getParentSha(branch);

    // Already sitting on the parent's current tip → nothing to replay.
    if (recordedBase === parentTip) continue;
    if (recordedBase == null && (await isAncestor(parentTip, branch))) {
      // Unadopted branch already on top of its parent — adopt the base, no rebase.
      await setParentSha(branch, parentTip);
      continue;
    }

    // `--onto <newTip> <oldBase>` replays only the branch's own commits. Without a
    // recorded base, fall back to the 2-arg form (merge-base picks the old base).
    const args = recordedBase
      ? ["rebase", "--onto", parentTip, recordedBase, branch]
      : ["rebase", parentTip, branch];
    const r = await git(args, { allowFail: true });

    if (r.exitCode !== 0) {
      await writeState({
        version: 1,
        target,
        includeDescendants,
        pending: steps.slice(i + 1),
        inflight: { branch, parentTip },
      });
      printConflict(branch, parent);
      process.exit(1);
    }

    await setParentSha(branch, parentTip);
    console.log(`  ${colors.green("✓")} ${colors.bold(branch)} ${colors.dim("→")} ${parent}`);
  }

  await finish(target, includeDescendants);
}

function printConflict(branch: string, parent: string): void {
  console.error("");
  console.error(`${colors.red().bold("✗")} Conflict restacking ${colors.bold(branch)} onto ${parent}.`);
  console.error("");
  console.error(`  ${colors.bold("1.")} Fix the files, then ${colors.cyan("git add <file>")}`);
  console.error(`  ${colors.bold("2.")} ${colors.cyan("git rebase --continue")} ${colors.dim("(or git rebase --abort to bail)")}`);
  console.error(`  ${colors.bold("3.")} ${colors.cyan("flo stack restack --continue")} to finish the rest of the stack`);
  console.error("");
}

/** Land back on the target, clear state, and flag any descendants left stale. */
async function finish(target: string, includeDescendants: boolean): Promise<void> {
  await git(["checkout", "--quiet", target], { allowFail: true });
  await clearState();

  if (!includeDescendants) {
    const forest = await loadForest();
    const stale = descendantsNeedingRestack(forest, target);
    if (stale.length > 0) {
      console.log("");
      warn(`Branches above ${colors.bold(target)} still need a restack: ${stale.map((b) => colors.bold(b)).join(", ")}`);
      console.log(
        colors.dim(`  Run ${colors.cyan("flo stack restack -s")} to include them, or restack from each one.`),
      );
    }
  }
  success(`Stack restacked 👍`);
}

async function loadForest(): Promise<Forest> {
  const [trunk, info, parents, recordedBases] = await Promise.all([
    detectTrunk(),
    readBranchInfo(),
    readParents(),
    readRecordedBases(),
  ]);
  return buildForest({ trunk, tips: tipsFrom(info), parents, recordedBases });
}

// ─── command ─────────────────────────────────────────────────────────────────

export async function stackRestackCommand(opts: StackRestackOpts): Promise<void> {
  if (opts.continue) return resume();

  const forest = await loadForest();
  const current = await currentBranch();

  const target = opts.branch ?? current;
  if (opts.branch && !(await branchExists(opts.branch))) fail(`Can't find a branch called ${opts.branch}.`);
  if (target === forest.trunk) fail(`You're on ${forest.trunk} — switch to a stacked branch first.`);

  if (await hasUncommittedChanges()) {
    fail("You have uncommitted changes — commit or stash them before restacking.");
  }
  if (await rebaseInProgress()) {
    fail("A rebase is already in progress. Finish it, then run flo stack restack --continue.");
  }

  const scope = restackScope(forest, target, !!opts.stack);
  if (scope.length === 0) fail(`Nothing to restack for ${target}.`);

  const steps: Step[] = scope.map((branch) => ({
    branch,
    parent: forest.nodes.get(branch)?.parent ?? forest.trunk,
  }));

  info(`Restacking ${scope.length} branch${scope.length === 1 ? "" : "es"}…`);
  await runSteps(steps, target, !!opts.stack);
}

async function resume(): Promise<void> {
  const state = await readState();
  if (!state) fail("No restack in progress — nothing to continue.");

  if (await rebaseInProgress()) {
    fail("The rebase isn't finished. Resolve conflicts, git add, then git rebase --continue before flo stack restack --continue.");
  }
  if (await hasUncommittedChanges()) {
    fail("You have uncommitted changes — commit or stash them before continuing the restack.");
  }

  // The conflicted branch's rebase is done; record its new base, then carry on.
  await setParentSha(state.inflight.branch, state.inflight.parentTip);
  console.log(`  ${colors.green("✓")} ${colors.bold(state.inflight.branch)} ${colors.dim("(resolved)")}`);

  await runSteps(state.pending, state.target, state.includeDescendants);
}
