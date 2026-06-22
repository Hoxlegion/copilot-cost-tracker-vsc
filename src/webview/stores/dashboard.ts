import { writable, derived } from 'svelte/store';
import type { DashboardRawData } from '../types';

export const dashboardData = writable<DashboardRawData | null>(null);

/**
 * Currency-aware USD formatter, reactive to the configured currency/exchangeRate.
 * Always renders amounts with exactly 2 decimals. Usage: {$formatUsd(amount)}.
 */
export const formatUsd = derived(dashboardData, ($d) => {
  const currency = $d?.currency ?? 'USD';
  const rate = $d?.exchangeRate ?? 1;
  return (amount: number): string => {
    const safe = Number.isFinite(amount) ? amount : 0;
    if (currency === 'USD') return `$${safe.toFixed(2)}`;
    const local = safe * rate;
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(local);
    } catch {
      return `${currency} ${local.toFixed(2)}`;
    }
  };
});

window.addEventListener('message', (event: MessageEvent) => {
  // Origin verification: VS Code delivers host→webview messages with a
  // `vscode-webview://` origin that remote/web content cannot forge, and the
  // panel CSP (`default-src 'none'`) sandboxes the webview. Reject anything else.
  if (!event.origin.startsWith('vscode-webview://')) return;

  // Shape validation: only accept the well-formed dashboard payload.
  const message = event.data;
  if (
    message &&
    typeof message === 'object' &&
    message.type === 'dashboardData' &&
    message.data &&
    typeof message.data === 'object'
  ) {
    dashboardData.set(message.data as DashboardRawData);
  }
});
