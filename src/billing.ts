/**
 * Billing period calculation utilities.
 * Determines the start/end of the current billing cycle based on a configurable start day.
 */

/**
 * Get the start date of the billing period that contains the given date.
 * If startDay exceeds the days in a month, uses the last day of that month.
 *
 * @param startDay - The configured billing cycle start day (1-31)
 * @param now - The reference date (defaults to current time)
 * @returns The start of the billing period as a Date (midnight local time)
 */
export function getBillingPeriodStart(startDay: number, now: Date = new Date()): Date {
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-indexed
  const today = now.getDate();

  // Clamp startDay to valid range
  const clampedDay = Math.max(1, Math.min(31, Math.round(startDay)));

  // Effective day for the current month (handle short months)
  const effectiveDayThisMonth = Math.min(clampedDay, daysInMonth(year, month));

  if (today >= effectiveDayThisMonth) {
    // We're in or past the start day this month — period started this month
    return new Date(year, month, effectiveDayThisMonth, 0, 0, 0, 0);
  } else {
    // We haven't reached the start day yet — period started last month
    const prevMonth = month === 0 ? 11 : month - 1;
    const prevYear = month === 0 ? year - 1 : year;
    const effectiveDayPrevMonth = Math.min(clampedDay, daysInMonth(prevYear, prevMonth));
    return new Date(prevYear, prevMonth, effectiveDayPrevMonth, 0, 0, 0, 0);
  }
}

/**
 * Get the end date (exclusive) of the billing period that contains the given date.
 * This is the start of the NEXT billing period.
 *
 * @param startDay - The configured billing cycle start day (1-31)
 * @param now - The reference date (defaults to current time)
 * @returns The end of the billing period (start of next period) as a Date
 */
export function getBillingPeriodEnd(startDay: number, now: Date = new Date()): Date {
  const periodStart = getBillingPeriodStart(startDay, now);
  const year = periodStart.getFullYear();
  const month = periodStart.getMonth();

  // Next period starts in the following month
  const nextMonth = month === 11 ? 0 : month + 1;
  const nextYear = month === 11 ? year + 1 : year;

  const clampedDay = Math.max(1, Math.min(31, Math.round(startDay)));
  const effectiveDayNextMonth = Math.min(clampedDay, daysInMonth(nextYear, nextMonth));

  return new Date(nextYear, nextMonth, effectiveDayNextMonth, 0, 0, 0, 0);
}

/**
 * Get the billing period start as a Unix timestamp in milliseconds.
 */
export function getBillingPeriodStartMs(startDay: number, now: Date = new Date()): number {
  return getBillingPeriodStart(startDay, now).getTime();
}

/**
 * Get the billing period end as a Unix timestamp in milliseconds.
 */
export function getBillingPeriodEndMs(startDay: number, now: Date = new Date()): number {
  return getBillingPeriodEnd(startDay, now).getTime();
}

/**
 * Get the number of days in a given month (0-indexed month).
 */
function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month = last day of this month
  return new Date(year, month + 1, 0).getDate();
}
