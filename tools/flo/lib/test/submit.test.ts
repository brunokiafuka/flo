import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import { FLO_STACK_MARKER, pickFloCommentId, renderStackComment, type StackCommentEntry } from "../commands/submit.js";

const entries: StackCommentEntry[] = [
  { branch: "feat_a", number: 41 },
  { branch: "feat_b", number: 42 },
  { branch: "wire_auth", number: 43 },
];

describe("renderStackComment", () => {
  test("unordered list of PR refs, tip on top, marks the PR it's posted on", () => {
    const body = renderStackComment(entries, "feat_b");
    const lines = body.split("\n");
    assert.equal(lines[0], FLO_STACK_MARKER);
    assert.ok(lines.includes("- #41"));
    assert.ok(lines.includes("- #42  👈 you are here"));
    assert.ok(lines.includes("- #43"));
    // tip (#43) renders above the base (#41) — matches the terminal stack view.
    assert.ok(body.indexOf("#43") < body.indexOf("#41"));
  });

  test("only the forBranch row gets the marker", () => {
    const body = renderStackComment(entries, "wire_auth");
    assert.equal((body.match(/👈 you are here/g) ?? []).length, 1);
    assert.ok(body.includes("- #43  👈 you are here"));
  });

  test("wraps in the sentinel and carries the flo signature", () => {
    const body = renderStackComment(entries, "feat_a");
    assert.ok(body.startsWith(FLO_STACK_MARKER));
    assert.ok(body.includes("<!-- /flo-stack -->"));
    assert.ok(/Added via flo/.test(body));
  });
});

describe("pickFloCommentId", () => {
  test("finds our comment by the invisible sentinel", () => {
    const comments = [
      { id: 1, body: "looks good!" },
      { id: 2, body: `${FLO_STACK_MARKER}\n**Stack**\n<!-- /flo-stack -->` },
    ];
    assert.equal(pickFloCommentId(comments), 2);
  });

  test("returns null when no flo comment exists (→ create a fresh one)", () => {
    assert.equal(pickFloCommentId([{ id: 1, body: "nice work" }]), null);
    assert.equal(pickFloCommentId([]), null);
  });
});
