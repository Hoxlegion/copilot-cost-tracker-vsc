import * as fs from "node:fs";

export interface FileWatcherOptions {
  debounceMs: number;
  fallbackIntervalMs: number;
}

export class FileWatcherStrategy {
  private watcher: fs.FSWatcher | undefined;
  private fallbackTimer: NodeJS.Timeout | undefined;
  private debounceTimer: NodeJS.Timeout | undefined;
  private isDisposed: boolean = false;
  private isRunning: boolean = false;
  private watchPath: string | null;
  private readonly callback: () => Promise<number>;
  private debounceMs: number;
  private fallbackIntervalMs: number;

  constructor(
    watchPath: string | null,
    callback: () => Promise<number>,
    options: FileWatcherOptions
  ) {
    this.watchPath = watchPath;
    this.callback = callback;
    this.debounceMs = options.debounceMs;
    this.fallbackIntervalMs = options.fallbackIntervalMs;
  }

  start(): void {
    if (this.isDisposed) return;
    this.setupWatcher();
    this.setupFallback();
  }

  updateWatchPath(path: string | null): void {
    if (this.isDisposed) return;
    if (path === this.watchPath) return;

    this.closeWatcher();
    this.watchPath = path;
    this.setupWatcher();
  }

  updateOptions(debounceMs: number, fallbackIntervalMs: number): void {
    if (this.isDisposed) return;

    const fallbackChanged = fallbackIntervalMs !== this.fallbackIntervalMs;
    this.debounceMs = debounceMs;
    this.fallbackIntervalMs = fallbackIntervalMs;

    if (fallbackChanged) {
      this.clearFallback();
      this.setupFallback();
    }
  }

  stop(): void {
    this.isDisposed = true;
    this.closeWatcher();
    this.clearFallback();
    this.clearDebounce();
  }

  dispose(): void {
    this.stop();
  }

  private setupWatcher(): void {
    if (!this.watchPath || this.isDisposed) return;

    try {
      if (!fs.existsSync(this.watchPath)) return;

      this.watcher = fs.watch(this.watchPath, () => {
        this.triggerDebounced();
      });

      this.watcher.on("error", () => {
        this.closeWatcher();
      });
    } catch {
      this.closeWatcher();
    }
  }

  private closeWatcher(): void {
    if (this.watcher) {
      try {
        this.watcher.close();
      } catch (_e) {
        void _e;
      }
      this.watcher = undefined;
    }
  }

  private setupFallback(): void {
    if (this.isDisposed) return;
    this.fallbackTimer = setInterval(() => {
      this.triggerDebounced();
    }, this.fallbackIntervalMs);
  }

  private clearFallback(): void {
    if (this.fallbackTimer) {
      clearInterval(this.fallbackTimer);
      this.fallbackTimer = undefined;
    }
  }

  private triggerDebounced(): void {
    if (this.isDisposed) return;
    this.clearDebounce();
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      this.runCallback();
    }, this.debounceMs);
  }

  private clearDebounce(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
  }

  private async runCallback(): Promise<void> {
    if (this.isDisposed || this.isRunning) return;
    this.isRunning = true;
    try {
      await this.callback();
    } finally {
      this.isRunning = false;
    }
  }
}
