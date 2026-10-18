import { describe, expect, it } from "vitest";
import { periodRange, startOfLocalDay } from "./time";

describe("store-local periods", () => {
  // 2026-10-18 02:00 UTC is 07:30 on the 18th in India.
  const now = new Date("2026-10-18T02:00:00.000Z");

  it("finds local midnight in India (UTC+05:30)", () => {
    expect(startOfLocalDay({ year: 2026, month: 10, day: 18 }, "Asia/Kolkata").toISOString()).toBe("2026-10-17T18:30:00.000Z");
  });

  it("handles daylight saving time", () => {
    // New York is UTC-4 in summer, UTC-5 in winter.
    expect(startOfLocalDay({ year: 2026, month: 7, day: 1 }, "America/New_York").toISOString()).toBe("2026-07-01T04:00:00.000Z");
    expect(startOfLocalDay({ year: 2026, month: 12, day: 1 }, "America/New_York").toISOString()).toBe("2026-12-01T05:00:00.000Z");
  });

  it("computes yesterday in the store's zone", () => {
    expect(periodRange("yesterday", "Asia/Kolkata", now)).toEqual({
      from: "2026-10-16T18:30:00.000Z",
      to: "2026-10-17T18:30:00.000Z",
    });
  });

  it("computes today up to now", () => {
    expect(periodRange("today", "Asia/Kolkata", now)).toEqual({ from: "2026-10-17T18:30:00.000Z", to: now.toISOString() });
  });

  it("computes the last 7 full days", () => {
    expect(periodRange("last_7_days", "Asia/Kolkata", now)).toEqual({
      from: "2026-10-10T18:30:00.000Z",
      to: "2026-10-17T18:30:00.000Z",
    });
  });

  it("computes last month across a year boundary", () => {
    expect(periodRange("last_month", "UTC", new Date("2026-01-15T10:00:00Z"))).toEqual({
      from: "2025-12-01T00:00:00.000Z",
      to: "2026-01-01T00:00:00.000Z",
    });
  });
});
