import * as path from "node:path";
import * as vscode from "vscode";
import { ConfigManager } from "./config";
import { Logger } from "./logger";

interface PromptPreviewResult {
  version: number;
  tokens: number;
}

const PREFERRED_TOKEN_COUNTER_MODELS = new Set(["claude-opus-4.6", "claude-sonnet-4.6", "gpt-5.4"]);

export class PromptCostIntelligenceProvider implements vscode.CodeLensProvider, vscode.HoverProvider, vscode.Disposable {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses: vscode.Event<void> = this.onDidChangeEmitter.event;

  private readonly previewByUri = new Map<string, PromptPreviewResult>();
  private readonly debounceTimers = new Map<string, NodeJS.Timeout>();
  private readonly subscriptions: vscode.Disposable[] = [];

  constructor(
    private readonly config: ConfigManager,
    private readonly logger: Logger
  ) {
    this.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (this.isEnabledFile?.(e.document)) {
          this.scheduleRecompute(e.document);
        }
      }),
      vscode.workspace.onDidOpenTextDocument((doc) => {
        if (this.isEnabledFile(doc)) {
          this.scheduleRecompute(doc);
        }
      }),
      vscode.workspace.onDidCloseTextDocument((doc) => {
        const key = doc.uri.toString();
        this.previewByUri.delete(key);
        const timer = this.debounceTimers.get(key);
        if (timer) {
          clearTimeout(timer);
          this.debounceTimers.delete(key);
        }
      }),
      this.config.onDidChange(() => {
        this.onDidChangeEmitter.fire();
      })
    );

    for (const doc of vscode.workspace.textDocuments) {
      if (this.isEnabledFile?.(doc)) {
        this.scheduleRecompute(doc);
      }
    }
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (!this.isEnabledFile(document)) {
      return [];
    }

    const uriKey = document.uri.toString();
    const preview = this.previewByUri.get(uriKey);
    if (!preview?.version || preview.version !== document.version) {
      this.scheduleRecompute(document);
      const loadingLens = new vscode.CodeLens(new vscode.Range(0, 0, 0, 0));
      loadingLens.command = { title: "Token preview: calculating...", command: "copilotCostTracker.openDashboard" };
      return [loadingLens];
    }

    const lens = new vscode.CodeLens(new vscode.Range(0, 0, 0, 0));
    lens.command = {
      title: `This file ≈ ${preview.tokens.toLocaleString()} input tokens`,
      command: "copilotCostTracker.openDashboard",
    };
    return [lens];
  }

  provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
    if (!this.isEnabledFile(document) || position.line !== 0) {
      return undefined;
    }

    const preview = this.previewByUri.get(document.uri.toString());
    if (!preview?.version || preview.version !== document.version) {
      this.scheduleRecompute(document);
      return new vscode.Hover(new vscode.MarkdownString("Calculating prompt preview..."));
    }

    const md = new vscode.MarkdownString(undefined, true);
    md.appendMarkdown(`**Prompt input tokens:** ${preview.tokens.toLocaleString()}`);

    return new vscode.Hover(md);
  }

  private scheduleRecompute(document: vscode.TextDocument): void {
    const key = document.uri.toString();
    const existing = this.debounceTimers.get(key);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      void this.computePreview(document);
      this.debounceTimers.delete(key);
    }, 300);

    this.debounceTimers.set(key, timer);
  }

  private async computePreview(document: vscode.TextDocument): Promise<void> {
    const capturedVersion = document.version;
    const tokens = await this.countTokens(document.getText());

    const openDoc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === document.uri.toString());
    if (!openDoc?.version || openDoc.version !== capturedVersion) {
      return;
    }

    this.previewByUri.set(document.uri.toString(), {
      version: capturedVersion,
      tokens,
    });

    this.onDidChangeEmitter.fire();
  }

  private async countTokens(text: string): Promise<number> {
    try {
      const lmApi = (vscode as unknown as { lm?: { selectChatModels?: (selector?: object) => Thenable<any[]> } }).lm;
      const models = await lmApi?.selectChatModels?.() ?? [];
      const preferred = models.find((model) =>
        typeof model?.id === "string" && PREFERRED_TOKEN_COUNTER_MODELS.has(model.id)
      );
      const modelForCounting = preferred ?? models[0];

      if (modelForCounting && typeof modelForCounting.countTokens === "function") {
        const tokenCount = await modelForCounting.countTokens(text);
        if (typeof tokenCount === "number" && tokenCount >= 0) {
          return tokenCount;
        }
      }
    } catch (err) {
      this.logger.debug("Falling back to char-based token estimate", err);
    }

    return Math.max(1, Math.ceil(text.length / 4));
  }

  private isEnabledFile(document: vscode.TextDocument): boolean {
    if (document.isClosed) {
      return false;
    }

    if (document.uri.scheme !== "file" && document.uri.scheme !== "untitled") {
      return false;
    }

    const ext = path.extname(document.fileName).toLowerCase();
    const allowlist = this.config.config.enabledFileExtensions.map((value) => value.toLowerCase());
    return allowlist.includes(ext);
  }

  dispose(): void {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    this.previewByUri.clear();
    this.onDidChangeEmitter.dispose();
    for (const sub of this.subscriptions) {
      sub.dispose();
    }
  }
}
