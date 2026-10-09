interface VsCodeApi {
  postMessage(message: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

// acquireVsCodeApi may only be called once per webview.
let api: VsCodeApi | undefined;

export function postToExtension(message: unknown): void {
  if (!api && typeof acquireVsCodeApi === 'function') api = acquireVsCodeApi();
  api?.postMessage(message);
}
