export function simplifyModelName(model: string): string {
  const trimmed = model.trim().toLowerCase();
  return trimmed.replace(/-20\d{2}-\d{2}-\d{2}$/, "");
}

export function formatDuration(durationMs: number): string {
  const rounded = Math.round(durationMs);
  if (rounded >= 1000) {
    return `${(rounded / 1000).toFixed(1)}s`;
  }
  return `${rounded} ms`;
}