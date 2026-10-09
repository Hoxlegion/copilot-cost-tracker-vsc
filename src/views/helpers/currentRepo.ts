import * as vscode from "vscode";
import { repoUrlToName } from "../../parser/tracesDbReader";
import { readOriginUrl } from "../../shared/gitRemote";

export { parseOriginUrl } from "../../shared/gitRemote";

/**
 * Resolve the current window's workspace to the same "Org/Repo" label used when
 * attributing turns from the traces DB. This lets the status bar scope its
 * figures to the repo the user is actually in, independent of other windows.
 *
 * Reads the open folder's git `origin` remote (falling back to any remote).
 * Returns null when there's no folder or no git remote, in which case callers
 * should fall back to unscoped (global) behavior.
 */
export function getCurrentWorkspaceRepo(): string | null {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!folder) {
    return null;
  }
  try {
    return repoUrlToName(readOriginUrl(folder));
  } catch {
    return null;
  }
}
