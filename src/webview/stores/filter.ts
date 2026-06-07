import { writable } from 'svelte/store';

export type FilterPreset = 'today' | '7d' | '30d' | 'period' | 'custom';

export interface FilterState {
  preset: FilterPreset;
  fromMs: number | null;
  toMs: number | null;
}

export const filterState = writable<FilterState>({
  preset: 'period',
  fromMs: null,
  toMs: null,
});

export function applyPreset(preset: FilterPreset, billingPeriodStartMs: number) {
  const now = Date.now();
  const msDay = 24 * 60 * 60 * 1000;
  
  let fromMs: number | null = null;
  let toMs: number | null = now;
  
  if (preset === 'today') {
    const d = new Date();
    fromMs = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  } else if (preset === '7d') {
    fromMs = now - 7 * msDay;
  } else if (preset === '30d') {
    fromMs = now - 30 * msDay;
  } else if (preset === 'period') {
    fromMs = billingPeriodStartMs;
  }
  
  filterState.set({ preset, fromMs, toMs });
}

export function applyCustomRange(fromMs: number | null, toMs: number | null) {
  filterState.set({ preset: 'custom', fromMs, toMs });
}

export function resetFilter(billingPeriodStartMs: number) {
  applyPreset('period', billingPeriodStartMs);
}
