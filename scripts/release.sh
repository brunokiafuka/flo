#!/usr/bin/env sh
# flo release — bumps tools/flo/package.json version, commits, and pushes.
# Invoked via `flo flo-release` (alias: `flo fr`).
#
# Release model: the `version` field on `main` is the source of truth for the
# in-flo update check, so releasing = bump version + merge/push to main.
set -eu

PKG="tools/flo/package.json"

if [ ! -f "$PKG" ]; then
  echo "✗ Run this from the workflow repo root (missing $PKG)." >&2
  exit 1
fi

BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$BRANCH" != "main" ]; then
  printf "You're on '%s', not main. Continue anyway? [y/N] " "$BRANCH"
  read -r ans
  case "$ans" in
    y|Y|yes|Yes) ;;
    *) echo "Aborted."; exit 1 ;;
  esac
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "✗ Working tree is dirty. Commit or stash first." >&2
  exit 1
fi

CURRENT=$(node -p "require('./$PKG').version")
echo "Current version: $CURRENT"

printf "Bump type? [patch/minor/major] (default: patch): "
read -r BUMP
BUMP=${BUMP:-patch}

NEW=$(CURRENT="$CURRENT" BUMP="$BUMP" node -e '
  const { CURRENT, BUMP } = process.env;
  const parts = CURRENT.split(".").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    console.error("Unexpected version shape: " + CURRENT);
    process.exit(1);
  }
  const [maj, min, pat] = parts;
  let next;
  if (BUMP === "major") next = [maj + 1, 0, 0];
  else if (BUMP === "minor") next = [maj, min + 1, 0];
  else if (BUMP === "patch") next = [maj, min, pat + 1];
  else { console.error("Unknown bump type: " + BUMP); process.exit(1); }
  console.log(next.join("."));
')

echo "→ $NEW"
printf "Commit, publish to npm, and push to origin/%s? [Y/n] " "$BRANCH"
read -r ans
case "$ans" in
  n|N|no|No) echo "Aborted — no changes made."; exit 1 ;;
  *) ;;
esac

PKG="$PKG" NEW="$NEW" node -e '
  const fs = require("fs");
  const p = process.env.PKG;
  const pkg = JSON.parse(fs.readFileSync(p, "utf8"));
  pkg.version = process.env.NEW;
  fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + "\n");
'

git add "$PKG"
git commit -m "flo: release $NEW"

# Publish the bundle BEFORE pushing: `npm publish` runs prepublishOnly, which
# does a clean `rm -rf dist && tsc` build, so the npm tarball always matches the
# source being released. If publish fails (e.g. auth/OTP), the commit is still
# local and un-pushed, so you can fix and re-run without a half-released state.
echo "Building and publishing flo $NEW to npm…"
( cd "$(dirname "$PKG")" && npm publish )

git push

echo "✓ Released flo $NEW — published to npm and pushed to origin/$BRANCH"
