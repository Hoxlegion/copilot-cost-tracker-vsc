import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import { repoUrlToName } from "../../parser/tracesDbReader";

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
    const configPath = resolveGitConfigPath(folder);
    if (!configPath || !fs.existsSync(configPath)) {
      return null;
    }
    const url = parseOriginUrl(fs.readFileSync(configPath, "utf-8"));
    return repoUrlToName(url);
  } catch {
    return null;
  }
}

/** Locate the git config file, handling worktrees/submodules where `.git` is a file. */
function resolveGitConfigPath(folder: string): string | null {
  const gitPath = path.join(folder, ".git");
  // Read `.git` directly and let the error tell us what it is, rather than
  // stat-then-read (which CodeQL flags as a file-system race / TOCTOU).
  let content: string;
  try {
    content = fs.readFileSync(gitPath, "utf-8");
  } catch (err) {
    // `.git` is a directory (standard repo layout) → config lives inside it.
    if ((err as NodeJS.ErrnoException).code === "EISDIR") {
      return path.join(gitPath, "config");
    }
    return null;
  }
  // `.git` is a file: "gitdir: <path>" pointing at the real git dir.
  const match = /^gitdir:\s*(.+)$/m.exec(content.trim());
  if (!match) {
    return null;
  }
  let gitDir = match[1].trim();
  if (!path.isAbsolute(gitDir)) {
    gitDir = path.resolve(folder, gitDir);
  }
  return path.join(gitDir, "config");
}

/** Extract the `origin` remote URL from a git config, falling back to the first remote. */
export function parseOriginUrl(config: string): string | null {
  let inRemote = false;
  let inOrigin = false;
  let firstUrl: string | null = null;
  let originUrl: string | null = null;

  for (const line of config.split(/\r?\n/)) {
    const section = /^\s*\[(.+?)\]\s*$/.exec(line);
    if (section) {
      const name = section[1].trim();
      inRemote = /^remote\s+"/i.test(name);
      inOrigin = /^remote\s+"origin"$/i.test(name);
      continue;
    }
    if (inRemote) {
      const kv = /^\s*url\s*=\s*(.+?)\s*$/i.exec(line);
      if (kv) {
        firstUrl ??= kv[1];
        if (inOrigin) {
          originUrl = kv[1];
        }
      }
    }
  }
  return originUrl ?? firstUrl;
}
