import * as vscode from "vscode";
import { CostDatabase } from "../database";
import { PricingEngine } from "../pricing";
import { buildTree, turnToTreeItem, CostTreeItem, TreeItemType } from "./treeBuilder";

export { CostTreeItem, TreeItemType };

export class CostTreeProvider implements vscode.TreeDataProvider<CostTreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<CostTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private readonly database: CostDatabase;
  private readonly pricing: PricingEngine;
  private workspaceFilter?: string;
  private referenceModels: string[] = [];

  constructor(database: CostDatabase, pricing: PricingEngine) {
    this.database = database;
    this.pricing = pricing;
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  setWorkspaceFilter(workspace?: string): void {
    this.workspaceFilter = workspace;
    this.refresh();
  }

  getTreeItem(element: CostTreeItem): vscode.TreeItem {
    const hasChildren = element.hasChildren ?? Boolean(element.children && element.children.length > 0);
    const collapsible = hasChildren
      ? this.getCollapsibleState(element.type)
      : vscode.TreeItemCollapsibleState.None;

    const item = new vscode.TreeItem(element.label, collapsible);
    item.description = element.description;
    item.tooltip = element.tooltip;

    const iconId = element.iconId ?? this.getDefaultIcon(element.type);
    item.iconPath = element.iconColor
      ? new vscode.ThemeIcon(iconId, new vscode.ThemeColor(element.iconColor))
      : new vscode.ThemeIcon(iconId);

    return item;
  }

  async getChildren(element?: CostTreeItem): Promise<CostTreeItem[]> {
    if (!element) {
      const result = buildTree(this.database, this.pricing, this.workspaceFilter);
      this.referenceModels = result.referenceModels;
      return result.items;
    }

    if (element.type === "session" && element.sessionId) {
      const turns = this.database.getTurnsForSession(element.sessionId, 20);
      const modelsInSession = new Set(turns.map((t) => t.modelFamily.toLowerCase()));
      const includeModelInTurns = element.includeModelInTurns ?? modelsInSession.size > 1;
      return turns.map((turn) => turnToTreeItem(turn, includeModelInTurns, this.pricing, this.referenceModels));
    }

    return element.children ?? [];
  }

  private getCollapsibleState(type: TreeItemType): vscode.TreeItemCollapsibleState {
    switch (type) {
      case "budget":
      case "month":
        return vscode.TreeItemCollapsibleState.Expanded;
      case "modelGroup":
      case "agentGroup":
      case "sessionsGroup":
      case "session":
        return vscode.TreeItemCollapsibleState.Collapsed;
      default:
        return vscode.TreeItemCollapsibleState.Collapsed;
    }
  }

  private getDefaultIcon(type: TreeItemType): string {
    switch (type) {
      case "budget": return "credit-card";
      case "budgetDetail": return "dash";
      case "today": return "flame";
      case "week": return "calendar";
      case "month": return "calendar";
      case "day": return "circle-small-filled";
      case "session": return "comment-discussion";
      case "turn": return "hubot";
      case "modelGroup": return "symbol-class";
      case "model": return "symbol-method";
      case "agentGroup": return "organization";
      case "agent": return "symbol-key";
      case "sessionsGroup": return "history";
      case "empty": return "info";
    }
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}
