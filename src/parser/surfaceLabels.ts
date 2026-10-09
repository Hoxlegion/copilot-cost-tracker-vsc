import { CLI_AGENT_NAME } from "./types";

export function formatAgentName(agentName: string | null): string {
  if (!agentName) return "Other";
  switch (agentName) {
    case "panel/editAgent": return "Inline Chat";
    case "XtabProvider": return "Next Edit Suggestions";
    case "GitHub Copilot Chat": return "Sidebar Chat";
    case "summarizeConversationHistory": return "Context Summarization";
    case "progressMessages": return "Background Processing";
    case "title": return "Title Generation";
    case "unknown": return "Unknown";
    case CLI_AGENT_NAME: return "Copilot CLI";
    default: return agentName;
  }
}
