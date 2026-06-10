---
title: Commands
description: Every flo command, its flags, and behavior notes.
---

`flo` is your local flow orchestrator — git, PRs, and project recipes in one tool. It wraps the handful of git invocations you'd otherwise type a hundred times a day, with safer defaults and friendlier output.

- [`flo setup`](#flo-setup) — configure your per-dev settings for this repo (supports `--update` to tweak a single field)
- [`flo sync`](#flo-sync) — pull trunk, clean up merged branches, restack the whole forest
- [`flo stack`](#flo-stack) — view, create, restack, and navigate stacked branches
- [`flo checkout`](#flo-checkout) — pick a branch from a graph view
- [`flo get`](#flo-get-target) — fetch + checkout a remote branch
- [`flo restack`](#flo-restack-branch) — rebase a single branch onto trunk (flat)
- [`flo add`](#flo-add) — stage everything
- [`flo commit`](#flo-commit) — create a commit
- [`flo modify`](#flo-modify) — amend (or create) a commit
- [`flo push`](#flo-push) — push with `--force-with-lease`
- [`flo submit`](#flo-submit) — push and open/update PRs (stack-aware, draft or ready-for-review per `pr.mode`)
- [`flo run`](#flo-run-name-args) — run a project command defined in `flo.yml`
- [`flo init`](#flo-init) — run the bootstrap steps in `flo.yml`

> New to stacked branches? Start with the **[Stacked branches guide](../guides/stacking.md)** — it explains the model and walks the lifecycle visually. This page is the flag-by-flag reference.

---

## `flo setup`

Interactive setup: writes a YAML config with your trunk branch, an optional branch-name prefix, and your default PR submission mode. Config lives **outside the repo**, under `~/.flo/projects/<host>/<owner>/<repo>/config.yml` (or `$XDG_CONFIG_HOME/flo/...` on Linux when that variable is set) — nothing to `.gitignore`. Every command reads this file when present; if it's missing, flo offers to run setup inline before continuing (see [Auto-prompt on first use](#auto-prompt-on-first-use) below).

**Flags**

| Flag           | What                                                                                |
| -------------- | ----------------------------------------------------------------------------------- |
| `-u, --update` | Skip the overwrite/update chooser and go straight to picking which fields to tweak. |

**What it asks**

1. **Trunk branch** — auto-detects from `origin/HEAD`, falls back to `main`/`master`.
2. **Prefix your branches with a personal tag?** — yes/no. Handy on shared repos where everyone's branches share a root namespace (`bk/add-feature`, `alice/fix-bug`). Defaults to yes when flo detects your git email.
3. **Prefix** — if yes. Defaults to the local part of your `git config user.email`. Validated against a safe subset for git refs (letters, digits, `._-`).
4. **PR submission mode** — `draft` (the default — safer, flip ready-for-review when you're ready) or `open` (immediately ready-for-review). Used by [`flo submit`](#flo-submit).

**Example run (fresh)**

```
? Trunk branch (main)
? Prefix your branches with a personal tag? (Y/n)
? Prefix (bk)
? How should `flo submit` open PRs? (Use arrow keys)
❯ Draft — safer default, ready for review later
  Open — immediately ready for review

✔ Wrote ~/.flo/projects/github.com/owner/repo/config.yml

  trunk:      main
  prefix:     bk
  pr mode:    draft

  Example:    add_new_feature → bk/add_new_feature
```

**Config shape on disk**

```yaml
trunk: main
branch:
  template: "{user}/{slug}" # or "{slug}" when no prefix
  user: bk # omitted when no prefix
pr:
  mode: draft # or "open"
```

Setup only writes the two template shapes above (`{user}/{slug}` and `{slug}`). The tokens are an implementation detail — `{user}` expands to `branch.user`, `{slug}` to a slugified commit subject (lowercase, spaces → `_`, git-invalid chars stripped, 60 chars max). Power users can hand-edit the YAML for other patterns like `"{user}-{slug}"`; the UI never exposes the tokens.

The template is applied wherever flo suggests a branch name (currently: the trunk-guard prompt in `commit` and `modify`).

### Re-running setup

When a config already exists, `flo setup` prints the current values and offers three choices:

| Choice                       | What                                                                                                                  |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Update specific settings** | Checkbox picker: trunk, branch prefix, PR mode. Only the chosen fields are re-prompted; everything else is preserved. |
| **Overwrite from scratch**   | Walks the full wizard again, pre-filled from the existing config.                                                     |
| **Cancel**                   | Bail out without writing.                                                                                             |

`flo setup --update` skips the chooser and jumps straight to the field picker — useful for quick one-off tweaks (`flo setup --update` → pick PR mode → pick `open`).

**Changing trunk is treated as destructive.** flo warns that the previous trunk will no longer be protected from direct commits by [`flo commit`](#flo-commit) / [`flo modify`](#flo-modify), and asks for explicit confirmation (defaults to **No**). Declining keeps the old trunk.

**Slot path resolution**

flo derives the slot from your `origin` remote. SSH and HTTPS forms of the same remote resolve to the **same slot** — re-cloning with a different URL scheme keeps your config.

| Origin URL                          | Slot                                                                         |
| ----------------------------------- | ---------------------------------------------------------------------------- |
| `git@github.com:owner/repo.git`     | `~/.flo/projects/github.com/owner/repo/`                                     |
| `https://github.com/owner/repo.git` | `~/.flo/projects/github.com/owner/repo/`                                     |
| `ssh://git@github.com/owner/repo`   | `~/.flo/projects/github.com/owner/repo/`                                     |
| `https://gitlab.com/group/sub/repo` | `~/.flo/projects/gitlab.com/group/sub/repo/`                                 |
| (no `origin` remote)                | `~/.flo/projects/_local/<dirname>/` — setup warns when this fallback is used |

Normalization: lowercase the host, strip `www.`, strip trailing `.git` / `/`. Unusual URL shapes (empty paths, `..` segments) fall back to the `_local/` slot.

**Legacy paths.** Existing repos with `.flo/config.json` or `.flo.json` keep working — flo falls back to those when no user-level config exists. Re-running `flo setup` writes the new YAML location; you can delete the old `.flo/` directory afterwards (a dedicated `--migrate` flow will handle this automatically in a later release).

### Auto-prompt on first use

Any command other than `setup` / `help` checks for a loadable config before running. If none is found, flo asks inline:

```
  No flo config found for this repo (expected at ~/.flo/projects/github.com/owner/repo/config.yml).
? Run flo setup now? (Y/n)
```

- **Yes** — runs setup, then continues with the original command
- **No** — prints a polite reminder and continues with defaults
- **Non-TTY** (CI, piped input) — skips the prompt, prints the reminder, continues

---

## `flo sync`

Syncs the **whole forest**: pulls trunk, cleans up merged branches, and rebases every stack onto its parents. It's `flo stack restack` applied across all your stacks at once — the command to run after a round of PRs lands. For the conceptual walkthrough, see the [Stacked branches guide](../guides/stacking.md#syncing-everything--flo-sync).

**What it does**

1. **Pull trunk** — `git fetch origin --prune` (with a progress bar), then fast-forward local `<trunk>` to `origin/<trunk>` (without a checkout when you're on another branch). Degrades gracefully when there's no `origin` remote.
2. **Clean up merged branches** — finds them two ways and re-parents their children onto the branch below before deleting them:
   - Local git heuristics — real merges, upstream-gone branches, and squash-merges via `git cherry` patch-equivalence.
   - GitHub — head refs of merged PRs (`gh pr list --state merged`). Fails open if `gh` is unavailable.
   - A merged **root** drops out and its children become new roots on trunk. Deletion is automatic — these branches have already landed.
3. **Restack every branch** onto its parent, replaying only that branch's own commits.

**Conflicts are reported, not paused.** Because sync touches the whole forest, a single conflict doesn't halt the run: the conflicting branch is rolled back (`git rebase --abort`) and the rest keep syncing. At the end you land back on your original branch, with a clean tree and a list of the few branches that need a hands-on fix:

```
! Unable to cleanly sync the following branches:
  - s2
  Run flo stack restack <branch> on each to resolve the conflict by hand.
```

> Compare with [`flo stack restack`](#flo-stack), which scopes to a single stack and **pauses** on conflict so you can resolve and `--continue`.

---

## `flo stack`

Everything for **stacked branches** — chains of dependent branches where each branch is its own PR based on the one below it. See the [Stacked branches guide](../guides/stacking.md) for the model and a visual walkthrough; this section is the flag reference. Bare `flo stack` runs the `view` subcommand.

flo tracks one fact per branch — its **parent** — in git config (`branch.<name>.flo-parent`), plus the parent's tip when the branch was last branched or restacked (`flo-parent-sha`, the **recorded base**). A branch with no parent is treated as a root on trunk. Nothing here touches your repo's working tree config; it's all per-repo state under git config.

### `flo stack view`

Draws the whole forest, **tip on top, trunk at the bottom**, with each branch's open PR number, tip commit, and a `⚠ needs restack` flag when its recorded base has drifted from its parent's tip. `●` marks the current branch, `○` the rest. Forks render side by side and merge into the shared parent.

```
  ●  wire_auth        PR#43  8cdc55d  wire up auth   ← current
  │
  ○  add_login_form   PR#42  9e4123d  add login form
  │
  ○  add_the_button   PR#41  c549273  add the button
  │
  main
```

PR numbers come from a single `gh pr list` call; without `gh` the graph still renders, just without PR numbers.

### `flo stack create [name]`

Creates a branch stacked on the **current** branch and commits in one go (≈ `gt create`). The current branch becomes the new branch's parent — start from trunk for a new root, from a stacked branch to go deeper. Same code path either way.

| Flag                  | What                                                 |
| --------------------- | ---------------------------------------------------- |
| `-m, --message <msg>` | commit message (prompts if omitted)                  |
| `-a, --all`           | stage all changes first                              |

The branch name is the explicit `name` argument if given, otherwise a slug of the commit message. It always commits, so it refuses on a clean tree (stage a change or pass `-a`).

### `flo stack nav <direction>`

Move along the stack via the parent pointers — just a `git checkout`, no rebase.

| Direction | Moves to                                   |
| --------- | ------------------------------------------ |
| `up`      | the child (toward the tip)                 |
| `down`    | the parent (toward trunk)                  |
| `top`     | the tip of the stack                       |
| `bottom`  | the root (the branch sitting on trunk)     |

`up` on a fork is ambiguous and tells you to use `flo checkout` to pick a child.

### `flo stack restack [branch]`

Heals a drifted stack. It **pulls trunk**, **cleans up merged branches** (re-parenting their children onto the branch below, deleting the merged ones), then **rebases** each branch onto its parent's new tip with `git rebase --onto`, replaying only that branch's own commits.

By default it restacks the path **up to the current branch** (or `[branch]`) and flags any descendants above that are now stale. It widens to the whole stack automatically when a cleanup re-parented branches.

| Flag             | What                                                                   |
| ---------------- | ---------------------------------------------------------------------- |
| `-s, --stack`    | restack the whole stack (the current branch's descendants too)         |
| `--no-pull`      | skip the fetch / fast-forward; restack against local trunk only        |
| `--continue`     | resume after resolving a conflict                                      |

**Conflicts pause.** The rebase is left in progress; resolve it, `git rebase --continue`, then `flo stack restack --continue` finishes the rest — branches already restacked stay done. (State lives in `.git/flo-restack-state.json`.)

```
› Restacking 2 branches…
  ✓ add_the_button → main
  ✓ add_login_form → add_the_button

! Branches above add_login_form still need a restack: wire_auth
  Run flo stack restack -s to include them.
```

> `flo stack restack` is one stack and pauses on conflict; [`flo sync`](#flo-sync) is the whole forest and reports conflicts at the end instead.

---

## `flo checkout`

Alias: `flo co`

Renders the same graph as [`flo stack`](#flo-stack) — the whole forest, tip on top, with PR numbers and `⚠ needs restack` flags — then wraps an interactive picker around it. The current branch is marked with `●` and preselected. Pick a branch to switch to.

```
  ○  wire_auth        PR#43  8cdc55d  wire up auth
  │
  ●  add_login_form   PR#42  9e4123d  add login form
  │
  ○  add_the_button   PR#41  c549273  add the button
  │
  main

? Checkout which branch? ›
  ❯ add_login_form
    wire_auth
    add_the_button
    main  (trunk)
```

Selecting the current branch is a no-op.

---

## `flo get [target]`

Fetches and checks out a branch, rebasing only that one branch. Defaults to the current branch if no target is given.

`<target>` can be:

- **A branch name** — fetched from `origin` and rebased onto its upstream.
- **A fork ref** like `user:branch` — looked up via `gh api` to find the matching PR, then handed off to `gh pr checkout <number>`. Prefers open PRs when a head ref has multiple.
- **A PR URL** like `https://github.com/owner/repo/pull/9` — validated and passed through to `gh pr checkout <url>`.

Useful when a teammate has force-pushed and you want the clean version without affecting your other branches, or when you're reviewing a PR from a fork.

After a successful checkout, `flo get` checks whether the branch is behind `origin/<trunk>` and hints at `flo restack` when it is.

Requires `gh` to be installed and authenticated for the fork-ref and URL forms.

---

## `flo restack [branch]`

Rebases the named branch (or current branch) **onto trunk** — the flat, single-branch case. It leaves conflicts open for you to resolve.

> For stacked branches, use [`flo stack restack`](#flo-stack) instead: it rebases onto the branch's **parent** (not trunk), walks the whole stack, pulls trunk, and cleans up merged branches. `flo restack` is the trunk-only special case.

---

## `flo add`

Stages all tracked and untracked changes (`git add -A`). No flags.

---

## `flo commit`

Creates a new commit on the current branch.

**Flags**

| Flag                  | What                                |
| --------------------- | ----------------------------------- |
| `-m, --message <msg>` | commit message (prompts if omitted) |
| `-a, --all`           | stage all changes first             |

**Trunk guard.** If you run `flo commit` while on `main`/`master`, flo first collects the commit message, then prompts for a new branch name — prefilled with a slug derived from the message (spaces → `_`, invalid chars stripped, capped at 60 chars). You can edit the suggestion or accept it. flo then runs `git checkout -b <name>` before the commit, so your work never lands directly on trunk.

---

## `flo modify`

Amend (or create) a commit on the current branch.

**Flags**

| Flag                  | What                                    |
| --------------------- | --------------------------------------- |
| `-m, --message <msg>` | amend with a new message                |
| `-a, --all`           | stage all changes first                 |
| `-c, --commit`        | create a new commit instead of amending |
| `-e, --edit`          | open the editor for the amended message |

**No-own-commits fallback.** If the branch has no commits of its own yet (trunk..HEAD count is 0), amending would rewrite trunk's HEAD — so flo silently falls through to creating a new commit instead. The trunk guard from `flo commit` also applies here.

---

## `flo push`

Pushes the current branch with `--force-with-lease`. On first push (no upstream set), uses `git push -u origin HEAD` instead.

Detects a stale upstream and tells you to `flo sync` rather than spewing git's native error.

---

## `flo submit`

Pushes and opens (or updates) PRs. Requires the [`gh`](https://cli.github.com/) CLI. **Stack-aware automatically** — there's no flag to flip. On a plain branch it opens one PR against trunk; on a stacked branch it pushes the ancestor chain bottom-up and opens **one PR per branch, each based on its parent**. flo reads the parent pointers to tell which case you're in. See the [Stacked branches guide](../guides/stacking.md#reviewing-a-stack--flo-submit) for the walkthrough.

**Submit set**

| Flag          | What                                                            |
| ------------- | -------------------------------------------------------------- |
| `--all-stack` | extend to the whole stack (descendants too), not just the path up to the current branch |
| `--dry-run`   | print the plan (push set, PR create/retarget, comment refresh) without touching GitHub |

By default the submit set is the **path up to your current branch** (the current branch plus its ancestors). Ancestors are always pushed first — GitHub rejects a PR whose base ref isn't on the remote yet.

**Status badges**

| Badge       | When                                    |
| ----------- | --------------------------------------- |
| `(created)` | no PR existed — a new one was opened    |
| `(updated)` | PR exists and the head moved            |
| `(no-op)`   | PR exists and local HEAD == remote HEAD |

**Flow (per branch, bottom-up)**

1. Push the branch (`--force-with-lease`; skipped when `(no-op)`).
2. **Create** the PR with `--base <parent>` (draft when `pr.mode=draft`, the default — configure via [`flo setup`](#flo-setup)), or **retarget** an existing PR whose base no longer matches its parent (`gh pr edit --base`).
3. Once every PR number is known, refresh the **stack comment** on each PR.

```
❯ Submitted #41 add the button (no-op)
❯ Submitted #42 add login form (updated)
❯ Submitted #43 wire up auth (created)

✓ current wire_auth: https://github.com/owner/repo/pull/43
```

**Stack comment.** Every PR in the stack gets a single sticky comment mapping the stack, with 👈 marking the PR it's posted on. It's found and rewritten in place via an invisible `<!-- flo-stack -->` marker (never duplicated), and reads tip-on-top to match `flo stack`:

```markdown
- #43  👈 you are here
- #42
- #41

Stack tip on top, trunk at the bottom · Added via flo 🌊
```

**Merged guard.** If a branch below you has already merged, `flo submit` stops rather than target a base that no longer exists, and points you at `flo sync` + `flo stack restack` to re-parent first:

```
! Already merged: add_the_button (#41)
  A PR below you has landed. Run flo sync then flo stack restack to re-parent
  the stack onto trunk, then submit again.
```

---

## `flo run <name> [args]`

Runs a project command defined in **`flo.yml`** at the repo root. Output streams live inside a bordered panel with a status footer (exit code + duration).

For the full `flo.yml` schema (fields, aliases, validation errors) see **[Configuration](./configuration.md)**.

**Invocation**

```
flo run test         # by name
flo run t            # by alias
flo test             # top-level shortcut (only when "test" isn't a built-in)
flo t                # alias at top level
```

Built-ins always win at the top level — define a recipe called `commit` and you'll still need `flo run commit` to reach it. Extra args after the recipe name are appended to the resolved command with shell-safe quoting.

**Output**

```
  ▶ test  pnpm --filter flo test
  │
  │ ... streamed stdout/stderr, line by line ...
  │
  ✓ done in 756ms
```

Non-zero exit shows a red `✗` footer with the exit code, and `flo` exits with the same code.

**Interactive recipes.** Set `interactive: true` on a recipe when the command needs to prompt the user (release scripts, `gh auth login`, etc.). Flo inherits stdio instead of buffering, so prompts and live output reach the terminal directly. Default behavior stays the same for non-interactive recipes. See [Configuration → `commands`](./configuration.md#commands).

`flo run` does not require `flo setup` — recipes are independent of trunk/user config.

---

## `flo init`

Runs the `init:` steps in `flo.yml` in declared order. Designed for post-clone bootstrap — install deps, run migrations, seed data.

For the `init:` schema (step shape, required/optional fields, validation errors) see **[Configuration → `init`](./configuration.md#init)**.

**Behavior**

- Sequential. Stops on the first non-zero exit — later steps don't run.
- No completion tracking. Safe to re-run — make your steps idempotent.
- Exits with the failing step's exit code.

**Output**

```
  ▶ init  2 steps
  │
  │ [1/2] Install dependencies
  │ $ pnpm install
  │
  │ ... streamed output ...
  │
  │ ✓ Install dependencies — 641ms
  │
  │ [2/2] Run migrations
  │ $ pnpm db:migrate
  │
  │ ... streamed output ...
  │
  │ ✓ Run migrations — 312ms
  │
  ✓ init done in 953ms (2/2 steps)
```

On failure: `✗ <step> failed in Xs (exit N) — stopping` followed by `N/M steps completed before failure`.
