import { cliui } from "@poppinss/cliui";

import { currentBranch, git, hasStagedChanges, hasUncommittedChanges, hasUnstagedChanges } from "../git.js";
import { suggestBranchName } from "../guards.js";
import { setParent } from "../stack.js";
import { colors, confirm, fail, promptInput, success } from "../ui.js";

const ui = cliui();

export type StackCreateOpts = {
  name?: string;
  message?: string;
  all?: boolean;
};

/**
 * `flo stack create [name] [-m <msg>] [-a]` — create a branch stacked on the
 * *current* branch and commit in one go (the stacking entry point, ≈ `gt create`).
 *
 * The current branch becomes the new branch's flo-parent; its HEAD is recorded
 * as the base. Current may be trunk (→ a new stack root) or any branch (→ deeper
 * in the stack) — same code path. Because it always commits, a message always
 * exists, so the name can always be derived from it when not given.
 */
export async function stackCreateCommand(opts: StackCreateOpts): Promise<void> {
  const parent = await currentBranch();
  const parentSha = (await git(["rev-parse", "HEAD"])).stdout.trim();

  if (!opts.all && (await hasUnstagedChanges())) {
    const yes = await confirm("You have unstaged changes. Stage them all?", true);
    if (yes) opts.all = true;
  }

  // flo branch is a commit-in-one-go verb: refuse when there's nothing to commit.
  const willCommit = opts.all ? await hasUncommittedChanges() : await hasStagedChanges();
  if (!willCommit) {
    fail("Nothing to commit — stage a change (or pass -a) so flo branch has something to put on the new branch.");
  }

  let message = opts.message?.trim();
  if (!message) {
    message = await promptInput("What's the commit message?");
    if (!message) fail("I need a message to commit.");
  }

  const name = opts.name?.trim() || (await suggestBranchName(message));
  if (!name) fail("Couldn't work out a branch name — pass one explicitly.");

  const tm = ui.tasks();
  let commitOutput = "";

  tm.add(`Creating ${name} on top of ${parent}`, async (task) => {
    task.update(`git checkout -b ${name}`);
    const r = await git(["checkout", "-b", name], { allowFail: true });
    if (r.exitCode !== 0) return task.error(r.stderr.trim() || "couldn't create branch");
    return "branched";
  });

  if (opts.all) {
    tm.add("Staging all changes", async (task) => {
      task.update("git add -A");
      const r = await git(["add", "-A"], { allowFail: true });
      if (r.exitCode !== 0) return task.error(r.stderr.trim() || "git add failed");
      return "staged";
    });
  }

  tm.add("Committing", async (task) => {
    task.update(`git commit -m "${message!.slice(0, 60)}${message!.length > 60 ? "…" : ""}"`);
    const r = await git(["commit", "-m", message!], { allowFail: true });
    commitOutput = [r.stdout, r.stderr].filter(Boolean).join("\n");
    if (r.exitCode !== 0) return task.error("commit didn't go through");
    return "committed";
  });

  await tm.run();

  if (tm.getState() === "failed") {
    if (commitOutput.trim()) {
      console.error("");
      for (const line of commitOutput.split("\n")) {
        if (line.trim()) console.error(`  ${colors.dim("│")} ${line}`);
      }
      console.error("");
    }
    process.exit(1);
  }

  // Record the parent pointer only once the branch + commit actually landed.
  await setParent(name, parent, parentSha);
  success(`Created ${colors.bold(name)} stacked on ${colors.bold(parent)}`);
}
