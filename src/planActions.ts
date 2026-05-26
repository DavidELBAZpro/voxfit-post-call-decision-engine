import { sanitize, truncate } from "./sanitize.js";
import {
  delayedCallAt,
  nextManualReviewAt,
  paymentReminderAt,
  snapToCallWindow,
} from "./scheduling.js";
import type {
  CallPatch,
  CasePatch,
  NormalizedOutcome,
  PostCallInput,
  ScheduledAction,
  ToolEvent,
} from "./types.js";

const SUMMARY_MAX_CHARS = 2000;

export type PlanContext = {
  outcome: NormalizedOutcome;
  input: PostCallInput;
};

export type PlanResult = {
  casePatch: CasePatch;
  scheduledActions: ScheduledAction[];
  callPatch: CallPatch;
  warnings: string[];
  audit: string[];
};

const PAYMENT_LINK_TOOLS = new Set(["send_payment_link", "send_payment_plan_link"]);

const dedupeToolEvents = (events: ToolEvent[] | undefined): ToolEvent[] => {
  if (!events || events.length === 0) return [];
  const seen = new Set<string>();
  const out: ToolEvent[] = [];
  for (const event of events) {
    const key = event.id ?? `${event.name}|${event.status}|${event.createdAt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(event);
  }
  return out;
};

const summarizeToolEvents = (
  events: ToolEvent[],
): { paymentLinkSent: boolean; warnings: string[]; audit: string[] } => {
  let paymentLinkSent = false;
  const warnings: string[] = [];
  const audit: string[] = [];
  for (const event of events) {
    const safeName = sanitize(event.name);
    const safeCreatedAt = sanitize(event.createdAt);
    if (event.status === "success" && PAYMENT_LINK_TOOLS.has(event.name)) {
      paymentLinkSent = true;
      audit.push(`plan: tool ${safeName} succeeded → paymentLinkSent=true`);
    }
    if (event.status === "failed") {
      warnings.push(`Tool ${safeName} failed at ${safeCreatedAt}`);
      audit.push(`plan: tool ${safeName} failed at ${safeCreatedAt}`);
    }
  }
  return { paymentLinkSent, warnings, audit };
};

const finalize = (
  patch: PlanResult,
  outcome: NormalizedOutcome,
  input: PostCallInput,
): PlanResult => {
  const dedupedEvents = dedupeToolEvents(input.toolEvents);
  const toolSummary = summarizeToolEvents(dedupedEvents);

  const callPatch: CallPatch = {
    outcome: patch.callPatch.outcome,
    ...(input.insights.summary !== undefined && {
      summary: truncate(input.insights.summary, SUMMARY_MAX_CHARS),
    }),
    ...(toolSummary.paymentLinkSent && { paymentLinkSent: true }),
  };

  const scheduledActions = [...patch.scheduledActions].sort((a, b) =>
    a.runAt.localeCompare(b.runAt),
  );

  const casePatch: CasePatch = { ...patch.casePatch };
  if (scheduledActions[0]) {
    casePatch.nextActionAt = scheduledActions[0].runAt;
  } else if (casePatch.nextActionAt === undefined) {
    casePatch.nextActionAt = null;
  }

  return {
    casePatch,
    scheduledActions,
    callPatch,
    warnings: [...patch.warnings, ...toolSummary.warnings],
    audit: [
      `plan: outcome=${outcome} caseStatus=${input.case.status}`,
      ...patch.audit,
      ...toolSummary.audit,
    ],
  };
};

const skipExcluded = (input: PostCallInput): PlanResult => ({
  casePatch: { nextActionAt: null },
  scheduledActions: [],
  callPatch: { outcome: "skipped" },
  warnings: [`Case is already ${input.case.status}; no further actions scheduled`],
  audit: [`plan: skipped — case already ${input.case.status}`],
});

const permanentExclude = (
  reason: string,
  outcome: NormalizedOutcome,
): PlanResult => ({
  casePatch: {
    status: "perm_excluded",
    permanentExclusionReason: reason,
    nextActionAt: null,
  },
  scheduledActions: [],
  callPatch: { outcome },
  warnings: [],
  audit: [`plan: perm_excluded — ${reason}`],
});

const handleCallbackScheduled = (input: PostCallInput): PlanResult => {
  const { now, insights, step, case: caseData } = input;
  const warnings: string[] = [];
  const audit: string[] = [];

  const callbackAt = insights.callbackAt;
  if (typeof callbackAt !== "string" || Number.isNaN(Date.parse(callbackAt))) {
    const fallback = delayedCallAt(
      now,
      step.retryDelayHours,
      step,
      caseData.preferredCallWindow,
    );
    warnings.push("Invalid callbackAt — falling back to retry-delay schedule");
    audit.push(`plan: invalid callbackAt → fallback call at ${fallback.runAt}`);
    return {
      casePatch: { status: "temp_excluded", temporaryExclusionReason: "callback_scheduled" },
      scheduledActions: [
        { type: "call", runAt: fallback.runAt, reason: "Fallback retry (invalid callbackAt)" },
      ],
      callPatch: { outcome: "callback_scheduled" },
      warnings,
      audit,
    };
  }

  const snapped = snapToCallWindow(callbackAt, step, caseData.preferredCallWindow, now);
  if (snapped.adjusted) {
    warnings.push(`Callback time snapped to next valid window slot (${snapped.runAt})`);
    audit.push(`plan: callback snapped from ${callbackAt} → ${snapped.runAt}`);
  } else {
    audit.push(`plan: callback at ${snapped.runAt}`);
  }

  return {
    casePatch: { status: "temp_excluded", temporaryExclusionReason: "callback_scheduled" },
    scheduledActions: [
      { type: "call", runAt: snapped.runAt, reason: "Scheduled callback per caller request" },
    ],
    callPatch: { outcome: "callback_scheduled" },
    warnings,
    audit,
  };
};

const handlePromiseToPay = (input: PostCallInput): PlanResult => {
  const { now, insights, step, case: caseData } = input;
  const warnings: string[] = [];
  const audit: string[] = [];
  const scheduledActions: ScheduledAction[] = [];

  let paymentPromiseDate: string | null = insights.paymentDate ?? null;
  const reminderRunAt = paymentReminderAt(insights.paymentDate, now);
  if (reminderRunAt) {
    scheduledActions.push({
      type: "payment_reminder",
      runAt: reminderRunAt,
      reason: "Promise to pay — remind on promise date 09:00 Paris",
    });
    audit.push(`plan: payment_reminder at ${reminderRunAt}`);
  } else {
    warnings.push(
      "Promise to pay without a valid future payment date — reminder skipped",
    );
    audit.push("plan: no payment_reminder (missing or past paymentDate)");
    paymentPromiseDate = null;
  }

  const followupDays = step.promiseFollowupDelayDays ?? 1;
  const followup = delayedCallAt(
    now,
    followupDays * 24,
    step,
    caseData.preferredCallWindow,
  );
  scheduledActions.push({
    type: "call",
    runAt: followup.runAt,
    reason: `Follow-up call ${followupDays} day(s) after promise`,
  });
  audit.push(`plan: follow-up call at ${followup.runAt}`);

  return {
    casePatch: {
      status: "temp_excluded",
      temporaryExclusionReason: "promise_to_pay",
      paymentPromiseDate,
    },
    scheduledActions,
    callPatch: { outcome: "promise_to_pay" },
    warnings,
    audit,
  };
};

const handleWaitPaymentConfirmation = (input: PostCallInput): PlanResult => {
  const { now, step, case: caseData } = input;
  const reminder = delayedCallAt(now, 24, step, caseData.preferredCallWindow);
  return {
    casePatch: {
      status: "temp_excluded",
      temporaryExclusionReason: "wait_payment_confirmation",
    },
    scheduledActions: [
      {
        type: "payment_reminder",
        runAt: reminder.runAt,
        reason: "Awaiting payment confirmation — reminder next morning",
      },
    ],
    callPatch: { outcome: "wait_payment_confirmation" },
    warnings: [],
    audit: [`plan: wait_payment_confirmation reminder at ${reminder.runAt}`],
  };
};

const handleDisputed = (input: PostCallInput): PlanResult => {
  const review = nextManualReviewAt(input.now, input.step, input.case.preferredCallWindow);
  return {
    casePatch: { status: "temp_excluded", temporaryExclusionReason: "disputed" },
    scheduledActions: [
      { type: "manual_review", runAt: review, reason: "Debt dispute — needs human review" },
    ],
    callPatch: { outcome: "disputed" },
    warnings: [],
    audit: [`plan: disputed → manual_review at ${review}`],
  };
};

const handleRetryCall = (
  input: PostCallInput,
  reason: string,
  outcome: NormalizedOutcome,
): PlanResult => {
  const retry = delayedCallAt(
    input.now,
    input.step.retryDelayHours,
    input.step,
    input.case.preferredCallWindow,
  );
  return {
    casePatch: { status: "temp_excluded", temporaryExclusionReason: outcome },
    scheduledActions: [{ type: "call", runAt: retry.runAt, reason }],
    callPatch: { outcome },
    warnings: [],
    audit: [`plan: ${outcome} retry at ${retry.runAt}`],
  };
};

const handleNoAnswerOrVoicemail = (
  input: PostCallInput,
  outcome: NormalizedOutcome,
): PlanResult => {
  const { step } = input;
  const attempts = (step.attemptsSoFar ?? 0) + 1;
  const max = step.maxAttempts ?? Number.POSITIVE_INFINITY;

  if (attempts >= max) {
    const review = nextManualReviewAt(input.now, step, input.case.preferredCallWindow);
    return {
      casePatch: { status: "temp_excluded", temporaryExclusionReason: outcome },
      scheduledActions: [
        {
          type: "manual_review",
          runAt: review,
          reason: `Max attempts (${max}) reached after ${outcome}`,
        },
      ],
      callPatch: { outcome },
      warnings: [`Max attempts (${max}) reached for ${outcome} — escalated to manual_review`],
      audit: [
        `plan: ${outcome} attempts=${attempts}/${max} → manual_review at ${review}`,
      ],
    };
  }

  return handleRetryCall(input, `Retry after ${outcome}`, outcome);
};

const handleUnknown = (input: PostCallInput): PlanResult => {
  const review = nextManualReviewAt(input.now, input.step, input.case.preferredCallWindow);
  return {
    casePatch: { status: "temp_excluded", temporaryExclusionReason: "unknown" },
    scheduledActions: [
      {
        type: "manual_review",
        runAt: review,
        reason: "Unclassified outcome — needs human review",
      },
    ],
    callPatch: { outcome: "unknown" },
    warnings: ["Outcome could not be classified deterministically"],
    audit: [`plan: unknown → manual_review at ${review}`],
  };
};

const dispatch = (ctx: PlanContext): PlanResult => {
  const { outcome, input } = ctx;
  switch (outcome) {
    case "do_not_call":
      return permanentExclude("Recipient asked to stop contact", outcome);
    case "wrong_contact":
      return permanentExclude("Incorrect contact information", outcome);
    case "callback_scheduled":
      return handleCallbackScheduled(input);
    case "promise_to_pay":
      return handlePromiseToPay(input);
    case "wait_payment_confirmation":
      return handleWaitPaymentConfirmation(input);
    case "disputed":
      return handleDisputed(input);
    case "uncooperative":
      return handleRetryCall(input, "Retry after refusal", "uncooperative");
    case "early_termination":
      return handleRetryCall(input, "Retry after early termination", "early_termination");
    case "no_answer":
    case "voice_mail":
      return handleNoAnswerOrVoicemail(input, outcome);
    case "unknown":
      return handleUnknown(input);
  }
};

export const planActions = (ctx: PlanContext): PlanResult => {
  if (ctx.input.case.status === "perm_excluded" || ctx.input.case.status === "completed") {
    return finalize(skipExcluded(ctx.input), ctx.outcome, ctx.input);
  }
  return finalize(dispatch(ctx), ctx.outcome, ctx.input);
};
