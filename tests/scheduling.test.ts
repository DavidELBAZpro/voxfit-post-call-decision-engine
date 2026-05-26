import { describe, expect, it } from "vitest";
import {
  delayedCallAt,
  nextManualReviewAt,
  paymentReminderAt,
  snapToCallWindow,
} from "../src/scheduling.js";
import type { PostCallInput } from "../src/types.js";

const NOW_WINTER = "2025-01-15T10:00:00.000Z";
const NOW_SUMMER = "2025-06-15T10:00:00.000Z";

const stepWith = (
  overrides: Partial<PostCallInput["step"]> = {},
): PostCallInput["step"] => ({
  stepActionId: "step-1",
  maxAttempts: 5,
  attemptsSoFar: 0,
  retryDelayHours: 24,
  ...overrides,
});

describe("paymentReminderAt — 09:00 Paris time on the given date", () => {
  it("returns 08:00Z in winter (CET, UTC+1)", () => {
    expect(paymentReminderAt("2025-02-10", NOW_WINTER)).toBe("2025-02-10T08:00:00.000Z");
  });

  it("returns 07:00Z in summer (CEST, UTC+2)", () => {
    expect(paymentReminderAt("2025-07-10", NOW_SUMMER)).toBe("2025-07-10T07:00:00.000Z");
  });

  it("handles the spring-forward day (2025-03-30 is CEST)", () => {
    expect(paymentReminderAt("2025-03-30", NOW_WINTER)).toBe("2025-03-30T07:00:00.000Z");
  });

  it("handles the fall-back day (2025-10-26 is back to CET)", () => {
    expect(paymentReminderAt("2025-10-26", NOW_SUMMER)).toBe("2025-10-26T08:00:00.000Z");
  });

  it("accepts a full ISO datetime and keeps the Paris calendar day", () => {
    // 23:30 UTC on Apr 15 is 01:30 Paris on Apr 16 (CEST = UTC+2)
    expect(paymentReminderAt("2025-04-15T23:30:00.000Z", "2025-04-10T10:00:00.000Z")).toBe(
      "2025-04-16T07:00:00.000Z",
    );
  });

  it("returns null on an invalid date string", () => {
    expect(paymentReminderAt("not-a-date", NOW_WINTER)).toBeNull();
  });

  it("returns null on a past date", () => {
    expect(paymentReminderAt("2024-12-01", NOW_WINTER)).toBeNull();
  });

  it("returns null when input is null", () => {
    expect(paymentReminderAt(null, NOW_WINTER)).toBeNull();
  });
});

describe("snapToCallWindow — keep in-window targets, snap out-of-window forward", () => {
  it("leaves a target that already sits inside the window untouched", () => {
    const result = snapToCallWindow(
      "2025-01-16T13:00:00.000Z",
      stepWith({
        callWindow: {
          days: ["mon", "tue", "wed", "thu", "fri"],
          start: "10:00",
          end: "18:00",
        },
      }),
      undefined,
      NOW_WINTER,
    );
    expect(result.runAt).toBe("2025-01-16T13:00:00.000Z");
    expect(result.adjusted).toBe(false);
  });

  it("snaps a Saturday target to next Monday window opening", () => {
    const result = snapToCallWindow(
      "2025-01-18T11:00:00.000Z",
      stepWith({
        callWindow: {
          days: ["mon", "tue", "wed", "thu", "fri"],
          start: "10:00",
          end: "18:00",
        },
      }),
      undefined,
      NOW_WINTER,
    );
    expect(result.runAt).toBe("2025-01-20T09:00:00.000Z");
    expect(result.adjusted).toBe(true);
  });

  it("snaps a too-late time on a valid day to the next valid morning", () => {
    const result = snapToCallWindow(
      "2025-01-16T19:30:00.000Z",
      stepWith({
        callWindow: {
          days: ["mon", "tue", "wed", "thu", "fri"],
          start: "10:00",
          end: "18:00",
        },
      }),
      undefined,
      NOW_WINTER,
    );
    expect(result.runAt).toBe("2025-01-17T09:00:00.000Z");
    expect(result.adjusted).toBe(true);
  });

  it("snaps a too-early time on a valid day to the same-day window opening", () => {
    const result = snapToCallWindow(
      "2025-01-16T06:30:00.000Z",
      stepWith({
        callWindow: {
          days: ["mon", "tue", "wed", "thu", "fri"],
          start: "10:00",
          end: "18:00",
        },
      }),
      undefined,
      NOW_WINTER,
    );
    expect(result.runAt).toBe("2025-01-16T09:00:00.000Z");
    expect(result.adjusted).toBe(true);
  });

  it("falls back to case.preferredCallWindow when step.callWindow is missing", () => {
    const result = snapToCallWindow(
      "2025-01-16T15:30:00.000Z",
      stepWith(),
      "10-12",
      NOW_WINTER,
    );
    expect(result.runAt).toBe("2025-01-17T09:00:00.000Z");
    expect(result.adjusted).toBe(true);
  });

  it("falls back to weekday default (8-20 Paris) when both windows are missing", () => {
    const result = snapToCallWindow(
      "2025-01-16T13:00:00.000Z",
      stepWith(),
      undefined,
      NOW_WINTER,
    );
    expect(result.runAt).toBe("2025-01-16T13:00:00.000Z");
    expect(result.adjusted).toBe(false);
  });

  it("never returns a runAt before now", () => {
    const result = snapToCallWindow(
      "2024-12-25T13:00:00.000Z",
      stepWith({
        callWindow: {
          days: ["mon", "tue", "wed", "thu", "fri"],
          start: "10:00",
          end: "18:00",
        },
      }),
      undefined,
      NOW_WINTER,
    );
    expect(new Date(result.runAt).getTime()).toBeGreaterThanOrEqual(new Date(NOW_WINTER).getTime());
    expect(result.adjusted).toBe(true);
  });

  it("snaps an invalid target to the next valid window opening (adjusted=true)", () => {
    const result = snapToCallWindow(
      "not-an-iso",
      stepWith({
        callWindow: {
          days: ["mon", "tue", "wed", "thu", "fri"],
          start: "10:00",
          end: "18:00",
        },
      }),
      undefined,
      NOW_WINTER,
    );
    expect(result.adjusted).toBe(true);
    expect(new Date(result.runAt).getTime()).toBeGreaterThanOrEqual(new Date(NOW_WINTER).getTime());
  });
});

describe("delayedCallAt — now + delay, snapped to window", () => {
  it("adds the retry delay and snaps forward if out of window", () => {
    const result = delayedCallAt(
      NOW_WINTER,
      24,
      stepWith({
        callWindow: {
          days: ["mon", "tue", "wed", "thu", "fri"],
          start: "10:00",
          end: "18:00",
        },
      }),
      undefined,
    );
    expect(result.runAt).toBe("2025-01-16T10:00:00.000Z");
  });

  it("uses a default delay of 24h when none is provided", () => {
    const result = delayedCallAt(NOW_WINTER, undefined, stepWith(), undefined);
    expect(new Date(result.runAt).getTime()).toBeGreaterThanOrEqual(
      new Date(NOW_WINTER).getTime() + 23 * 60 * 60 * 1000,
    );
  });
});

describe("nextManualReviewAt — next 09:00 Paris on a valid window day", () => {
  it("returns next morning when current time is before 09:00 Paris", () => {
    const now = "2025-01-15T05:00:00.000Z";
    expect(nextManualReviewAt(now, stepWith(), undefined)).toBe("2025-01-16T08:00:00.000Z");
  });

  it("skips weekends when the window forbids them", () => {
    const fridayAfternoon = "2025-01-17T17:00:00.000Z";
    const result = nextManualReviewAt(
      fridayAfternoon,
      stepWith({
        callWindow: {
          days: ["mon", "tue", "wed", "thu", "fri"],
          start: "10:00",
          end: "18:00",
        },
      }),
      undefined,
    );
    expect(result).toBe("2025-01-20T08:00:00.000Z");
  });
});
