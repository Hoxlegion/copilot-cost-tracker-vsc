import * as vscode from "vscode";
import { CostDatabase } from "../database";
import { PricingEngine } from "../pricing";
import { TracesDbReader } from "../parser";
import { DashboardDataAssembler } from "./dashboardDataAssembler";
import { renderDashboard } from "./dashboardTemplate";

export class DashboardPanel {
  private static _currentPanel: DashboardPanel | undefined;

  public static get currentPanel(): DashboardPanel | undefined {
    return this._currentPanel;
  }

  private static set currentPanel(value: DashboardPanel | undefined) {
    this._currentPanel = value;
  }

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly database: CostDatabase;
  private readonly pricing: PricingEngine;
  private readonly assembler: DashboardDataAssembler;
  private disposables: vscode.Disposable[] = [];

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    database: CostDatabase,
    pricing: PricingEngine,
    reader: TracesDbReader
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.database = database;
    this.pricing = pricing;
    this.assembler = new DashboardDataAssembler(database, reader);
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  public static createOrShow(
    extensionUri: vscode.Uri,
    database: CostDatabase,
    pricing: PricingEngine,
    reader: TracesDbReader
  ): void {
    const column = vscode.ViewColumn.Beside;

    if (DashboardPanel.currentPanel) {
      DashboardPanel.currentPanel.panel.reveal(column);
      void DashboardPanel.currentPanel.update();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "copilotCostDashboard",
      "Copilot Cost Dashboard",
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, "media"),
          vscode.Uri.joinPath(extensionUri, "dist"),
        ],
      }
    );

    DashboardPanel.currentPanel = new DashboardPanel(panel, extensionUri, database, pricing, reader);
    void DashboardPanel.currentPanel.update();
  }

  public async update(): Promise<void> {
    try {
      const config = vscode.workspace.getConfiguration("copilotCostTracker");
      const billingCycleStartDay = config.get<number>("billingCycleStartDay", 1);
      const budgetCredits = config.get<number>("budgetCredits", 180);

      const rawData = await this.assembler.assemble(billingCycleStartDay);

      this.panel.webview.html = renderDashboard({
        rawData,
        database: this.database,
        pricing: this.pricing,
        cspSource: this.panel.webview.cspSource,
        budgetCredits,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.panel.webview.html = `<!DOCTYPE html><html><body style="font-family: var(--vscode-font-family); padding: 16px; color: var(--vscode-editor-foreground); background: var(--vscode-editor-background);"><h3>Dashboard failed to render</h3><p>${message.replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</p><p>Open Developer Tools or reload the window after updating the extension.</p></body></html>`;
    }
  }

  private dispose(): void {
    DashboardPanel.currentPanel = undefined;
    this.panel.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }
}
