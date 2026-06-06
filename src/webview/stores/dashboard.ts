import { writable } from 'svelte/store';
import type { DashboardRawData } from '../types';

export const dashboardData = writable<DashboardRawData | null>(null);

window.addEventListener('message', (event) => {
  const message = event.data;
  if (message.type === 'dashboardData') {
    dashboardData.set(message.data);
  }
});
