import type { BranchInfo, Forest } from "./stack.js";
import { colors } from "./ui.js";

// ─────────────────────────────────────────────────────────────────────────────
// The shared stack-graph renderer. `flo stack` prints it; `flo checkout` wraps
// an interactive picker around it. Orientation is tip-on-top, trunk at the
// bottom (matches `gt log`). See design-stacking.md §4.
//
// Layout is the git-graph lane algorithm: nodes are emitted tips-first
// (post-order from trunk), each occupies a lane, and a parent's lane absorbs
// all of its children's lanes via a merge connector. `layoutForest` is pure and
// color-free so the gutter geometry can be snapshot-tested; `renderForest`
// layers names, PR numbers, last-commit and color on top.
// ─────────────────────────────────────────────────────────────────────────────

export type LaidOutRow =
  | { kind: "node"; branch: string; gutter: string; isTrunk: boolean }
  | { kind: "edge"; gutter: string };

type RawRow =
  | { kind: "node"; branch: string; laneN: number; isTrunk: boolean; occupied: boolean[] }
  | { kind: "spine"; occupied: boolean[] }
  | { kind: "merge"; laneN: number; mergeLanes: number[]; occupied: boolean[] };

/** Post-order over the forest: every descendant before its parent, trunk last. */
function postorder(forest: Forest): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (b: string) => {
    if (seen.has(b)) return;
    seen.add(b);
    for (const child of forest.nodes.get(b)?.children ?? []) visit(child);
    out.push(b);
  };
  visit(forest.trunk);
  for (const b of forest.nodes.keys()) if (!seen.has(b)) visit(b); // detached safety net
  return out;
}

/**
 * Lay the forest out into rows with plain (color-free) gutter strings.
 * `current` only selects the node marker glyph (● vs ○), keeping this pure.
 */
export function layoutForest(forest: Forest, current?: string): LaidOutRow[] {
  const order = postorder(forest);
  const lanes: (string | null)[] = [];
  const raw: RawRow[] = [];
  let maxLanes = 0;

  const snapshot = () => lanes.map((l) => l !== null);
  const trackWidth = () => {
    maxLanes = Math.max(maxLanes, lanes.length);
  };

  order.forEach((branch, idx) => {
    const node = forest.nodes.get(branch);
    if (!node) return;
    const targets: number[] = [];
    for (let i = 0; i < lanes.length; i++) if (lanes[i] === branch) targets.push(i);

    let laneN: number;
    if (targets.length === 0) {
      laneN = lanes.indexOf(null);
      if (laneN === -1) {
        laneN = lanes.length;
        lanes.push(null);
      }
    } else {
      laneN = targets[0];
      const mergeLanes = targets.slice(1);
      if (mergeLanes.length > 0) {
        trackWidth();
        raw.push({ kind: "merge", laneN, mergeLanes, occupied: snapshot() });
        for (const i of mergeLanes) lanes[i] = null;
      }
    }

    lanes[laneN] = branch; // claim the lane for this row's snapshot
    trackWidth();
    raw.push({ kind: "node", branch, laneN, isTrunk: node.isTrunk, occupied: snapshot() });

    // Hand the lane down to the parent (null terminates at trunk / a true root).
    lanes[laneN] = node.parent && node.parent !== branch ? node.parent : null;
    while (lanes.length > 0 && lanes.at(-1) === null) lanes.pop();

    if (idx < order.length - 1 && lanes.some((l) => l !== null)) {
      trackWidth();
      raw.push({ kind: "spine", occupied: snapshot() });
    }
  });

  return raw.map((row) => stringifyRow(row, maxLanes, current));
}

/** Turn one abstract row into a fixed-width gutter string. */
function stringifyRow(row: RawRow, maxLanes: number, current?: string): LaidOutRow {
  const cell: string[] = [];
  const sep: string[] = [];
  for (let i = 0; i < maxLanes; i++) {
    cell.push(row.occupied[i] ? "│" : " ");
    sep.push(" ");
  }

  if (row.kind === "node") {
    if (row.isTrunk) return { kind: "node", branch: row.branch, gutter: "", isTrunk: true };
    cell[row.laneN] = row.branch === current ? "●" : "○";
  } else if (row.kind === "merge") {
    const rightmost = Math.max(...row.mergeLanes);
    cell[row.laneN] = "├";
    for (let i = row.laneN; i < rightmost; i++) sep[i] = "─";
    for (let i = row.laneN + 1; i < rightmost; i++) {
      if (row.mergeLanes.includes(i)) cell[i] = "┴";
      else if (row.occupied[i]) cell[i] = "┼";
      else cell[i] = "─";
    }
    cell[rightmost] = "┘";
  }

  let gutter = "";
  for (let i = 0; i < maxLanes; i++) gutter += cell[i] + sep[i];
  if (row.kind === "node") return { kind: "node", branch: row.branch, gutter, isTrunk: false };
  return { kind: "edge", gutter: gutter.replace(/\s+$/, "") };
}

export type RenderOpts = {
  current?: string;
  info?: Map<string, BranchInfo>;
  prMap?: Map<string, number>;
};

const INDENT = "  ";

/** Visible width of a string, ignoring ANSI color codes. */
function visibleWidth(s: string): number {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\[[0-9;]*m/g, "").length;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, Math.max(1, max - 1))}…`;
}

/**
 * Render the forest to colored terminal lines (tip-on-top) plus the top-to-bottom
 * branch order (node rows only) for callers that need a selection list.
 */
export function renderForest(forest: Forest, opts: RenderOpts = {}): { lines: string[]; order: string[] } {
  const rows = layoutForest(forest, opts.current);
  const info = opts.info ?? new Map<string, BranchInfo>();
  const prMap = opts.prMap ?? new Map<string, number>();

  const prLabel = (branch: string) => {
    const n = prMap.get(branch);
    return n ? `PR#${n}` : "";
  };

  // Width of the gutter+name block, so the PR / last-commit columns line up.
  let nameCol = 0;
  for (const row of rows) {
    if (row.kind !== "node" || row.isTrunk) continue;
    nameCol = Math.max(nameCol, visibleWidth(row.gutter) + 1 + row.branch.length);
  }
  const maxPr = Math.max(0, ...rows.map((r) => (r.kind === "node" && !r.isTrunk ? prLabel(r.branch).length : 0)));

  const cols = process.stdout.columns;
  const subjectCap = cols && cols > 0 ? Math.max(20, Math.min(80, cols - 6 - nameCol - (maxPr ? maxPr + 2 : 0))) : 50;

  const order: string[] = [];
  const lines: string[] = [];

  for (const row of rows) {
    if (row.kind === "edge") {
      lines.push(INDENT + colors.dim(row.gutter));
      continue;
    }
    if (row.isTrunk) {
      order.push(row.branch);
      lines.push(INDENT + colors.dim(row.branch));
      continue;
    }
    order.push(row.branch);

    const node = forest.nodes.get(row.branch);
    const isCurrent = row.branch === opts.current;
    const markerGlyph = isCurrent ? colors.cyan("●") : colors.dim("○");
    const coloredGutter = row.gutter.replace(/[●○]/, markerGlyph);
    const name = isCurrent ? colors.bold(row.branch) : row.branch;
    const left = coloredGutter + " " + name;
    const pad = " ".repeat(Math.max(0, nameCol - visibleWidth(left)));

    const pr = prLabel(row.branch);
    const prCell = maxPr
      ? pr
        ? colors.magenta(pr) + " ".repeat(maxPr - pr.length)
        : colors.dim("—") + " ".repeat(maxPr - 1)
      : "";

    const meta = info.get(row.branch);
    const commit = meta && meta.short ? colors.dim(`${meta.short}  ${truncate(meta.subject, subjectCap)}`) : "";
    const restack = node?.needsRestack ? colors.yellow("⚠ needs restack") : "";

    const parts = [INDENT + left + pad, prCell, commit, restack].filter(Boolean);
    let line = parts.join("  ");
    if (isCurrent) line += colors.cyan("   ← current");
    lines.push(line);
  }

  return { lines, order };
}
