import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { userBaseDir } from "./slot.js";
import { colors } from "./ui.js";

const CACHE_FILENAME = "update-check.json";
const CHECK_TTL_MS = 12 * 60 * 60 * 1000; // 12h
const FETCH_TIMEOUT_MS = 2500;
// Source of truth for the latest published version: the npm registry. A
// "release" is `npm publish` of a bumped version field.
const REMOTE_PKG_URL = "https://registry.npmjs.org/flo-tools/latest";

export type UpdateCache = {
  checkedAt: number;
  latestVersion: string;
};

export type InstallSource = "npm" | "git" | "unknown";

export type UpdateStatus = {
  currentVersion: string;
  latestVersion: string;
  available: boolean;
  source: InstallSource;
  hint: string;
};

function cachePath(): string {
  return join(userBaseDir(), CACHE_FILENAME);
}

async function readCache(): Promise<UpdateCache | null> {
  try {
    const raw = await readFile(cachePath(), "utf8");
    const parsed = JSON.parse(raw) as UpdateCache;
    if (typeof parsed.checkedAt !== "number" || typeof parsed.latestVersion !== "string") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function writeCache(data: UpdateCache): Promise<void> {
  const base = userBaseDir();
  await mkdir(base, { recursive: true });
  await writeFile(cachePath(), `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export function isFresh(cache: UpdateCache, now = Date.now()): boolean {
  return now - cache.checkedAt < CHECK_TTL_MS;
}

/**
 * Compare two semver-ish strings. Returns -1 if a<b, 0 if equal, 1 if a>b.
 * Missing segments are treated as 0; non-numeric segments compared lexically.
 */
export function compareVersions(a: string, b: string): number {
  const clean = (v: string) => v.replace(/^v/, "").split(/[.-]/);
  const as = clean(a);
  const bs = clean(b);
  const len = Math.max(as.length, bs.length);
  for (let i = 0; i < len; i++) {
    const ai = as[i] ?? "0";
    const bi = bs[i] ?? "0";
    const an = Number(ai);
    const bn = Number(bi);
    if (Number.isFinite(an) && Number.isFinite(bn)) {
      if (an !== bn) return an < bn ? -1 : 1;
      continue;
    }
    if (ai !== bi) return ai < bi ? -1 : 1;
  }
  return 0;
}

/**
 * Detect how flo is installed from the absolute path to its module directory.
 * npm installs (global or local) live under a node_modules/ path; everything
 * else is treated as a direct checkout.
 */
export function detectInstallSource(modulePath: string): InstallSource {
  if (/[/\\]node_modules[/\\]/.test(modulePath)) return "npm";
  if (modulePath && modulePath.length > 0) return "git";
  return "unknown";
}

/** Human-readable command for refreshing flo. */
export function updateHint(source: InstallSource, repoRoot?: string): string {
  if (source === "npm") return "npm i -g flo-tools";
  if (source === "git") {
    const where = repoRoot ? `cd ${repoRoot} && ` : "";
    return `${where}git pull && ./tools/flo/install`;
  }
  return "npm i -g flo-tools";
}

/**
 * Read flo's own version from the nearest package.json above this module.
 * Walks up from the module dir so it works whether running from compiled
 * `dist/lib/` or directly from `lib/` via tsx.
 */
export async function readCurrentVersion(): Promise<string> {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    try {
      const raw = await readFile(join(dir, "package.json"), "utf8");
      const parsed = JSON.parse(raw) as { name?: string; version?: string };
      if (parsed.version) return parsed.version;
    } catch {
      /* keep walking up */
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return "0.0.0";
}

function moduleRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..");
}

async function fetchLatestVersion(): Promise<string | null> {
  try {
    const res = await fetch(REMOTE_PKG_URL, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { version?: string };
    const v = body.version?.trim();
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

/**
 * Return the current update status, refreshing the cache inline when stale.
 * Network failures are swallowed — the check is purely advisory. Returns null
 * when no version information is available yet (first run with no network).
 */
export async function checkForUpdate(): Promise<UpdateStatus | null> {
  const currentVersion = await readCurrentVersion();
  const source = detectInstallSource(moduleRoot());

  let cache = await readCache();
  if (!cache || !isFresh(cache)) {
    const latest = await fetchLatestVersion();
    if (latest) {
      cache = { checkedAt: Date.now(), latestVersion: latest };
      await writeCache(cache).catch(() => {});
    }
  }

  if (!cache) return null;

  const available = compareVersions(currentVersion, cache.latestVersion) < 0;
  return {
    currentVersion,
    latestVersion: cache.latestVersion,
    available,
    source,
    hint: updateHint(source, moduleRoot().replace(/\/tools\/flo$/, "")),
  };
}

export function printUpdateNotice(status: UpdateStatus): void {
  if (!status.available) return;
  const msg =
    `flo ${colors.bold(status.latestVersion)} is available ` +
    `(you have ${colors.dim(status.currentVersion)}). ` +
    `Run ${colors.cyan(status.hint)} to update.`;
  console.log("");
  console.log(`  ${colors.yellow("↑")} ${msg}`);
}

/** Convenience: check + print, swallowing all errors. */
export async function maybeNotifyUpdate(): Promise<void> {
  try {
    const status = await checkForUpdate();
    if (status) printUpdateNotice(status);
  } catch {
    /* advisory only */
  }
}
