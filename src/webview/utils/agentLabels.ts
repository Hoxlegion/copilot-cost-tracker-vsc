/** Shared agent name → friendly label map, used across multiple tabs. */
export const AGENT_LABEL_MAP: Record<string, string> = {
  'GitHub Copilot Chat': 'Sidebar Chat',
  'panel/editAgent': 'Inline Chat',
  'XtabProvider': 'Next Edit Suggestions',
  'summarizeConversationHistory': 'Context Summarization',
  'progressMessages': 'Background Processing',
  'title': 'Title Generation',
};

export function friendlyAgentName(raw: string | null): string {
  if (!raw) return 'Other';
  return AGENT_LABEL_MAP[raw] ?? raw;
}
