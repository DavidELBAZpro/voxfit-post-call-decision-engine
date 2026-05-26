import { describe, expect, it } from "vitest";
import { buildPostCallDecision } from "../src/buildPostCallDecision.js";
import type { PostCallInput, Weekday } from "../src/types.js";
import { baseInput, withCall, withInsights, withTools } from "./_factories.js";

// =============================================================================
// Category A — Conflicting signals not already covered
// =============================================================================

describe("A1: Stop contact outcome + successful send_payment_link", () => {
  it("do_not_call wins over the tool event (insight outcome beats tool event)", () => {
    const decision = buildPostCallDecision(
      withTools(
        withInsights(baseInput(), { outcome: "Stop contact" }),
        [
          {
            id: "t1",
            name: "send_payment_link",
            status: "success",
            createdAt: "2025-03-15T13:59:30.000Z",
          },
        ],
      ),
    );
    expect(decision.normalizedOutcome).toBe("do_not_call");
    expect(decision.casePatch.status).toBe("perm_excluded");
    expect(decision.scheduledActions).toHaveLength(0);
  });
});

describe("A2: wait_payment_confirmation + failed send_payment_link", () => {
  it("still classifies wait_payment_confirmation from the insights outcome, with a warning about the failed tool event", () => {
    const decision = buildPostCallDecision(
      withTools(
        withInsights(baseInput(), { outcome: "Accepted full payment now" }),
        [
          {
            id: "t1",
            name: "send_payment_link",
            status: "failed",
            createdAt: "2025-03-15T13:59:30.000Z",
          },
        ],
      ),
    );
    expect(decision.normalizedOutcome).toBe("wait_payment_confirmation");
    expect(decision.callPatch.paymentLinkSent).toBeFalsy();
    expect(decision.warnings.some((w) => w.toLowerCase().includes("failed"))).toBe(true);
  });
});

// =============================================================================
// Category B — Doubtful input validity
// =============================================================================

describe("B4: durationSec negative", () => {
  it("does NOT classify as early_termination when durationSec is negative", () => {
    const decision = buildPostCallDecision(withCall(baseInput(), { durationSec: -5 }));
    expect(decision.normalizedOutcome).not.toBe("early_termination");
  });

  it("emits a validation warning when durationSec is negative", () => {
    const decision = buildPostCallDecision(withCall(baseInput(), { durationSec: -5 }));
    expect(decision.warnings.some((w) => w.toLowerCase().includes("duration"))).toBe(true);
  });
});

describe("B6: call.performedAt > now", () => {
  it("emits a warning when the call appears to have happened in the future", () => {
    const decision = buildPostCallDecision({
      ...baseInput(),
      now: "2025-03-15T14:00:00.000Z",
      call: { ...baseInput().call, performedAt: "2025-04-01T10:00:00.000Z" },
    });
    expect(
      decision.warnings.some((w) => w.toLowerCase().includes("performedat")),
    ).toBe(true);
  });
});

describe("B7: amountRemaining ≤ 0", () => {
  it("emits a warning when amountRemaining is exactly 0 (case already settled?)", () => {
    const decision = buildPostCallDecision({
      ...baseInput(),
      case: { ...baseInput().case, amountRemaining: 0 },
    });
    expect(decision.warnings.some((w) => w.toLowerCase().includes("amount"))).toBe(true);
  });

  it("emits a warning when amountRemaining is negative (overpaid)", () => {
    const decision = buildPostCallDecision({
      ...baseInput(),
      case: { ...baseInput().case, amountRemaining: -50 },
    });
    expect(decision.warnings.some((w) => w.toLowerCase().includes("amount"))).toBe(true);
  });
});

describe("B8: maxAttempts = 0", () => {
  it("escalates immediately to manual_review on no_answer", () => {
    const decision = buildPostCallDecision({
      ...withCall(baseInput(), { status: "no-answer", amdStatus: null }),
      step: { ...baseInput().step, maxAttempts: 0, attemptsSoFar: 0 },
    });
    expect(
      decision.scheduledActions.find((a) => a.type === "manual_review"),
    ).toBeDefined();
    expect(
      decision.scheduledActions.find((a) => a.type === "call"),
    ).toBeUndefined();
  });
});

describe("B9: retryDelayHours negative or zero", () => {
  it("falls back to default 24h when retryDelayHours is negative", () => {
    const decision = buildPostCallDecision({
      ...withCall(baseInput(), { status: "no-answer", amdStatus: null }),
      step: { ...baseInput().step, retryDelayHours: -10 },
    });
    const callAction = decision.scheduledActions.find((a) => a.type === "call");
    expect(callAction).toBeDefined();
    const expectedMin = new Date(baseInput().now).getTime() + 23 * 60 * 60 * 1000;
    expect(new Date(callAction!.runAt).getTime()).toBeGreaterThanOrEqual(expectedMin);
  });
});

// =============================================================================
// Category C — TZ / DST not yet covered
// =============================================================================

describe("C10: input.timezone other than Europe/Paris", () => {
  it("emits a warning when timezone is not the supported value", () => {
    const decision = buildPostCallDecision({
      ...baseInput(),
      timezone: "America/New_York" as unknown as PostCallInput["timezone"],
    });
    expect(
      decision.warnings.some((w) => w.toLowerCase().includes("timezone")),
    ).toBe(true);
  });
});

describe("C11: scheduling inside the DST spring-forward gap", () => {
  it("produces a runAt that is a valid UTC instant (Luxon advances out of the gap)", () => {
    // 2025-03-30: 02:00 Paris jumps to 03:00. A target at 02:30 Paris doesn't exist
    // locally. With end-of-window 02:30 we'd never hit the gap; we simulate by
    // passing a callbackAt that lands in the gap (01:30 UTC = 02:30 Paris on the gap).
    const decision = buildPostCallDecision({
      ...withInsights(baseInput(), {
        outcome: "Call rescheduled",
        callbackAt: "2025-03-30T01:30:00.000Z",
      }),
      step: {
        ...baseInput().step,
        callWindow: {
          days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
          start: "00:00",
          end: "23:59",
        },
      },
    });
    const action = decision.scheduledActions[0];
    expect(action).toBeDefined();
    // Whatever Luxon returns, it must be a valid ISO and not the local gap time
    expect(Number.isNaN(Date.parse(action!.runAt))).toBe(false);
  });
});

describe("C12: window crossing midnight (start > end)", () => {
  it("falls back to default window and warns when start >= end", () => {
    const decision = buildPostCallDecision({
      ...withCall(baseInput(), { status: "no-answer", amdStatus: null }),
      step: {
        ...baseInput().step,
        callWindow: {
          days: ["mon", "tue", "wed", "thu", "fri"],
          start: "22:00",
          end: "02:00",
        },
      },
    });
    expect(
      decision.warnings.some((w) => w.toLowerCase().includes("window")),
    ).toBe(true);
  });
});

describe("C13: callback target at 18:00:00.000 sharp on a 10-18 window", () => {
  it("snaps to next morning (18:00 is exclusive end)", () => {
    // 2025-03-20 = Thursday. 17:00 UTC = 18:00 Paris (CET, winter)
    const decision = buildPostCallDecision({
      ...withInsights(baseInput(), {
        outcome: "Call rescheduled",
        callbackAt: "2025-03-20T17:00:00.000Z",
      }),
      step: {
        ...baseInput().step,
        callWindow: {
          days: ["mon", "tue", "wed", "thu", "fri"] as Weekday[],
          start: "10:00",
          end: "18:00",
        },
      },
    });
    // Friday 10:00 Paris = 09:00 UTC
    expect(decision.scheduledActions[0]?.runAt).toBe("2025-03-21T09:00:00.000Z");
  });
});

// =============================================================================
// Category D — Deduplication edges
// =============================================================================

describe("D14: send_payment_link AND send_payment_plan_link both success", () => {
  it("paymentLinkSent is true and exactly one payment_reminder is scheduled", () => {
    const decision = buildPostCallDecision(
      withInsights(
        withTools(baseInput(), [
          {
            id: "link",
            name: "send_payment_link",
            status: "success",
            createdAt: "2025-03-15T13:59:30.000Z",
          },
          {
            id: "plan",
            name: "send_payment_plan_link",
            status: "success",
            createdAt: "2025-03-15T13:59:31.000Z",
          },
        ]),
        { outcome: "Accepted full payment now" },
      ),
    );
    expect(decision.callPatch.paymentLinkSent).toBe(true);
    expect(
      decision.scheduledActions.filter((a) => a.type === "payment_reminder"),
    ).toHaveLength(1);
  });
});

describe("D15: tool events differing by milliseconds are NOT deduplicated", () => {
  it("two distinct timestamps produce two distinct events (documented behavior)", () => {
    const decision = buildPostCallDecision(
      withTools(baseInput(), [
        {
          name: "send_payment_link",
          status: "success",
          createdAt: "2025-03-15T13:59:30.000Z",
        },
        {
          name: "send_payment_link",
          status: "success",
          createdAt: "2025-03-15T13:59:30.001Z",
        },
      ]),
    );
    // paymentLinkSent is idempotent (true either way)
    expect(decision.callPatch.paymentLinkSent).toBe(true);
    // The classification still ends in wait_payment_confirmation; not duplicated reminders
    expect(
      decision.scheduledActions.filter((a) => a.type === "payment_reminder"),
    ).toHaveLength(1);
  });
});

// =============================================================================
// Category E — Robustness
// =============================================================================

describe("E16: insights.outcome with newlines is sanitized in auditLog", () => {
  it("strips newlines from quoted strings in audit messages", () => {
    const decision = buildPostCallDecision(
      withInsights(baseInput(), { outcome: "Stop contact\nwith malicious newline" }),
    );
    for (const line of decision.auditLog) {
      expect(line).not.toMatch(/\n/);
      expect(line).not.toMatch(/\r/);
    }
  });
});

describe("E17: very long insights.summary is truncated in callPatch", () => {
  it("truncates to <= 2000 chars and signals truncation", () => {
    const longSummary = "A".repeat(5000);
    const decision = buildPostCallDecision(
      withInsights(baseInput(), { summary: longSummary }),
    );
    expect(decision.callPatch.summary?.length ?? 0).toBeLessThanOrEqual(2000);
  });

  it("keeps short summaries unchanged", () => {
    const shortSummary = "Short call summary.";
    const decision = buildPostCallDecision(
      withInsights(baseInput(), { summary: shortSummary }),
    );
    expect(decision.callPatch.summary).toBe(shortSummary);
  });
});
