import { describe, it, expect, vi } from "vitest";
import { TelemetrySourceResolver, SourceResolverDeps } from "../src/watcher/telemetrySourceResolver";

function makeDeps(overrides?: Partial<SourceResolverDeps>): SourceResolverDeps {
  return {
    dbExists: overrides?.dbExists ?? (() => true),
    onSwitchToJsonl: overrides?.onSwitchToJsonl ?? vi.fn(),
    onRecoverToDb: overrides?.onRecoverToDb ?? vi.fn(),
  };
}

describe("TelemetrySourceResolver", () => {
  it("defaults to database when traces DB exists", () => {
    const resolver = new TelemetrySourceResolver();
    expect(resolver.resolve(makeDeps())).toBe("database");
  });

  it("falls back to jsonl when traces DB does not exist", () => {
    const resolver = new TelemetrySourceResolver();
    const onSwitch = vi.fn();
    const deps = makeDeps({ dbExists: () => false, onSwitchToJsonl: onSwitch });

    expect(resolver.resolve(deps)).toBe("jsonl");
    expect(onSwitch).toHaveBeenCalledOnce();
  });

  it("does not fire onSwitchToJsonl twice for repeated missing-db calls", () => {
    const resolver = new TelemetrySourceResolver();
    const onSwitch = vi.fn();
    const deps = makeDeps({ dbExists: () => false, onSwitchToJsonl: onSwitch });

    resolver.resolve(deps);
    resolver.resolve(deps);
    expect(onSwitch).toHaveBeenCalledOnce();
  });

  it("respects forced telemetrySource=database", () => {
    const resolver = new TelemetrySourceResolver();
    resolver.setTelemetrySource("database");
    expect(resolver.resolve(makeDeps({ dbExists: () => false }))).toBe("database");
  });

  it("respects forced telemetrySource=jsonl", () => {
    const resolver = new TelemetrySourceResolver();
    resolver.setTelemetrySource("jsonl");
    expect(resolver.resolve(makeDeps())).toBe("jsonl");
  });

  it("switches to jsonl after FAILOVER_THRESHOLD_POLLS empty polls", () => {
    const resolver = new TelemetrySourceResolver();
    const onSwitch = vi.fn();
    const deps = makeDeps({ onSwitchToJsonl: onSwitch });

    for (let i = 0; i < TelemetrySourceResolver.FAILOVER_THRESHOLD_POLLS; i++) {
      resolver.recordEmptyDbPoll();
    }

    expect(resolver.resolve(deps)).toBe("jsonl");
    expect(onSwitch).toHaveBeenCalledOnce();
  });

  it("stays on database when empty polls are below threshold", () => {
    const resolver = new TelemetrySourceResolver();
    for (let i = 0; i < TelemetrySourceResolver.FAILOVER_THRESHOLD_POLLS - 1; i++) {
      resolver.recordEmptyDbPoll();
    }
    expect(resolver.resolve(makeDeps())).toBe("database");
  });

  it("resets empty poll counter on successful poll", () => {
    const resolver = new TelemetrySourceResolver();
    for (let i = 0; i < TelemetrySourceResolver.FAILOVER_THRESHOLD_POLLS - 1; i++) {
      resolver.recordEmptyDbPoll();
    }
    resolver.recordSuccessfulDbPoll();

    // Would have been at threshold - 1 + 1 more = threshold, but reset to 0
    resolver.recordEmptyDbPoll();
    expect(resolver.resolve(makeDeps())).toBe("database");
  });

  it("probes database recovery after DB_RECOVERY_PROBE_MS", () => {
    const resolver = new TelemetrySourceResolver();
    const onSwitch = vi.fn();
    const onRecover = vi.fn();

    const t0 = 1_000_000;

    // Force failover by missing DB at t0
    resolver.resolve(
      makeDeps({ dbExists: () => false, onSwitchToJsonl: onSwitch }),
      t0,
    );
    expect(resolver.getActiveSource()).toBe("jsonl");

    // Before recovery interval: still jsonl (DB now exists)
    const depsWithDb = makeDeps({
      dbExists: () => true,
      onRecoverToDb: onRecover,
    });
    const beforeRecovery = t0 + TelemetrySourceResolver.DB_RECOVERY_PROBE_MS - 1;
    expect(resolver.resolve(depsWithDb, beforeRecovery)).toBe("jsonl");
    expect(onRecover).not.toHaveBeenCalled();

    // After recovery interval: probes database
    const afterRecovery = t0 + TelemetrySourceResolver.DB_RECOVERY_PROBE_MS + 1000;
    expect(resolver.resolve(depsWithDb, afterRecovery)).toBe("database");
    expect(onRecover).toHaveBeenCalledOnce();
  });

  it("getActiveSource reflects current state", () => {
    const resolver = new TelemetrySourceResolver();
    expect(resolver.getActiveSource()).toBe("database");

    resolver.setTelemetrySource("jsonl");
    expect(resolver.getActiveSource()).toBe("jsonl");

    resolver.setTelemetrySource("database");
    expect(resolver.getActiveSource()).toBe("database");
  });
});
