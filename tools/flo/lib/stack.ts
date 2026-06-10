import { git } from "./git.js";

// ─────────────────────────────────────────────────────────────────────────────
// Data model
//
// Stacking rests on one idea: a branch can be parented on *another* branch, not
// just trunk. We store that parent pointer (and the parent's tip when we last
// branched/restacked) in git config — per-repo state, recomputed every run:
//
//   branch.<name>.flo-parent      = login_form   the branch this one stacks on
//   branch.<name>.flo-parent-sha  = d4e5f6…      parent's tip at branch/restack
//
// git config is the source of truth. The forest (DAG) is derived in-memory per
// invocation from three batched reads — never cached to disk (it would drift the
// instant any plain-git op runs). See design-stacking.md §2.
// ─────────────────────────────────────────────────────────────────────────────

const parentKey = (branch: string) => `branch.${branch}.flo-parent`;
const parentShaKey = (branch: string) => `branch.${branch}.flo-parent-sha`;

/** Read this branch's recorded parent, or null if it has none (a root on trunk). */
export async function getParent(branch: string): Promise<string | null> {
  const r = await git(["config", "--get", parentKey(branch)], { allowFail: true });
  if (r.exitCode !== 0) return null;
  return r.stdout.trim() || null;
}

/** Read this branch's recorded base — the parent's tip when last branched/restacked. */
export async function getParentSha(branch: string): Promise<string | null> {
  const r = await git(["config", "--get", parentShaKey(branch)], { allowFail: true });
  if (r.exitCode !== 0) return null;
  return r.stdout.trim() || null;
}

/** Record `branch`'s parent and the parent's current tip (the recorded base). */
export async function setParent(branch: string, parent: string, parentSha: string): Promise<void> {
  await git(["config", parentKey(branch), parent]);
  await git(["config", parentShaKey(branch), parentSha]);
}

/** Update just the recorded base (after a successful restack onto the parent's new tip). */
export async function setParentSha(branch: string, parentSha: string): Promise<void> {
  await git(["config", parentShaKey(branch), parentSha]);
}

/** Forget a branch's parent pointer entirely (both keys). */
export async function clearParent(branch: string): Promise<void> {
  await git(["config", "--unset", parentKey(branch)], { allowFail: true });
  await git(["config", "--unset", parentShaKey(branch)], { allowFail: true });
}

// ─── Batched reads — the whole topology in a fixed number of git calls ───────

/** Parse `git config --get-regexp` output into a branch→value map for one suffix. */
function parseBranchConfig(stdout: string, suffix: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = new RegExp(`^branch\\.(.+)\\.${suffix}$`);
  for (const line of stdout.split("\n")) {
    const sp = line.indexOf(" ");
    if (sp < 0) continue;
    const key = line.slice(0, sp);
    const value = line.slice(sp + 1).trim();
    const m = key.match(re);
    if (m && value) map.set(m[1], value);
  }
  return map;
}

/** All `flo-parent` pointers — one git call. */
export async function readParents(): Promise<Map<string, string>> {
  const r = await git(["config", "--get-regexp", "^branch\\..*\\.flo-parent$"], { allowFail: true });
  if (r.exitCode !== 0) return new Map();
  return parseBranchConfig(r.stdout, "flo-parent");
}

/** All `flo-parent-sha` recorded bases — one git call. */
export async function readRecordedBases(): Promise<Map<string, string>> {
  const r = await git(["config", "--get-regexp", "^branch\\..*\\.flo-parent-sha$"], { allowFail: true });
  if (r.exitCode !== 0) return new Map();
  return parseBranchConfig(r.stdout, "flo-parent-sha");
}

export type BranchInfo = { sha: string; short: string; subject: string };

/** Tip sha + short sha + subject for every local branch — one `for-each-ref`. */
export async function readBranchInfo(): Promise<Map<string, BranchInfo>> {
  const r = await git([
    "for-each-ref",
    "--format=%(refname:short)%09%(objectname)%09%(objectname:short)%09%(contents:subject)",
    "refs/heads/",
  ]);
  const map = new Map<string, BranchInfo>();
  for (const line of r.stdout.split("\n")) {
    if (!line.trim()) continue;
    const [name = "", sha = "", short = "", subject = ""] = line.split("\t");
    if (name) map.set(name, { sha, short, subject });
  }
  return map;
}

/** Derive the branch→tip map from BranchInfo (avoids a second ref walk). */
export function tipsFrom(info: Map<string, BranchInfo>): Map<string, string> {
  return new Map([...info].map(([branch, i]) => [branch, i.sha]));
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure forest builder — no I/O. Everything below takes the batched reads as
// plain maps so it can be unit-tested without a git repo.
// ─────────────────────────────────────────────────────────────────────────────

export type StackNode = {
  branch: string;
  /** Effective parent branch name, or null for trunk (the forest root). */
  parent: string | null;
  /** flo-parent-sha — the recorded base, or null if never set. */
  recordedBase: string | null;
  /** Current tip sha, or null if unknown. */
  tip: string | null;
  /** Effective children, sorted for deterministic rendering. */
  children: string[];
  isTrunk: boolean;
  /** recordedBase set and ≠ the parent's *current* tip → the child is stale. */
  needsRestack: boolean;
};

export type Forest = {
  trunk: string;
  nodes: Map<string, StackNode>;
  /** Branches whose effective parent is trunk (the stack roots), sorted. */
  roots: string[];
};

export type ForestInput = {
  trunk: string;
  tips: Map<string, string>;
  parents: Map<string, string>;
  recordedBases: Map<string, string>;
};

/**
 * Resolve a branch's *effective* parent:
 *  - trunk has none (forest root)
 *  - a `flo-parent` pointing at an existing local branch wins
 *  - anything else (no pointer, or a pointer to a deleted branch) → root on trunk
 */
function effectiveParent(branch: string, input: ForestInput): string | null {
  if (branch === input.trunk) return null;
  const p = input.parents.get(branch);
  if (p && p !== branch && (p === input.trunk || input.tips.has(p))) return p;
  return input.trunk;
}

/** Build the in-memory DAG from the batched reads. Pure. */
export function buildForest(input: ForestInput): Forest {
  const branches = new Set([...input.tips.keys(), input.trunk]); // trunk always present

  const nodes = new Map<string, StackNode>();
  for (const branch of branches) {
    nodes.set(branch, {
      branch,
      parent: null,
      recordedBase: input.recordedBases.get(branch) ?? null,
      tip: input.tips.get(branch) ?? null,
      children: [],
      isTrunk: branch === input.trunk,
      needsRestack: false,
    });
  }

  const roots: string[] = [];
  for (const branch of branches) {
    if (branch === input.trunk) continue;
    const parent = effectiveParent(branch, input);
    const node = nodes.get(branch);
    if (node) node.parent = parent;
    const parentNode = parent ? nodes.get(parent) : undefined;
    if (parentNode) {
      parentNode.children.push(branch);
      if (parent === input.trunk) roots.push(branch);
    } else {
      roots.push(branch);
    }
  }

  for (const node of nodes.values()) {
    if (node.isTrunk || !node.parent) continue;
    const parentTip = nodes.get(node.parent)?.tip ?? null;
    node.needsRestack = node.recordedBase !== null && parentTip !== null && node.recordedBase !== parentTip;
  }

  for (const node of nodes.values()) node.children.sort();
  roots.sort();
  return { trunk: input.trunk, nodes, roots };
}

// ─── Stack resolution — "the current stack" used by stack/restack/sync --so ──

/**
 * Walk `flo-parent` up from `branch` to the stack root (the branch whose parent
 * is trunk). Returns null if `branch` is trunk or unknown.
 */
export function stackRootOf(forest: Forest, branch: string): string | null {
  let cur = forest.nodes.get(branch);
  if (!cur || cur.isTrunk) return null;
  const seen = new Set<string>();
  while (cur.parent && cur.parent !== forest.trunk) {
    if (seen.has(cur.branch)) break; // cycle guard
    seen.add(cur.branch);
    const next = forest.nodes.get(cur.parent);
    if (!next) break;
    cur = next;
  }
  return cur.branch;
}

/** A root's entire subtree in topological order (parents before children). */
export function subtreeOf(forest: Forest, root: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (b: string) => {
    if (seen.has(b)) return;
    seen.add(b);
    out.push(b);
    for (const child of forest.nodes.get(b)?.children ?? []) visit(child);
  };
  visit(root);
  return out;
}

/** The current stack = the stack-root subtree containing `branch`, topo-ordered. */
export function currentStack(forest: Forest, branch: string): string[] {
  const root = stackRootOf(forest, branch);
  return root ? subtreeOf(forest, root) : [];
}

/** Every branch (excluding trunk) in topological order, parents before children. */
export function topoOrder(forest: Forest): string[] {
  return forest.roots.flatMap((root) => subtreeOf(forest, root));
}

/**
 * The ancestor path from the stack root down to `branch`, inclusive
 * (root → … → branch). Linear by construction — each branch has one parent.
 * Empty for trunk / unknown branches.
 */
export function ancestorPathTo(forest: Forest, branch: string): string[] {
  const node = forest.nodes.get(branch);
  if (!node || node.isTrunk) return [];
  const path: string[] = [];
  const seen = new Set<string>();
  let cur: StackNode | undefined = node;
  while (cur && !cur.isTrunk) {
    if (seen.has(cur.branch)) break; // cycle guard
    seen.add(cur.branch);
    path.push(cur.branch);
    cur = cur.parent ? forest.nodes.get(cur.parent) : undefined;
  }
  return path.toReversed();
}

/**
 * Branches a restack should walk, in topological order (parents first):
 *  - default: the ancestor path up to `branch` (heal *me* and everything below)
 *  - `includeDescendants`: the whole stack-root subtree (the design's "the stack")
 */
export function restackScope(forest: Forest, branch: string, includeDescendants: boolean): string[] {
  if (!includeDescendants) return ancestorPathTo(forest, branch);
  const root = stackRootOf(forest, branch);
  return root ? subtreeOf(forest, root) : [];
}

/**
 * Descendants of `branch` that are stale — used after a path-restack to flag the
 * branches above the target that the restack deliberately left untouched.
 */
export function descendantsNeedingRestack(forest: Forest, branch: string): string[] {
  return subtreeOf(forest, branch).filter((b) => b !== branch && forest.nodes.get(b)?.needsRestack);
}

/** Walk up from `branch` past any merged ancestors to the first live parent (or trunk). */
function nearestLiveAncestor(forest: Forest, branch: string, merged: Set<string>): string {
  let p = forest.nodes.get(branch)?.parent ?? forest.trunk;
  const seen = new Set<string>();
  while (p !== forest.trunk && merged.has(p) && !seen.has(p)) {
    seen.add(p);
    p = forest.nodes.get(p)?.parent ?? forest.trunk;
  }
  return p;
}

export type RepointOp = { branch: string; newParent: string };

/**
 * Plan the cleanup when branches have merged: each merged branch is deletable,
 * and its still-live children re-parent onto the nearest non-merged ancestor
 * (trunk, for a merged stack root). Children keep their recorded base so the
 * follow-up restack replays only their own commits. Pure.
 */
export function planPrune(forest: Forest, merged: Set<string>): { repoint: RepointOp[]; deletable: string[] } {
  const repoint: RepointOp[] = [];
  const deletable: string[] = [];
  for (const m of merged) {
    const node = forest.nodes.get(m);
    if (!node || node.isTrunk) continue;
    deletable.push(m);
    for (const child of node.children) {
      if (merged.has(child)) continue; // it's deletable too; its own children get repointed
      repoint.push({ branch: child, newParent: nearestLiveAncestor(forest, child, merged) });
    }
  }
  return { repoint, deletable: deletable.sort() };
}

// ─── Navigation — pure resolvers; the command layer does the actual checkout ──

export type NavResult = { target: string } | { error: string };

/** Toward the tip: the single child, or an error when ambiguous / already on top. */
export function navUp(forest: Forest, branch: string): NavResult {
  const node = forest.nodes.get(branch);
  if (!node) return { error: `I don't know a branch called ${branch}.` };
  const kids = node.children;
  if (kids.length === 0) return { error: `${branch} is already at the top of its stack.` };
  if (kids.length > 1) {
    return { error: `${branch} forks into ${kids.join(", ")} — use flo checkout to pick one.` };
  }
  return { target: kids[0] };
}

/** Toward trunk: this branch's parent (trunk when it's a stack root). */
export function navDown(forest: Forest, branch: string): NavResult {
  const node = forest.nodes.get(branch);
  if (!node) return { error: `I don't know a branch called ${branch}.` };
  if (node.isTrunk) return { error: `You're on ${forest.trunk} — nothing below it.` };
  return { target: node.parent ?? forest.trunk };
}

/** Climb to the tip of the linear stack; errors if it forks on the way up. */
export function navTop(forest: Forest, branch: string): NavResult {
  let cur = forest.nodes.get(branch);
  if (!cur) return { error: `I don't know a branch called ${branch}.` };
  if (cur.isTrunk) return { error: `You're on ${forest.trunk} — switch to a stack first.` };
  const seen = new Set<string>();
  for (;;) {
    if (cur.children.length === 0) return { target: cur.branch };
    if (cur.children.length > 1) {
      return { error: `${cur.branch} forks into ${cur.children.join(", ")} — use flo checkout to pick one.` };
    }
    const next = forest.nodes.get(cur.children[0]);
    if (!next || seen.has(next.branch)) return { target: cur.branch };
    seen.add(next.branch);
    cur = next;
  }
}

/** Drop to the stack root (the branch sitting directly on trunk). */
export function navBottom(forest: Forest, branch: string): NavResult {
  const node = forest.nodes.get(branch);
  if (!node) return { error: `I don't know a branch called ${branch}.` };
  if (node.isTrunk) return { error: `You're on ${forest.trunk} — switch to a stack first.` };
  const root = stackRootOf(forest, branch);
  return root ? { target: root } : { error: `${branch} has no stack root.` };
}
