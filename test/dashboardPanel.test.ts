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

describe("dashboard panel", () => {
  it("uses the CSP nonce for its bundle and forwards bounded dashboard settings", async () => {
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
    };
    const reader = { getSurfaceBreakdown: vi.fn(async () => []), getTurnDiscovery: vi.fn(async () => []) };
    const pricing = { calculateCacheSavings: vi.fn(() => 0) };
    const configManager = { config: {
      billingCycleStartDay: 17, budgetCredits: 500, currency: "EUR", exchangeRate: 1.2,
      alertWindowHours: 48, dashboardSessionLimit: 25,
    } };

    DashboardPanel.createOrShow(
      { path: "/extension" } as Parameters<typeof DashboardPanel.createOrShow>[0],
      database as unknown as Parameters<typeof DashboardPanel.createOrShow>[1],
      pricing as unknown as Parameters<typeof DashboardPanel.createOrShow>[2],
      reader as unknown as Parameters<typeof DashboardPanel.createOrShow>[3],
      configManager as unknown as Parameters<typeof DashboardPanel.createOrShow>[4],
    );
    await vi.waitFor(() => expect(webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "dashboardData" })));

    const nonce = /script-src 'nonce-([a-f0-9]{32})' vscode-resource:/.exec(webview.html)?.[1];
    expect(nonce).toBeDefined();
    expect(webview.html).toContain(`<script nonce="${nonce}" src="vscode-resource:/extension/dist/webview/bundle.js"></script>`);
    expect(database.getSessionSummaries).toHaveBeenCalledWith(undefined, 25);
    expect(database.getCurrentMonthTotal).toHaveBeenCalledWith(17);
    expect(mocks.getAlerts).toHaveBeenCalledWith(database, undefined, 48);
    panel.onDidDispose.mock.calls[0][0]();
  });
});