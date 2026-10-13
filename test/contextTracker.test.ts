import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

const notify = vi.hoisted(() => ({ info: vi.fn(), warning: vi.fn() }));

vi.mock("vscode", () => ({
  window: { showInformationMessage: notify.info, showWarningMessage: notify.warning },
}));

import { ContextTracker } from "../src/views/contextTracker";
import type { CostReader, SessionContextInfo } from "../src/database";
import type { Logger } from "../src/logger";

class MemoryState {
  private readonly values = new Map<string, unknown>();
  get<T>(key: string): T | undefined {
    return this.values.get(key) as T | undefined;
  }
  update(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
    return Promise.resolve();
  }
  keys(): readonly string[] {
    return [...this.values.keys()];
  }
}

function session(sessionId: string, tokens: number, overrides: Partial<SessionContextInfo> = {}): SessionContextInfo {
  return {
    sessionId,
    workspace: "Org/Repo",
    turnCount: 12,
    lastActivityMs: Date.now(),
    firstActivityMs: Date.now() - 60_000,
    currentContextWeight: tokens,
    costUsd: 1,
    credits: 100,
    ...overrides,
  };
}

function createTracker(state?: MemoryState) {
  let active: SessionContextInfo | null = null;
  const database = { getMostRecentSessionContext: vi.fn(() => active) };
  const logger = { warn: vi.fn(), debug: vi.fn() };
  const tracker = new ContextTracker(
    database as unknown as CostReader,
    logger as unknown as Logger,
    null,
    state as unknown as vscode.Memento | undefined,
  );
  return {
    tracker,
    observe(info: SessionContextInfo | null) {
      active = info;
      return tracker.update();
    },
  };
}

const notificationCount = () => notify.info.mock.calls.length + notify.warning.mock.calls.length;

describe("ContextTracker notifications", () => {
  beforeEach(() => {
    notify.info.mockClear();
    notify.warning.mockClear();
  });

  it("shows one notification for the highest level a session reached", () => {
    const { observe } = createTracker();

    observe(session("chat-a", 100_000));

    expect(notify.warning).toHaveBeenCalledTimes(1);
    expect(notify.info).not.toHaveBeenCalled();
  });

  it("escalates through levels without repeating a level", () => {
    const { observe } = createTracker();

    observe(session("chat-a", 25_000));
    observe(session("chat-a", 30_000));
    expect(notify.info).toHaveBeenCalledTimes(1);

    observe(session("chat-a", 45_000));
    observe(session("chat-a", 90_000));
    observe(session("chat-a", 95_000));
    expect(notify.info).toHaveBeenCalledTimes(2);
    expect(notify.warning).toHaveBeenCalledTimes(1);
  });

  it("does not repeat notifications when the active session alternates", () => {
    const { observe } = createTracker();

    for (let i = 0; i < 5; i++) {
      observe(session("chat-a", 90_000 + i));
      observe(session("chat-b", 50_000 + i));
    }

    expect(notify.warning).toHaveBeenCalledTimes(1);
    expect(notify.info).toHaveBeenCalledTimes(1);
  });

  it("stays silent for a stale session but still reports its weight", () => {
    const { observe } = createTracker();

    const weight = observe(session("chat-a", 90_000, { lastActivityMs: Date.now() - 31 * 60_000 }));

    expect(weight).toMatchObject({ tokens: 90_000, stale: true });
    expect(notificationCount()).toBe(0);
  });

  it("remembers notified sessions across tracker instances through shared state", () => {
    const state = new MemoryState();
    createTracker(state).observe(session("chat-a", 90_000));
    expect(notificationCount()).toBe(1);

    createTracker(state).observe(session("chat-a", 95_000));
    createTracker(new MemoryState()).observe(session("chat-a", 95_000));

    expect(notificationCount()).toBe(2);
  });

  it("respects the notifications setting", () => {
    const { tracker, observe } = createTracker();
    tracker.setNotificationsEnabled(false);

    observe(session("chat-a", 90_000));

    expect(notificationCount()).toBe(0);
  });
});

