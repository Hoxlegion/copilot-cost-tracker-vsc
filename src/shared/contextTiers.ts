/**
 * Context size of one chat request: the conversation history that every request re-sends.
 * Calibrated for agentic chat, where a fresh chat already starts at roughly 20-50K tokens
 * (system prompt, tool definitions, instructions, and workspace context).
 */
export type ContextTier = "light" | "moderate" | "heavy" | "critical";

/** A request with more context tokens than a threshold belongs to that tier; up to `moderate` it is light. */
export const CONTEXT_TIER_THRESHOLDS = {
  moderate: 64_000,
  heavy: 128_000,
  critical: 256_000,
} as const;

export const CONTEXT_TIER_LABELS: Record<ContextTier, string> = {
  light: "Light",
  moderate: "Moderate",
  heavy: "Heavy",
  critical: "Critical",
};

export function classifyContextTier(tokens: number): ContextTier {
  if (tokens > CONTEXT_TIER_THRESHOLDS.critical) return "critical";
  if (tokens > CONTEXT_TIER_THRESHOLDS.heavy) return "heavy";
  if (tokens > CONTEXT_TIER_THRESHOLDS.moderate) return "moderate";
  return "light";
}
