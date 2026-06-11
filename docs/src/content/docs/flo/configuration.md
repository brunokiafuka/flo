---
title: Configuration
description: The flo.yml schema — recipes, init steps, and validation rules.
---

Every repo can ship a **`flo.yml`** at its root to declare project-specific commands and a bootstrap sequence. The file is committed alongside the code so the same `flo test` / `flo init` works from any fresh clone.

For ready-made templates, see **[Recipes](./recipes.md)**. For how the commands are invoked, see **[Commands → `flo run`](./commands.md#flo-run-name-args)**.

```yaml
# flo.yml — lives at the repo root
project: "Workflow"            # optional label

init:
  - install-dependencies:
      name: Install dependencies
      run: pnpm install

commands:
  test:
    description: Run the test suite
    command: pnpm --filter flo test
    aliases: [t]
```

---

## Top-level fields

| Field | Type | Required | Purpose |
| ----- | ---- | -------- | ------- |
| `project` | string | no | Display label. Purely cosmetic today; reserved for future UI. |
| `init` | list | no | Steps run in order by [`flo init`](./commands.md#flo-init). |
| `commands` | map | no | Named recipes runnable via [`flo run`](./commands.md#flo-run-name-args). |

Anything else is ignored. Flo fails loud on malformed entries (invalid type, missing `run`, duplicate alias, etc.) with the file path in the error.

---

## `commands`

A map of **name → recipe**. Names must be valid YAML keys; pick something short and typeable.

```yaml
commands:
  test:
    description: Run the test suite
    command: pnpm --filter flo test
    aliases: [t]
  build:
    command: pnpm --filter flo build
  lint:
    description: Typecheck + lint
    command: pnpm lint && pnpm typecheck
```

**Fields**

| Field | Type | Required | Notes |
| ----- | ---- | -------- | ----- |
| `command` | string | ✅ | Raw shell string. Passed through your `$SHELL` (`-c`), so `&&`, pipes, env vars, and quoting all work. |
| `description` | string | no | One-liner shown in listings. |
| `aliases` | string[] | no | Alternate names. Must be unique across the file and must not shadow another command's primary name. |
| `interactive` | boolean | no | When `true`, the recipe inherits flo's stdio — prompts from the child (`read`, `inquirer`, `gh auth login`, etc.) reach your terminal directly. Default (`false`) buffers output inside a boxed panel, which deadlocks on any command that asks for input. Turn this on for release scripts, interactive CLIs, or anything that expects a TTY. |

**Invocation rules**

```
flo run test        # by name
flo run t           # by alias
flo test            # top-level shortcut (works when no built-in shares the name)
flo t               # alias at the top level
flo t -- --watch    # extra args are appended with shell-safe quoting
```

Built-ins (`sync`, `commit`, `push`, `setup`, etc.) always win at the top level. If you name a recipe `commit`, you can still reach it via `flo run commit` — but not `flo commit`, which always invokes the built-in.

**Extra arguments** passed after the recipe name are appended verbatim (with quoting for anything that contains whitespace or shell special characters). Use `--` if your args start with a flag that flo might try to parse.

---

## `init`

A **list of single-key maps**, one per step. The key is the step id; the value is the step config.

```yaml
init:
  - install-dependencies:
      name: Install dependencies
      run: pnpm install
  - run-migrations:
      name: Run migrations
      run: pnpm db:migrate
  - seed:
      run: pnpm db:seed         # name omitted — falls back to the id "seed"
```

**Fields per step**

| Field | Type | Required | Notes |
| ----- | ---- | -------- | ----- |
| `run` | string | ✅ | Shell string. Same semantics as a recipe's `command`. |
| `name` | string | no | Human-friendly label shown in `flo init` output. Defaults to the step id. |

**Behavior**

- Steps run **sequentially** in declared order.
- On the first non-zero exit, flo prints the failure, lists how many steps completed, and exits with that step's exit code — later steps do not run.
- **No completion tracking.** Flo re-runs every step every time. Write idempotent steps:
  - `pnpm install` is already idempotent (no-op on an up-to-date lockfile).
  - Migration runners skip applied migrations by design.
  - For bespoke seed scripts, gate with `if [ ! -f .seeded ]; then …; fi` or similar.
- The step's `run` inherits the shell environment, so things like `NODE_ENV`, `PATH`, and your shell's aliases all apply.

---

## Validation errors

Flo reads `flo.yml` on every `flo run` and `flo init` invocation. Typical errors:

| Error | Cause |
| ----- | ----- |
| `commands.<name>.command is required (string)` | Missing or non-string `command`. |
| `alias "x" is defined on both "a" and "b"` | Two commands list the same alias. |
| `alias "x" on "a" shadows another command` | Alias matches a primary command name. |
| `commands.<name>.interactive must be a boolean` | `interactive:` set to anything other than `true` / `false`. |
| `init must be a list of steps` | `init:` isn't a YAML list. |
| `init[N] must have exactly one step id as key` | A step map has zero or multiple keys at the top level. |
| `init step "x" is defined twice` | Duplicate step id. |
| `init step "x".run is required (string)` | Missing or non-string `run`. |

All errors include the absolute path to the offending `flo.yml`.

---

## Why `flo.yml` (and not `.flo/config.json`)

`flo.yml` is the **project-facing, committed** file — team-visible recipes and bootstrap. It lives at the repo root alongside `package.json` / `Makefile`.

Personal, per-developer flo settings (trunk override, branch prefix) live in a separate **user-level** file outside the repo — see [Commands → `flo setup`](./commands.md#flo-setup). The two files are independent: `flo run` does not require `flo setup`, and vice versa.
