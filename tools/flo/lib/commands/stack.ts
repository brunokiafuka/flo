import { currentBranch } from "../git.js";
import { buildForest, readBranchInfo, readParents, readRecordedBases, tipsFrom } from "../stack.js";
import { renderForest } from "../stackRender.js";
import { detectTrunk, fetchOpenPrs } from "../trunk.js";
import { colors } from "../ui.js";

/** `flo stack` — read-only forest graph with `needs restack` flags and PR numbers. */
export async function stackCommand(): Promise<void> {
  const [trunk, current, info, parents, recordedBases] = await Promise.all([
    detectTrunk(),
    currentBranch(),
    readBranchInfo(),
    readParents(),
    readRecordedBases(),
  ]);

  const forest = buildForest({ trunk, tips: tipsFrom(info), parents, recordedBases });
  const { map: prMap, ghFailed } = await fetchOpenPrs([...forest.nodes.keys()]);

  const { lines } = renderForest(forest, { current, info, prMap });

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
}
