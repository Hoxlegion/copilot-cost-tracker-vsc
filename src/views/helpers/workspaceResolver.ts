import * as path from "node:path";
import * as fs from "node:fs";
import { getVscodeUserDataPath } from "../../shared/paths";

function shortenWorkspaceName(workspace: string): string {
  if (!workspace) return "unknown";
  const normalized = workspace.replaceAll("\\", "/");
  const parts = normalized.split("/").filter(Boolean);
  const tail = parts.slice(-2).join("/") || normalized;
  return tail.length > 34 ? `${tail.slice(0, 31)}…` : tail;
}

const SAFE_HASH_RE = /^[a-f0-9]{32,64}$/i;
const MAX_CACHE_SIZE = 500;
const workspaceNameCache = new Map<string, string>();

/** Insert into the cache, evicting the oldest entry when the size limit is exceeded. */
function cacheSet(hash: string, value: string): string {
  workspaceNameCache.set(hash, value);
  if (workspaceNameCache.size > MAX_CACHE_SIZE) {
    const oldest = workspaceNameCache.keys().next().value;
    if (oldest !== undefined) workspaceNameCache.delete(oldest);
  }
  return value;
}

export function resolveWorkspaceName(hash: string): string {
  const cached = workspaceNameCache.get(hash);
  if (cached !== undefined) return cached;
  if (!hash || hash === "unknown") return hash || "unknown";
  if (hash.includes("/") || hash.includes("\\")) {
    return cacheSet(hash, shortenWorkspaceName(hash));
  }

  // Reject hashes that don't look like hex digests to prevent path traversal
  if (!SAFE_HASH_RE.test(hash)) {
    return cacheSet(hash, hash.slice(0, 12) + "…");
  }

  try {
    const storagePath = path.join(getVscodeUserDataPath(), "workspaceStorage", hash, "workspace.json");

    if (!fs.existsSync(storagePath)) return hash.slice(0, 12) + "…";

    const raw = JSON.parse(fs.readFileSync(storagePath, "utf-8")) as Record<string, unknown>;
    const folder = (raw.folder as string) ?? "";
    if (!folder) return hash.slice(0, 12) + "…";

    const decoded = decodeURIComponent(folder)
      .replace(/^[a-z][a-z0-9+\-.]*:\/+/i, "")
      .replaceAll("\\", "/");
    const parts = decoded.split("/").filter(Boolean);
    const tail = parts.slice(-2).join("/") || decoded;
    const result = tail.length > 34 ? `${tail.slice(0, 31)}…` : tail;
    return cacheSet(hash, result);
  } catch {
    return cacheSet(hash, hash.slice(0, 12) + "…");
  }
}
