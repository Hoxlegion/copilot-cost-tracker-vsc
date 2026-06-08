export const DASHBOARD_CSS = /*css*/ `
    :root {
      --bg: var(--vscode-editor-background);
      --fg: var(--vscode-editor-foreground);
      --border: var(--vscode-panel-border);
      --card-bg: var(--vscode-editorWidget-background);
      --accent: var(--vscode-progressBar-background);
      --tab-active: var(--vscode-tab-activeBackground);
      --tab-inactive: var(--vscode-tab-inactiveBackground);
      --muted: var(--vscode-descriptionForeground);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family);
      font-size: 13px;
      color: var(--fg);
      background: var(--bg);
    }

    /* Header bar */
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 16px;
      border-bottom: 1px solid var(--border);
    }
    .header h1 { font-size: 14px; font-weight: 600; }
    .header .stats {
      display: flex;
      gap: 16px;
      font-size: 12px;
      color: var(--muted);
    }
    .header .stats .val { font-weight: 600; color: var(--fg); }

    /* Tabs */
    .tabs {
      display: flex;
      border-bottom: 1px solid var(--border);
      padding: 0 16px;
    }
    .tab {
      padding: 8px 14px;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      font-size: 12px;
      color: var(--muted);
      transition: all 0.15s;
    }
    .tab:hover { color: var(--fg); }
    .tab.active {
      color: var(--fg);
      border-bottom-color: var(--accent);
      font-weight: 600;
    }

    /* Tab content */
    .tab-content { display: none; padding: 16px; }
    .tab-content.active { display: block; }

    /* Stat cards */
    .stat-row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 10px;
      margin-bottom: 16px;
    }
    .stat {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 10px 12px;
    }
    .stat-label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.3px; }
    .stat-value { font-size: 20px; font-weight: 700; margin-top: 2px; }
    .stat-sub { font-size: 11px; color: var(--muted); margin-top: 1px; }

    /* Progress */
    .budget-bar {
      width: 100%;
      height: 6px;
      background: var(--border);
      border-radius: 3px;
      margin-top: 6px;
      overflow: hidden;
    }
    .budget-fill {
      height: 100%;
      background: var(--accent);
      border-radius: 3px;
    }

    .chart-section-title {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      color: var(--muted);
      margin-bottom: 6px;
    }

    .chart-wrap {
      position: relative;
      width: 100%;
      height: 320px;
      margin: 12px 0;
      padding-bottom: 4px;
    }
    .chart-grid {
      display: grid;
      grid-template-columns: 1.5fr 1fr;
      gap: 16px;
    }

    /* Heatmap */
    .heatmap {
      display: flex;
      gap: 2px;
    }
    .heatmap-col {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .heatmap-cell {
      width: 13px;
      height: 13px;
      border-radius: 2px;
      background: var(--border);
      flex-shrink: 0;
    }
    .heatmap-day-label {
      height: 13px;
      line-height: 13px;
      display: flex;
      align-items: center;
      font-size: 10px;
      color: var(--muted);
    }
    .heatmap-legend {
      display: flex;
      align-items: center;
      gap: 4px;
      margin-top: 8px;
      font-size: 11px;
      color: var(--muted);
    }
    .heatmap-legend .cell {
      width: 13px;
      height: 13px;
      border-radius: 2px;
    }
    .heatmap-labels {
      display: flex;
      flex-direction: column;
      gap: 3px;
      font-size: 10px;
      color: var(--muted);
      margin-right: 4px;
      justify-content: flex-start;
      padding-top: 0;
    }
    .heatmap-labels span { height: 18px; display: flex; align-items: center; }
    .heatmap-toggle {
      display: flex;
      gap: 8px;
      margin-bottom: 8px;
    }
    .heatmap-toggle button {
      padding: 3px 10px;
      border: 1px solid var(--border);
      background: var(--card-bg);
      color: var(--fg);
      border-radius: 3px;
      cursor: pointer;
      font-size: 11px;
    }
    .heatmap-toggle button.active {
      background: var(--accent);
      color: #fff;
      border-color: var(--accent);
    }
    .period-toggle {
      display: flex;
      gap: 4px;
    }
    .period-toggle button {
      padding: 3px 10px;
      border: 1px solid var(--border);
      background: var(--card-bg);
      color: var(--fg);
      border-radius: 3px;
      cursor: pointer;
      font-size: 11px;
    }
    .period-toggle button.active {
      background: var(--accent);
      color: #fff;
      border-color: var(--accent);
    }

    /* Table */
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }
    th, td {
      padding: 6px 10px;
      text-align: left;
      border-bottom: 1px solid var(--border);
    }
    th {
      font-weight: 600;
      font-size: 11px;
      color: var(--muted);
      text-transform: uppercase;
    }
    th.sortable {
      cursor: pointer;
      user-select: none;
    }
    .table-filter-row th {
      padding: 4px 8px;
      border-bottom: 1px solid var(--border);
      background: var(--card-bg);
      text-transform: none;
    }
    .table-filter-row input {
      width: 100%;
      font-size: 11px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 3px 6px;
    }
    tr:hover { background: var(--card-bg); }
    .num { text-align: right; font-variant-numeric: tabular-nums; }

    .global-filter-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      padding: 10px 16px;
      border-bottom: 1px solid var(--border);
      background: color-mix(in srgb, var(--card-bg) 60%, transparent);
    }
    .global-filter-bar .label {
      font-size: 11px;
      color: var(--muted);
      margin-right: 2px;
    }
    .global-filter-bar button,
    .global-filter-bar input {
      font-size: 11px;
      border-radius: 4px;
    }
    .global-filter-bar .preset {
      padding: 3px 10px;
      border: 1px solid var(--border);
      background: var(--card-bg);
      color: var(--fg);
      cursor: pointer;
    }
    .global-filter-bar .preset.active {
      background: var(--accent);
      border-color: var(--accent);
      color: #fff;
    }
    .global-filter-bar input {
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--border);
      padding: 3px 6px;
    }
    .global-filter-bar .action {
      padding: 3px 10px;
      border: none;
      cursor: pointer;
    }
    .global-filter-bar .apply {
      background: var(--accent);
      color: #fff;
    }
    .global-filter-bar .reset {
      background: var(--border);
      color: var(--fg);
    }
    .freshness-chip {
      margin-left: auto;
      font-size: 11px;
      color: var(--muted);
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 3px 10px;
      background: color-mix(in srgb, var(--card-bg) 75%, transparent);
    }

    .insight-panel {
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 10px 12px;
      background: color-mix(in srgb, var(--card-bg) 72%, transparent);
      margin-top: 12px;
    }
    .insight-panel h4 {
      margin: 0 0 6px 0;
      font-size: 12px;
      color: var(--fg);
    }
    .insight-note {
      font-size: 11px;
      color: var(--muted);
      margin-bottom: 8px;
    }

    /* Help Button & Modal */
    .help-button {
      background: transparent;
      border: 1px solid var(--border);
      cursor: pointer;
      color: var(--muted);
      padding: 6px 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 6px;
      transition: all 0.2s ease;
      min-width: 32px;
      min-height: 32px;
    }
    .help-button:hover {
      background-color: var(--card-bg);
      color: var(--accent);
      border-color: var(--accent);
      transform: scale(1.05);
    }
    .help-button:active {
      transform: scale(0.98);
    }

    .modal {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      z-index: 1000;
    }
    .modal.show {
      display: flex;
    }
    .modal-overlay {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.5);
      cursor: pointer;
    }
    .modal-content {
      position: relative;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      width: 90%;
      max-width: 700px;
      max-height: 80vh;
      overflow-y: auto;
      margin: auto;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
    }
    .modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 20px;
      border-bottom: 1px solid var(--border);
      position: sticky;
      top: 0;
      background: var(--bg);
    }
    .modal-header h2 {
      margin: 0;
      font-size: 18px;
      font-weight: 600;
    }
    .modal-close {
      background: transparent;
      border: none;
      cursor: pointer;
      color: var(--muted);
      padding: 4px;
      display: flex;
      align-items: center;
      border-radius: 4px;
      transition: color 0.2s;
    }
    .modal-close:hover {
      color: var(--fg);
    }
    .modal-body {
      padding: 20px;
    }
    .help-section {
      margin-bottom: 20px;
    }
    .help-section:last-child {
      margin-bottom: 0;
    }
    .help-section h3 {
      margin: 0 0 10px 0;
      font-size: 14px;
      font-weight: 600;
    }
    .help-section p {
      margin: 8px 0;
      font-size: 13px;
      line-height: 1.5;
      color: var(--fg);
    }
    .help-section ul {
      margin: 8px 0;
      padding-left: 20px;
      font-size: 13px;
      line-height: 1.6;
    }
    .help-section li {
      margin: 4px 0;
    }
    .help-section code {
      background: var(--card-bg);
      padding: 2px 6px;
      border-radius: 3px;
      font-family: monospace;
      font-size: 12px;
    }

    /* Visual refresh */
    :root {
      --brand-1: #2aa5ff;
      --brand-2: #11c49b;
      --brand-3: #ffb347;
      --brand-4: #ff6f61;
      --panel-tint: color-mix(in srgb, var(--card-bg) 78%, #103449 22%);
      --panel-border-strong: color-mix(in srgb, var(--border) 70%, var(--brand-1) 30%);
    }
    body {
      background:
        radial-gradient(1200px 500px at 10% -10%, color-mix(in srgb, var(--brand-1) 18%, transparent), transparent),
        radial-gradient(900px 420px at 100% 0%, color-mix(in srgb, var(--brand-2) 14%, transparent), transparent),
        var(--bg);
    }
    .header {
      padding: 14px 16px;
      background: linear-gradient(120deg, color-mix(in srgb, var(--card-bg) 70%, #153247 30%), color-mix(in srgb, var(--card-bg) 76%, #19382f 24%));
      border-bottom: 1px solid var(--panel-border-strong);
    }
    .header h1 {
      font-size: 16px;
      letter-spacing: 0.2px;
    }
    .tabs {
      gap: 6px;
      border-bottom: none;
      padding-top: 8px;
      padding-bottom: 8px;
      background: color-mix(in srgb, var(--card-bg) 65%, transparent);
      position: sticky;
      top: 0;
      z-index: 12;
      backdrop-filter: blur(6px);
    }
    .tab {
      border: 1px solid transparent;
      border-radius: 999px;
      padding: 6px 12px;
    }
    .tab.active {
      border-bottom-color: transparent;
      border-color: color-mix(in srgb, var(--brand-1) 45%, var(--border) 55%);
      background: color-mix(in srgb, var(--brand-1) 20%, transparent);
    }
    .global-filter-bar {
      border-top: 1px solid var(--border);
      border-bottom: 1px solid var(--panel-border-strong);
      background: linear-gradient(90deg, color-mix(in srgb, var(--card-bg) 82%, #112f40 18%), color-mix(in srgb, var(--card-bg) 90%, #143428 10%));
    }
    .tab-content {
      padding-top: 18px;
      animation: fadeIn 0.18s ease;
    }
    .stat {
      background: var(--panel-tint);
      border: 1px solid var(--panel-border-strong);
      border-radius: 10px;
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.16);
    }
    .chart-wrap,
    .insight-panel,
    table {
      border-radius: 8px;
    }
    table {
      border: 1px solid color-mix(in srgb, var(--border) 72%, var(--brand-1) 28%);
      overflow: hidden;
      background: color-mix(in srgb, var(--card-bg) 88%, #101d29 12%);
    }
    th {
      background: color-mix(in srgb, var(--card-bg) 70%, #103449 30%);
      color: color-mix(in srgb, var(--fg) 82%, #9fd9ff 18%);
    }
    tr:nth-child(even) {
      background: color-mix(in srgb, var(--card-bg) 92%, transparent);
    }
    .table-filter-row th {
      background: color-mix(in srgb, var(--card-bg) 86%, #0f2333 14%);
    }
    .session-zone {
      border: 1px solid var(--panel-border-strong);
      border-radius: 10px;
      padding: 12px;
      background: color-mix(in srgb, var(--card-bg) 78%, #0d2737 22%);
      margin-bottom: 14px;
    }
    .section-header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      margin-bottom: 8px;
      gap: 10px;
    }
    .section-title {
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.35px;
      color: var(--fg);
    }
    .section-sub {
      font-size: 11px;
      color: var(--muted);
    }
    .session-focus-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 12px;
      margin-bottom: 12px;
    }
    .session-focus-grid > * {
      min-width: 0;
      overflow: hidden;
    }
    .session-focus-grid .insight-panel {
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .session-focus-grid .insight-panel > div.scroll-wrap {
      overflow-x: auto;
      flex: 1;
    }
    .session-subtabs {
      display: flex;
      gap: 6px;
      margin-bottom: 12px;
      flex-wrap: wrap;
    }
    .session-subtab {
      border: 1px solid var(--border);
      background: color-mix(in srgb, var(--card-bg) 88%, transparent);
      color: var(--muted);
      border-radius: 999px;
      padding: 5px 12px;
      font-size: 11px;
      cursor: pointer;
      transition: all 0.12s ease;
    }
    .session-subtab:hover {
      color: var(--fg);
      border-color: color-mix(in srgb, var(--brand-1) 40%, var(--border) 60%);
    }
    .session-subtab.active {
      color: #fff;
      border-color: color-mix(in srgb, var(--brand-1) 65%, var(--border) 35%);
      background: linear-gradient(90deg, color-mix(in srgb, var(--brand-1) 72%, #0e2230 28%), color-mix(in srgb, var(--brand-2) 56%, #0d2230 44%));
    }
    .session-pane {
      display: none;
    }
    .session-pane.active {
      display: block;
      animation: fadeIn 0.16s ease;
    }
    @keyframes fadeIn {
      from { opacity: 0.45; transform: translateY(3px); }
      to { opacity: 1; transform: translateY(0); }
    }`;
