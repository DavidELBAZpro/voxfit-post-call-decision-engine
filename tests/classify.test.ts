import { describe, expect, it } from "vitest";
import { classify } from "../src/classify.js";
import { baseInput, withCall, withInsights, withTools } from "./_factories.js";

describe("classify — telephony safety overrides", () => {
  it("classifies machine_start as voice_mail", () => {
    const input = withCall(baseInput(), { amdStatus: "machine_start" });
    expect(classify(input).outcome).toBe("voice_mail");
  });

  it("classifies machine_end as voice_mail", () => {
    const input = withCall(baseInput(), { amdStatus: "machine_end" });
    expect(classify(input).outcome).toBe("voice_mail");
  });

  it("classifies status no-answer as no_answer", () => {
    const input = withCall(baseInput(), { status: "no-answer", amdStatus: "unknown" });
    expect(classify(input).outcome).toBe("no_answer");
  });

  it("classifies status busy as no_answer", () => {
    const input = withCall(baseInput(), { status: "busy", amdStatus: null });
    expect(classify(input).outcome).toBe("no_answer");
  });

  it("classifies status failed as no_answer", () => {
    const input = withCall(baseInput(), { status: "failed", amdStatus: null });
    expect(classify(input).outcome).toBe("no_answer");
  });

  it("telephony beats AI insights when they conflict", () => {
    const input = withInsights(
      withCall(baseInput(), { status: "no-answer", amdStatus: null }),
      { outcome: "Accepted full payment later" },
    );
    expect(classify(input).outcome).toBe("no_answer");
  });
});

describe("classify — insight outcome mapping", () => {
  it("maps Stop contact to do_not_call", () => {
    const input = withInsights(baseInput(), { outcome: "Stop contact" });
    expect(classify(input).outcome).toBe("do_not_call");
  });

  it("maps Incorrect contact information to wrong_contact", () => {
    const input = withInsights(baseInput(), { outcome: "Incorrect contact information" });
    expect(classify(input).outcome).toBe("wrong_contact");
  });

  it("maps Debt dispute to disputed", () => {
    const input = withInsights(baseInput(), { outcome: "Debt dispute" });
    expect(classify(input).outcome).toBe("disputed");
  });

  it("maps Debt payment refusal to uncooperative", () => {
    const input = withInsights(baseInput(), { outcome: "Debt payment refusal" });
    expect(classify(input).outcome).toBe("uncooperative");
  });

  it("maps Accepted full payment now to wait_payment_confirmation", () => {
    const input = withInsights(baseInput(), { outcome: "Accepted full payment now" });
    expect(classify(input).outcome).toBe("wait_payment_confirmation");
  });

  it("maps Accepted full payment later to promise_to_pay", () => {
    const input = withInsights(baseInput(), {
      outcome: "Accepted full payment later",
      paymentDate: "2025-04-01",
    });
    expect(classify(input).outcome).toBe("promise_to_pay");
  });

  it("maps Accepted payment plan later to promise_to_pay", () => {
    const input = withInsights(baseInput(), {
      outcome: "Accepted payment plan later",
      paymentDate: "2025-04-01",
    });
    expect(classify(input).outcome).toBe("promise_to_pay");
  });

  it("maps Call rescheduled to callback_scheduled", () => {
    const input = withInsights(baseInput(), {
      outcome: "Call rescheduled",
      callbackAt: "2025-03-16T10:00:00.000Z",
    });
    expect(classify(input).outcome).toBe("callback_scheduled");
  });

  it("infers callback_scheduled from callbackAt alone", () => {
    const input = withInsights(baseInput(), { callbackAt: "2025-03-16T10:00:00.000Z" });
    expect(classify(input).outcome).toBe("callback_scheduled");
  });
});

describe("classify — tool events", () => {
  it("classifies successful send_payment_link as wait_payment_confirmation", () => {
    const input = withTools(baseInput(), [
      {
        id: "tool-1",
        name: "send_payment_link",
        status: "success",
        createdAt: "2025-03-15T13:59:30.000Z",
      },
    ]);
    expect(classify(input).outcome).toBe("wait_payment_confirmation");
  });

  it("classifies successful send_payment_plan_link as wait_payment_confirmation", () => {
    const input = withTools(baseInput(), [
      {
        name: "send_payment_plan_link",
        status: "success",
        createdAt: "2025-03-15T13:59:30.000Z",
      },
    ]);
    expect(classify(input).outcome).toBe("wait_payment_confirmation");
  });

  it("ignores failed send_payment_link", () => {
    const input = withTools(baseInput(), [
      {
        name: "send_payment_link",
        status: "failed",
        createdAt: "2025-03-15T13:59:30.000Z",
      },
    ]);
    expect(classify(input).outcome).toBe("unknown");
  });
});

describe("classify — early termination guard", () => {
  it("classifies sub-7s human calls with no stronger outcome as early_termination", () => {
    const input = withCall(baseInput(), { durationSec: 4 });
    expect(classify(input).outcome).toBe("early_termination");
  });

  it("does NOT downgrade a strong insight outcome to early_termination", () => {
    const input = withInsights(withCall(baseInput(), { durationSec: 4 }), {
      outcome: "Stop contact",
    });
    expect(classify(input).outcome).toBe("do_not_call");
  });
});

describe("classify — fallback", () => {
  it("returns unknown when no signal matches", () => {
    expect(classify(baseInput()).outcome).toBe("unknown");
  });

  it("emits at least one audit line", () => {
    expect(classify(baseInput()).audit.length).toBeGreaterThan(0);
  });
});
