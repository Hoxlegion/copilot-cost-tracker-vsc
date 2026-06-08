export const GRID_COLOR = 'rgba(255, 255, 255, 0.05)';
export const TICK_COLOR = 'rgba(255, 255, 255, 0.5)';
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
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}

export const tooltipConfig = {
  backgroundColor: 'rgba(30, 30, 30, 0.95)',
  titleColor: '#fff',
  bodyColor: 'rgba(255, 255, 255, 0.85)',
  borderColor: 'rgba(255, 255, 255, 0.1)',
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
