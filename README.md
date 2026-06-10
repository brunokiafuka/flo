<h1 align="center" style="font-size: 6em; margin: 0;">🌊</h1>

<h1 align="center">flo</h1>

<p align="center">
  Your local flow orchestrator — git, PRs, and project recipes in one tool.<br/>
  <code>sync</code> · <code>checkout</code> · <code>commit</code> · <code>submit</code> · <code>run</code>
</p>

---

## Install

```bash
npm install -g flo-tools     # then run `flo`
```

Or run it on demand, no install:

```bash
npx flo-tools --help
```

The package is [`flo-tools`](https://www.npmjs.com/package/flo-tools) (source under [`tools/flo`](https://github.com/brunokiafuka/flo/tree/main/tools/flo)); its binary is `flo`. For the release flow, see the [contributing guide](https://brunokiafuka.github.io/flo/contributing/guide/).

## Quickstart

```bash
flo --help              # list commands
flo setup               # per-dev config: trunk, prefix, PR mode (stored under ~/.flo)
flo sync                # update trunk, prune merged branches, restack
flo checkout            # pick a branch from a graph view
flo commit -a -m "msg"  # stage + commit (branches off trunk if needed)
flo submit              # push + open/update a PR (draft or ready-for-review, per setup)
flo <recipe>            # run a project command defined in flo.yml
```

## Docs

Live at **<https://brunokiafuka.github.io/flo/>** (built with [Starlight](https://starlight.astro.build/), source under [`docs/`](docs/)).

- **[Quickstart](https://brunokiafuka.github.io/flo/get-started/quickstart/)** — install, first-run setup, a typical loop
- **[Command reference](https://brunokiafuka.github.io/flo/reference/commands/)** — every command, flags, and behavior notes
- **[Configuration](https://brunokiafuka.github.io/flo/reference/configuration/)** — `flo.yml` schema: commands, init steps, validation
- **[Recipes](https://brunokiafuka.github.io/flo/reference/recipes/)** — ready-made `flo.yml` patterns
- **[Contributing guide](https://brunokiafuka.github.io/flo/contributing/guide/)** — local dev, tests, release flow

## Local dev

```bash
pnpm install
pnpm run install:flo    # symlinks ~/.local/bin/flo
```

## Layout

```
./
├── tools/
│   └── flo/         # the tool — self-contained, owns its deps
├── docs/            # Starlight site (deploys to GitHub Pages)
└── package.json     # pnpm workspace root (tools/*, docs)
```

The repo is a pnpm workspace shaped for one tool today — extra `tools/<name>` slots stay open for whatever lands next.

## Philosophy

- **Scripts over services.** Small, local, reversible.
- **One tool, one job.** No shared runtime — each tool owns its dependencies under `tools/<name>`.
- **Boring stack.** TypeScript + tsx, no bundler, no framework.
