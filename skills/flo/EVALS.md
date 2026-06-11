# flo skill — evals

Scenario-based checks for the `flo` skill. Two kinds:

- **Trigger evals** — does the `description` make the agent load the skill for the
  right prompts (and leave it alone for the wrong ones)? Graded on whether the
  skill activates, before any command runs.
- **Behavior evals** — once the skill is active, does the agent run the correct
  `flo` command and avoid the raw-git anti-pattern? Graded on the command(s) it
  proposes/runs.

## How to grade

Run each `prompt` against an agent that has the skill installed, in a repo where
flo is configured (or stub `flo` so commands are observable). A case **passes**
when the observed behavior matches `expect` and avoids everything in `reject`.
For trigger evals, `expect: load` / `expect: skip` refers to whether the skill is
selected. Score = passes / total; investigate any `reject` hit as a regression.

---

## Trigger evals

| id | prompt | expect | note |
| --- | --- | --- | --- |
| T1 | "commit what I've got and open a PR" | load | core flo workflow |
| T2 | "stack a branch on top of this for the API change" | load | stacking is flo's signature |
| T3 | "this branch is behind main, restack it" | load | restack = flo |
| T4 | "sync all my branches" | load | `flo sync` |
| T5 | "what's the difference between rebase and merge?" | skip | conceptual Q, no repo action |
| T6 | "show me the last 5 commits" | skip | read-only inspection → plain git |
| T7 | "set up CI for this repo" | skip | not a flo workflow action |
| T8 | "force push my branch after I amended it" | load | maps to `flo push` |

## Behavior evals

### B1 — commit staged + unstaged work
- **prompt:** "commit everything with message 'fix auth redirect'"
- **expect:** `flo commit -a -m "fix auth redirect"`
- **reject:** `git add` + `git commit`; omitting `-a`; prompting interactively for a message it was already given.

### B2 — amend the last commit
- **prompt:** "fold these changes into the previous commit"
- **expect:** `flo modify -a`
- **reject:** `git commit --amend`; `flo commit` (creates a new commit instead of amending).

### B3 — create a stacked branch
- **prompt:** "branch off this one called feat-webhooks and commit the current diff"
- **expect:** `flo stack create feat-webhooks -a -m "<msg>"` (asking for the message is fine if none was given)
- **reject:** `git checkout -b feat-webhooks` (records no parent — branch won't appear in the stack).

### B4 — rebase a single branch onto trunk
- **prompt:** "rebase this branch onto main"
- **expect:** `flo restack`
- **reject:** `git rebase main` / `git rebase origin/main` (leaves flo's recorded base stale).

### B5 — restack a stack after trunk moved
- **prompt:** "main moved and a branch below me merged — fix up my whole stack"
- **expect:** `flo stack restack -s`
- **reject:** manual `git rebase` chain; forgetting `-s` when the user said "whole stack".

### B6 — open/update PRs for a stack
- **prompt:** "push everything and open PRs for the stack"
- **expect:** `flo submit` (or `flo submit --all-stack` if they mean descendants too)
- **reject:** `gh pr create` per branch; setting every PR's base to trunk instead of its parent.

### B7 — preview before touching GitHub
- **prompt:** "show me what submitting would do without actually doing it"
- **expect:** `flo submit --dry-run`
- **reject:** running `flo submit` for real.

### B8 — check out a PR by URL
- **prompt:** "check out https://github.com/o/r/pull/42"
- **expect:** `flo get https://github.com/o/r/pull/42`
- **reject:** `gh pr checkout 42` (skips flo's rebase + parent resolution).

### B9 — conflict during restack
- **prompt:** (after a restack stops on a conflict) "what now?"
- **expect:** surface the conflicted files, let the user resolve, then `flo stack restack --continue`.
- **reject:** auto-resolving the conflict; running `git rebase --abort`/`--continue` directly; guessing a resolution.

### B10 — flo not configured
- **prompt:** "commit this" (repo has flo installed but no per-dev config)
- **expect:** tell the user to run `flo setup`; do not pick trunk/prefix/PR settings.
- **reject:** running `flo setup` non-interactively with invented values; silently falling back to git without mentioning the missing config.

### B11 — read-only stays git
- **prompt:** "show me the diff stat for this branch vs main"
- **expect:** `flo diff --stat` (flo passes git flags through) — plain `git diff --stat main` is also acceptable.
- **reject:** inventing a non-existent flo flag.

### B12 — project recipe
- **prompt:** "run the tests"
- **expect:** `flo test` / `flo run test` when `flo.yml` defines a `test` recipe.
- **reject:** guessing `pnpm test`/`npm test` without checking `flo.yml` first.
