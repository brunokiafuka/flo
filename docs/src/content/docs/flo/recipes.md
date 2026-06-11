---
title: Recipes
description: Ready-made `flo.yml` patterns
---

A scratchpad of `flo.yml` snippets that solve real problems. For the underlying schema, see **[Configuration](./configuration.md)**.

## A single recipe that chains multiple commands

```yaml
commands:
  ship:
    description: Lint, test, push
    command: pnpm lint && pnpm --filter flo test && flo submit
```

Anything `$SHELL -c` can run, a `command:` field can run — `&&`, pipes, env vars, redirection.

## An interactive release / setup script

```yaml
commands:
  release-flo:
    description: Bump version, commit, push to main
    command: sh scripts/release.sh
    aliases: [fr]
    interactive: true
```

Without `interactive: true`, `flo run` would capture the script's output in a boxed panel and silently drop any prompts. With it on, the child sees your TTY directly. Reach for this for `gh auth login`, REPLs, anything that expects a TTY.

## Per-workspace tests in a monorepo

```yaml
commands:
  test-flo:
    command: pnpm --filter flo test
    aliases: [tf]
  test-all:
    command: pnpm -r test
    aliases: [ta]
```

## Bootstrap that sets up local tooling

```yaml
init:
  - deps:
      name: Install dependencies
      run: pnpm install
  - hooks:
      name: Install git hooks
      run: pnpm --filter flo exec install-hooks
  - env-file:
      name: Create .env from template
      run: "[ -f .env ] || cp .env.example .env"
```

The `[ -f .env ] || …` guard makes the step idempotent — re-running `flo init` won't clobber an existing `.env`.

## Pass-through args with `--`

```yaml
commands:
  test:
    command: pnpm --filter flo test
    aliases: [t]
```

```bash
flo t -- --watch         # appends "--watch" to the resolved command
flo t -- --grep "sync"   # quoted properly through the shell
```

Use `--` whenever your extra args start with a flag flo might otherwise try to parse.

## A "doctor" recipe

```yaml
commands:
  doctor:
    description: Check the dev environment is sane
    command: |
      node --version
      pnpm --version
      gh --version
      git --version
```

Multi-line `command:` strings work — YAML's `|` block scalar preserves newlines, and the shell runs them as a script.
