export class PollingScheduler {
  private pollTimer: NodeJS.Timeout | undefined;
  private currentIntervalMs: number;
  private minIntervalMs: number;
  private maxIntervalMs: number;
  private isDisposed: boolean = false;

  constructor(minMs: number = 5000, maxMs: number = 60000) {
    this.minIntervalMs = minMs;
    this.maxIntervalMs = maxMs;
    this.currentIntervalMs = minMs;
  }

  start(onPoll: () => Promise<number>): void {
    if (this.isDisposed) return;
    this.scheduleNext(onPoll);
  }

  stop(): void {
    this.isDisposed = true;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  adjustInterval(newCount: number): void {
    if (newCount > 0) {
      this.currentIntervalMs = this.minIntervalMs;
    } else {
      this.currentIntervalMs = Math.min(this.currentIntervalMs * 2, this.maxIntervalMs);
    }
  }

  updateBounds(minMs: number, maxMs: number): void {
    this.minIntervalMs = minMs;
    this.maxIntervalMs = maxMs;
    this.currentIntervalMs = Math.min(Math.max(this.currentIntervalMs, minMs), maxMs);
  }

  private scheduleNext(onPoll: () => Promise<number>): void {
    if (this.isDisposed) return;
    this.pollTimer = setTimeout(async () => {
      const count = await onPoll();
      this.adjustInterval(count);
      this.scheduleNext(onPoll);
    }, this.currentIntervalMs);
  }
}
