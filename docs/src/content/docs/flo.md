---
title: What's flo?
description: A local flow orchestrator — git, PRs, and project recipes in one tool.
---

`flo` is the first tool in [toolkit](/toolkit/). It's your local flow orchestrator — it wraps the handful of git invocations you'd otherwise type a hundred times a day, with safer defaults and friendlier output.

## What it does

- **`flo sync`** — fetches origin, prunes merged branches, restacks the rest onto trunk.
- **`flo checkout`** — picks a branch from a graph view.
- **`flo commit`** / **`flo modify`** — guards against committing on trunk; prompts for a branch name.
- **`flo push`** — pushes with `--force-with-lease`, hints at `flo sync` when upstream is stale.
- **`flo submit`** — pushes and opens (or updates) a PR, draft by default.
- **`flo run`** — runs per-project recipes declared in `flo.yml`.
- **`flo init`** — runs the bootstrap steps in `flo.yml` (post-clone setup).

## Who it's for

Solo devs and small teams who like git's model but find its surface area punishing. flo doesn't replace git — it just gives you fewer chances to bend it the wrong way.

## Where to next

- New here? Walk through the **[Quickstart](./get-started/quickstart.md)**.
- Using a coding agent? Install the **[flo skill](./get-started/skill.md)** and drive your workflow with `/flo`.
- Looking up a specific command? See **[Reference → Commands](./reference/commands.md)**.
- Setting up per-project recipes? See **[Reference → Configuration](./reference/configuration.md)** and **[Recipes](./reference/recipes.md)**.
- Hacking on flo itself? See the **[Contributing guide](./contributing/guide.md)**.
