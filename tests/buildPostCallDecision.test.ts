import { describe, expect, it } from "vitest";
import { buildPostCallDecision } from "../src/buildPostCallDecision.js";
import { baseInput, withCall, withInsights, withTools } from "./_factories.js";

describe("buildPostCallDecision — public contract", () => {
  it("returns a decision with all required top-level fields", () => {
    const decision = buildPostCallDecision(baseInput());
    expect(decision).toHaveProperty("normalizedOutcome");
    expect(decision).toHaveProperty("casePatch");
    expect(decision).toHaveProperty("scheduledActions");
    expect(decision).toHaveProperty("callPatch");
    expect(Array.isArray(decision.warnings)).toBe(true);
    expect(Array.isArray(decision.auditLog)).toBe(true);
  });

  it("is deterministic — same input yields equal output", () => {
    const a = buildPostCallDecision(baseInput());
    const b = buildPostCallDecision(baseInput());
    expect(a).toEqual(b);
  });

  it("auditLog concatenates classify lines BEFORE plan lines", () => {
    const decision = buildPostCallDecision(
      withCall(baseInput(), { status: "no-answer", amdStatus: null }),
    );
    const classifyIdx = decision.auditLog.findIndex((l) => l.startsWith("classify:"));
    const planIdx = decision.auditLog.findIndex((l) => l.startsWith("plan:"));
    expect(classifyIdx).toBeGreaterThanOrEqual(0);
    expect(planIdx).toBeGreaterThan(classifyIdx);
  });

  it("end-to-end: telephony no-answer drives no_answer + retry call", () => {
    const decision = buildPostCallDecision(
      withCall(baseInput(), { status: "no-answer", amdStatus: null }),
    );
    expect(decision.normalizedOutcome).toBe("no_answer");
    expect(decision.casePatch.status).toBe("temp_excluded");
    expect(decision.scheduledActions[0]?.type).toBe("call");
  });

  it("end-to-end: successful payment-link tool event → wait_payment_confirmation", () => {
    const decision = buildPostCallDecision(
      withTools(baseInput(), [
        {
          id: "t1",
          name: "send_payment_link",
          status: "success",
          createdAt: "2025-03-15T13:59:30.000Z",
        },
      ]),
    );
    expect(decision.normalizedOutcome).toBe("wait_payment_confirmation");
    expect(decision.callPatch.paymentLinkSent).toBe(true);
  });

  it("end-to-end: stop contact insight permanently excludes the case", () => {
    const decision = buildPostCallDecision(
      withInsights(baseInput(), { outcome: "Stop contact" }),
    );
    expect(decision.normalizedOutcome).toBe("do_not_call");
    expect(decision.casePatch.status).toBe("perm_excluded");
    expect(decision.scheduledActions).toHaveLength(0);
  });
});
