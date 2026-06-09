import { writable } from 'svelte/store';
import type { DashboardRawData } from '../types';

export const dashboardData = writable<DashboardRawData | null>(null);

window.addEventListener('message', (event) => {
  if (!event.origin.startsWith('vscode-webview://')) return;
  const message = event.data;
  if (message.type === 'dashboardData') {
    dashboardData.set(message.data);
  }
});
