import { cliui } from "@poppinss/cliui";
import { execa } from "execa";

import { currentBranch, upstreamOf } from "../git.js";
import { fail, success, warn } from "../ui.js";

const ui = cliui();

export type PushResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  firstPush: boolean;
};

/**
 * Push a named branch with --force-with-lease, setting upstream on first push.
 * Works without checking the branch out (needed for stacked submit's bottom-up
 * push of the whole ancestor chain).
 */
export async function pushNamedBranch(branch: string): Promise<PushResult> {
  const upstream = await upstreamOf(branch);
  const args = upstream
    ? ["push", "--force-with-lease", "origin", branch]
    : ["push", "-u", "origin", branch];
  const r = await execa("git", args, { reject: false });
  return {
    exitCode: r.exitCode ?? 0,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    firstPush: !upstream,
  };
}

/** Core push used by both `flo push` and `flo submit`. Captures output. */
export async function pushCurrentBranch(): Promise<{ branch: string; result: PushResult }> {
  const branch = await currentBranch();
  if (!branch || branch === "HEAD") {
    fail("You're in detached HEAD — check out a branch first.");
  }
  return { branch, result: await pushNamedBranch(branch) };
}

export async function pushCommand(): Promise<void> {
  let result: PushResult | null = null;
  let branchName = "";

  await ui
    .tasks()
    .add("Pushing", async (task) => {
      const { branch, result: r } = await pushCurrentBranch();
      branchName = branch;
      result = r;
      task.update(r.firstPush ? `git push -u origin HEAD (${branch})` : `git push --force-with-lease (${branch})`);
      if (r.exitCode !== 0) {
        return task.error(r.stderr.trim().split("\n").pop() ?? "push failed");
      }
      return r.firstPush ? "set upstream to origin" : "up to date";
    })
    .run();

  if (!result || (result as PushResult).exitCode !== 0) {
    const stderr = result ? (result as PushResult).stderr : "";
    if (stderr && /stale info|rejected|non-fast-forward|force-with-lease/i.test(stderr)) {
      warn("Remote has moved on since your last fetch. Run `flo sync` first, then try again.");
    } else if (stderr.trim()) {
      process.stderr.write(`${stderr}\n`);
    }
    process.exit((result as PushResult | null)?.exitCode || 1);
  }

  success(
    (result as PushResult).firstPush
      ? `🚀 Pushed ${branchName} and set it tracking origin/${branchName}`
      : `🚀 Pushed ${branchName}`,
  );
}
