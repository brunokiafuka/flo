import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import { compareVersions, detectInstallSource, isFresh, updateHint, type UpdateCache } from "../updater.js";

describe("compareVersions", () => {
  test("treats equal versions as 0", () => {
    assert.equal(compareVersions("0.2.0", "0.2.0"), 0);
    assert.equal(compareVersions("v0.2.0", "0.2.0"), 0);
  });

  test("returns -1 when a is older", () => {
    assert.equal(compareVersions("0.1.0", "0.2.0"), -1);
    assert.equal(compareVersions("0.2.0", "0.2.1"), -1);
    assert.equal(compareVersions("0.9.0", "1.0.0"), -1);
  });

  test("returns 1 when a is newer", () => {
    assert.equal(compareVersions("1.0.0", "0.9.9"), 1);
    assert.equal(compareVersions("0.3.0", "0.2.0"), 1);
  });

  test("tolerates missing trailing segments", () => {
    assert.equal(compareVersions("1.0", "1.0.0"), 0);
    assert.equal(compareVersions("1", "1.0.0"), 0);
    assert.equal(compareVersions("1", "1.0.1"), -1);
  });

  test("ignores a leading v on either side", () => {
    assert.equal(compareVersions("v1.2.3", "v1.2.3"), 0);
    assert.equal(compareVersions("v0.2.0", "v0.3.0"), -1);
  });

  test("falls back to lexical compare for non-numeric segments", () => {
    // pre-release tags shouldn't be ranked above a final release, but they
    // should at least sort deterministically.
    assert.notEqual(compareVersions("1.0.0-alpha", "1.0.0-beta"), 0);
  });
});

describe("isFresh", () => {
  const now = 1_000_000_000_000;
  const cache = (ageMs: number): UpdateCache => ({
    checkedAt: now - ageMs,
    latestVersion: "0.3.0",
  });

  test("returns true for a check under 12h old", () => {
    assert.equal(isFresh(cache(60 * 60 * 1000), now), true); // 1h
    assert.equal(isFresh(cache(11 * 60 * 60 * 1000), now), true); // 11h
  });

  test("returns false for a check at or past 12h", () => {
    assert.equal(isFresh(cache(12 * 60 * 60 * 1000), now), false);
    assert.equal(isFresh(cache(24 * 60 * 60 * 1000), now), false);
  });

  test("treats a future checkedAt as fresh (clock-skew tolerant)", () => {
    assert.equal(isFresh(cache(-1_000), now), true);
  });
});

describe("detectInstallSource", () => {
  test("recognizes npm install paths", () => {
    assert.equal(detectInstallSource("/usr/local/lib/node_modules/flo-tools/dist"), "npm");
    assert.equal(detectInstallSource("/Users/bk/project/node_modules/flo-tools/dist/lib"), "npm");
  });

  test("treats anything else with a path as a git checkout", () => {
    assert.equal(detectInstallSource("/Users/bk/code/flo/tools/flo"), "git");
    assert.equal(detectInstallSource("/home/alice/flo/tools/flo"), "git");
  });

  test("returns unknown for an empty path", () => {
    assert.equal(detectInstallSource(""), "unknown");
  });
});

describe("updateHint", () => {
  test("npm source suggests a global reinstall", () => {
    assert.equal(updateHint("npm"), "npm i -g flo-tools");
  });

  test("git source suggests a pull + reinstall, with cd when repo root is known", () => {
    assert.equal(updateHint("git", "/Users/bk/flo"), "cd /Users/bk/flo && git pull && ./tools/flo/install");
    assert.equal(updateHint("git"), "git pull && ./tools/flo/install");
  });

  test("unknown source falls back to the npm install command", () => {
    assert.equal(updateHint("unknown"), "npm i -g flo-tools");
  });
});
