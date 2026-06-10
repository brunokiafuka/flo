import { currentBranch } from "../git.js";
import {
  buildForest,
  readBranchInfo,
  readParents,
  readRecordedBases,
  tipsFrom,
} from "../stack.js";
import { renderForest } from "../stackRender.js";
import { detectTrunk, fetchOpenPrs } from "../trunk.js";
import { colors, fail } from "../ui.js";

import { navCommand, type NavDir } from "./nav.js";
import { stackCreateCommand, type StackCreateOpts } from "./stackCreate.js";
import { stackRestackCommand, type StackRestackOpts } from "./stackRestack.js";

const NAV_DIRS = new Set<NavDir>(["up", "down", "top", "bottom"]);

/**
 * `flo stack [view]` — read-only forest graph with `needs restack` flags and PR
 * numbers. The default subcommand, so bare `flo stack` shows the graph.
 */
export async function stackViewCommand(): Promise<void> {
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

function parseStackCreate(argv: string[]): StackCreateOpts {
  const opts: StackCreateOpts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "-m":
      case "--message":
        opts.message = argv[++i];
        if (!opts.message) fail("-m requires a message argument");
        break;
      case "-a":
      case "--all":
        opts.all = true;
        break;
      default:
        if (a.startsWith("-")) fail(`Unknown flag for stack create: ${a}`);
        if (opts.name) fail(`Unexpected extra argument for stack create: ${a}`);
        opts.name = a;
    }
  }
  return opts;
}

function parseStackRestack(argv: string[]): StackRestackOpts {
  const opts: StackRestackOpts = {};
  for (const a of argv) {
    switch (a) {
      case "-s":
      case "--stack":
        opts.stack = true;
        break;
      case "--continue":
        opts.continue = true;
        break;
      case "--no-pull":
        opts.noPull = true;
        break;
      default:
        if (a.startsWith("-")) fail(`Unknown flag for stack restack: ${a}`);
        if (opts.branch) fail(`Unexpected extra argument for stack restack: ${a}`);
        opts.branch = a;
    }
  }
  return opts;
}

/** `flo stack [<subcommand>]` — dispatcher. Bare/`view` shows the graph. */
export async function stackCommand(argv: string[]): Promise<void> {
  const [sub, ...rest] = argv;
  switch (sub) {
    case undefined:
    case "view":
      await stackViewCommand();
      break;
    case "create":
      await stackCreateCommand(parseStackCreate(rest));
      break;
    case "restack":
      await stackRestackCommand(parseStackRestack(rest));
      break;
    case "nav": {
      const dir = rest[0];
      if (!dir)
        fail("flo stack navigates needs a direction: up | down | top | bottom");
      if (!NAV_DIRS.has(dir as NavDir))
        fail(`Unknown direction "${dir}". Try: up | down | top | bottom`);
      await navCommand(dir as NavDir);
      break;
    }
    default:
      fail(
        `Unknown stack subcommand "${sub}". Try: flo stack [view] | flo stack create | flo stack restack | flo stack nav <dir>`,
      );
  }
}
