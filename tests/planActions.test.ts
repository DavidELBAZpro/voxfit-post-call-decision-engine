import { describe, expect, it } from "vitest";
import { planActions } from "../src/planActions.js";
import type { NormalizedOutcome, PostCallInput, Weekday } from "../src/types.js";
import { baseInput, withCall, withInsights, withTools } from "./_factories.js";

const plan = (outcome: NormalizedOutcome, input: PostCallInput) =>
  planActions({ outcome, input });

describe("planActions — permanent exclusions", () => {
  it("do_not_call permanently excludes the case and schedules nothing", () => {
    const result = plan(
      "do_not_call",
      withInsights(baseInput(), { outcome: "Stop contact" }),
    );
    expect(result.casePatch.status).toBe("perm_excluded");
    expect(result.casePatch.permanentExclusionReason).toBeTruthy();
    expect(result.scheduledActions).toHaveLength(0);
  });

  it("wrong_contact permanently excludes the case and schedules nothing", () => {
    const result = plan("wrong_contact", baseInput());
    expect(result.casePatch.status).toBe("perm_excluded");
    expect(result.scheduledActions).toHaveLength(0);
  });
});

describe("planActions — already-excluded case guard", () => {
  it("does nothing and warns when the case is already perm_excluded", () => {
    const input: PostCallInput = {
      ...baseInput(),
      case: { ...baseInput().case, status: "perm_excluded" },
    };
    const result = plan("no_answer", input);
    expect(result.scheduledActions).toHaveLength(0);
    expect(result.casePatch.status).toBeUndefined();
    expect(result.warnings.some((w) => w.toLowerCase().includes("perm_excluded"))).toBe(true);
  });

  it("does nothing and warns when the case is already completed", () => {
    const input: PostCallInput = {
      ...baseInput(),
      case: { ...baseInput().case, status: "completed" },
    };
    const result = plan("promise_to_pay", input);
    expect(result.scheduledActions).toHaveLength(0);
    expect(result.warnings.some((w) => w.toLowerCase().includes("completed"))).toBe(true);
  });
});

describe("planActions — promise_to_pay", () => {
  it("schedules a payment_reminder on the promise date and a follow-up call", () => {
    const input = withInsights(baseInput(), {
      outcome: "Accepted full payment later",
      paymentDate: "2025-04-01",
    });
    const result = plan("promise_to_pay", input);

    expect(result.casePatch.status).toBe("temp_excluded");
    expect(result.casePatch.paymentPromiseDate).toBe("2025-04-01");

    const reminder = result.scheduledActions.find((a) => a.type === "payment_reminder");
    expect(reminder?.runAt).toBe("2025-04-01T07:00:00.000Z");

    const followup = result.scheduledActions.find((a) => a.type === "call");
    expect(followup).toBeDefined();
  });

  it("warns and skips the reminder when paymentDate is missing", () => {
    const input = withInsights(baseInput(), { outcome: "Accepted full payment later" });
    const result = plan("promise_to_pay", input);
    expect(
      result.scheduledActions.find((a) => a.type === "payment_reminder"),
    ).toBeUndefined();
    expect(result.warnings.some((w) => w.toLowerCase().includes("payment date"))).toBe(true);
  });

  it("warns and skips the reminder when paymentDate is in the past", () => {
    const input = withInsights(baseInput(), {
      outcome: "Accepted full payment later",
      paymentDate: "2024-01-01",
    });
    const result = plan("promise_to_pay", input);
    expect(
      result.scheduledActions.find((a) => a.type === "payment_reminder"),
    ).toBeUndefined();
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

describe("planActions — wait_payment_confirmation", () => {
  it("temp-excludes and schedules a single payment_reminder for next morning", () => {
    const input = withTools(baseInput(), [
      {
        id: "tool-1",
        name: "send_payment_link",
        status: "success",
        createdAt: "2025-03-15T13:59:30.000Z",
      },
    ]);
    const result = plan("wait_payment_confirmation", input);

    expect(result.casePatch.status).toBe("temp_excluded");
    const reminders = result.scheduledActions.filter((a) => a.type === "payment_reminder");
    expect(reminders).toHaveLength(1);
    expect(result.callPatch.paymentLinkSent).toBe(true);
  });

  it("does NOT emit two reminders when send_payment_link is duplicated", () => {
    const event = {
      name: "send_payment_link",
      status: "success" as const,
      createdAt: "2025-03-15T13:59:30.000Z",
    };
    const input = withTools(baseInput(), [event, { ...event, id: "dup" }]);
    const result = plan("wait_payment_confirmation", input);
    expect(result.scheduledActions.filter((a) => a.type === "payment_reminder")).toHaveLength(
      1,
    );
    expect(result.callPatch.paymentLinkSent).toBe(true);
  });
});

describe("planActions — callback_scheduled", () => {
  it("schedules a call at the callbackAt time when valid and in-window", () => {
    const input = withInsights(baseInput(), {
      outcome: "Call rescheduled",
      callbackAt: "2025-03-17T13:00:00.000Z",
    });
    const result = plan("callback_scheduled", input);
    expect(result.casePatch.status).toBe("temp_excluded");
    expect(result.scheduledActions[0]?.type).toBe("call");
    expect(result.scheduledActions[0]?.runAt).toBe("2025-03-17T13:00:00.000Z");
    expect(result.warnings).toHaveLength(0);
  });

  it("warns and falls back to retry-delay when callbackAt is invalid", () => {
    const input = withInsights(baseInput(), {
      outcome: "Call rescheduled",
      callbackAt: "not-an-iso",
    });
    const result = plan("callback_scheduled", input);
    expect(result.scheduledActions[0]?.type).toBe("call");
    expect(result.warnings.some((w) => w.toLowerCase().includes("callback"))).toBe(true);
  });

  it("warns when the callback is snapped to a different time (out of window)", () => {
    const input = {
      ...withInsights(baseInput(), {
        outcome: "Call rescheduled",
        callbackAt: "2025-03-16T11:00:00.000Z",
      }),
      step: {
        ...baseInput().step,
        callWindow: {
          days: ["mon", "tue", "wed", "thu", "fri"] as Weekday[],
          start: "10:00",
          end: "18:00",
        },
      },
    };
    const result = plan("callback_scheduled", input);
    expect(result.warnings.some((w) => w.toLowerCase().includes("snapped"))).toBe(true);
  });
});

describe("planActions — no_answer / voice_mail and attempts", () => {
  it("schedules a retry call when attempts are below max", () => {
    const result = plan(
      "no_answer",
      withCall(baseInput(), { status: "no-answer", amdStatus: null }),
    );
    expect(result.casePatch.status).toBe("temp_excluded");
    expect(result.scheduledActions[0]?.type).toBe("call");
  });

  it("emits a manual_review and warning when max attempts reached", () => {
    const input: PostCallInput = {
      ...withCall(baseInput(), { status: "no-answer", amdStatus: null }),
      step: { ...baseInput().step, maxAttempts: 3, attemptsSoFar: 3 },
    };
    const result = plan("no_answer", input);
    expect(result.scheduledActions.find((a) => a.type === "call")).toBeUndefined();
    expect(result.scheduledActions.find((a) => a.type === "manual_review")).toBeDefined();
    expect(result.warnings.some((w) => w.toLowerCase().includes("max attempts"))).toBe(true);
  });

  it("voice_mail behaves the same as no_answer for retry logic", () => {
    const result = plan(
      "voice_mail",
      withCall(baseInput(), { amdStatus: "machine_end" }),
    );
    expect(result.scheduledActions[0]?.type).toBe("call");
  });
});

describe("planActions — unknown fallback", () => {
  it("schedules a manual_review and warns when outcome is unknown", () => {
    const result = plan("unknown", baseInput());
    expect(result.scheduledActions.some((a) => a.type === "manual_review")).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

describe("planActions — tool events", () => {
  it("records a warning for failed tool events", () => {
    const input = withTools(baseInput(), [
      {
        name: "send_payment_link",
        status: "failed",
        createdAt: "2025-03-15T13:59:30.000Z",
      },
    ]);
    const result = plan("no_answer", input);
    expect(result.warnings.some((w) => w.toLowerCase().includes("failed"))).toBe(true);
    expect(result.callPatch.paymentLinkSent).toBeFalsy();
  });
});

describe("planActions — output ordering and nextActionAt", () => {
  it("sorts scheduledActions ascending by runAt", () => {
    const input = withInsights(baseInput(), {
      outcome: "Accepted full payment later",
      paymentDate: "2025-04-15",
    });
    const result = plan("promise_to_pay", input);
    const times = result.scheduledActions.map((a) => a.runAt);
    const sorted = [...times].sort();
    expect(times).toEqual(sorted);
  });

  it("sets casePatch.nextActionAt to the earliest scheduled runAt", () => {
    const input = withInsights(baseInput(), {
      outcome: "Accepted full payment later",
      paymentDate: "2025-04-15",
    });
    const result = plan("promise_to_pay", input);
    expect(result.casePatch.nextActionAt).toBe(result.scheduledActions[0]?.runAt);
  });
});
