import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import {
  ancestorPathTo,
  buildForest,
  currentStack,
  descendantsNeedingRestack,
  type ForestInput,
  navBottom,
  navDown,
  navTop,
  navUp,
  planPrune,
  restackScope,
  stackRootOf,
  subtreeOf,
  topoOrder,
} from "../stack.js";
import { layoutForest } from "../stackRender.js";

type Spec = {
  trunk?: string;
  // branch -> { parent, sha, base }
  branches: Record<string, { parent?: string; sha?: string; base?: string }>;
  trunkSha?: string;
};

/** Assemble a ForestInput from a compact spec. */
function input(spec: Spec): ForestInput {
  const trunk = spec.trunk ?? "main";
  const tips = new Map<string, string>();
  const parents = new Map<string, string>();
  const recordedBases = new Map<string, string>();
  tips.set(trunk, spec.trunkSha ?? "trunk0");
  for (const [name, b] of Object.entries(spec.branches)) {
    tips.set(name, b.sha ?? `${name}_tip`);
    if (b.parent) parents.set(name, b.parent);
    if (b.base) recordedBases.set(name, b.base);
  }
  return { trunk, tips, parents, recordedBases };
}

const linear: Spec = {
  branches: {
    add_button: { parent: "main", sha: "ab1", base: "trunk0" },
    login_form: { parent: "add_button", sha: "lf1", base: "ab1" },
    wire_auth: { parent: "login_form", sha: "wa1", base: "lf1" },
  },
};

describe("buildForest", () => {
  test("linear chain: parents, children, single root", () => {
    const f = buildForest(input(linear));
    assert.equal(f.roots.join(","), "add_button");
    assert.equal(f.nodes.get("add_button")?.parent, "main");
    assert.equal(f.nodes.get("login_form")?.parent, "add_button");
    assert.deepEqual(f.nodes.get("login_form")?.children, ["wire_auth"]);
    assert.deepEqual(f.nodes.get("main")?.children, ["add_button"]);
    assert.equal(f.nodes.get("wire_auth")?.children.length, 0);
  });

  test("no flo-parent → treated as a root on trunk", () => {
    const f = buildForest(input({ branches: { stray: { sha: "s1" } } }));
    assert.equal(f.nodes.get("stray")?.parent, "main");
    assert.deepEqual(f.roots, ["stray"]);
  });

  test("flo-parent pointing at a deleted branch → falls back to trunk", () => {
    const f = buildForest(input({ branches: { orphan: { parent: "ghost", sha: "o1" } } }));
    assert.equal(f.nodes.get("orphan")?.parent, "main");
  });

  test("fork: children sorted, both under shared parent", () => {
    const f = buildForest(
      input({
        branches: {
          login_form: { parent: "main", sha: "lf1" },
          wire_auth: { parent: "login_form", sha: "wa1" },
          telemetry: { parent: "login_form", sha: "te1" },
        },
      }),
    );
    assert.deepEqual(f.nodes.get("login_form")?.children, ["telemetry", "wire_auth"]);
  });
});

describe("needsRestack", () => {
  test("recorded base equal to parent tip → in sync", () => {
    const f = buildForest(input(linear));
    assert.equal(f.nodes.get("login_form")?.needsRestack, false);
  });

  test("recorded base stale vs parent's current tip → needs restack", () => {
    const f = buildForest(
      input({
        branches: {
          add_button: { parent: "main", sha: "ab2", base: "trunk0" },
          login_form: { parent: "add_button", sha: "lf1", base: "ab1" }, // parent moved ab1→ab2
        },
      }),
    );
    assert.equal(f.nodes.get("login_form")?.needsRestack, true);
  });

  test("no recorded base → can't tell, not stale", () => {
    const f = buildForest(input({ branches: { x: { parent: "main", sha: "x1" } } }));
    assert.equal(f.nodes.get("x")?.needsRestack, false);
  });
});

describe("stack resolution", () => {
  test("stackRootOf walks to the branch on trunk", () => {
    const f = buildForest(input(linear));
    assert.equal(stackRootOf(f, "wire_auth"), "add_button");
    assert.equal(stackRootOf(f, "add_button"), "add_button");
    assert.equal(stackRootOf(f, "main"), null);
  });

  test("subtreeOf is topological (parents before children)", () => {
    const f = buildForest(input(linear));
    assert.deepEqual(subtreeOf(f, "add_button"), ["add_button", "login_form", "wire_auth"]);
  });

  test("currentStack from a mid branch returns the whole root subtree", () => {
    const f = buildForest(
      input({
        branches: {
          a: { parent: "main", sha: "a1" },
          b: { parent: "a", sha: "b1" },
          c: { parent: "a", sha: "c1" },
        },
      }),
    );
    assert.deepEqual(currentStack(f, "b").sort(), ["a", "b", "c"]);
  });

  test("topoOrder spans every root subtree", () => {
    const f = buildForest(
      input({
        branches: {
          a: { parent: "main", sha: "a1" },
          b: { parent: "a", sha: "b1" },
          z: { parent: "main", sha: "z1" },
        },
      }),
    );
    assert.deepEqual(topoOrder(f), ["a", "b", "z"]);
  });
});

describe("restack scope", () => {
  test("ancestorPathTo is root→branch, inclusive", () => {
    const f = buildForest(input(linear));
    assert.deepEqual(ancestorPathTo(f, "wire_auth"), ["add_button", "login_form", "wire_auth"]);
    assert.deepEqual(ancestorPathTo(f, "add_button"), ["add_button"]);
    assert.deepEqual(ancestorPathTo(f, "main"), []);
  });

  test("default scope (path up to current) stops at the target, ignoring descendants", () => {
    const f = buildForest(
      input({
        branches: {
          a: { parent: "main", sha: "a1" },
          b: { parent: "a", sha: "b1" },
          c: { parent: "b", sha: "c1" }, // descendant above b
        },
      }),
    );
    assert.deepEqual(restackScope(f, "b", false), ["a", "b"]);
  });

  test("--stack scope is the whole root subtree, including forks", () => {
    const f = buildForest(
      input({
        branches: {
          a: { parent: "main", sha: "a1" },
          b: { parent: "a", sha: "b1" },
          c: { parent: "a", sha: "c1" },
        },
      }),
    );
    assert.deepEqual(restackScope(f, "b", true).sort(), ["a", "b", "c"]);
  });

  test("descendantsNeedingRestack flags only stale branches above the target", () => {
    const f = buildForest(
      input({
        branches: {
          a: { parent: "main", sha: "a2", base: "trunk0" },
          b: { parent: "a", sha: "b1", base: "a1" }, // a moved a1→a2 → stale
          c: { parent: "b", sha: "c1", base: "b1" }, // in sync with b
        },
      }),
    );
    assert.deepEqual(descendantsNeedingRestack(f, "a"), ["b"]);
    assert.deepEqual(descendantsNeedingRestack(f, "b"), []);
  });
});

describe("planPrune (merged cleanup)", () => {
  test("merged stack root → children re-parent onto trunk, root deletable", () => {
    const f = buildForest(input(linear)); // main → add_button → login_form → wire_auth
    const { repoint, deletable } = planPrune(f, new Set(["add_button"]));
    assert.deepEqual(deletable, ["add_button"]);
    assert.deepEqual(repoint, [{ branch: "login_form", newParent: "main" }]);
  });

  test("a merged mid branch → its child re-parents onto the grandparent", () => {
    const f = buildForest(input(linear));
    const { repoint } = planPrune(f, new Set(["login_form"]));
    assert.deepEqual(repoint, [{ branch: "wire_auth", newParent: "add_button" }]);
  });

  test("a chain of merged branches → child skips past all of them to trunk", () => {
    const f = buildForest(input(linear));
    const { repoint, deletable } = planPrune(f, new Set(["add_button", "login_form"]));
    assert.deepEqual(deletable, ["add_button", "login_form"]);
    // wire_auth's parent (login_form) and grandparent (add_button) are both merged → trunk
    assert.deepEqual(repoint, [{ branch: "wire_auth", newParent: "main" }]);
  });

  test("nothing merged → no-op", () => {
    const f = buildForest(input(linear));
    assert.deepEqual(planPrune(f, new Set()), { repoint: [], deletable: [] });
  });
});

describe("navigation", () => {
  const f = buildForest(input(linear));

  test("up moves toward the tip", () => {
    assert.deepEqual(navUp(f, "add_button"), { target: "login_form" });
  });

  test("up at the tip errors", () => {
    assert.ok("error" in navUp(f, "wire_auth"));
  });

  test("up on a fork is ambiguous", () => {
    const fork = buildForest(
      input({
        branches: { a: { parent: "main", sha: "a1" }, b: { parent: "a", sha: "b1" }, c: { parent: "a", sha: "c1" } },
      }),
    );
    const r = navUp(fork, "a");
    assert.ok("error" in r && /forks into/.test(r.error));
  });

  test("down moves toward trunk; root → trunk", () => {
    assert.deepEqual(navDown(f, "login_form"), { target: "add_button" });
    assert.deepEqual(navDown(f, "add_button"), { target: "main" });
    assert.ok("error" in navDown(f, "main"));
  });

  test("top climbs to the tip of a linear stack", () => {
    assert.deepEqual(navTop(f, "add_button"), { target: "wire_auth" });
  });

  test("bottom drops to the stack root", () => {
    assert.deepEqual(navBottom(f, "wire_auth"), { target: "add_button" });
  });
});

describe("layoutForest gutters", () => {
  test("linear stack: tip-on-top, single spine", () => {
    const f = buildForest(input(linear));
    const gutters = layoutForest(f, "login_form").map((r) => r.gutter);
    assert.deepEqual(gutters, ["○ ", "│", "● ", "│", "○ ", "│", ""]);
  });

  test("trunk renders last with an empty gutter", () => {
    const f = buildForest(input(linear));
    const rows = layoutForest(f);
    const last = rows.at(-1);
    assert.equal(last.kind, "node");
    assert.ok(last.kind === "node" && last.isTrunk && last.gutter === "");
  });

  test("fork: second child takes a new lane, merges back with ├─┘", () => {
    const f = buildForest(
      input({
        branches: {
          login_form: { parent: "main", sha: "lf1" },
          telemetry: { parent: "login_form", sha: "te1" },
          wire_auth: { parent: "login_form", sha: "wa1" },
        },
      }),
    );
    const gutters = layoutForest(f).map((r) => r.gutter);
    assert.deepEqual(gutters, ["○   ", "│", "│ ○ ", "│ │", "├─┘", "○   ", "│", ""]);
  });
});
