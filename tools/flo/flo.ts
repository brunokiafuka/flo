#!/usr/bin/env node
import inquirer from "inquirer";

import {
  addCommand,
  checkoutCommand,
  commitCommand,
  type CommitOpts,
  diffCommand,
  getCommand,
  initCommand,
  modifyCommand,
  type ModifyOpts,
  pushCommand,
  restackCommand,
  runCommand,
  setupCommand,
  type SetupOpts,
  stackCommand,
  submitCommand,
  syncCommand,
} from "./lib/commands/index.js";
import { configLabel, loadConfig } from "./lib/config.js";
import { listRecipeNames, loadRecipes, resolveRecipe } from "./lib/recipes.js";
import { c, fail } from "./lib/ui.js";
import { maybeNotifyUpdate } from "./lib/updater.js";

const HELP = `
flo — your local git workflow helper

Usage:
  flo sync                Fetch origin, fast-forward trunk, prompt to delete
                          merged branches, then rebase every local branch
                          onto trunk. Aborts on conflict and suggests flo restack.
  flo get [target]        Fetch and check out a branch, rebasing only that
                          one branch. Defaults to the current branch.
                          <target> can be:
                            • a branch name (fetched from origin)
                            • a fork ref like user:branch (resolved to its PR,
                              then handed to gh pr checkout)
                            • a PR URL like https://github.com/o/r/pull/N
                          Hints "flo restack" when the result is behind trunk.
  flo checkout            Pick a local branch from a graph view and switch to it.
  flo stack [view]        Show the whole branch forest (tip on top), with each
                          branch's open PR and a "needs restack" flag when its
                          recorded base has drifted from its parent's tip.
  flo stack create [name] Create a branch stacked on the current branch and
                          commit in one go. Records the current branch as the
                          new branch's parent (so it shows up in flo stack).
    -m <msg>              commit message (asks if omitted)
    -a                    stage all changes first
  flo stack nav <dir>    Move along the stack: up (toward the tip), down
                          (toward trunk), top (the tip), bottom (the branch
                          sitting on trunk).
  flo stack restack       Rebase the ancestor path up to the current branch onto
                          their parents (heals "needs restack"), and flag any
                          branches above you left stale.
    [branch]             restack the path up to <branch> instead of current
    -s, --stack          restack the whole stack (current's descendants too)
    --continue           resume after resolving a conflict
  flo restack [branch]    Rebase the current (or named) branch onto trunk,
                          leaving conflicts open for you to resolve.
  flo diff [flags]        Show what this branch changes vs trunk.
                          --copy / -c copies diff to clipboard.
                          Pass extra git flags like --stat or --name-only.
  flo add                 Stage all changes (git add -A).
  flo commit [flags]      Create a new commit on the current branch.
    -m <msg>              commit message (asks if omitted)
    -a                    stage all changes first
  flo modify [flags]      Amend (or create) a commit on the current branch.
    -m <msg>              amend with new message
    -a                    stage all changes first
    -c                    create a new commit instead of amending
    -e                    open editor for the amended message
  flo setup [--update]    Configure per-dev flo config for this repo (trunk,
                          branch prefix, PR mode). Stored under ~/.flo so
                          nothing touches your repo's .gitignore. Pass
                          --update to tweak specific settings in place
                          instead of overwriting the whole config.
  flo push                Push current branch with --force-with-lease
                          (sets upstream on first push).
  flo submit              Push and open/update the PR for the current branch.
                          Opens a new PR (draft or ready-for-review per your
                          flo setup) when none exists yet.
  flo run <name> [args]   Run a project command defined in flo.yml at the repo
                          root. Output is boxed with a status footer. You can
                          also invoke recipes directly: "flo test" is short for
                          "flo run test" when no built-in named "test" exists.
  flo init                Run the init: steps in flo.yml in order (install deps,
                          run migrations, seed data, etc). Stops on first
                          failure. Safe to re-run — make your steps idempotent.
  flo --help              Show this message.
`;

const BUILTIN_COMMANDS = new Set([
  "sync",
  "get",
  "checkout",
  "co",
  "stack",
  "add",
  "diff",
  "commit",
  "restack",
  "modify",
  "push",
  "setup",
  "submit",
  "run",
  "init",
]);

function parseCommit(argv: string[]): CommitOpts {
  const opts: CommitOpts = {};
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
        fail(`Unknown flag for commit: ${a}`);
    }
  }
  return opts;
}

function parseSetup(argv: string[]): SetupOpts {
  const opts: SetupOpts = {};
  for (const a of argv) {
    switch (a) {
      case "-u":
      case "--update":
        opts.update = true;
        break;
      default:
        fail(`Unknown flag for setup: ${a}`);
    }
  }
  return opts;
}

function parseModify(argv: string[]): ModifyOpts {
  const opts: ModifyOpts = {};
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
      case "-c":
      case "--commit":
        opts.newCommit = true;
        break;
      case "-e":
      case "--edit":
        opts.edit = true;
        break;
      default:
        fail(`Unknown flag for modify: ${a}`);
    }
  }
  return opts;
}

const UPDATE_SKIP_COMMANDS = new Set(["setup", "help", "--help", "-h"]);

function shouldCheckForUpdate(cmd: string | undefined): boolean {
  if (!cmd) return false;
  if (UPDATE_SKIP_COMMANDS.has(cmd)) return false;
  if (process.env.FLO_NO_UPDATE_CHECK === "1") return false;
  if (!process.stdout.isTTY) return false;
  return true;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);

  if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") {
    console.log(HELP);
    return;
  }

  // Top-level recipe dispatch: `flo <name>` routes to `flo run <name>` when
  // <name> isn't a built-in and matches a recipe in flo.yml.
  if (!BUILTIN_COMMANDS.has(cmd)) {
    const recipes = await loadRecipes();
    const recipe = recipes ? resolveRecipe(recipes, cmd) : null;
    if (recipe) {
      await runCommand(recipe.name, rest);
      return;
    }
    console.error(`I don't know the command "${cmd}".`);
    if (recipes && Object.keys(recipes.commands).length > 0) {
      console.error("");
      console.error(
        `Recipes in flo.yml: ${listRecipeNames(recipes).join(", ")}`,
      );
    }
    console.error(HELP);
    process.exit(1);
  }

  // Commands that don't need flo config — skip the setup prompt entirely.
  const NO_CONFIG_NEEDED = new Set(["setup", "run", "init"]);
  if (!NO_CONFIG_NEEDED.has(cmd) && (await loadConfig()) === null) {
    console.log(
      c.dim(
        `  No flo config found for this repo (expected at ${c.b(await configLabel())}).`,
      ),
    );
    if (process.stdout.isTTY) {
      const { runSetup } = await inquirer.prompt<{ runSetup: boolean }>([
        {
          type: "confirm",
          name: "runSetup",
          message: "Run flo setup now?",
          default: true,
        },
      ]);
      if (runSetup) {
        await setupCommand();
        console.log("");
      } else {
        console.log(
          c.dim(
            `  Carrying on with defaults. Run ${c.cyan("flo setup")} later when you're ready.`,
          ),
        );
      }
    } else {
      console.log(c.dim(`  Run ${c.cyan("flo setup")} to configure it.`));
    }
  }

  switch (cmd) {
    case "sync":
      await syncCommand();
      break;
    case "get":
      await getCommand(rest[0]);
      break;
    case "checkout":
    case "co":
      await checkoutCommand();
      break;
    case "stack":
      await stackCommand(rest);
      break;
    case "add":
      await addCommand();
      break;
    case "diff":
      await diffCommand(rest);
      break;
    case "commit":
      await commitCommand(parseCommit(rest));
      break;
    case "restack":
      await restackCommand(rest[0]);
      break;
    case "modify":
      await modifyCommand(parseModify(rest));
      break;
    case "push":
      await pushCommand();
      break;
    case "setup":
      await setupCommand(parseSetup(rest));
      break;
    case "submit":
      await submitCommand();
      break;
    case "run":
      await runCommand(rest[0], rest.slice(1));
      break;
    case "init":
      await initCommand();
      break;
    default:
      console.error(`I don't know the command "${cmd}".`);
      console.error(HELP);
      process.exit(1);
  }
}

main()
  .then(async () => {
    const cmd = process.argv[2];
    if (shouldCheckForUpdate(cmd)) await maybeNotifyUpdate();
  })
  .catch((err) => {
    // enquirer throws on Ctrl-C with an empty value — treat as clean exit.
    if (err === "" || err === undefined) {
      console.error("\nOK, cancelled.");
      process.exit(130);
    }
    fail(err instanceof Error ? err.message : String(err));
  });
