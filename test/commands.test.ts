import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredTurn } from "../src/database";

const mocks = vi.hoisted(() => ({
  commands: new Map<string, () => Promise<void>>(),
  showQuickPick: vi.fn(),
  showSaveDialog: vi.fn(),
  showInformationMessage: vi.fn(),
  showErrorMessage: vi.fn(),
}));

vi.mock("vscode", () => ({
  commands: {
    registerCommand: (name: string, handler: () => Promise<void>) => {
      mocks.commands.set(name, handler);
      return { dispose: vi.fn() };
    },
  },
  Uri: { file: (fsPath: string) => ({ scheme: "file", fsPath }) },
  window: {
    showQuickPick: mocks.showQuickPick,
    showSaveDialog: mocks.showSaveDialog,
    showInformationMessage: mocks.showInformationMessage,
    showErrorMessage: mocks.showErrorMessage,
  },
}));

vi.mock("../src/views", () => ({ DashboardPanel: { createOrShow: vi.fn() } }));

import { registerCommands } from "../src/commands";

describe("export command", () => {
  let exportDir: string;

  beforeEach(async () => {
    vi.resetAllMocks();
    mocks.commands.clear();
    exportDir = await mkdtemp(join(tmpdir(), "cost-export-"));
  });

  afterEach(async () => {
    await rm(exportDir, { recursive: true, force: true });
  });

  it("prevents spreadsheet formulas in CSV text fields", async () => {
    const turn: StoredTurn = {
      id: 1, sessionId: "=1+1", timestamp: 100, duration: -2,
      agentName: " \t@SUM(1,2)", model: "+SUM(1,2)", modelFamily: "model",
      inputTokens: 1, outputTokens: 2, cachedTokens: 0, cacheWriteTokens: 0,
      totalTokens: 3, costUsd: 0.01, credits: 1, workspace: "-cmd",
      status: 'a,b"c', costSource: "real",
    };
    mocks.showQuickPick.mockResolvedValue({ label: "CSV" });
    const targetPath = join(exportDir, "export.csv");
    mocks.showSaveDialog.mockResolvedValue({ scheme: "file", fsPath: targetPath });
    registerCommands({ subscriptions: [] } as unknown as Parameters<typeof registerCommands>[0], {
      database: { iterateAllTurns: () => [turn] },
    } as unknown as Parameters<typeof registerCommands>[1]);

    await mocks.commands.get("copilotCostTracker.exportData")!();

    expect(mocks.showErrorMessage).not.toHaveBeenCalled();
    const csv = await readFile(targetPath, "utf8");
    expect(csv).toContain(',"\'=1+1",');
    expect(csv).toContain(',"\' \t@SUM(1,2)",');
    expect(csv).toContain(',"\'+SUM(1,2)",');
    expect(csv).toContain(',"\'-cmd",');
    expect(csv).toContain(',-2,');
    expect(csv).toContain(',"a,b""c",');
  });

  it("writes many JSON turns without loading all turns at once", async () => {
    mocks.showQuickPick.mockResolvedValue({ label: "JSON" });
    const targetPath = join(exportDir, "export.json");
    mocks.showSaveDialog.mockResolvedValue({ scheme: "file", fsPath: targetPath });
    const getAllTurns = vi.fn(() => { throw new Error("eager read"); });
    const iterateAllTurns = vi.fn(function* () {
      for (let index = 0; index < 1200; index++) {
        yield {
          id: index + 1, sessionId: `session-${index}`, timestamp: index, duration: 1,
          agentName: "agent", model: "model", modelFamily: "model", inputTokens: 1,
          outputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, totalTokens: 1,
          costUsd: 0, credits: 0, workspace: "repo", status: "ok", costSource: "real",
        } satisfies StoredTurn;
      }
    });
    registerCommands({ subscriptions: [] } as unknown as Parameters<typeof registerCommands>[0], {
      database: { getAllTurns, iterateAllTurns },
    } as unknown as Parameters<typeof registerCommands>[1]);

    await mocks.commands.get("copilotCostTracker.exportData")!();

    expect(getAllTurns).not.toHaveBeenCalled();
    expect(mocks.showErrorMessage).not.toHaveBeenCalled();
    const turns = JSON.parse(await readFile(targetPath, "utf8")) as StoredTurn[];
    expect(turns).toHaveLength(1200);
    expect(turns.at(-1)?.sessionId).toBe("session-1199");
    expect(await readdir(exportDir)).toEqual(["export.json"]);
  });

  it("preserves an existing export if the database read fails", async () => {
    mocks.showQuickPick.mockResolvedValue({ label: "CSV" });
    const targetPath = join(exportDir, "export.csv");
    await writeFile(targetPath, "previous export");
    mocks.showSaveDialog.mockResolvedValue({ scheme: "file", fsPath: targetPath });
    registerCommands({ subscriptions: [] } as unknown as Parameters<typeof registerCommands>[0], {
      database: { iterateAllTurns: function* () { yield { id: 1 }; throw new Error("read failed"); } },
    } as unknown as Parameters<typeof registerCommands>[1]);

    await mocks.commands.get("copilotCostTracker.exportData")!();

    expect(mocks.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("read failed"));
    expect(await readFile(targetPath, "utf8")).toBe("previous export");
    expect(await readdir(exportDir)).toEqual(["export.csv"]);
  });

  it("writes valid JSON when there are no recorded turns", async () => {
    mocks.showQuickPick.mockResolvedValue({ label: "JSON" });
    const targetPath = join(exportDir, "empty.json");
    mocks.showSaveDialog.mockResolvedValue({ scheme: "file", fsPath: targetPath });
    registerCommands({ subscriptions: [] } as unknown as Parameters<typeof registerCommands>[0], {
      database: { iterateAllTurns: () => [] },
    } as unknown as Parameters<typeof registerCommands>[1]);

    await mocks.commands.get("copilotCostTracker.exportData")!();

    expect(await readFile(targetPath, "utf8")).toBe("[]");
    expect(mocks.showInformationMessage).toHaveBeenCalledWith(expect.stringContaining("Exported 0 turns"));
  });

  it("rejects non-local export destinations before reading any turns", async () => {
    mocks.showQuickPick.mockResolvedValue({ label: "CSV" });
    mocks.showSaveDialog.mockResolvedValue({ scheme: "vscode-remote", fsPath: "remote.csv" });
    const iterateAllTurns = vi.fn(() => []);
    registerCommands({ subscriptions: [] } as unknown as Parameters<typeof registerCommands>[0], {
      database: { iterateAllTurns },
    } as unknown as Parameters<typeof registerCommands>[1]);

    await mocks.commands.get("copilotCostTracker.exportData")!();

    expect(iterateAllTurns).not.toHaveBeenCalled();
    expect(mocks.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("local file"));
    expect(await readdir(exportDir)).toEqual([]);
  });
});