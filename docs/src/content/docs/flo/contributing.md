---
title: Contributing guide
description: Hack on flo — local dev setup, tests, and the release flow.
---

## Local dev

Clone, install, and symlink flo into your `PATH`:

```bash
git clone https://github.com/brunokiafuka/flo.git
cd flo
pnpm install
pnpm run install:flo    # symlinks ~/.local/bin/flo at the working tree
```

`flo --help` should now resolve to your checkout. Edits to `tools/flo/lib/**` take effect on next invocation — there's no build step (TypeScript runs through `tsx`).

## Tests, lint, format

```bash
pnpm --filter flo test       # unit tests for tools/flo
pnpm lint                    # oxlint
pnpm format                  # oxfmt write
pnpm format:check            # CI form
```

There's a top-level `flo.yml` with shortcuts: `flo test`, `flo lint`, `flo fmt`.

## Docs

The docs site is a Starlight project under `docs/`. Live-reload it with:

```bash
pnpm --filter docs dev       # http://localhost:4321/flo/
pnpm --filter docs build     # static output to docs/dist/
```

A push to `main` that touches `docs/**` triggers `.github/workflows/deploy-docs.yml`, which builds and publishes to GitHub Pages.

## Cutting a release

flo is published to npm as [`flo-tools`](https://www.npmjs.com/package/flo-tools), and **`tools/flo/package.json`'s `version` field on `main`** is the source of truth for the in-flo update check (it fetches that file directly). A release is:

1. **Bump the version** in `tools/flo/package.json` (`0.2.0` → `0.3.0`).
2. **Publish to npm** (see below).
3. **Merge to `main`.**

Users on `npm i -g flo-tools` upgrade with `npm i -g flo-tools@latest`, and the update notice fires the next time their local cache expires (12h TTL) regardless of how they installed.

There's a helper too — `flo fr` (alias for `flo release-flo`) runs `scripts/release.sh`, which handles the bump + commit + push interactively.

### Publishing to npm

From `tools/flo`:

```bash
cd tools/flo
npm publish
```

- `prepublishOnly` runs the build (`tsc`) first, so `dist/` is always fresh.
- Only `dist/` ships — see the `files` field in `package.json`.

Verify with:

```bash
npm view flo-tools version
```
