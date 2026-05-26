import { sanitize } from "./sanitize.js";
import type { PostCallInput } from "./types.js";

export type ValidationResult = {
  warnings: string[];
  audit: string[];
};

const SUPPORTED_TIMEZONE = "Europe/Paris";

const parseHHMM = (value: string | undefined): number => {
  if (!value) return Number.NaN;
  const [hStr, mStr] = value.split(":");
  const h = Number(hStr);
  const m = Number(mStr ?? "0");
  if (!Number.isFinite(h) || !Number.isFinite(m)) return Number.NaN;
  return h * 60 + m;
};

export const validateInput = (input: PostCallInput): ValidationResult => {
  const warnings: string[] = [];
  const audit: string[] = [];

  if (input.timezone !== SUPPORTED_TIMEZONE) {
    warnings.push(
      `Unsupported timezone "${sanitize(String(input.timezone))}" — falling back to ${SUPPORTED_TIMEZONE}`,
    );
    audit.push(
      `validate: timezone="${sanitize(String(input.timezone))}" → using ${SUPPORTED_TIMEZONE}`,
    );
  }

  if (typeof input.call.durationSec === "number" && input.call.durationSec < 0) {
    warnings.push(
      `Negative call duration (${input.call.durationSec}s) — ignored for classification`,
    );
    audit.push(`validate: durationSec=${input.call.durationSec} (negative, ignored)`);
  }

  const nowMs = Date.parse(input.now);
  const performedMs = Date.parse(input.call.performedAt);
  if (Number.isFinite(nowMs) && Number.isFinite(performedMs) && performedMs > nowMs) {
    warnings.push("call.performedAt is in the future relative to now — clock skew suspected");
    audit.push("validate: performedAt > now (possible clock skew)");
  }

  if (input.case.amountRemaining <= 0) {
    warnings.push(
      `Suspicious amountRemaining=${input.case.amountRemaining} — case may be settled or overpaid`,
    );
    audit.push(`validate: amountRemaining=${input.case.amountRemaining} (non-positive)`);
  }

  const win = input.step.callWindow;
  if (win) {
    const startM = parseHHMM(win.start);
    const endM = parseHHMM(win.end);
    if (!Number.isFinite(startM) || !Number.isFinite(endM) || startM >= endM) {
      warnings.push(
        `Invalid call window (start="${sanitize(win.start)}" end="${sanitize(win.end)}") — using defaults`,
      );
      audit.push(
        `validate: invalid callWindow start=${win.start} end=${win.end} (using default 8-20 weekdays)`,
      );
    }
  }

  return { warnings, audit };
};
