---
name: flo
description: Drive the user's git workflow through the `flo` CLI instead of raw git — create and stack branches, commit, amend, restack onto trunk, sync the branch forest, push, and open/update stacked PRs. Use when working in a repo configured with flo (a `flo` binary on PATH and per-dev config under ~/.flo) and the user asks to commit, branch, stack, restack, sync, push, diff, or submit/open a PR. Reaching for flo keeps its stack metadata (recorded parents, restack flags) consistent in ways raw `git checkout -b` / `git rebase` / `git push` would silently break.
---

<what-to-do>

When the user asks for a git-workflow action in a flo repo, run the matching `flo` command rather than the raw git equivalent. flo records each branch's parent and tracks the branch forest; raw `git checkout -b`, `git rebase`, and `git push` bypass that bookkeeping and leave the stack inconsistent.

Before relying on flo, confirm it applies: `flo` is on PATH and the repo has per-dev config (flo stores it under `~/.flo`, not in the repo). If `flo <cmd>` reports no config, tell the user to run `flo setup` — do not run setup for them or guess trunk/prefix/PR settings. If flo is not installed at all, fall back to raw git and say so.

Map the user's intent to one command (full table in supporting-info). The common ones:

- commit work → `flo commit -a -m "msg"` (branches off trunk automatically if needed)
- amend the last commit → `flo modify -a` (`-m` new message, `-c` new commit instead, `-e` editor)
- stack a new branch on the current one → `flo stack create <name> -a -m "msg"`
- rebase onto trunk → `flo restack` (one branch) or `flo stack restack` (pull trunk, prune merged, restack the path)
- refresh everything → `flo sync`
- push → `flo push` (uses `--force-with-lease`)
- open/update PRs → `flo submit` (stack-aware: each PR's base is its parent)

Pass a `-m` message yourself when you already know it; only let flo prompt interactively when you genuinely need the user to decide. Never invent a flag — if an intent has no flo command, use git and say why.

Read-only inspection (`git status`, `git log`, `git show`) stays plain git — flo is for the mutating workflow, not for replacing every git call.

</what-to-do>

<supporting-info>

## Intent → command

| User wants | Command |
| --- | --- |
| Update trunk, prune merged branches, restack every stack | `flo sync` |
| Fetch + check out a branch / PR URL / `user:branch` fork ref, rebasing just it | `flo get [target]` (defaults to current branch) |
| Pick a local branch from a graph view | `flo checkout` (alias `co`) |
| Show the branch forest with PRs and "needs restack" flags | `flo stack` |
| Stack a new branch on the current one and commit in one go | `flo stack create [name] -a -m "msg"` |
| Move along the stack | `flo stack nav <up\|down\|top\|bottom>` |
| Pull trunk, prune merged, rebase the path up to current | `flo stack restack` (`-s` whole stack incl. descendants, `--no-pull` local only, `--continue` after a conflict, `[branch]` restack up to a named branch) |
| Rebase current (or named) branch onto trunk | `flo restack [branch]` |
| See what this branch changes vs trunk | `flo diff` (`-c`/`--copy` to clipboard; passes through git flags like `--stat`, `--name-only`) |
| Stage everything (`git add -A`) | `flo add` |
| New commit on current branch | `flo commit [-a] [-m "msg"]` |
| Amend / re-commit | `flo modify [-a] [-m "msg"] [-c new commit] [-e editor]` |
| Force-push current branch (`--force-with-lease`, sets upstream first time) | `flo push` |
| Push + open/update stacked PRs | `flo submit` (`--all-stack` incl. descendants, `--dry-run` to preview) |
| Run a project recipe from `flo.yml` | `flo run <name> [args]` — or just `flo <name>` when no built-in clashes |
| Run project init steps from `flo.yml` | `flo init` |
| Configure per-dev settings | `flo setup` (`--update` to tweak in place) |

## Stacking mental model

flo treats branches as a forest. Each branch records its **parent** in git config; a stack is a chain of branches where each sits on the previous one's tip rather than directly on trunk. `flo stack` renders the forest tip-on-top and flags a branch "needs restack" when its recorded base has drifted from its parent's tip (e.g. the parent got amended or trunk moved).

This is why command choice matters:

- Create stacked branches with `flo stack create`, not `git checkout -b` — the latter records no parent, so the branch never appears in the stack and won't restack.
- Rebase with `flo restack` / `flo stack restack`, not `git rebase` — flo re-parents merged branches onto trunk and updates recorded bases; a manual rebase leaves the metadata stale.
- Open PRs with `flo submit`, not `gh pr create` — flo sets each PR's base to its parent branch and maintains a sticky "stack" comment across the PRs.

## Conflict handling

`flo restack`, `flo stack restack`, and `flo sync` leave merge conflicts open in the working tree for the user to resolve by hand — they do not auto-resolve or abort silently. After the user fixes the conflict, resume with `flo stack restack --continue` (for a stack restack). `flo sync` rolls back any branch it couldn't rebase cleanly and lists them at the end to fix individually with `flo stack restack`. When you hit a conflict, surface the conflicted files and hand control back to the user rather than guessing a resolution.

## Guardrails

- `flo push` force-pushes (`--force-with-lease`). It is the intended way to update a branch after a restack/amend, but it is still a force push — don't run it on a branch you haven't just rebased without flagging it.
- Don't run `flo setup` on the user's behalf or pick trunk/prefix/PR-mode values for them; that config is personal and lives outside the repo.
- `flo <something>` for an unknown command falls through to `flo run <something>` (a `flo.yml` recipe). If that's not what the user meant, you'll see "I don't know the command" — re-check the intent table.

</supporting-info>
