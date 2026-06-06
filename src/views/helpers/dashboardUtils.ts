export function createNonce(length: number = 32): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let i = 0; i < length; i++) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}

export function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const idx = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil(p * sortedValues.length) - 1));
  return Math.round(sortedValues[idx]);
}

export const AGENT_LABEL_MAP: Record<string, string> = {
  "GitHub Copilot Chat": "Sidebar Chat",
  "panel/editAgent": "Inline Chat",
  "XtabProvider": "Next Edit Suggestions",
  "summarizeConversationHistory": "Context Summarization",
  "progressMessages": "Background Processing",
  "title": "Title Generation",
};
