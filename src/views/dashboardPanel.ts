import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { CostDatabase } from '../database';
import { PricingEngine } from '../pricing';
import { TracesDbReader } from '../parser';
import { DashboardDataAssembler } from './dashboardDataAssembler';

export class DashboardPanel {
  private static _currentPanel: DashboardPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly database: CostDatabase;
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
        const webviewPath = path.join(this.extensionUri.fsPath, 'dist', 'webview', 'index.html');
        let html = fs.readFileSync(webviewPath, 'utf-8');
        
        const nonce = this.getNonce();
        html = html
          .replace(/\{\{CSP_SOURCE\}\}/g, this.panel.webview.cspSource)
          .replace(/\{\{NONCE\}\}/g, nonce);
        
        const webviewUri = this.panel.webview.asWebviewUri(
          vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview')
        );
        
        // Fix Vite-generated script tag: replace relative path with webview URI,
        // add nonce, remove type="module" (bundle is IIFE format)
        html = html.replace(
          /<script[^>]*src="\.\/bundle\.js"[^>]*><\/script>/,
          ''
        );
        
        // Add script tag at the end of body (after #app div exists)
        html = html.replace(
          '</body>',
          `<script nonce="${nonce}" src="${webviewUri}/bundle.js"></script></body>`
        );
        
        // Also handle the original template script tag if present
        html = html.replace(/src="\.\//g, `src="${webviewUri}/`);
        html = html.replace(/href="\.\//g, `href="${webviewUri}/`);
        
        this.panel.webview.html = html;
        this.htmlLoaded = true;
      }

      const config = vscode.workspace.getConfiguration('copilotCostTracker');
      const billingCycleStartDay = config.get<number>('billingCycleStartDay', 1);
      const budgetCredits = config.get<number>('budgetCredits', 180);

      const rawData = await this.assembler.assemble(billingCycleStartDay, budgetCredits);
      
      this.panel.webview.postMessage({
        type: 'dashboardData',
        data: rawData,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Dashboard update failed:', message);
    }
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
