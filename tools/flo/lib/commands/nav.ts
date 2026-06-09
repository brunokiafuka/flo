import { currentBranch, git } from "../git.js";
import {
  buildForest,
  type Forest,
  navBottom,
  navDown,
  navTop,
  navUp,
  type NavResult,
  readBranchInfo,
  readParents,
  readRecordedBases,
  tipsFrom,
} from "../stack.js";
import { detectTrunk, fetchOpenPrs } from "../trunk.js";
import { colors, fail, success } from "../ui.js";

export type NavDir = "up" | "down" | "top" | "bottom";

const RESOLVERS: Record<NavDir, (forest: Forest, branch: string) => NavResult> =
  {
    up: navUp,
    down: navDown,
    top: navTop,
    bottom: navBottom,
  };

/** `flo stack nav up` / `down` / `top` / `bottom` — move along the stack via flo-parent. */
export async function navCommand(dir: NavDir): Promise<void> {
  const [trunk, current, info, parents, recordedBases] = await Promise.all([
    detectTrunk(),
    currentBranch(),
    readBranchInfo(),
    readParents(),
    readRecordedBases(),
  ]);

  const forest = buildForest({
    trunk,
    tips: tipsFrom(info),
    parents,
    recordedBases,
  });
  const res = RESOLVERS[dir](forest, current);

  if ("error" in res) fail(res.error);
  const target = res.target;
  if (target === current) {
    success(`Already on ${colors.bold(current)}.`);
    return;
  }

  const co = await git(["checkout", "--quiet", target], { allowFail: true });
  if (co.exitCode !== 0)
    fail(co.stderr.trim() || `Couldn't switch to ${target}.`);

  const { map: prMap } = await fetchOpenPrs([target]);
  const pr = prMap.get(target);
  const prNote = pr != null ? `  ${colors.dim(`·  PR#${pr}`)}` : "";
  success(`Switched to ${colors.bold(target)}${prNote}`);
}
