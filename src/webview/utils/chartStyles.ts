import { cssVar, withAlpha } from './palette';

/**
 * Theme-aware chart styling derived from VS Code color-theme variables.
 * Resolved once at module load from the active theme, so grid lines, ticks, and
 * tooltips read correctly on both light and dark themes (previously hardcoded to
 * white-on-dark, which broke on light themes).
 */

export const GRID_COLOR = withAlpha(cssVar('--vscode-foreground', '#cccccc'), 0.08);
export const TICK_COLOR = cssVar('--vscode-descriptionForeground', 'rgba(255, 255, 255, 0.5)');
export const TICK_FONT_SIZE = 10;

export function createGradient(
  ctx: CanvasRenderingContext2D,
  chartArea: { top: number; bottom: number },
  color: string,
  startAlpha: number = 0.4,
  endAlpha: number = 0
): CanvasGradient {
  const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
  const rgb = hexToRgb(color);
  if (rgb) {
    gradient.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${startAlpha})`);
    gradient.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${endAlpha})`);
  }
  return gradient;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: Number.parseInt(result[1], 16),
    g: Number.parseInt(result[2], 16),
    b: Number.parseInt(result[3], 16)
  } : null;
}

export const tooltipConfig = {
  backgroundColor: cssVar('--vscode-editorHoverWidget-background', 'rgba(30, 30, 30, 0.95)'),
  titleColor: cssVar('--vscode-editorHoverWidget-foreground', '#fff'),
  bodyColor: cssVar('--vscode-editorHoverWidget-foreground', 'rgba(255, 255, 255, 0.85)'),
  borderColor: cssVar('--vscode-editorHoverWidget-border', 'rgba(255, 255, 255, 0.1)'),
  borderWidth: 1,
  cornerRadius: 6,
  padding: 10,
  titleFont: { size: 12, weight: '600' as const },
  bodyFont: { size: 11 },
  displayColors: true,
  boxPadding: 4,
};

export const baseScaleConfig = {
  grid: {
    color: GRID_COLOR,
    drawBorder: false,
  },
  ticks: {
    color: TICK_COLOR,
    font: { size: TICK_FONT_SIZE },
  },
};
