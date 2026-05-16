/**
 * CHAT-05: System-prompt scaffold for Mara's Coffee chat surface.
 *
 * Guidance: prefer "I don't have data on that" over guessing. Passed via
 * `--system-prompt` flag if gbrain supports it (QB_GBRAIN_SUPPORTS_SYSTEM_PROMPT=1).
 * Otherwise, it's a known gap documented in CONTEXT.md (D-CHAT-05).
 *
 * Detection strategy: env-var gate (QB_GBRAIN_SUPPORTS_SYSTEM_PROMPT).
 * Do NOT shell out to detect support at module load — avoids 200ms spawn cost
 * on every cold start. Operator can flip the var after a one-time check:
 *   gbrain think --help | grep system-prompt
 */

export const MARAS_COFFEE_SYSTEM_PROMPT =
  "You are answering questions about a small coffee shop's business records " +
  "(invoices, vendor emails, bank statements). " +
  "If the documents do not contain enough information to answer, reply exactly with: " +
  "'I don't have data on that.' " +
  "Cite sources using the [Source: <path>] format shown in retrieval results.";

/**
 * One-time warning flag: emit the CHAT-05 best-effort warning at most once
 * per process to avoid log spam on every request.
 */
let _warnedCHAT05 = false;

/**
 * buildThinkArgs — builds the args array for `spawnGBrain` for the chat surface.
 *
 * ALWAYS uses `gbrain think --model haiku` (spec_override 2026-05-16):
 *   - `gbrain think` = LLM synthesis (what the chat surface needs)
 *   - `--model haiku` = ~30s answer vs Opus which hangs minute-scale (CHAT-06)
 *   - `gbrain query` = retrieval only (used only by onboarding warm-up, plan 02-03)
 *
 * If QB_GBRAIN_SUPPORTS_SYSTEM_PROMPT=1, prepends the system prompt flag.
 * Otherwise, returns the base args and logs a one-time notice.
 *
 * @param question - The user's question text (already validated, max 500 chars)
 * @param model    - Override the model; defaults to "haiku" (CHAT-06 budget)
 */
export function buildThinkArgs(question: string, model = "haiku"): string[] {
  const base = ["think", question, "--model", model];

  if (process.env.QB_GBRAIN_SUPPORTS_SYSTEM_PROMPT === "1") {
    // gbrain think --system-prompt "<prompt>" <question> --model haiku
    // Prepend system-prompt flag before the question so gbrain parses it as an option.
    return ["think", "--system-prompt", MARAS_COFFEE_SYSTEM_PROMPT, question, "--model", model];
  }

  if (!_warnedCHAT05) {
    _warnedCHAT05 = true;
    console.warn(
      "[QuickBrain CHAT-05] System-prompt guidance is disabled. " +
      "To enable, verify gbrain supports --system-prompt: " +
      "`gbrain think --help | grep system-prompt` " +
      "then set QB_GBRAIN_SUPPORTS_SYSTEM_PROMPT=1 in your environment.",
    );
  }

  return base;
}
