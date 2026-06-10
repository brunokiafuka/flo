import { spawn } from "node:child_process";

import cliProgress from "cli-progress";
import type { ExecaError } from "execa";
import { execa } from "execa";

import { colors } from "./ui.js";

export type GitResult = { stdout: string; stderr: string; exitCode: number };

/** Run git and capture output. Throws on non-zero unless `allowFail` is true. */
export async function git(args: string[], opts: { allowFail?: boolean } = {}): Promise<GitResult> {
  try {
    const r = await execa("git", args, { reject: !opts.allowFail });
    return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode ?? 0 };
  } catch (e) {
    const err = e as ExecaError;
    return {
      stdout: String(err.stdout ?? ""),
      stderr: String(err.stderr ?? ""),
      exitCode: typeof err.exitCode === "number" ? err.exitCode : 1,
    };
  }
}

/** Run git with inherited stdio (for editors, rebase, etc.). Returns exit code. */
export async function gitInherit(args: string[]): Promise<number> {
  try {
    const r = await execa("git", args, { stdio: "inherit" });
    return r.exitCode ?? 0;
  } catch (e) {
    const err = e as ExecaError;
    return typeof err.exitCode === "number" ? err.exitCode : 1;
  }
}

export async function currentBranch(): Promise<string> {
  const r = await git(["rev-parse", "--abbrev-ref", "HEAD"]);
  return r.stdout.trim();
}

export async function hasUncommittedChanges(): Promise<boolean> {
  const r = await git(["status", "--porcelain"]);
  return r.stdout.trim().length > 0;
}

export async function hasUnstagedChanges(): Promise<boolean> {
  // `diff --quiet` exits 1 when there are unstaged changes.
  const r = await git(["diff", "--quiet"], { allowFail: true });
  return r.exitCode !== 0;
}

export async function hasStagedChanges(): Promise<boolean> {
  // `diff --cached --quiet` exits 1 when there are staged changes.
  const r = await git(["diff", "--cached", "--quiet"], { allowFail: true });
  return r.exitCode !== 0;
}

export async function localBranches(): Promise<string[]> {
  const r = await git(["for-each-ref", "--format=%(refname:short)", "refs/heads/"]);
  return r.stdout
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function branchExists(name: string): Promise<boolean> {
  const r = await git(["show-ref", "--verify", "--quiet", `refs/heads/${name}`], {
    allowFail: true,
  });
  return r.exitCode === 0;
}

/** Run `git fetch --progress <args>` and render a live cli-progress bar. */
export function gitFetch(args: string[]): Promise<{ exitCode: number; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("git", ["fetch", "--progress", ...args]);
    let stderrBuf = "";
    let bar: cliProgress.SingleBar | null = null;
    let currentPhase = "";

    const ensureBar = (): cliProgress.SingleBar => {
      if (bar) return bar;
      bar = new cliProgress.SingleBar(
        {
          format: `${colors.cyan("{phase}")} ${colors.green("{bar}")} ${colors.bold("{percentage}%")}`,
          barCompleteChar: "█",
          barIncompleteChar: "░",
          barsize: 24,
          hideCursor: true,
          clearOnComplete: true,
          linewrap: false,
        },
        cliProgress.Presets.shades_classic,
      );
      bar.start(100, 0, { phase: "".padEnd(22, " ") });
      return bar;
    };

    child.stderr.on("data", (buf: Buffer) => {
      const text = buf.toString();
      stderrBuf += text;
      for (const chunk of text.split(/[\r\n]/)) {
        const trimmed = chunk.trim();
        if (!trimmed) continue;
        const pctMatch = trimmed.match(/(\d+)%/);
        if (!pctMatch) continue;
        const pct = Math.min(100, Math.max(0, parseInt(pctMatch[1], 10)));
        const phase = (trimmed.split(":")[0] ?? "").slice(0, 22).padEnd(22, " ");
        const activeBar = ensureBar();
        if (phase !== currentPhase) {
          currentPhase = phase;
        }
        activeBar.update(pct, { phase });
      }
    });

    const finish = (exitCode: number, stderr: string) => {
      if (bar) {
        bar.update(100);
        bar.stop();
        bar = null;
      }
      resolve({ exitCode, stderr });
    };

    child.on("close", (code) => finish(code ?? 0, stderrBuf));
    child.on("error", (err) => finish(1, err.message));
  });
}

export async function upstreamOf(branch: string): Promise<string | null> {
  const r = await git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", `${branch}@{u}`], { allowFail: true });
  if (r.exitCode !== 0) return null;
  return r.stdout.trim() || null;
}
