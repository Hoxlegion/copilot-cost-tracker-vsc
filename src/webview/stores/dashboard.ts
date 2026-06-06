import { writable } from 'svelte/store';
import type { DashboardRawData } from '../types';

export const dashboardData = writable<DashboardRawData | null>(null);

console.log('[Webview Store] Setting up message listener...');

window.addEventListener('message', (event) => {
  const message = event.data;
  console.log('[Webview Store] Received message:', message.type);
  if (message.type === 'dashboardData') {
    console.log('[Webview Store] Updating dashboard data');
    dashboardData.set(message.data);
  }
});
