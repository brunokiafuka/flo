---
title: Skills
description: Install the flo skill so your coding agent drives your git workflow through flo.
---

flo ships an **agent skill**. Once installed, your coding agent reaches for `flo` — stack, commit, restack, submit — instead of raw git, which keeps your stack metadata (recorded parents, restack flags) consistent in ways a stray `git checkout -b` or `git rebase` would quietly break.

It's a plain skill folder, so it works with any agent that supports skills.

## Install

```bash
npx skills add brunokiafuka/toolkit/skills/flo
```

This pulls the `skills/flo` skill from the toolkit repo into your agent's skills directory. Re-run it any time to update.

## Use it

Invoke it explicitly with `/flo` and describe what you want — for example, create a stack:

```text
/flo stack a branch called feat-webhooks for the handler and commit what I've got
```

A few more:

```text
/flo restack my stack onto main
/flo push and open PRs for the whole stack
/flo amend the last commit with these changes
```

The skill also activates on its own whenever you ask for a flo-shaped action — commit, branch, stack, restack, sync, push, or open a PR — in a repo where flo is set up.

## What it does

- **Maps intent → command.** "stack a branch" → `flo stack create`, "rebase onto main" → `flo restack`, "open PRs" → `flo submit`.
- **Protects the stack.** It steers away from raw `git checkout -b` / `git rebase` / `gh pr create`, which bypass flo's parent tracking.
- **Knows the guardrails.** It leaves merge conflicts open for you to resolve (resume with `flo stack restack --continue`), and won't run `flo setup` or guess your trunk/prefix/PR settings.

:::note
The skill drives flo — it doesn't install it. Make sure `flo` is on your PATH and configured first; see the [Quickstart](./quickstart.md).
:::
