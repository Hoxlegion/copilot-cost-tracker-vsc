import { describe, it, expect } from "vitest";
import {
  getBillingPeriodStart,
  getBillingPeriodEnd,
  getBillingPeriodStartMs,
  getBillingPeriodEndMs,
  assessBudgetPace,
} from "../src/billing";

describe("getBillingPeriodStart", () => {
  it("returns the 1st of current month when startDay=1 and today >= 1", () => {
    const now = new Date(2026, 4, 15); // May 15, 2026
    const result = getBillingPeriodStart(1, now);
    expect(result).toEqual(new Date(2026, 4, 1, 0, 0, 0, 0));
  });

  it("returns previous month when today < startDay", () => {
    const now = new Date(2026, 4, 3); // May 3, 2026
    const result = getBillingPeriodStart(15, now);
    expect(result).toEqual(new Date(2026, 3, 15, 0, 0, 0, 0)); // April 15
  });

  it("handles startDay=31 in a 30-day month (uses last day)", () => {
    const now = new Date(2026, 3, 30); // April 30 (April has 30 days)
    const result = getBillingPeriodStart(31, now);
    // April has 30 days, so effective start day is 30. Today is 30 >= 30, so period starts April 30.
    expect(result).toEqual(new Date(2026, 3, 30, 0, 0, 0, 0));
  });

  it("handles startDay=31 in February (uses Feb 28/29)", () => {
    const now = new Date(2026, 1, 15); // Feb 15, 2026 (not a leap year)
    const result = getBillingPeriodStart(31, now);
    // Feb 15 < Feb 28 (effective), so look at previous month: Jan 31
    expect(result).toEqual(new Date(2026, 0, 31, 0, 0, 0, 0));
  });

  it("handles leap year February with startDay=29", () => {
    const now = new Date(2028, 1, 29); // Feb 29, 2028 (leap year)
    const result = getBillingPeriodStart(29, now);
    expect(result).toEqual(new Date(2028, 1, 29, 0, 0, 0, 0));
  });

  it("handles year rollover (January, today < startDay)", () => {
    const now = new Date(2026, 0, 5); // Jan 5, 2026
    const result = getBillingPeriodStart(15, now);
    expect(result).toEqual(new Date(2025, 11, 15, 0, 0, 0, 0)); // Dec 15, 2025
  });

  it("returns start day of current month when today equals startDay", () => {
    const now = new Date(2026, 5, 15); // June 15
    const result = getBillingPeriodStart(15, now);
    expect(result).toEqual(new Date(2026, 5, 15, 0, 0, 0, 0));
  });

  it("clamps invalid startDay < 1 to 1", () => {
    const now = new Date(2026, 4, 15);
    const result = getBillingPeriodStart(0, now);
    expect(result).toEqual(new Date(2026, 4, 1, 0, 0, 0, 0));
  });

  it("clamps invalid startDay > 31 to 31", () => {
    const now = new Date(2026, 0, 31); // Jan 31
    const result = getBillingPeriodStart(50, now);
    expect(result).toEqual(new Date(2026, 0, 31, 0, 0, 0, 0));
  });
});

describe("getBillingPeriodEnd", () => {
  it("returns start of next month when startDay=1", () => {
    const now = new Date(2026, 4, 15); // May 15
    const result = getBillingPeriodEnd(1, now);
    expect(result).toEqual(new Date(2026, 5, 1, 0, 0, 0, 0)); // June 1
  });

  it("returns next period start in following month", () => {
    const now = new Date(2026, 4, 20); // May 20
    const result = getBillingPeriodEnd(15, now);
    expect(result).toEqual(new Date(2026, 5, 15, 0, 0, 0, 0)); // June 15
  });

  it("handles year rollover (December period ends in January)", () => {
    const now = new Date(2026, 11, 20); // Dec 20
    const result = getBillingPeriodEnd(15, now);
    expect(result).toEqual(new Date(2027, 0, 15, 0, 0, 0, 0)); // Jan 15, 2027
  });

  it("handles startDay=31 — end is last day of next month", () => {
    const now = new Date(2026, 0, 31); // Jan 31
    const result = getBillingPeriodEnd(31, now);
    // Next period: Feb, effective day = min(31, 28) = 28
    expect(result).toEqual(new Date(2026, 1, 28, 0, 0, 0, 0));
  });

  it("end is always strictly after start", () => {
    for (let month = 0; month < 12; month++) {
      const now = new Date(2026, month, 15);
      const start = getBillingPeriodStart(10, now);
      const end = getBillingPeriodEnd(10, now);
      expect(end.getTime()).toBeGreaterThan(start.getTime());
    }
  });
});

describe("getBillingPeriodStartMs / getBillingPeriodEndMs", () => {
  it("returns timestamps consistent with Date versions", () => {
    const now = new Date(2026, 4, 15);
    expect(getBillingPeriodStartMs(1, now)).toBe(getBillingPeriodStart(1, now).getTime());
    expect(getBillingPeriodEndMs(1, now)).toBe(getBillingPeriodEnd(1, now).getTime());
  });
});

describe("assessBudgetPace", () => {
  it("flags too-fast pace when spend is far above expected", () => {
    const now = new Date(2026, 4, 15).getTime();
    const start = new Date(2026, 4, 1).getTime();
    const end = new Date(2026, 5, 1).getTime();
    const result = assessBudgetPace(start, end, 80, 100, now);
    expect(result.level).toBe("too-fast");
  });

  it("stays on-track when spend is below expected late in period", () => {
    const now = new Date(2026, 4, 28).getTime();
    const start = new Date(2026, 4, 1).getTime();
    const end = new Date(2026, 5, 1).getTime();
    const result = assessBudgetPace(start, end, 80, 100, now);
    expect(result.level).toBe("on-track");
  });

  it("returns unknown when budget is not positive", () => {
    const now = new Date(2026, 4, 15).getTime();
    const start = new Date(2026, 4, 1).getTime();
    const end = new Date(2026, 5, 1).getTime();
    const result = assessBudgetPace(start, end, 10, 0, now);
    expect(result.level).toBe("unknown");
    expect(result.shortLabel).toBe("PACE N/A");
  });
});
