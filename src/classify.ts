import type { Classification, NormalizedOutcome, PostCallInput, ToolEvent } from "./types.js";

const TELEPHONY_FAILURE_STATUSES = new Set(["no-answer", "busy", "failed"]);
const PAYMENT_LINK_TOOLS = new Set(["send_payment_link", "send_payment_plan_link"]);
const EARLY_TERMINATION_THRESHOLD_SEC = 7;

const INSIGHT_OUTCOME_MAP: ReadonlyArray<readonly [string, NormalizedOutcome]> = [
  ["Stop contact", "do_not_call"],
  ["Incorrect contact information", "wrong_contact"],
  ["Debt dispute", "disputed"],
  ["Debt payment refusal", "uncooperative"],
  ["Accepted full payment now", "wait_payment_confirmation"],
  ["Accepted full payment later", "promise_to_pay"],
  ["Accepted payment plan later", "promise_to_pay"],
  ["Call rescheduled", "callback_scheduled"],
];

const looksLikeMachine = (amdStatus: string | null | undefined): boolean => {
  if (!amdStatus) return false;
  const lower = amdStatus.toLowerCase();
  return lower.includes("machine") || lower.includes("voicemail");
};

const hasSuccessfulPaymentLink = (toolEvents: ToolEvent[] | undefined): boolean =>
  (toolEvents ?? []).some(
    (event) => PAYMENT_LINK_TOOLS.has(event.name) && event.status === "success",
  );

const isIsoDateParseable = (value: string | null | undefined): value is string =>
  typeof value === "string" && !Number.isNaN(Date.parse(value));

export const classify = (input: PostCallInput): Classification => {
  const audit: string[] = [];
  const { call, insights, toolEvents } = input;

  if (looksLikeMachine(call.amdStatus)) {
    audit.push(`classify: amdStatus=${call.amdStatus} → voice_mail (telephony override)`);
    return { outcome: "voice_mail", audit };
  }

  if (call.status && TELEPHONY_FAILURE_STATUSES.has(call.status)) {
    audit.push(`classify: status=${call.status} → no_answer (telephony override)`);
    return { outcome: "no_answer", audit };
  }

  if (insights.outcome) {
    for (const [needle, outcome] of INSIGHT_OUTCOME_MAP) {
      if (insights.outcome === needle) {
        audit.push(`classify: insights.outcome="${needle}" → ${outcome}`);
        return { outcome, audit };
      }
    }
  }

  if (hasSuccessfulPaymentLink(toolEvents)) {
    audit.push(
      "classify: successful payment_link tool event → wait_payment_confirmation",
    );
    return { outcome: "wait_payment_confirmation", audit };
  }

  if (isIsoDateParseable(insights.callbackAt)) {
    audit.push(`classify: insights.callbackAt=${insights.callbackAt} → callback_scheduled`);
    return { outcome: "callback_scheduled", audit };
  }

  if (
    typeof call.durationSec === "number" &&
    call.durationSec < EARLY_TERMINATION_THRESHOLD_SEC
  ) {
    audit.push(
      `classify: durationSec=${call.durationSec} < ${EARLY_TERMINATION_THRESHOLD_SEC}s → early_termination`,
    );
    return { outcome: "early_termination", audit };
  }

  audit.push("classify: no matching signal → unknown");
  return { outcome: "unknown", audit };
};
