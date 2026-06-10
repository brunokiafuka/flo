import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { branchExists, currentBranch, git, hasUncommittedChanges } from "../git.js";
import { descendantsNeedingRestack, restackScope, setParentSha, stackRootOf, subtreeOf, topoOrder } from "../stack.js";
import {
  applyPrune,
  deleteMerged,
  detectMerged,
  gitDir,
  loadForest,
  pullTrunk,
  rebaseInProgress,
  rebaseStep,
} from "../stackEngine.js";
import { detectTrunk } from "../trunk.js";
import { colors, fail, info, success, warn } from "../ui.js";

export type StackRestackOpts = {
  branch?: string;
  stack?: boolean; // -s/--stack: include descendants (the whole stack)
  continue?: boolean;
  noPull?: boolean; // --no-pull: skip fetching + fast-forwarding trunk
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
  /** Merged branches to delete once the walk finishes (survives a conflict pause). */
  deletable: string[];
};

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

// ─── the walk (pause + resume on conflict) ───────────────────────────────────

async function runSteps(
  steps: Step[],
  target: string,
  includeDescendants: boolean,
  deletable: string[],
): Promise<void> {
  for (let i = 0; i < steps.length; i++) {
    const { branch, parent } = steps[i];
    const { status, parentTip } = await rebaseStep(branch, parent);

    if (status === "conflict") {
      await writeState({
        version: 1,
        target,
        includeDescendants,
        pending: steps.slice(i + 1),
        inflight: { branch, parentTip },
        deletable,
      });
      printConflict(branch, parent);
      process.exit(1);
    }
    if (status === "rebased") {
      console.log(`  ${colors.green("✓")} ${colors.bold(branch)} ${colors.dim("→")} ${parent}`);
    }
  }
}

function printConflict(branch: string, parent: string): void {
  console.error("");
  console.error(`${colors.red().bold("✗")} Conflict restacking ${colors.bold(branch)} onto ${parent}.`);
  console.error("");
  console.error(`  ${colors.bold("1.")} Fix the files, then ${colors.cyan("git add <file>")}`);
  console.error(
    `  ${colors.bold("2.")} ${colors.cyan("git rebase --continue")} ${colors.dim("(or git rebase --abort to bail)")}`,
  );
  console.error(
    `  ${colors.bold("3.")} ${colors.cyan("flo stack restack --continue")} to finish the rest of the stack`,
  );
  console.error("");
}

/** Land back on target, delete merged branches, clear state, flag any stragglers. */
async function finalize(target: string, includeDescendants: boolean, deletable: string[]): Promise<void> {
  if (await branchExists(target)) await git(["checkout", "--quiet", target], { allowFail: true });
  await clearState();

  const deleted = await deleteMerged(deletable, target);
  if (deleted.length > 0) info(`Cleaned up merged: ${deleted.map((b) => colors.bold(b)).join(", ")}`);

  if (!includeDescendants && (await branchExists(target))) {
    const forest = await loadForest();
    const stale = descendantsNeedingRestack(forest, target);
    if (stale.length > 0) {
      console.log("");
      warn(
        `Branches above ${colors.bold(target)} still need a restack: ${stale.map((b) => colors.bold(b)).join(", ")}`,
      );
      console.log(colors.dim(`  Run ${colors.cyan("flo stack restack -s")} to include them.`));
    }
  }
  success(`Stack restacked 👍`);
}

// ─── command ─────────────────────────────────────────────────────────────────

export async function stackRestackCommand(opts: StackRestackOpts): Promise<void> {
  if (opts.continue) return resume();

  if (await hasUncommittedChanges()) {
    fail("You have uncommitted changes — commit or stash them before restacking.");
  }
  if (await rebaseInProgress()) {
    fail("A rebase is already in progress. Finish it, then run flo stack restack --continue.");
  }

  const trunk = await detectTrunk();
  let current = await currentBranch();
  if (opts.branch && !(await branchExists(opts.branch))) fail(`Can't find a branch called ${opts.branch}.`);

  // 1. Pull main: fetch + fast-forward trunk.
  if (!opts.noPull) {
    const r = await pullTrunk(trunk, current);
    if (r === "diverged") warn(`Local ${trunk} has diverged from origin/${trunk} — restacking on local ${trunk}.`);
    else if (r === "updated") info(`Pulled ${colors.bold(trunk)} from origin.`);
    else if (r === "no-remote") info(colors.dim(`No origin remote — restacking on local ${trunk}.`));
  }

  // 2. Prune merged branches in the current stack: re-parent their children.
  let forest = await loadForest();
  const focus = opts.branch ?? current;
  const root = stackRootOf(forest, focus) ?? focus;
  const inStack = new Set(forest.nodes.get(focus) ? subtreeOf(forest, root) : []);
  const detected = [...(await detectMerged(trunk))].filter((b) => inStack.has(b));

  let deletable: string[] = [];
  if (detected.length > 0) {
    deletable = await applyPrune(forest, new Set(detected));
    forest = await loadForest(); // re-read after re-parenting
    info(
      `Cleaning up ${detected.length} merged branch${detected.length === 1 ? "" : "es"}, re-parenting onto ${colors.bold(
        trunk,
      )}.`,
    );
  }
  const mergedSet = new Set(deletable);

  // Step off a branch that's about to be deleted.
  current = await currentBranch();
  if (mergedSet.has(current)) {
    await git(["checkout", "--quiet", trunk], { allowFail: true });
    current = trunk;
  }

  // 3. Resolve scope and restack. Pruning (or sitting on trunk) widens to the
  //    whole forest so no re-parented orphan is left behind.
  const target = opts.branch && !mergedSet.has(opts.branch) ? opts.branch : current;
  const wide = mergedSet.size > 0 || target === trunk;
  const scope = (wide ? topoOrder(forest) : restackScope(forest, target, !!opts.stack)).filter(
    (b) => !mergedSet.has(b),
  );
  const fullyRestacked = wide || !!opts.stack;

  if (scope.length === 0 && deletable.length === 0) {
    success(`Nothing to restack — your stack is already on ${trunk}.`);
    return;
  }

  const steps: Step[] = scope.map((branch) => ({
    branch,
    parent: forest.nodes.get(branch)?.parent ?? trunk,
  }));

  if (steps.length > 0) info(`Restacking ${steps.length} branch${steps.length === 1 ? "" : "es"}…`);
  await runSteps(steps, target, fullyRestacked, deletable);
  await finalize(target, fullyRestacked, deletable);
}

async function resume(): Promise<void> {
  const state = await readState();
  if (!state) fail("No restack in progress — nothing to continue.");

  if (await rebaseInProgress()) {
    fail(
      "The rebase isn't finished. Resolve conflicts, git add, then git rebase --continue before flo stack restack --continue.",
    );
  }
  if (await hasUncommittedChanges()) {
    fail("You have uncommitted changes — commit or stash them before continuing the restack.");
  }

  await setParentSha(state.inflight.branch, state.inflight.parentTip);
  console.log(`  ${colors.green("✓")} ${colors.bold(state.inflight.branch)} ${colors.dim("(resolved)")}`);

  await runSteps(state.pending, state.target, state.includeDescendants, state.deletable);
  await finalize(state.target, state.includeDescendants, state.deletable);
}
