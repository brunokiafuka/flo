# flo

`flo` is your local flow orchestrator — git, PRs, and project recipes in one tool.

https://github.com/user-attachments/assets/6df2fbfa-568d-489e-a2a3-5156945488a5


## Docs

Live at **<https://brunokiafuka.github.io/flo/>**.

- **[Quickstart](https://brunokiafuka.github.io/flo/get-started/quickstart/)** — install + first-run setup
- **[Command reference](https://brunokiafuka.github.io/flo/reference/commands/)** — every command, flags, and behavior notes
- **[Configuration](https://brunokiafuka.github.io/flo/reference/configuration/)** — the `flo.yml` schema
- **[Recipes](https://brunokiafuka.github.io/flo/reference/recipes/)** — ready-made `flo.yml` patterns
- **[Contributing guide](https://brunokiafuka.github.io/flo/contributing/guide/)** — local dev + release flow

## Install

```bash
npm i -g flo-tools      # installs the `flo` command globally
```

## Quickstart

```bash
flo --help              # list commands
flo setup               # per-dev config: trunk, prefix, PR mode (stored under ~/.flo)
flo setup --update      # tweak a single setting without walking the whole wizard
flo sync                # update trunk, prune merged branches, restack
flo checkout            # pick a branch from a graph view
flo commit -a -m "msg"  # stage + commit (branches off trunk if needed)
flo submit              # push + open/update a PR (draft or ready-for-review, per setup)
flo <recipe>            # run a project command defined in flo.yml
```
