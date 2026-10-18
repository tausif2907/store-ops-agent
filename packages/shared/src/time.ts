/**
 * Calendar periods in a store's own time zone. "Yesterday" for a store in
 * Asia/Kolkata starts at 00:00 IST, not 00:00 UTC.
 */

export const PERIODS = ["today", "yesterday", "last_7_days", "last_30_days", "this_month", "last_month"] as const;
export type Period = (typeof PERIODS)[number];

interface LocalDate {
  year: number;
  month: number; // 1-12
  day: number;
}

function localParts(instant: Date, timeZone: string): LocalDate & { hour: number; minute: number; second: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(instant)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, Number(p.value)]),
  );
  return parts as unknown as LocalDate & { hour: number; minute: number; second: number };
}

/** Milliseconds the zone is ahead of UTC at `instant`. */
function offsetMs(instant: Date, timeZone: string): number {
  const p = localParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The UTC instant of local midnight on the given calendar date. */
export function startOfLocalDay(date: LocalDate, timeZone: string): Date {
  const guess = Date.UTC(date.year, date.month - 1, date.day);
  let result = guess - offsetMs(new Date(guess), timeZone);
  // A second pass corrects for an offset change (DST) between guess and result.
  result = guess - offsetMs(new Date(result), timeZone);
  return new Date(result);
}

function addDays(date: LocalDate, days: number): LocalDate {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** [from, to) in UTC ISO strings for a named period, as the store's owner would mean it. */
export function periodRange(period: Period, timeZone: string, now: Date = new Date()): { from: string; to: string } {
  const today = localParts(now, timeZone);
  const day = (d: LocalDate) => startOfLocalDay(d, timeZone);
  let from: Date;
  let to: Date;
  switch (period) {
    case "today":
      from = day(today);
      to = now;
      break;
    case "yesterday":
      from = day(addDays(today, -1));
      to = day(today);
      break;
    case "last_7_days":
      from = day(addDays(today, -7));
      to = day(today);
      break;
    case "last_30_days":
      from = day(addDays(today, -30));
      to = day(today);
      break;
    case "this_month":
      from = day({ ...today, day: 1 });
      to = now;
      break;
    case "last_month": {
      const firstThisMonth = { ...today, day: 1 };
      const lastMonth = addDays(firstThisMonth, -1);
      from = day({ ...lastMonth, day: 1 });
      to = day(firstThisMonth);
      break;
    }
  }
  return { from: from.toISOString(), to: to.toISOString() };
}
