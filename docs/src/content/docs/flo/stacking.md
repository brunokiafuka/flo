---
title: Stacked branches
description: Build, navigate, review, and sync chains of dependent branches — one PR per branch — with flo stack.
---

Most of the time a branch hangs off trunk on its own. But sometimes work is **layered**: feature B builds on feature A, and C builds on B. Waiting for A to merge before starting B stalls you; piling everything into one branch makes an unreviewable mega‑PR.

**Stacking** is the third option: keep each layer as its own branch and its own PR, where each PR's base is the branch below it. flo tracks the chain for you, keeps every branch rebased on its parent, and opens the PRs with the right bases.

```
trunk → add_button → add_login_form → wire_auth
         (PR #41)      (PR #42)         (PR #43)
```

Each arrow is a parent relationship. `add_login_form`'s PR is reviewed against `add_button`, not trunk — so reviewers see only the login‑form diff, not the button diff underneath it.

## Why stack?

- **Keep moving.** You don't have to wait for PR #41 to merge before starting #42. Build the next layer on top and keep shipping; the dependency is explicit, not a stall.
- **Small, reviewable PRs.** Each branch is one focused change with one diff. Reviewers approve a 40‑line PR, not a 600‑line one — and they review _your_ change, not the three changes underneath it.
- **Faster review, faster merge.** Small PRs get looked at sooner and merge sooner. The stack drains from the bottom as each layer lands.
- **Honest history.** One logical change per branch means a clean, bisectable trunk — instead of a single squashed commit that smuggles in five unrelated things.
- **No manual rebasing.** When trunk moves or a lower branch is amended or merged, `flo stack restack` (or `flo sync`) replays the whole chain for you and re‑points the PR bases. The bookkeeping that makes stacking painful by hand is the part flo automates.

The cost is that a stack is a chain of dependencies you have to keep in order — which is exactly the chore flo takes over. If a change is genuinely standalone, a plain branch on trunk is still the right tool; reach for a stack when the next piece of work _depends_ on the last.

## The mental model

A **stack** is a chain rooted on trunk. The branch sitting directly on trunk is the **root** (it merges first); the branch on top is the **tip** (it merges last). flo stores one fact per branch — its **parent** — in git config, and derives the whole picture from that:

- The parent drives the graph, each PR's base, and what a rebase targets.
- A **recorded base** (the parent's tip when you last branched or restacked) is how flo knows a branch has gone **stale**: if the parent has moved since, the child needs a restack.

You don't manage any of this by hand. `flo stack create` records it, and the other commands read it.

## Seeing the stack

`flo stack` draws the whole forest, **tip on top, trunk at the bottom** — the same orientation as `git log --graph` rotated so newest is up:

```
  ●  wire_auth        PR#43  8cdc55d  wire up auth   ← current
  │
  ○  add_login_form   PR#42  9e4123d  add login form
  │
  ○  add_the_button   PR#41  c549273  add the button
  │
  main
```

Each row shows the branch, its open PR number, the tip commit, and a marker (`●` = where you are, `○` = everything else). When a branch's recorded base has drifted from its parent's tip, the row is flagged:

```
  ●  wire_auth        ⚠ needs restack
  │
  ○  add_login_form   PR#42  add login form
  │
  main
```

Branches can **fork** — two children off one parent. They render side by side and merge back into the shared parent with a connector:

```
  ○    telemetry      PR#44  log click events
  │
  │ ○  wire_auth      ⚠ needs restack
  │ │
  ├─┘
  ○    add_login_form PR#42  add login form   ← current
  │
  main
```

`flo checkout` shows the same graph, then lets you pick a branch to switch to.

## Building a stack

`flo stack create` is the entry point. It branches off **your current branch** and commits in one go:

```bash
flo stack create -m "add the button"     # branches off trunk → new root
flo stack create -m "add login form"     # branches off the button → stacked
flo stack create wire_auth -m "wire up auth"
```

- With `-m`, the message is used directly; bare `flo stack create` asks for it.
- The branch name comes from an explicit argument, otherwise it's slugged from the message.
- `-a` stages everything first. It always commits, so there's always a message to name the branch from.

Whatever branch you're on becomes the new branch's parent. Start from trunk and you get a new root; start from a stacked branch and you go one layer deeper — same command either way.

## Moving around

Navigate along the chain without rebasing anything:

```bash
flo stack nav up       # toward the tip (your child)
flo stack nav down     # toward trunk (your parent)
flo stack nav top      # jump to the tip
flo stack nav bottom   # jump to the root (the branch on trunk)
```

`up` on a fork is ambiguous, so it asks you to use `flo checkout` to pick a child.

## Keeping it rebased — `flo stack restack`

The moment you amend a lower branch, or trunk advances, everything above it is sitting on a stale base. `flo stack restack` heals that. It:

1. **Pulls trunk** — fetches and fast‑forwards your local trunk.
2. **Cleans up merged branches** — drops any branch in the stack whose PR has landed, re‑pointing its children onto the branch below (a merged root's children become new roots on trunk).
3. **Rebases** each branch onto its parent's new tip, replaying only that branch's own commits.

By default it restacks the path **up to your current branch** and flags anything above you that's now stale:

```
› Restacking 2 branches…
  ✓ add_the_button → main
  ✓ add_login_form → add_the_button

! Branches above add_login_form still need a restack: wire_auth
  Run flo stack restack -s to include them.
```

Use `-s` / `--stack` to restack the whole stack including descendants. Use `--no-pull` to skip the fetch and work purely locally.

### When the bottom branch merges

This is the payoff. Say `add_the_button` (the root) merges. After a restack:

```
before                          after  (add_the_button merged)

  ●  wire_auth                    ●  wire_auth
  │                               │
  ○  add_login_form               ○  add_login_form
  │                               │
  ○  add_the_button   ✓ merged    main
  │
  main
```

`add_the_button` is deleted, `add_login_form` re‑points onto trunk, and the whole stack replays on the updated trunk — its own commits only, never the already‑landed ones.

### If a rebase conflicts

`flo stack restack` **pauses** and leaves the conflict open, exactly like a normal rebase:

```
✗ Conflict restacking add_login_form onto add_the_button.

  1. Fix the files, then git add <file>
  2. git rebase --continue
  3. flo stack restack --continue   to finish the rest of the stack
```

Resolve, `git rebase --continue`, then `flo stack restack --continue` picks up where it left off — branches already done stay done.

## Reviewing a stack — `flo submit`

`flo submit` is stack‑aware automatically; there's no flag to flip. On a stacked branch it pushes the ancestor chain bottom‑up and opens or updates **one PR per branch, each based on its parent**:

```bash
flo submit              # the path up to your current branch
flo submit --all-stack  # the whole stack, descendants included
flo submit --dry-run    # print the plan, touch nothing
```

A plain branch on trunk behaves like a normal single‑PR submit — same command, flo just sees there's no stack.

Each line reports what happened, with the PR number and a status badge:

```
❯ Submitted #41 add the button (no-op)
❯ Submitted #42 add login form (updated)
❯ Submitted #43 wire up auth (created)

✓ current wire_auth: https://github.com/owner/repo/pull/43
```

| Badge | Meaning |
| ----- | ------- |
| `(created)` | no PR existed — a new one was opened |
| `(updated)` | the PR's head moved |
| `(no-op)` | already up to date |

### The stack comment

Every PR in the stack gets a sticky comment mapping the whole stack, with 👈 marking the PR you're reading. It's rewritten in place on each submit (never duplicated), and reads tip‑on‑top to match `flo stack`:

```markdown
- #43  👈 you are here
- #42
- #41

Stack tip on top, trunk at the bottom · Added via flo 🌊
```

The `#43`/`#42`/`#41` are live PR links, so you can hop between layers from any PR.

### If a lower PR has already merged

`flo submit` stops rather than push children onto a base that no longer exists:

```
! Already merged: add_the_button (#41)
  A PR below you has landed. Run flo sync then flo stack restack to re-parent
  the stack onto trunk, then submit again.
```

## Syncing everything — `flo sync`

`flo stack restack` fixes **your** stack. `flo sync` does the same across the **whole forest** — every stack at once — and it's the command to run after a round of merges:

1. Pull trunk.
2. Clean up every merged branch (re‑parent its children onto trunk, delete it).
3. Rebase every stack onto its parents.

The difference from restack is the conflict policy. Sync touches everything, so a single conflict doesn't halt the sweep: the conflicting branch is **rolled back and reported at the end**, and the rest still sync.

```
› Cleaning up 1 merged branch, re-parenting onto main.
› Restacking 3 branches…
  ✓ s1a → main
  ✓ s1b → s1a
› Cleaned up merged: s3

! Unable to cleanly sync the following branches:
  - s2
  Run flo stack restack <branch> on each to resolve the conflict by hand.
```

You're left back on the branch you started from, with a clean tree, and a short list of the few branches that need a hands‑on restack.

## Command summary

| Command | What |
| ------- | ---- |
| `flo stack` (or `flo stack view`) | draw the forest, tip on top |
| `flo stack create [name]` | branch off the current branch + commit (`-m`, `-a`) |
| `flo stack nav <up\|down\|top\|bottom>` | move along the stack |
| `flo stack restack` | pull, clean up merged, rebase **your** stack (`-s`, `--no-pull`, `--continue`) |
| `flo sync` | the same across the **whole forest**; conflicts reported, not paused |
| `flo submit` | one PR per branch, base = parent, plus a stack comment (`--all-stack`, `--dry-run`) |

See the [Commands reference](./commands.md) for every flag and the exact behavior of each.
