import { describe, expect, it } from "vitest";
import { buildPostCallDecision } from "../src/buildPostCallDecision.js";
import type { PostCallInput } from "../src/types.js";
import { baseInput, withCall, withInsights, withTools } from "./_factories.js";

describe("edge case — conflicting signals (transcript vs telephony)", () => {
  it("ignores a transcript-extracted promise_to_pay when status is no-answer", () => {
    const decision = buildPostCallDecision(
      withInsights(
        withCall(baseInput(), { status: "no-answer", amdStatus: null, durationSec: 0 }),
        { outcome: "Accepted full payment later", paymentDate: "2025-04-01" },
      ),
    );
    expect(decision.normalizedOutcome).toBe("no_answer");
    expect(
      decision.scheduledActions.find((a) => a.type === "payment_reminder"),
    ).toBeUndefined();
  });
});

describe("edge case — invalid dates", () => {
  it("warns and falls back when callbackAt is not parseable", () => {
    const decision = buildPostCallDecision(
      withInsights(baseInput(), { outcome: "Call rescheduled", callbackAt: "tomorrow" }),
    );
    expect(decision.normalizedOutcome).toBe("callback_scheduled");
    expect(decision.warnings.some((w) => w.toLowerCase().includes("callback"))).toBe(true);
    expect(decision.scheduledActions[0]?.type).toBe("call");
  });

  it("warns and skips the reminder when paymentDate is malformed", () => {
    const decision = buildPostCallDecision(
      withInsights(baseInput(), {
        outcome: "Accepted full payment later",
        paymentDate: "31/02/2025",
      }),
    );
    expect(decision.normalizedOutcome).toBe("promise_to_pay");
    expect(
      decision.scheduledActions.find((a) => a.type === "payment_reminder"),
    ).toBeUndefined();
    expect(decision.warnings.length).toBeGreaterThan(0);
  });
});

describe("edge case — past dates", () => {
  it("never schedules a payment_reminder in the past", () => {
    const decision = buildPostCallDecision(
      withInsights(baseInput(), {
        outcome: "Accepted full payment later",
        paymentDate: "2024-01-01",
      }),
    );
    const now = new Date(baseInput().now).getTime();
    for (const action of decision.scheduledActions) {
      expect(new Date(action.runAt).getTime()).toBeGreaterThanOrEqual(now);
    }
  });

  it("snaps a past callbackAt forward to a future window slot", () => {
    const decision = buildPostCallDecision(
      withInsights(baseInput(), {
        outcome: "Call rescheduled",
        callbackAt: "2020-01-01T10:00:00.000Z",
      }),
    );
    const action = decision.scheduledActions[0];
    expect(action?.type).toBe("call");
    expect(new Date(action?.runAt ?? "").getTime()).toBeGreaterThanOrEqual(
      new Date(baseInput().now).getTime(),
    );
  });
});

describe("edge case — already permanently excluded case", () => {
  it("does nothing and warns when the case is already perm_excluded", () => {
    const input: PostCallInput = {
      ...withInsights(baseInput(), { outcome: "Accepted full payment later" }),
      case: { ...baseInput().case, status: "perm_excluded" },
    };
    const decision = buildPostCallDecision(input);
    expect(decision.scheduledActions).toHaveLength(0);
    expect(decision.casePatch.status).toBeUndefined();
    expect(decision.warnings.some((w) => w.toLowerCase().includes("perm_excluded"))).toBe(true);
  });
});

describe("edge case — duplicate tool events", () => {
  it("emits a single payment_reminder and paymentLinkSent=true on duplicates", () => {
    const event = {
      name: "send_payment_link",
      status: "success" as const,
      createdAt: "2025-03-15T13:59:30.000Z",
    };
    const decision = buildPostCallDecision(
      withTools(baseInput(), [event, { ...event, id: "dup-1" }, { ...event, id: "dup-2" }]),
    );
    expect(decision.callPatch.paymentLinkSent).toBe(true);
    expect(
      decision.scheduledActions.filter((a) => a.type === "payment_reminder"),
    ).toHaveLength(1);
  });
});

describe("edge case — missing optional fields", () => {
  it("works when insights is empty and there are no tool events", () => {
    const decision = buildPostCallDecision(baseInput());
    expect(decision.normalizedOutcome).toBe("unknown");
    expect(decision.scheduledActions[0]?.type).toBe("manual_review");
  });

  it("works when step has no callWindow, no retryDelayHours, no maxAttempts", () => {
    const input: PostCallInput = {
      ...withCall(baseInput(), { status: "no-answer", amdStatus: null }),
      step: { stepActionId: "minimal" },
    };
    const decision = buildPostCallDecision(input);
    expect(decision.normalizedOutcome).toBe("no_answer");
    expect(decision.scheduledActions[0]?.type).toBe("call");
  });
});

describe("edge case — boundary times near end of call window", () => {
  it("snaps a target one minute after window close to next valid morning", () => {
    const input: PostCallInput = {
      ...withInsights(baseInput(), {
        outcome: "Call rescheduled",
        // 18:01 Paris (CET = UTC+1) on Thu Mar 20 — 1 min after a 10-18 window closes
        callbackAt: "2025-03-20T17:01:00.000Z",
      }),
      step: {
        ...baseInput().step,
        callWindow: {
          days: ["mon", "tue", "wed", "thu", "fri"],
          start: "10:00",
          end: "18:00",
        },
      },
    };
    const decision = buildPostCallDecision(input);
    // Friday Mar 21 10:00 Paris = 09:00 UTC (still CET until Mar 30)
    expect(decision.scheduledActions[0]?.runAt).toBe("2025-03-21T09:00:00.000Z");
    expect(decision.warnings.some((w) => w.toLowerCase().includes("snapped"))).toBe(true);
  });
});

describe("edge case — daylight saving and timezone handling", () => {
  it("schedules a reminder on a winter day at 08:00Z (CET, UTC+1)", () => {
    const decision = buildPostCallDecision(
      withInsights(
        { ...baseInput(), now: "2025-02-01T10:00:00.000Z" },
        { outcome: "Accepted full payment later", paymentDate: "2025-02-15" },
      ),
    );
    expect(
      decision.scheduledActions.find((a) => a.type === "payment_reminder")?.runAt,
    ).toBe("2025-02-15T08:00:00.000Z");
  });

  it("schedules a reminder on a summer day at 07:00Z (CEST, UTC+2)", () => {
    const decision = buildPostCallDecision(
      withInsights(
        { ...baseInput(), now: "2025-06-01T10:00:00.000Z" },
        { outcome: "Accepted full payment later", paymentDate: "2025-07-15" },
      ),
    );
    expect(
      decision.scheduledActions.find((a) => a.type === "payment_reminder")?.runAt,
    ).toBe("2025-07-15T07:00:00.000Z");
  });

  it("schedules a reminder on the spring-forward day at 07:00Z (already CEST)", () => {
    const decision = buildPostCallDecision(
      withInsights(
        { ...baseInput(), now: "2025-03-01T10:00:00.000Z" },
        { outcome: "Accepted full payment later", paymentDate: "2025-03-30" },
      ),
    );
    expect(
      decision.scheduledActions.find((a) => a.type === "payment_reminder")?.runAt,
    ).toBe("2025-03-30T07:00:00.000Z");
  });

  it("schedules a reminder on the fall-back day at 08:00Z (CET again)", () => {
    const decision = buildPostCallDecision(
      withInsights(
        { ...baseInput(), now: "2025-10-01T10:00:00.000Z" },
        { outcome: "Accepted full payment later", paymentDate: "2025-10-26" },
      ),
    );
    expect(
      decision.scheduledActions.find((a) => a.type === "payment_reminder")?.runAt,
    ).toBe("2025-10-26T08:00:00.000Z");
  });
});
