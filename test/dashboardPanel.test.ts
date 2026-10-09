import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createWebviewPanel: vi.fn(),
  getAlerts: vi.fn(() => []),
  buildPlaybook: vi.fn(() => []),
}));

vi.mock("vscode", () => ({
  ViewColumn: { Beside: 2 },
  Uri: { joinPath: (uri: { path: string }, ...parts: string[]) => ({
    path: [uri.path, ...parts].join("/"),
    toString: () => [uri.path, ...parts].join("/"),
  }) },
  window: { createWebviewPanel: mocks.createWebviewPanel },
  commands: { executeCommand: vi.fn() },
}));

vi.mock("../src/insights", () => ({
  getAlerts: mocks.getAlerts,
  buildPlaybook: mocks.buildPlaybook,
}));

import { DashboardPanel } from "../src/views/dashboardPanel";

function createHarness(configOverrides: Record<string, unknown> = {}) {
  const webview = {
    cspSource: "vscode-resource:",
    asWebviewUri: (uri: { path: string }) => `vscode-resource:${uri.path}`,
    onDidReceiveMessage: vi.fn(),
    postMessage: vi.fn(),
    html: "",
  };
  const panel = { webview, onDidDispose: vi.fn(), dispose: vi.fn(), reveal: vi.fn() };
  mocks.createWebviewPanel.mockReturnValue(panel);
  const database = {
    getInsightMetrics: vi.fn(() => ({})),
    getCurrentMonthTotal: vi.fn(() => ({ costUsd: 0, credits: 0, turns: 0 })),
    getDailyCosts: vi.fn(() => []),
    getModelBreakdown: vi.fn(() => []),
    getAgentBreakdown: vi.fn(() => []),
    getDailyAgentBreakdown: vi.fn(() => []),
    getSessionSummaries: vi.fn(() => []),
    getCreditsSince: vi.fn(() => 0),
    getCostSince: vi.fn(() => ({ costUsd: 0, credits: 0, turns: 0 })),
    getCacheSavingsMetrics: vi.fn(() => ({})),
    getSessionContextDistribution: vi.fn(() => []),
    getSessionModelBreakdowns: vi.fn(() => []),
    getCostBySourceSince: vi.fn(() => [{ source: "cli", costUsd: 1, credits: 100, turns: 2 }]),
    countCliSessionsWithoutUsage: vi.fn(() => 3),
  };
  const reader = { getSurfaceBreakdown: vi.fn(async () => []), getTurnDiscovery: vi.fn(async () => []) };
  const pricing = { calculateCacheSavings: vi.fn(() => 0) };
  const configManager = { config: {
    billingCycleStartDay: 17, budgetCredits: 500, currency: "EUR", exchangeRate: 1.2,
    alertWindowHours: 48, dashboardSessionLimit: 25, includeCliInBudget: true,
    ...configOverrides,
  } };

  DashboardPanel.createOrShow(
    { path: "/extension" } as Parameters<typeof DashboardPanel.createOrShow>[0],
    database as unknown as Parameters<typeof DashboardPanel.createOrShow>[1],
    pricing as unknown as Parameters<typeof DashboardPanel.createOrShow>[2],
    reader as unknown as Parameters<typeof DashboardPanel.createOrShow>[3],
    configManager as unknown as Parameters<typeof DashboardPanel.createOrShow>[4],
  );
  const receive = (message: unknown) => (webview.onDidReceiveMessage.mock.calls[0][0] as (m: unknown) => void)(message);
  const dispose = () => (panel.onDidDispose.mock.calls[0][0] as () => void)();
  return { webview, database, receive, dispose };
}

describe("dashboard panel", () => {
  it("uses the CSP nonce for its bundle and forwards bounded dashboard settings", async () => {
    const { webview, database, dispose } = createHarness();
    await vi.waitFor(() => expect(webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "dashboardData" })));

    const nonce = /script-src 'nonce-([a-f0-9]{32})' vscode-resource:/.exec(webview.html)?.[1];
    expect(nonce).toBeDefined();
    expect(webview.html).toContain(`<script nonce="${nonce}" src="vscode-resource:/extension/dist/webview/bundle.js"></script>`);
    expect(database.getSessionSummaries).toHaveBeenCalledWith(undefined, 25, undefined);
    expect(database.getCurrentMonthTotal).toHaveBeenCalledWith(17, undefined, undefined);
    expect(mocks.getAlerts).toHaveBeenCalledWith(database, undefined, 48);
    expect(webview.postMessage.mock.calls[0][0].data).toMatchObject({
      sourceFilter: "all", hasCliData: true, cliSessionsWithoutUsage: 3,
    });
    dispose();
  });

  it("re-assembles for a validated source filter and keeps budget figures on the budget setting", async () => {
    const { webview, database, receive, dispose } = createHarness({ includeCliInBudget: false });
    await vi.waitFor(() => expect(webview.postMessage).toHaveBeenCalledTimes(1));
    // All sources shown, CLI excluded from the budget: only budget figures are Chat-only.
    expect(database.getSessionSummaries).toHaveBeenLastCalledWith(undefined, 25, undefined);
    expect(database.getCreditsSince).toHaveBeenLastCalledWith(expect.any(Number), "chat");

    receive({ command: "setSourceFilter", source: "cli" });
    await vi.waitFor(() => expect(webview.postMessage).toHaveBeenCalledTimes(2));
    expect(webview.postMessage.mock.calls[1][0].data.sourceFilter).toBe("cli");
    expect(database.getSessionSummaries).toHaveBeenLastCalledWith(undefined, 25, "cli");
    expect(database.getDailyCosts).toHaveBeenLastCalledWith(365, undefined, "cli");
    expect(database.getCreditsSince).toHaveBeenLastCalledWith(expect.any(Number), "cli");

    receive({ command: "setSourceFilter", source: "'; DROP TABLE turns; --" });
    receive({ command: "setSourceFilter" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(webview.postMessage).toHaveBeenCalledTimes(2);
    dispose();
  });
});