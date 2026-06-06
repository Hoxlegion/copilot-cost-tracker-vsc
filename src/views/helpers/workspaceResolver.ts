import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";

function shortenWorkspaceName(workspace: string): string {
  if (!workspace) return "unknown";
  const normalized = workspace.replaceAll("\\", "/");
  const parts = normalized.split("/").filter(Boolean);
  const tail = parts.slice(-2).join("/") || normalized;
  return tail.length > 34 ? `${tail.slice(0, 31)}…` : tail;
}

export function resolveWorkspaceName(hash: string): string {
  if (!hash || hash === "unknown") return hash || "unknown";
  if (hash.includes("/") || hash.includes("\\")) return shortenWorkspaceName(hash);

  try {
    const platform = os.platform();
    let storagePath: string;
    if (platform === "win32") {
      storagePath = path.join(os.homedir(), "AppData", "Roaming", "Code", "User", "workspaceStorage", hash, "workspace.json");
    } else if (platform === "darwin") {
      storagePath = path.join(os.homedir(), "Library", "Application Support", "Code", "User", "workspaceStorage", hash, "workspace.json");
    } else {
      storagePath = path.join(os.homedir(), ".config", "Code", "User", "workspaceStorage", hash, "workspace.json");
    }

    if (!fs.existsSync(storagePath)) return hash.slice(0, 12) + "…";

    const raw = JSON.parse(fs.readFileSync(storagePath, "utf-8")) as Record<string, unknown>;
    const folder = (raw.folder as string) ?? "";
    if (!folder) return hash.slice(0, 12) + "…";

    const decoded = decodeURIComponent(folder)
      .replace(/^[a-z][a-z0-9+\-.]*:\/+/i, "")
      .replaceAll("\\", "/");
    const parts = decoded.split("/").filter(Boolean);
    const tail = parts.slice(-2).join("/") || decoded;
    return tail.length > 34 ? `${tail.slice(0, 31)}…` : tail;
  } catch {
    return hash.slice(0, 12) + "…";
  }
}
