import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";

/**
 * Optional manual override for the VS Code user data directory (the folder that
 * contains `globalStorage` and `workspaceStorage`, e.g. `.../Code/User`). Set from
 * the `copilotCostTracker.userDataPath` setting during activation.
 */
let userDataPathOverride: string | undefined;

export function setUserDataPathOverride(override: string | undefined): void {
  const trimmed = override?.trim();
  userDataPathOverride = trimmed ? trimmed : undefined;
}

/** Platform-specific base directory that holds per-editor app folders. */
function editorConfigRoot(): string {
  const homeDir = os.homedir();
  switch (os.platform()) {
    case "win32":
      return path.join(homeDir, "AppData", "Roaming");
    case "darwin":
      return path.join(homeDir, "Library", "Application Support");
    default:
      return path.join(homeDir, ".config");
  }
}

/** Detect the editor's app-folder name from the running executable path. */
function detectAppFolderFromExecPath(): string | undefined {
  const exec = (process.execPath || "").toLowerCase();
  if (exec.includes("insiders")) return "Code - Insiders";
  if (exec.includes("cursor")) return "Cursor";
  if (exec.includes("windsurf")) return "Windsurf";
  return undefined;
}

/**
 * Returns the VS Code (or compatible fork) user data directory, i.e. the folder
 * containing `globalStorage`/`workspaceStorage` (e.g. `.../Code/User`).
 *
 * Resolution order:
 *   1. `copilotCostTracker.userDataPath` override (if set)
 *   2. Portable Mode (`VSCODE_PORTABLE` env var)
 *   3. Editor variant detected from `process.execPath` (Insiders, Cursor, Windsurf)
 *   4. First existing candidate among known editor app folders
 *   5. Stable default (`Code`)
 */
export function getVscodeUserDataPath(): string {
  if (userDataPathOverride) {
    return userDataPathOverride;
  }

  const portable = process.env.VSCODE_PORTABLE?.trim();
  if (portable) {
    return path.join(portable, "user-data", "User");
  }

  const root = editorConfigRoot();
  const detected = detectAppFolderFromExecPath();

  // Prioritize the detected variant, then fall back through known editor folders.
  const candidates = [detected, "Code", "Code - Insiders", "Cursor", "Windsurf"]
    .filter((v): v is string => Boolean(v));

  for (const appFolder of candidates) {
    const candidate = path.join(root, appFolder, "User");
    try {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {
      // Ignore and try the next candidate.
    }
  }

  return path.join(root, detected ?? "Code", "User");
}
