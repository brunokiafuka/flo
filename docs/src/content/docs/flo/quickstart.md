---
title: Quickstart
description: Install flo, configure your defaults, and ship your first PR.
---

## Install

`flo` ships on npm as [`flo-tools`](https://www.npmjs.com/package/flo-tools) (its binary is `flo`). Install it globally:

```bash
npm install -g flo-tools
```

Or run it on demand without installing:

```bash
npx flo-tools --help
```

Upgrade later with:

```bash
npm install -g flo-tools@latest
```

The source lives under [`tools/flo`](https://github.com/brunokiafuka/flo/tree/main/tools/flo). For the release flow, see the **[Contributing guide](./contributing.md)**.

## First-run setup

`flo setup` walks you through a one-time per-repo config — trunk branch, optional branch-name prefix, default PR submission mode. Config is stored **outside the repo**, under `~/.flo/projects/<host>/<owner>/<repo>/config.yml`, so there's nothing to `.gitignore`.

```
? Trunk branch (main)
? Prefix your branches with a personal tag? (Y/n)
? Prefix (bk)
? How should `flo submit` open PRs? (Use arrow keys)
❯ Draft — safer default, ready for review later
  Open — immediately ready for review
```

You don't strictly need to run `flo setup` first — any other command will offer to run it inline if no config is found.

## A typical loop

```bash
flo sync                  # fetch, prune merged branches, restack
flo commit -a -m "wip"    # branches off trunk if needed, then commits
flo submit                # push + open a draft PR

# come back later
flo modify -a             # amend with new changes
flo submit                # PR is updated automatically by the push
```

## Run project recipes

`flo run <name>` executes commands declared in a repo's `flo.yml`. Top-level shortcut works too: `flo test` if `test` isn't a built-in.

```yaml
# flo.yml
commands:
  test:
    description: Run the test suite
    command: pnpm --filter flo test
    aliases: [t]
```

```bash
flo test          # → pnpm --filter flo test
flo t -- --watch  # extra args appended with shell-safe quoting
```

For the full `flo.yml` schema, see **[Configuration](./configuration.md)**.

## Where to next

- The full **[Command reference](./commands.md)** with every flag.
- Common **[Recipes](./recipes.md)** for `flo.yml`.
- The **[Contributing guide](./contributing.md)** if you want to hack on flo itself.
