import { stat } from "node:fs/promises";

import { cliui } from "@poppinss/cliui";
import { execa } from "execa";

import { resolveConfig } from "../config.js";
import { currentBranch, git, hasUncommittedChanges, upstreamOf } from "../git.js";
import { prTemplatePath, resolveSlot } from "../slot.js";
import { buildForest, readBranchInfo, readParents, readRecordedBases, restackScope, tipsFrom } from "../stack.js";
import { detectTrunk } from "../trunk.js";
import { colors, fail, success, warn } from "../ui.js";
import { pushNamedBranch } from "./push.js";

const ui = cliui();

export type SubmitOpts = {
  allStack?: boolean; // expand the submit set to the whole stack (descendants too)
  dryRun?: boolean;
};

// ─── stack-nav comment (pure, unit-tested) ───────────────────────────────────

export const FLO_STACK_MARKER = "<!-- flo-stack -->";
const FLO_STACK_END = "<!-- /flo-stack -->";

export type StackCommentEntry = {
  branch: string;
  number: number;
};

/**
 * Render the sticky stack-nav block, numbered base→tip (1 = first to merge),
 * with 👈 marking the PR this comment is posted on. Wrapped in an invisible
 * sentinel so we can find-and-update our own comment instead of duplicating it.
 */
export function renderStackComment(entries: StackCommentEntry[], forBranch: string): string {
  // entries arrive base→tip; render tip-on-top so the comment reads like the
  // terminal `flo stack`.
  const rows = entries.map((e) => {
    const here = e.branch === forBranch ? "  👈 you are here" : "";
    return `- #${e.number}${here}`;
  });
  rows.reverse();
  return [
    FLO_STACK_MARKER,
    ...rows,
    "",
    "<sub>Stack tip on top, trunk at the bottom · Added via flo 🌊</sub>",
    FLO_STACK_END,
  ].join("\n");
}

/** Pick the id of our managed comment from a PR's comment list, or null. */
export function pickFloCommentId(comments: { id: number; body: string }[]): number | null {
  const mine = comments.find((c) => (c.body ?? "").includes(FLO_STACK_MARKER));
  return mine ? mine.id : null;
}

// ─── gh helpers ──────────────────────────────────────────────────────────────

type PrInfo = {
  number: number;
  url: string;
  isDraft: boolean;
  state: string;
  baseRefName: string;
  title: string;
} | null;

async function ensureGh(): Promise<void> {
  try {
    await execa("gh", ["--version"]);
  } catch {
    fail("`gh` CLI not found. Install it from https://cli.github.com/ and run `gh auth login`.");
  }
}

async function openUrl(url: string): Promise<void> {
  const platform = process.platform;
  const cmd = platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    await execa(cmd, args, { reject: false, stdio: "ignore" });
  } catch {
    /* best-effort */
  }
}

async function hasNonEmptyFile(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isFile() && s.size > 0;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw e;
  }
}

/** First commit on `branch` since its `parent` — the natural PR title. */
async function firstCommitSubject(branch: string, parent: string): Promise<string> {
  const since = await git(["log", `${parent}..${branch}`, "--reverse", "--format=%s", "-n", "1"], { allowFail: true });
  const subject = since.stdout.trim();
  if (subject) return subject;
  return (await git(["log", "-1", "--format=%s", branch], { allowFail: true })).stdout.trim();
}

async function buildCreateArgs(branch: string, parent: string, isDraft: boolean): Promise<string[]> {
  const base = ["pr", "create", "--base", parent, "--head", branch];
  if (isDraft) base.push("--draft");
  const templatePath = prTemplatePath(await resolveSlot());
  if (!(await hasNonEmptyFile(templatePath))) {
    const title = (await firstCommitSubject(branch, parent)) || branch;
    return [...base, "--title", title, "--fill"];
  }
  const title = (await firstCommitSubject(branch, parent)) || branch;
  return [...base, "--title", title, "--body-file", templatePath];
}

async function lookupPr(branch: string): Promise<PrInfo> {
  try {
    const r = await execa("gh", ["pr", "view", branch, "--json", "number,url,isDraft,state,baseRefName,title"]);
    return JSON.parse(r.stdout) as NonNullable<PrInfo>;
  } catch {
    return null;
  }
}

/** Create or update our sticky stack-nav comment on a PR. */
async function upsertStackComment(prNumber: number, body: string): Promise<void> {
  let existingId: number | null = null;
  try {
    const r = await execa("gh", ["api", `repos/{owner}/{repo}/issues/${prNumber}/comments`]);
    const comments = JSON.parse(r.stdout) as { id: number; body: string }[];
    existingId = pickFloCommentId(comments);
  } catch {
    /* fall through to create */
  }
  if (existingId !== null) {
    await execa(
      "gh",
      ["api", "--method", "PATCH", `repos/{owner}/{repo}/issues/comments/${existingId}`, "-f", `body=${body}`],
      {
        reject: false,
      },
    );
  } else {
    await execa("gh", ["pr", "comment", String(prNumber), "--body", body], {
      reject: false,
    });
  }
}

// ─── status ──────────────────────────────────────────────────────────────────

type PrStatus = "create" | "updated" | "no update";

function badge(status: PrStatus): string {
  switch (status) {
    case "create":
      return colors.cyan("(created)");
    case "updated":
      return colors.yellow("(updated)");
    case "no update":
      return colors.dim("(no-op)");
  }
}

type Plan = {
  branch: string;
  parent: string;
  /** The PR title — existing PR's title, else the branch's first commit subject. */
  title: string;
  existing: PrInfo;
  status: PrStatus;
  retarget: boolean;
};

async function planFor(branch: string, parent: string): Promise<Plan> {
  const existing = await lookupPr(branch);
  const title = existing?.title || (await firstCommitSubject(branch, parent)) || branch;
  let status: PrStatus;
  if (!existing) {
    status = "create";
  } else {
    const upstream = await upstreamOf(branch);
    if (!upstream) {
      status = "updated";
    } else {
      const local = (await git(["rev-parse", branch])).stdout.trim();
      const remote = (await git(["rev-parse", upstream], { allowFail: true })).stdout.trim();
      status = local && remote && local === remote ? "no update" : "updated";
    }
  }
  const retarget = !!existing && existing.baseRefName !== parent;
  return { branch, parent, title, existing, status, retarget };
}

function showDirtyTreeHint(): void {
  ui.sticker()
    .heading(colors.yellow().bold("You've got uncommitted changes"))
    .add("")
    .add(`Tidy up first, then re-run ${colors.cyan("flo submit")}:`)
    .add("")
    .add(`  ${colors.cyan("flo add")}     stage everything`)
    .add(`  ${colors.cyan("flo modify")}  fold the changes into your last commit`)
    .add("")
    .add(colors.dim("— or stage and commit them yourself."))
    .render();
}

// ─── command ─────────────────────────────────────────────────────────────────

export async function submitCommand(opts: SubmitOpts = {}): Promise<void> {
  await ensureGh();

  const branch = await currentBranch();
  if (!branch || branch === "HEAD") fail("You're in detached HEAD — check out a branch first.");

  if (await hasUncommittedChanges()) {
    showDirtyTreeHint();
    process.exit(1);
  }

  const [trunk, info, parents, recordedBases] = await Promise.all([
    detectTrunk(),
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

  if (branch === trunk) fail(`You're on ${trunk} — switch to a branch to submit.`);

  // Submit set: path up to current (bottom-up); --all-stack expands to the stack.
  const set = restackScope(forest, branch, !!opts.allStack);
  if (set.length === 0) fail(`Nothing to submit for ${branch}.`);

  const parentOf = (b: string) => forest.nodes.get(b)?.parent ?? trunk;

  // Pre-flight: a stale branch will submit a head that isn't rebased on its parent.
  const stale = set.filter((b) => forest.nodes.get(b)?.needsRestack);
  if (stale.length > 0) {
    warn(`Heads up — these branches need a restack first: ${stale.map((b) => colors.bold(b)).join(", ")}`);
    console.log(
      colors.dim(`  Run ${colors.cyan(`flo stack restack${opts.allStack ? " -s" : ""}`)} to heal them, then submit.`),
    );
    console.log("");
  }

  const plans: Plan[] = [];
  for (const b of set) plans.push(await planFor(b, parentOf(b)));

  // Stop if a branch below us has already merged — its children still point at
  // it locally, so submitting now would target a dead base. Re-parent first.
  const merged = plans.filter((p) => p.existing?.state === "MERGED");
  if (merged.length > 0) {
    warn(`Already merged: ${merged.map((p) => `${colors.bold(p.branch)} (#${p.existing?.number})`).join(", ")}`);
    console.log(
      colors.dim(
        `  A PR below you has landed. Run ${colors.cyan("flo sync")} then ${colors.cyan(
          "flo stack restack",
        )} to re-parent the stack onto trunk, then submit again.`,
      ),
    );
    process.exit(1);
  }

  // ── dry run: print the plan, touch nothing ──
  if (opts.dryRun) {
    console.log(colors.bold("flo submit — dry run"));
    console.log("");
    console.log(`  Push (bottom-up): ${set.join(", ")}`);
    console.log("");
    for (const p of plans) {
      const action =
        p.status === "create" ? "create" : p.retarget ? "retarget" : p.status === "updated" ? "update" : "no change";
      console.log(`  ${colors.bold(p.branch.padEnd(20))} ${action.padEnd(9)} base=${p.parent}  ${badge(p.status)}`);
    }
    if (set.length > 1) {
      console.log("");
      console.log(`  Comment: refresh the stack block on ${set.length} PRs`);
    }
    return;
  }

  // ── execute: push bottom-up, then create/retarget bottom-up ──
  const tm = ui.tasks();
  const urls = new Map<string, string>();
  const numbers = new Map<string, number>();
  let failed = false;

  plans.forEach((p, idx) => {
    const prRef = p.existing ? `#${p.existing.number} ` : "";
    tm.add(`Submitting ${prRef}${p.title} ${badge(p.status)}`, async (task) => {
      // 1. push (skip the network when the head is already up to date)
      if (p.status !== "no update") {
        const push = await pushNamedBranch(p.branch);
        if (push.exitCode !== 0) {
          failed = true;
          if (/stale info|rejected|non-fast-forward|force-with-lease/i.test(push.stderr)) {
            return task.error("remote moved on — run flo sync first");
          }
          return task.error(push.stderr.trim().split("\n").pop() ?? "push failed");
        }
      }

      // 2. create / retarget / nothing
      if (!p.existing) {
        const { prMode } = await resolveConfig();
        const isDraft = prMode === "draft";
        const r = await execa("gh", await buildCreateArgs(p.branch, p.parent, isDraft), { reject: false });
        if (r.exitCode !== 0) {
          failed = true;
          return task.error(r.stderr?.trim().split("\n").pop() ?? "gh pr create failed");
        }
        const url = r.stdout.match(/https?:\/\/\S+/)?.[0] ?? "";
        urls.set(p.branch, url);
        const fresh = await lookupPr(p.branch);
        if (fresh) numbers.set(p.branch, fresh.number);
      } else {
        numbers.set(p.branch, p.existing.number);
        urls.set(p.branch, p.existing.url);
        if (p.retarget) {
          const r = await execa("gh", ["pr", "edit", p.branch, "--base", p.parent], { reject: false });
          if (r.exitCode !== 0) {
            failed = true;
            return task.error(r.stderr?.trim().split("\n").pop() ?? "retarget failed");
          }
        }
      }

      // Flip the label to past tense on completion. Task.title is mutable and
      // the success renderer reads it after the callback resolves, so the line
      // shows "Submitting" while running and "Submitted" once done.
      const n = numbers.get(p.branch);
      tm.tasks()[idx].title = `Submitted ${n ? `#${n} ` : ""}${p.title} ${badge(p.status)}`;
      return "";
    });
  });

  await tm.run();
  if (failed || tm.getState() === "failed") process.exit(1);

  // ── refresh the sticky stack-nav comment on every PR in the set ──
  if (set.length > 1) {
    const entries: StackCommentEntry[] = set
      .filter((b) => numbers.has(b))
      .map((b) => ({ branch: b, number: numbers.get(b) as number }));

    if (entries.length > 1) {
      // Silent + parallel: each PR's comment is independent.
      await Promise.all(entries.map((e) => upsertStackComment(e.number, renderStackComment(entries, e.branch))));
    }
  }

  const url = urls.get(branch) || "";
  const link = url ? colors.cyan(url) : colors.dim("(no url)");
  console.log("");
  success(`current ${colors.bold(branch)}: ${link}`);

  const { openBrowser } = await resolveConfig();
  const currentPlan = plans.find((p) => p.branch === branch);
  const shouldOpen = !!url && (openBrowser === "always" || (openBrowser === "new" && currentPlan?.status === "create"));
  if (shouldOpen) await openUrl(url);
}
