import { cliui } from "@poppinss/cliui";
import enquirer from "enquirer";

import { branchExists, currentBranch, git } from "../git.js";
import { buildForest, readBranchInfo, readParents, readRecordedBases, tipsFrom } from "../stack.js";
import { renderForest } from "../stackRender.js";
import { detectTrunk, fetchOpenPrs } from "../trunk.js";
import { colors, fail, success } from "../ui.js";

const { prompt } = enquirer;
const ui = cliui();

export async function checkoutCommand(): Promise<void> {
  const [trunk, current, info, parents, recordedBases] = await Promise.all([
    detectTrunk(),
    currentBranch(),
    readBranchInfo(),
    readParents(),
    readRecordedBases(),
  ]);

  const forest = buildForest({ trunk, tips: tipsFrom(info), parents, recordedBases });
  const { map: prMap, ghFailed } = await fetchOpenPrs([...forest.nodes.keys()]);

  // Same graph as `flo stack`, then an interactive picker wrapped around it.
  const { lines, order } = renderForest(forest, { current, info, prMap });

  console.log("");
  for (const line of lines) console.log(line);
  console.log("");

  if (ghFailed) {
    console.log(
      colors.dim(
        "  Tip: could not list open PRs. Install the GitHub CLI (gh) and run gh auth login to show PR numbers here.",
      ),
    );
    console.log("");
  }

  if (order.length <= 1) fail("Nothing to check out — only trunk exists.");

  const choices = order.map((branch) => {
    const pr = prMap.get(branch);
    const hint = pr ? `PR#${pr}` : branch === trunk ? "(trunk)" : prMap.size > 0 ? "—" : "";
    return { name: branch, message: branch, ...(hint ? { hint } : {}) };
  });
  const limit = Math.min(order.length, Math.max(10, Math.min(18, (process.stdout.rows ?? 30) - 8)));
  const res = (await prompt({
    type: "autocomplete",
    name: "v",
    message: "Checkout which branch? (type to filter, ↑↓ scroll) ",
    choices,
    limit,
    initial: Math.max(
      0,
      order.findIndex((b) => b === current),
    ),
  } as never)) as { v: string };

  const target = res.v;
  if (!target || target === current) return;
  if (!(await branchExists(target))) fail(`Branch ${target} doesn't exist.`);

  const prOnTarget = prMap.get(target);

  await ui
    .tasks()
    .add(`Switching to ${target}`, async (task) => {
      task.update(`git checkout ${target}`);
      const co = await git(["checkout", "--quiet", target], { allowFail: true });
      if (co.exitCode !== 0) return task.error(co.stderr.trim() || "checkout failed");
      return "switched";
    })
    .run();

  const prNote = prOnTarget !== undefined ? `  ${colors.dim(`·  PR#${prOnTarget}`)}` : "";
  success(`Switched to ${colors.bold(target)}${prNote}`);
}
