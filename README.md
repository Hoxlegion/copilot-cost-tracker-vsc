# Copilot Cost Tracker

[![Version](https://img.shields.io/badge/version-0.8.0-blue.svg)](https://github.com/Hoxlegion/copilot-cost-tracker-vsc/releases)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.85.0-blue.svg)](https://code.visualstudio.com/)

💰 **Real-time cost tracking for your GitHub Copilot usage in Copilot Chat and the Copilot CLI. See exactly what you are spending as you work.**

Get live updates on AI credit consumption with an always-visible status bar, budget alerts, and dashboards. No API keys required.

> ⚠️ **Requires VS Code settings change** [Setup <30 seconds](#requirements)

---

## Table of Contents

- [Features](#features)
- [Screenshots](#screenshots)
- [Requirements](#requirements)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Essential Configuration](#essential-configuration)
- [Commands](#commands)
- [Copilot CLI](#copilot-cli)
- [UI Components](#ui-components)
- [Troubleshooting](#troubleshooting)
- [Advanced: Pricing & Configuration](#advanced-pricing--configuration)
- [Architecture](#architecture)
- [Development](#development)
- [Contributing](#contributing)
- [License](#license)

---

## Features

| Feature | Description |
|---------|-------------|
| Live status bar | Session delta (`+2.3 cr`) and period total (`42.5 cr`) updated as you work |
| Budget threshold alerts | One-time VS Code notifications at configurable % thresholds (default: 75%, 90%, 100%) |
| Rich sidebar panel | Styled overview: budget bar, 14-day sparkline, today/week, pace, model & workspace breakdowns, recent sessions |
| Dashboard webview | 5-tab Chart.js dashboard: Dashboard, Activity, Models, Efficiency, Budget |
| Efficiency Grade | A–F grade with gauge, scoring cache reuse, context size, and input:output ratio |
| Context Tax visualization | Signature view of how much conversation history each turn resends, with average growth curve |
| Cost Story digest | Plain-language summary of your spend, top model, priciest session, and cache health |
| Productivity metrics | Cost per turn and cost per active hour, alongside cache savings and forecast |
| Theme-aware UI | Charts, legends, and tooltips adapt to light and dark VS Code themes |
| Global date filtering | Filter all dashboard tabs by custom date range (Today, 7d, 30d, This Period, or custom) |
| Reactive dashboard | All tabs update instantly when filter changes, no page reload needed |
| Accurate model attribution | Per-model cost split across multi-model sessions, not just the session's primary model |
| Workspace focus insights | Top workspace card + workspace leaderboard for current range |
| Turn Explorer analytics | Turn-level discovery with LLM calls, tool calls, cache %, expand/collapse, and filters |
| Cache savings visibility | Range-level savings card with model breakdown |
| Billing period tracking | Correct period boundaries for any `billingCycleStartDay`, including short months |
| Multi-model prices | Built-in rates for all June 2026 GA models from OpenAI, Anthropic, Google, GitHub |
| Custom model rates | Define credits-per-1M-tokens for models not in the built-in table |
| Model exclusion | Filter out models you don't want tracked (default: `gpt-4o-mini` code completions) |
| Context weight notifications | Warnings at 20K, 40K, 80K tokens when active sessions accumulate heavy context |
| Context awareness alerts | Identifies patterns: micro-turn bloat, raw paste, premium model misallocation, agent sprawl |
| File watcher strategy | Event-driven updates with 2s debounce for near-instant status bar refresh (sub-second after data arrival) |
| Response latency metrics | Tracks model response times and displays avg latency and P90 per model |
| DB + JSONL failover | Reads `agent-traces.db` directly; falls back to JSONL debug logs automatically |
| Copilot CLI tracking | Imports Copilot CLI usage with GitHub's billed credits from the CLI's session logs, without double counting resumed or re-read sessions |
| Source filter | Switch the dashboard between all usage, Copilot Chat, and Copilot CLI; the sidebar splits period credits by source |
| Watermark recovery | On restart, resumes from the last processed timestamp and re-reads a 15-minute overlap; unchanged turns are ignored, so nothing is counted twice |
| Periodic persistence | In-memory SQLite flushed to disk every 60 seconds, only when something changed |

---

## Screenshots

### Status Bar for Live Cost Tracking
See session delta (+2.3 credits) and period total in real time.

![Live cost indicator in status bar](media/statusbar.png)

### Cost Overview Sidebar
Styled panel: budget bar, 14-day sparkline, today/week, pace, and model/workspace breakdowns.

![Cost overview sidebar](media/sidetab.png)

### Dashboard (5-tab analytics)
Dashboard hero with Efficiency Grade and Context Tax, plus Activity, Models, Efficiency, and Budget tabs.
![5-tab Chart.js dashboard](media/dashboard.png)

Includes global date range filters, sorting, and detailed breakdowns.

---

## Requirements

Copilot Chat must have this telemetry setting enabled so usage data is written for this extension to read:
The extension attempts to enable this automatically on activation.
If VS Code policy/settings scope blocks automatic updates, set it manually.

```jsonc
"github.copilot.chat.otel.dbSpanExporter.enabled": true
```

**That's it.** The extension reads data that Copilot Chat already creates - no external APIs or authentication needed.

Copilot CLI usage needs no setup; see [Copilot CLI](#copilot-cli).

*(Optional: enable JSONL fallback logs if the database becomes unavailable)*

---

## Installation

### From VS Code Marketplace
1. Open **Extensions** in VS Code (`Ctrl+Shift+X`)
2. Search: **Copilot Cost Tracker**
3. Click **Install**

### From VSIX (Manual)
```bash
code --install-extension copilot-cost-tracker-0.6.5.vsix
```

### From Source
```bash
git clone https://github.com/Hoxlegion/copilot-cost-tracker-vsc.git
cd copilot-cost-tracker
npm install
npm run package
code --install-extension copilot-cost-tracker-0.6.5.vsix
```

---

## Quick Start

**3 steps:**

1. **Verify telemetry setting** (usually automatic)  
  On activation, the extension attempts to set this to `true` automatically.  
  If needed, set it manually in `settings.json`:
   ```jsonc
   "github.copilot.chat.otel.dbSpanExporter.enabled": true
   ```
  Then restart VS Code if you still don't see data.

2. **Open the extension**  
   Click the **Copilot Cost Tracker** icon in the Activity Bar (left sidebar).

3. **Start coding**  
   Use Copilot normally. Credits appear in real-time at the bottom status bar.

---

## Essential Configuration

Most users won't need to change anything. These are the most common settings:

| Setting | Type | Default | What it does |
|---------|------|---------|-------------|
| `budgetCredits` | number | `180` | Your monthly AI credit budget (used for alerts & progress bar). Set to `0` to disable budget tracking. |
| `billingCycleStartDay` | number | `1` | Day of month your billing resets (1–31) |
| `budgetWarningThresholds` | array | `[75, 90, 100]` | % thresholds for VS Code notifications |
| `currency` | string | `"USD"` | Display currency code |
| `currency` | string | `"USD"` | Display currency code (e.g. `EUR`, `GBP`). Requires `exchangeRate`. |
| `exchangeRate` | number | `1` | Exchange rate from USD to the configured `currency`. |
| `userDataPath` | string | `""` | Manual override for the editor user-data path (see fork support below). |
| `cliEnabled` | boolean | `true` | Track Copilot CLI usage from the CLI's session logs. |
| `cliHomePaths` | array | `[]` | Copilot CLI home folders to read (the folders that contain `session-state`). Empty uses `COPILOT_HOME` or `~/.copilot`. |
| `includeCliInBudget` | boolean | `true` | Count Copilot CLI credits toward the budget, pace, status bar, and sidebar totals. |
| `alertWindowHours` | number | `24` | Lookback window (hours) for efficiency alerts (1–168). |
| `dashboardSessionLimit` | number | `200` | Max recent sessions loaded when opening the dashboard (10–1000). |
| `weekStartDay` | enum | `"monday"` | First day of the week for the sidebar's weekly total (`monday`/`sunday`). |
| `showStatusBar` | boolean | `true` | Show cost in status bar |
| `contextWeightNotifications` | boolean | `true` | Show warnings for heavy context (20K, 40K, 80K tokens) |
| `microTurnGapSeconds` | number | `120` | Max seconds between turns for micro-turn pattern detection |
| `microTurnMinCount` | number | `5` | Consecutive rapid turns to trigger Micro-Turn Bloat alert |
| `rawPasteMinInputTokens` | number | `15000` | Min uncached tokens in a turn to trigger Raw Paste alert |
| `premiumMisallocationMinCredits` | number | `2` | Min credits for Premium Model Misallocation alert |
| `agentSprawlMinInputTokens` | number | `80000` | Min input tokens to trigger Massive Context Turn alert |

See the [Advanced: Pricing & Configuration](#advanced-pricing--configuration) section below for the full settings reference.

---

## Commands

Accessible via the Command Palette (`Ctrl+Shift+P`) under the **Copilot Cost Tracker** category.

| Command | Description |
|---------|-------------|
| `Copilot Cost Tracker: Refresh Cost Data` | Forces a full ingest, refreshes pricing, updates all UI. |
| `Copilot Cost Tracker: Open Dashboard` | Opens the webview dashboard in a side panel. |
| `Copilot Cost Tracker: Scan All Workspaces` | Ingests all available data without watermark restriction. |
| `Copilot Cost Tracker: Scan Full History` | Ingests from timestamp 0 — backfills the entire available history. |
| `Copilot Cost Tracker: Set Monthly Budget` | Pick a plan or enter a custom monthly credit budget. |
| `Copilot Cost Tracker: Export Usage Data` | Stream all recorded turns to a local JSON or CSV file. Spreadsheet formula-like text is prefixed with an apostrophe in CSV exports. |

---

## Editor & Fork Support

Copilot Cost Tracker automatically locates the editor's user-data directory for VS Code and popular forks:

- **VS Code** and **VS Code Insiders** (`Code - Insiders`)
- **Cursor** and **Windsurf**
- **Portable Mode** (via the `VSCODE_PORTABLE` environment variable)

If auto-detection fails (unusual install location, remote setup, etc.), set `copilotCostTracker.userDataPath` to the absolute path of your editor's `User` data directory as a manual override.

## Copilot CLI

GitHub Copilot CLI usage is tracked as a separate source next to Copilot Chat. No setup is needed: the extension reads the CLI's own session logs in `~/.copilot/session-state/<session-id>/events.jsonl`, or under `COPILOT_HOME` when that is set.

- **Credits**: the CLI logs the amount GitHub bills for its model calls, and the extension uses that amount as is. Only usage without a billed amount is estimated from token prices.
- **Turns**: a turn is one model call. Newer CLIs log every call; older CLIs only log totals when a session exits, so one of their rows can count several calls.
- **No double counting**: when a log changes, it is re-read in full and replaces that session's earlier rows. Resumed sessions, appended events, and re-reading a log never add usage twice. When Copilot Chat recorded the same session, the Chat data is kept. A session found in several CLI folders is counted once, from its newest log.
- **Budget**: CLI credits count toward the budget, pace, status bar, and sidebar totals. Set `includeCliInBudget` to `false` to leave them out. The dashboard's All / Chat / CLI filter works independently of this setting.
- **WSL or other folders**: list CLI home folders (the folders that contain `session-state`) in `cliHomePaths`, for example `\\wsl$\Ubuntu\home\me\.copilot`. Only the listed folders are read, so include your local `~/.copilot` as well if you use both.

Limitations:
- Older CLI versions, such as 1.0.71, save usage only when a session exits normally. A session closed another way, or a resumed session that is still running, has no or incomplete usage data on disk. Its usage is not estimated; the sidebar and dashboard show how many CLI sessions this period are affected.
- Per-call details such as latency, context weight, and tool calls are not available, so the Turn Explorer, alerts, and context insights use Copilot Chat data only.
- Turning `cliEnabled` off stops reading CLI logs. CLI usage that was already imported stays until `retentionDays` removes it.

Privacy: the session logs contain your full CLI conversations. The extension only parses session, context, and usage events and stores model names, token counts, credits, timestamps, the workspace label, and the session title. Prompts, responses, and tool output are not parsed or stored, and nothing leaves your machine.

## UI Components

### Status Bar
Displays at the bottom of VS Code:
```
$(credit-card) +$0.42 | $4.25 | $(brain) 35K
```
- **`+$0.42`** — USD spent in the current session (since activation)
- **`$4.25`** — Total spend this billing period
- **`$(brain) 35K`** — Active chat context weight (tokens)
- Color-coded by budget thresholds and pacing (yellow when approaching, red when over)
- Click for a quick menu: period summary, context, top models, dashboard, refresh, settings

### Cost Overview Sidebar
Styled panel in the Activity Bar:
- Budget bar with % used and reset date
- 14-day credit sparkline
- Today / This Week totals and projected pace
- Model and workspace breakdowns
- Copilot Chat and Copilot CLI credits for the period, once CLI usage exists
- Recent sessions with cost, model, and turn counts

### Dashboard
5-tab webview with Chart.js visualizations and global date range filtering:
- **Dashboard**: Today/period hero cards, Efficiency Grade (A–F), Context Tax visualization, Cost Story digest, productivity metrics (cost/turn, cost/active hour), cache savings, forecast, daily activity chart, cost drivers, and smart alerts
- **Activity**: Activity heatmap, workspace filter, recent sessions, sessions table, and a Turn Explorer with per-turn LLM/tool calls and cache %
- **Models**: Per-model cost breakdown (accurate across multi-model sessions) with avg credits/turn, token usage, cache %, avg and P90 latency, plus bar/pie/token-flow charts
- **Efficiency**: Optimization score, cache/context/IO metrics, context scatter & growth charts, surface breakdown, alerts, and a savings playbook
- **Budget**: Budget gauge, pacing status, forecast, and timeline

All tabs respond to the global date range filter for focused analysis. Once Copilot CLI usage exists, an **All / Chat / CLI** switch next to the date presets limits the totals, charts, breakdowns, and sessions to one source.

The Turn Explorer (Activity tab) includes:
- `Expand all` / `Collapse all`
- `Only rows with tools` filter
- `Only anomalies` filter (cache hit < 40% or turn used tools)
- Last Active timestamp for each turn

Open via **Copilot Cost Tracker: Open Dashboard** command or the graph icon in the sidebar.

---

## Troubleshooting

**No data appears / sidebar is empty**
1. Verify the required VS Code setting is enabled (see [Requirements](#requirements))
2. Restart VS Code
3. Set `logLevel` to `"info"` in settings and check the **Copilot Cost Tracker** Output Channel
4. Run **Copilot Cost Tracker: Scan Full History** to force a backfill

**Cost appears wrong for a model**
- Add custom rates via `copilotCostTracker.customModelRates` setting
- Unknown models default to GPT-5.4-tier fallback rates; check logs for warnings

**Copilot CLI usage is missing**
- Older CLIs only save usage when a session exits normally; other sessions appear in the "missing usage data" hint instead of the totals
- If you set `COPILOT_HOME`, VS Code must see the same environment variable, or add that folder to `cliHomePaths`
- Check that `cliEnabled` is on, then run **Copilot Cost Tracker: Refresh Cost Data** to re-read all CLI logs

**Budget period shows wrong start date**
- Verify `billingCycleStartDay` matches your GitHub billing cycle (GitHub → Settings → Billing and plans)
- If `startDay=31` and the month has fewer days, it correctly uses the last day of that month

**Extension not activating**
- Requires VS Code `^1.85.0`
- Loads after VS Code startup (a few seconds), not instantly
- Check VS Code Developer Console (`Help → Toggle Developer Tools`) for errors

---

## Advanced: Pricing & Configuration

### Full Configuration Reference
All settings under `copilotCostTracker.*`:
- **Billing**: `billingCycleStartDay`, `budgetCredits`, `budgetWarningThresholds`, `includeCliInBudget`
- **Pricing**: `customModelRates`, `excludedModels`, `pricingUrl`  
- **Data**: `telemetrySource`, `pollIntervalMax`, `initialScanDays`, `userDataPath`, `cliEnabled`, `cliHomePaths`
- **Display**: `currency`, `exchangeRate`, `weekStartDay`, `showStatusBar`
- **Insights**: `alertWindowHours`, `dashboardSessionLimit`
- **Debug**: `logLevel`

Tip: open VS Code Settings and search for `copilotCostTracker.` to browse all available options.

### Built-in Pricing Rates (June 2026)
Official rates for OpenAI, Anthropic, Google, GitHub models:
- **OpenAI**: GPT-5.5, GPT-5.4, GPT-5-mini, etc.
- **Anthropic**: Claude Opus/Sonnet/Haiku with cache support
- **Google**: Gemini models
- **GitHub**: Copilot fine-tuned models

Define custom rates for unlisted models:
```jsonc
"copilotCostTracker.customModelRates": {
  "my-model": { "input": 150, "output": 600 }
}
```

---

## Architecture

This extension is built with:
- **sql.js**: In-memory SQLite database (zero external runtime dependencies)
- **VS Code API**: Settings, status bar, webview, Output Channel
- **Svelte**: Reactive dashboard webview with component-based architecture
- **Chart.js**: Dashboard visualizations
- **File watcher strategy**: Event-driven file monitoring with debouncing for responsive UI updates
- **Context tracking**: Real-time session context weight monitoring with granular alerts

Data flows from VS Code's internal telemetry (traces database) and the Copilot CLI's session logs → cost calculation → in-memory DB → UI.

For deeper implementation details, inspect the source under `src/` and tests under `test/`.

---

## Development

### Quick Start

```bash
git clone https://github.com/Hoxlegion/copilot-cost-tracker-vsc.git
cd copilot-cost-tracker
npm install
npm run watch          # Rebuilds on changes
code .                 # Open in VS Code
```

Press `F5` to launch extension in a debug window.

### Build & Package

```bash
npm run build          # Development build with source maps
npm run package        # Create .vsix file for distribution
npm test               # Run unit tests (vitest)
npm run test:watch     # Watch mode
npm run typecheck      # Typecheck extension, tests, and webview
npm run deploy:local   # Builds and installs to local VS Code
```

### Traces WAL Validation

The traces reader opens the main database and WAL with read-only file descriptors. It validates WAL salts and checksums, applies only committed pages, and retries up to three times when the source changes during a full read. It never checkpoints or writes Copilot's database or shared-memory file.

The reader keeps one in-memory image of the database: the main file plus committed WAL pages, following the [SQLite WAL file format](https://www.sqlite.org/fileformat2.html#walformat). sql.js reads that image in place. New commits in the same WAL generation are read from the end of the WAL and applied to the image. A full reload happens only after a WAL restart, a removed WAL, a replaced database file, or growth beyond the image's 12.5% headroom, and it reuses the same memory. The image itself still needs about as much memory as the database file.

Ingestion streams spans in batches of 1,000, each in its own transaction, and yields to the event loop between batches. Incremental passes re-read 15 minutes before the watermark because Copilot writes a span when it ends. Unchanged turns are ignored, so the overlap cannot double count. The cost database is only exported when it changed.

Use Node.js 22 or newer to reproduce the measurement:

```bash
# Freeze a consistent copy of the live main/WAL pair
node scripts/measure-traces.js --freeze ./traces-copy
# Compare a checkout of the previous release with the current code on that copy
git worktree add --detach ../cct-v0.7.0 v0.7.0
node scripts/measure-traces.js ./traces-copy/agent-traces.db --baseline ../cct-v0.7.0
npm test -- test/tracesWal.test.ts --reporter=verbose
```

The script gives every scenario a fresh copy of the capture and runs the production reader, ingester, and cost database of each code version in separate processes. It writes to the temporary copies with SQLite to create real WAL commits and restarts, and uses SQLite as the correctness reference. A replay makes spans visible in the order they ended to measure late-span losses. Temporary files are removed afterwards, and span identifiers are hashed. Node's native SQLite is only used for measurements and test fixtures, not by the extension.

Measured on Windows with Node.js 22.19.0 on 2026-10-09 (main file 824,958,976 bytes, WAL 6,538,472 bytes, 30 days, median of three runs):

| Scenario | 0.7.0 | 0.7.1 |
|----------|-------|-------|
| Cold ingest + save | 647 ms, 863 MiB peak RSS | 434 ms, 860 MiB peak RSS |
| Warm query | 195 ms | 45 ms |
| Refresh after a WAL timestamp change | 448 ms, +794 MiB peak | 47 ms, +3.5 MiB peak |
| Refresh after a WAL commit (10 turns) | 429 ms, +786 MiB peak | 27 ms, +3.6 MiB peak |
| Refresh after a WAL restart | 369 ms, +786 MiB peak | 184 ms, +4.6 MiB peak |
| Three saves without changes | 3 exports | 0 exports |
| Full rescan without changes | 661 turns rewritten, 1 export | 0 turns, 0 exports |
| Late-span replay (1,082 passes) | 9 of 661 turns missed (453.02 credits) | 0 missed |

Peak RSS during a refresh dropped from about 1,655 MiB to 863 MiB. In every scenario both versions matched SQLite with zero missing, unexpected, or credit-mismatched spans and stored identical turns and credits. The replay needed at most 70 seconds of overlap; the longest stored span lasted 348 seconds. The snapshot reserves its headroom as untouched memory, so it raises ArrayBuffer usage (886 instead of 787 MiB) but not RSS. These are single-machine measurements with a warm file cache, so treat the timings as indicative.

The WAL integration tests also cover incremental application without rereading the main file, checkpoints within a WAL generation, restarts, truncated and removed WALs, growth and shrinkage, replaced files, concurrent changes during a read, pinned iteration, and byte-for-byte preservation of the main, WAL, and SHM files. The watcher fixture requires commit-to-visible latency under 1.5 seconds with a 10 ms debounce, without waiting for the fallback poll; this small-fixture latency is not a live-database benchmark.

### Project Structure

```
src/
  extension.ts         # Entry point, wires all modules
  config.ts           # Settings management
  billing.ts          # Billing period calculations
  database/           # In-memory SQL database
  parser/             # Trace data and Copilot CLI log parsing
  pricing/            # Cost calculation engine
  watcher/            # Data polling & ingestion
  views/              # UI: status bar, sidebar, dashboard
    helpers/          # View helper functions
  webview/            # Svelte dashboard application
    components/
      charts/         # Chart.js wrappers (Daily, Heatmap, Model, Context charts)
      shared/         # Reusable components (StatCard, BudgetBar, DataTable, GlobalFilter,
                      #   EfficiencyGrade, ContextCostHero, CostStory)
      tabs/           # Tab components (Dashboard, Activity, Models, Efficiency, Budget)
    stores/           # Svelte stores (dashboard data, filter state)
    utils/            # Formatting, palette, chart styles, model aggregation
    types.ts          # TypeScript interfaces
test/
  billing.test.ts     # Billing period calculation tests
```

See the `src/` folders above for module boundaries and ownership.

---

## Contributing

Pull requests welcome! Please:
1. Follow the existing code style and run `npm run lint`
2. Add tests for new features
3. Update docs if behavior changes
4. Reference any GitHub issues in commit messages

---
---

## License

MIT License — see [LICENSE](LICENSE)
