import { describe, it, expect, vi } from "vitest";

// currentRepo.ts imports `vscode` for workspaceFolders; parseOriginUrl itself
// doesn't use it, so a minimal stub lets the module load under vitest.
vi.mock("vscode", () => ({ workspace: { workspaceFolders: undefined } }));

import { parseOriginUrl } from "../src/views/helpers/currentRepo";

describe("parseOriginUrl", () => {
  it("returns the origin remote URL", () => {
    const cfg = `
[core]
\trepositoryformatversion = 0
[remote "origin"]
\turl = https://github.com/Hoxlegion/copilot-cost-tracker-vsc.git
\tfetch = +refs/heads/*:refs/remotes/origin/*
[branch "main"]
\tremote = origin
`;
    expect(parseOriginUrl(cfg)).toBe("https://github.com/Hoxlegion/copilot-cost-tracker-vsc.git");
  });

  it("prefers origin over other remotes regardless of order", () => {
    const cfg = `
[remote "upstream"]
\turl = https://github.com/upstream/repo.git
[remote "origin"]
\turl = git@github.com:me/repo.git
`;
    expect(parseOriginUrl(cfg)).toBe("git@github.com:me/repo.git");
  });

  it("falls back to the first remote when there is no origin", () => {
    const cfg = `
[remote "fork"]
\turl = https://github.com/fork/repo.git
`;
    expect(parseOriginUrl(cfg)).toBe("https://github.com/fork/repo.git");
  });

  it("returns null when there are no remotes", () => {
    expect(parseOriginUrl("[core]\n\tbare = false\n")).toBeNull();
  });
});
