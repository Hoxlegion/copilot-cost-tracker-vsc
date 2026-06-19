import * as vscode from "vscode";
import { LogLevel } from "./config";

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  trace: 4,
};

/**
 * Structured logger that writes to a VS Code OutputChannel.
 * Respects the configured log level — messages below threshold are dropped.
 */
export class Logger implements vscode.Disposable {
  private readonly _channel: vscode.OutputChannel;
  private _level: LogLevel;

  constructor(level: LogLevel = "error") {
    this._channel = vscode.window.createOutputChannel("Copilot Cost Tracker");
    this._level = level;
  }

  /** Update the active log level (called when config changes). */
  setLevel(level: LogLevel): void {
    this._level = level;
  }

  /** Get the current log level. */
  get level(): LogLevel {
    return this._level;
  }

  error(message: string, ...args: unknown[]): void {
    this._log("error", message, args);
  }

  warn(message: string, ...args: unknown[]): void {
    this._log("warn", message, args);
  }

  info(message: string, ...args: unknown[]): void {
    this._log("info", message, args);
  }

  debug(message: string, ...args: unknown[]): void {
    this._log("debug", message, args);
  }

  trace(message: string, ...args: unknown[]): void {
    this._log("trace", message, args);
  }

  private _log(level: LogLevel, message: string, args: unknown[]): void {
    if (LOG_LEVEL_PRIORITY[level] > LOG_LEVEL_PRIORITY[this._level]) {
      return;
    }

    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
    const formatted = args.length > 0
      ? `${prefix} ${message} ${args.map((a) => this.formatArg(a)).join(" ")}`
      : `${prefix} ${message}`;

    this._channel.appendLine(formatted);
  }

  private formatArg(a: unknown): string {
    if (a === null || typeof a !== "object") return String(a);
    try { return JSON.stringify(a); } catch { return "[Circular]"; }
  }

  /** Show the OutputChannel in the editor. */
  show(): void {
    this._channel.show(true);
  }

  dispose(): void {
    this._channel.dispose();
  }
}
