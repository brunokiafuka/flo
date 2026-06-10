import { branchExists, currentBranch, git, hasUncommittedChanges } from "../git.js";
import {
  applyPrune,
  deleteMerged,
  detectMerged,
  loadForest,
  pullTrunk,
  rebaseInProgress,
  rebaseStep,
} from "../stackEngine.js";
import { topoOrder } from "../stack.js";
import { detectTrunk } from "../trunk.js";
import { colors, fail, info, success, warn } from "../ui.js";

/**
 * `flo sync` — restack the *entire forest*. Pull trunk, clean up merged branches
 * (re-parenting their children onto trunk), then replay every branch onto its
 * parent. Unlike `flo stack restack`, a conflict doesn't pause the run: that
 * branch is rolled back and reported at the end so the rest still sync.
 */
export async function syncCommand(): Promise<void> {
  if (await hasUncommittedChanges()) {
    fail("You have uncommitted changes — commit or stash them first, then try again.");
  }
  if (await rebaseInProgress()) {
    fail("A rebase is already in progress. Finish it (git rebase --continue/--abort), then run flo sync.");
  }

  const trunk = await detectTrunk();
  const original = await currentBranch();
  let current = original;

  // 1. Pull main.
  const pulled = await pullTrunk(trunk, current);
  if (pulled === "diverged") warn(`Local ${trunk} has diverged from origin/${trunk} — syncing on local ${trunk}.`);
  else if (pulled === "updated") info(`Pulled ${colors.bold(trunk)} from origin.`);
  else if (pulled === "no-remote") info(colors.dim(`No origin remote — syncing on local ${trunk}.`));

  // 2. Prune merged branches across the whole forest, re-parenting onto trunk.
  let forest = await loadForest();
  const detected = [...(await detectMerged(trunk))];
  let deletable: string[] = [];
  if (detected.length > 0) {
    deletable = await applyPrune(forest, new Set(detected));
    forest = await loadForest();
    info(`Cleaning up ${detected.length} merged branch${detected.length === 1 ? "" : "es"}, re-parenting onto ${colors.bold(trunk)}.`);
  }
  const mergedSet = new Set(deletable);

  // Step off a branch that's about to be deleted.
  current = await currentBranch();
  if (mergedSet.has(current)) {
    await git(["checkout", "--quiet", trunk], { allowFail: true });
    current = trunk;
  }

  // 3. Replay every branch onto its parent (topo order). Abort + collect on conflict.
  const scope = topoOrder(forest).filter((b) => !mergedSet.has(b));
  if (scope.length > 0) info(`Restacking ${scope.length} branch${scope.length === 1 ? "" : "es"}…`);

  const failed: string[] = [];
  for (const branch of scope) {
    const parent = forest.nodes.get(branch)?.parent ?? trunk;
    const { status } = await rebaseStep(branch, parent);
    if (status === "conflict") {
      await git(["rebase", "--abort"], { allowFail: true });
      failed.push(branch);
    } else if (status === "rebased") {
      console.log(`  ${colors.green("✓")} ${colors.bold(branch)} ${colors.dim("→")} ${parent}`);
    }
  }

  // 4. Delete merged branches and return to where we started.
  const deleted = await deleteMerged(deletable, current);
  if (deleted.length > 0) info(`Cleaned up merged: ${deleted.map((b) => colors.bold(b)).join(", ")}`);

  if (await branchExists(original)) {
    await git(["checkout", "--quiet", original], { allowFail: true });
  } else {
    warn(`Your branch ${original} was cleaned up — leaving you on ${trunk}.`);
  }

  // 5. Report.
  if (failed.length > 0) {
    console.log("");
    warn("Unable to cleanly sync the following branches:");
    for (const b of failed) console.log(`  ${colors.yellow("-")} ${colors.bold(b)}`);
    console.log(colors.dim(`  Run ${colors.cyan("flo stack restack <branch>")} on each to resolve the conflict by hand.`));
    process.exit(1);
  }
  success(`All set — everything's rebased on ${trunk} 🎉`);
}
