import * as vscode from 'vscode';
import { CostReader } from '../database';
import { PricingEngine } from '../pricing';
import { TracesDbReader } from '../parser';
import { DashboardDataAssembler } from './dashboardDataAssembler';

export class DashboardPanel {
  private static _currentPanel: DashboardPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly database: CostReader;
  private readonly pricing: PricingEngine;
  private readonly assembler: DashboardDataAssembler;
  private disposables: vscode.Disposable[] = [];
  private htmlLoaded = false;

  public static get currentPanel(): DashboardPanel | undefined {
    return this._currentPanel;
  }

  private static set currentPanel(value: DashboardPanel | undefined) {
    this._currentPanel = value;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    database: CostReader,
    pricing: PricingEngine,
    reader: TracesDbReader
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.database = database;
    this.pricing = pricing;
    this.assembler = new DashboardDataAssembler(database, reader, pricing);
    
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    
    this.panel.webview.onDidReceiveMessage(
      (message) => {
        if (message.command === 'refresh') {
          vscode.commands.executeCommand('copilotCostTracker.refresh');
        }
      },
      null,
      this.disposables
    );
  }

  public static createOrShow(
    extensionUri: vscode.Uri,
    database: CostReader,
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
      'copilotCostDashboard',
      'Copilot Cost Dashboard',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'media'),
          vscode.Uri.joinPath(extensionUri, 'dist'),
        ],
      }
    );

    DashboardPanel.currentPanel = new DashboardPanel(panel, extensionUri, database, pricing, reader);
    void DashboardPanel.currentPanel.update();
  }

  public async update(): Promise<void> {
    try {
      if (!this.htmlLoaded) {
        this.panel.webview.html = this.buildHtml();
        this.htmlLoaded = true;
      }

      const config = vscode.workspace.getConfiguration('copilotCostTracker');
      const billingCycleStartDay = config.get<number>('billingCycleStartDay', 1);
      const budgetCredits = config.get<number>('budgetCredits', 180);
      const currency = config.get<string>('currency', 'USD');
      const exchangeRate = config.get<number>('exchangeRate', 1);

      const rawData = await this.assembler.assemble(billingCycleStartDay, budgetCredits, currency, exchangeRate);
      
      this.panel.webview.postMessage({
        type: 'dashboardData',
        data: rawData,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Dashboard update failed:', message);
    }
  }

  private buildHtml(): string {
    const nonce = this.getNonce();
    const cspSource = this.panel.webview.cspSource;
    const webviewUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview')
    );

    // The Svelte build emits a single IIFE bundle with CSS inlined, so the host
    // HTML is constructed directly here rather than reading and regex-rewriting
    // Vite's generated index.html. Only the trusted bundle (matched by the CSP
    // nonce) can execute; default-src 'none' blocks everything else.
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${cspSource}; font-src ${cspSource};">
  <title>Copilot Cost Dashboard</title>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}" src="${webviewUri}/bundle.js"></script>
</body>
</html>`;
  }

  private getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
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
