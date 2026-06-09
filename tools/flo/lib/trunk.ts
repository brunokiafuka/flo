import { execa } from "execa";

import { loadConfig } from "./config.js";
import { git, localBranches } from "./git.js";

/**
 * Ask GitHub which local branch names already have a merged PR.
 * Returns an empty set when `gh` is missing, unauthenticated, or fails —
 * this is purely additive to the git-based detection.
 */
export async function ghMergedHeads(): Promise<Set<string>> {
  try {
    const r = await execa("gh", ["pr", "list", "--state", "merged", "--limit", "200", "--json", "headRefName"], {
      reject: false,
    });
    if (r.exitCode !== 0) return new Set();
    const data = JSON.parse(r.stdout) as { headRefName: string }[];
    return new Set(data.map((d) => d.headRefName));
  } catch {
    return new Set();
  }
}

/**
 * One `gh pr list` call → map of branch → open PR number, shared by the stack
 * graph renderer (`flo stack`, `flo checkout`). `ghFailed` is true when `gh` is
 * missing/unauthenticated so callers can show a tip instead of silent blanks.
 */
export async function fetchOpenPrs(branches: string[]): Promise<{ map: Map<string, number>; ghFailed: boolean }> {
  const map = new Map<string, number>();
  if (branches.length === 0) return { map, ghFailed: false };
  try {
    const r = await execa("gh", ["pr", "list", "--json", "number,headRefName", "--state", "open", "--limit", "200"], {
      reject: false,
    });
    if (r.exitCode !== 0) return { map, ghFailed: true };
    const list = JSON.parse(r.stdout) as { number: number; headRefName: string }[];
    const wanted = new Set(branches);
    for (const pr of list) {
      if (wanted.has(pr.headRefName)) map.set(pr.headRefName, pr.number);
    }
  } catch {
    return { map, ghFailed: true };
  }
  return { map, ghFailed: false };
}

/** Detect the trunk branch name. Prefers .flo/config.json, then origin/HEAD, then main/master. */
export async function detectTrunk(): Promise<string> {
  const cfg = await loadConfig();
  if (cfg?.trunk) return cfg.trunk;

  const head = await git(["symbolic-ref", "refs/remotes/origin/HEAD"], {
    allowFail: true,
  });
  if (head.exitCode === 0) {
    const name = head.stdout.trim().replace(/^refs\/remotes\/origin\//, "");
    if (name) return name;
  }
  // Fallbacks: prefer main, then master, else first local branch.
  const locals = await localBranches();
  if (locals.includes("main")) return "main";
  if (locals.includes("master")) return "master";
  return locals[0] ?? "main";
}

/**
 * Find local branches that can be safely offered for deletion:
 *   1. Real merges into trunk (`git branch --merged`)
 *   2. Squash-merges — detected via `git cherry` patch-equivalence
 *   3. Upstream gone — remote tracking branch was pruned (fetch --prune),
 *      which almost always means the PR was merged and the remote cleaned up.
 */
export async function findMergedBranches(trunk: string): Promise<string[]> {
  const locals = (await localBranches()).filter((b) => b !== trunk);
  const candidates: string[] = [];

  // (1) Real merges — fast path.
  const merged = await git(["branch", "--merged", trunk, "--format=%(refname:short)"]);
  const mergedSet = new Set(
    merged.stdout
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s && s !== trunk),
  );

  // (3) Upstream-gone set: parse `upstream:track` per branch.
  const goneSet = new Set<string>();
  const tracking = await git(["for-each-ref", "--format=%(refname:short)%09%(upstream:track)", "refs/heads/"], {
    allowFail: true,
  });
  if (tracking.exitCode === 0) {
    for (const line of tracking.stdout.split("\n")) {
      const [name, track] = line.split("\t");
      if (!name || name === trunk) continue;
      if (track && track.includes("gone")) goneSet.add(name);
    }
  }

  for (const branch of locals) {
    if (mergedSet.has(branch) || goneSet.has(branch)) {
      candidates.push(branch);
      continue;
    }
    // (2) Squash-merge detection: `git cherry <trunk> <branch>` prints one
    // line per commit on branch-not-in-trunk. "+" = genuinely missing;
    // "-" = patch-equivalent (the typical squash-merge signature).
    const cherry = await git(["cherry", trunk, branch], { allowFail: true });
    if (cherry.exitCode !== 0) continue;
    const lines = cherry.stdout
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (lines.length === 0) continue;
    if (lines.every((l) => l.startsWith("-"))) {
      candidates.push(branch);
    }
  }

  return Array.from(new Set(candidates));
}
