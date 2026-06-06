import App from './App.svelte';
import { mount } from 'svelte';
import './stores/dashboard';

console.log('[Webview] Mounting Svelte app...');

const app = mount(App, {
  target: document.getElementById('app')!,
});

console.log('[Webview] Svelte app mounted successfully');

export default app;
