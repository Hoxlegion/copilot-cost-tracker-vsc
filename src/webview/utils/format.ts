export function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (Math.abs(value) >= 1000000) return (value / 1000000).toFixed(1) + 'M';
  if (Math.abs(value) >= 1000) return (value / 1000).toFixed(1) + 'K';
  return String(Math.round(value));
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return `${tokens}`;
}

export function formatSessionLabel(workspace: string, startMs: number, sessionId: string, title?: string | null): string {
  const d = new Date(startMs);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const month = months[d.getMonth()];
  const day = d.getDate();
  let hours = d.getHours();
  const minutes = d.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  const dateStr = `${month} ${day}, ${hours}:${minutes} ${ampm}`;
  const ws = workspace.length > 20 ? workspace.slice(0, 17) + '...' : workspace;
  if (title) {
    return `${title} · ${dateStr}`;
  }
  const shortId = sessionId.slice(0, 5);
  return `${ws} · ${dateStr} (${shortId})`;
}
