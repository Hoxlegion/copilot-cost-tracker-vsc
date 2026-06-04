# Copilot Cost Tracker

A VS Code extension that tracks and visualizes your GitHub Copilot AI credit consumption in real time. Built for the **usage-based billing model** effective June 1, 2026, where every interaction is billed per token and **1 AI credit = $0.01 USD**.

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Screenshots](#screenshots)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Configuration Reference](#configuration-reference)
- [Commands](#commands)
- [How It Works](#how-it-works)
  - [Data Sources: Where Do Prices Come From?](#data-sources-where-do-prices-come-from)
  - [Data Storage: How Is It Persisted?](#data-storage-how-is-it-persisted)
  - [Configuration Hierarchy](#configuration-hierarchy)
- [Architecture](#architecture)
  - [Data Flow](#data-flow)
  - [Module Overview](#module-overview)
  - [Data Sources & Failover](#data-sources--failover)
  - [Adaptive Polling](#adaptive-polling)
  - [Cost Calculation](#cost-calculation)
  - [Billing Periods](#billing-periods)
  - [Persistence](#persistence)
- [UI Components](#ui-components)
  - [Status Bar](#status-bar)
  - [Cost Overview Tree View](#cost-overview-tree-view)
  - [Dashboard](#dashboard)
- [Pricing Model](#pricing-model)
  - [Built-in Model Rates](#built-in-model-rates)
  - [Custom Model Rates](#custom-model-rates)
  - [Excluding Models](#excluding-models)
- [Development](#development)
  - [Project Structure](#project-structure)
  - [Build & Package](#build--package)
  - [Running Tests](#running-tests)
  - [TypeScript Notes](#typescript-notes)
- [Troubleshooting](#troubleshooting)

---

## Overview

GitHub Copilot switched from flat request-based billing to token-based billing on **June 1, 2026**. Each model interaction now consumes AI credits based on the number of input, output, and cached tokens used. This extension reads that raw usage data directly from VS Code's internal telemetry and gives you a live view of your spend — inside the editor where you're actually doing the work.

Key design goals:
- **Zero external dependencies** at runtime — reads telemetry written by VS Code itself
- **Accurate per-token billing** using official GitHub pricing tables
- **Billing-period aware** — tracks against your actual cycle (any start day 1–31), not calendar month
- **Non-intrusive** — passive observer only; no API calls, no credentials required

---

## Features

| Feature | Description |
|---------|-------------|
| Live status bar | Session delta (`+2.3 cr`) and period total (`42.5 cr`) updated as you work |
| Budget threshold alerts | One-time VS Code notifications at configurable % thresholds (default: 75%, 90%, 100%) |
| Cost tree view | Hierarchical sidebar: budget → today/week/month → models → sessions |
| Dashboard webview | 6-tab Chart.js dashboard: Overview, Budget health, Sessions, Models, Heatmap, Tokens |
| Billing period tracking | Correct period boundaries for any `billingCycleStartDay`, including short months |
| Multi-model pricing | Built-in rates for all June 2026 GA models from OpenAI, Anthropic, Google, GitHub |
| Custom model rates | Define credits-per-1M-tokens for models not in the built-in table |
| Model exclusion | Filter out models you don't want tracked (default: `gpt-4o-mini` code completions) |
| Adaptive polling | Interval doubles when idle (up to `pollIntervalMax`), resets immediately on new data |
| DB + JSONL failover | Reads `agent-traces.db` directly; falls back to JSONL debug logs automatically |
| Watermark recovery | On restart, resumes from the last processed timestamp — no duplicate counting |
| Periodic persistence | In-memory SQLite flushed to disk every 60 seconds |

---

## Screenshots

> 📸 **Coming soon** — Add the following captures to enhance Marketplace discoverability:
>
> 1. **Status Bar in action**: Show the real-time cost indicator (`+2.3 cr | 42.5 credits`) at the bottom of VS Code.
> 2. **Cost Overview tree**: Expand the sidebar to show budget breakdown by billing period, model, and session.
> 3. **Dashboard Overview tab**: Show the 6-tab Chart.js dashboard with historical spend trends and budget health.
>
> **Screenshot tips**:
> - Keep your GitHub username/workspace paths obscured if sensitive.
> - Use a clean VS Code theme for contrast.
> - Capture full window for status bar, tree, and dashboard examples.
> - Name files: `screenshot-status-bar.png`, `screenshot-tree-view.png`, `screenshot-dashboard.png`
> - Place in `media/` folder and reference below once added.

---

## Installation

### From VSIX

```bash
code --install-extension copilot-cost-tracker-0.2.0.vsix
```

Or: **Extensions** panel → `...` menu → **Install from VSIX...** → select the file.

### From source

```bash
git clone <repo>
cd copilot-cost-tracker
npm install
npm run package
code --install-extension copilot-cost-tracker-0.2.0.vsix
```

---

## Quick Start

### ⚠️ Step 1: REQUIRED — Enable Copilot Telemetry Writing

**The extension cannot function without these settings.** It reads usage data that Copilot Chat writes to disk, but that telemetry writing must be explicitly enabled. Add **all three** of these settings to your VS Code `settings.json`:

```jsonc
// Required: tells Copilot Chat to write span data to agent-traces.db (primary source)
"github.copilot.chat.otel.dbSpanExporter.enabled": true,

// Optional: enables JSONL debug logs as a fallback if the DB is unavailable
"github.copilot.advanced.debug.useElectronFetcher": true,
"github.copilot.advanced.debug.overrideLogLevels": { "*": "DEBUG" }
```

Restart VS Code after adding these settings.

### Step 2: Start using the extension

1. Install the extension (see [Installation](#installation)).
2. The extension activates automatically on VS Code startup (`onStartupFinished`).
3. Open the **Copilot Cost Tracker** panel in the Activity Bar to see your Cost Overview tree.
4. The status bar at the bottom shows live session and period totals.
5. Click the graph icon in the tree view toolbar to open the full Dashboard.

The extension locates the traces database automatically at:

```
%APPDATA%\Code\User\workspaceStorage\<hash>\GitHub.copilot-chat\agent-traces.db
```

If that file isn't found or produces no data after 12 consecutive polls, it falls back to JSONL debug logs at:

```
%APPDATA%\Code\User\workspaceStorage\<hash>\GitHub.copilot-chat\debug-logs\
```

---

## Configuration Reference

All settings live under `copilotCostTracker.*` in VS Code Settings (UI or `settings.json`).

### Billing & Budget

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `billingCycleStartDay` | `number` | `1` | Day of month your billing cycle starts (1–31). Clamped to last day of month if it exceeds month length. |
| `budgetCredits` | `number` | `180` | Total AI credit budget for the billing period. Used for threshold alerts and the budget progress bar. |
| `budgetWarningThresholds` | `number[]` | `[75, 90, 100]` | Percentage thresholds that trigger a one-time VS Code notification. Fired once per threshold per period. |

### Plan & Pool

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `plan` | `string` | `"enterprise"` | Your Copilot plan: `pro`, `pro_plus`, `max`, `business`, or `enterprise`. |
| `creditsPerUser` | `number` | `3900` | Monthly AI credits included in your plan per user. |
| `poolSize` | `number` | `1` | Number of users whose credits are pooled at your billing entity level. |

### Data Ingestion

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `telemetrySource` | `string` | `"auto"` | `"auto"` = DB with JSONL fallback. `"database"` = force DB. `"jsonl"` = force JSONL. |
| `initialScanDays` | `number` | `30` | Days of history to ingest on first activation. Use **Scan Full History** for a complete backfill. |
| `pollIntervalMin` | `number` | `5000` | Fastest poll rate in ms (reset to this after data is found). |
| `pollIntervalMax` | `number` | `60000` | Slowest poll rate in ms (reached after repeated empty polls). |

### Pricing & Models

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `customModelRates` | `object` | `{}` | Custom rates for unlisted models. Keys are model name strings (substring matched). Values: `{ "input": <credits/1M>, "output": <credits/1M> }`. |
| `excludedModels` | `string[]` | `["gpt-4o-mini"]` | Models to silently skip during ingestion. Uses substring matching (case-insensitive). |
| `pricingUrl` | `string` | `""` | URL to a remote JSON pricing file. Fetched at activation and on **Refresh**. Leave empty to use built-in rates. |

### Display

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `currency` | `string` | `"USD"` | Display currency code for cost labels. |
| `exchangeRate` | `number` | `1.0` | Multiplier applied to all USD values in the UI. |
| `showStatusBar` | `boolean` | `true` | Whether to show the cost indicator in the status bar. |

### Diagnostics

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `logLevel` | `string` | `"error"` | Verbosity for the **Copilot Cost Tracker** Output Channel: `error`, `warn`, `info`, `debug`, `trace`. |

---

## Commands

Accessible via the Command Palette (`Ctrl+Shift+P`) under the **Copilot Cost Tracker** category.

| Command | Description |
|---------|-------------|
| `Copilot Cost Tracker: Refresh Cost Data` | Forces a full ingest, refreshes pricing, updates all UI. |
| `Copilot Cost Tracker: Open Dashboard` | Opens the webview dashboard in a side panel. |
| `Copilot Cost Tracker: Scan All Workspaces` | Ingests all available data without watermark restriction. |
| `Copilot Cost Tracker: Scan Full History` | Ingests from timestamp 0 — backfills the entire available history. |

---

## How It Works

### Data Sources: Where Do Prices Come From?

1. **Primary Source — Traces Database (`agent-traces.db`)**
   - Copilot Chat writes every request/response to a SQLite database at `%APPDATA%\Code\User\workspaceStorage\<hash>\GitHub.copilot-chat\agent-traces.db`.
   - Each span includes: model name, input/output token counts, timestamp, session ID, and more.
   - The extension reads this file directly using [sql.js](https://sql.js.org/) (zero external dependencies).

2. **Fallback Source — JSONL Debug Logs**
   - If the traces database is unavailable or empty, the extension falls back to text-based JSONL logs in `debug-logs/`.
   - Automatically detected; no configuration needed.
   - Useful if the database becomes corrupted or inaccessible.

3. **Pricing: Built-in vs. Custom**
   - **Built-in rates**: Official June 2026 pricing from OpenAI (GPT-4o, GPT-4o-mini), Anthropic (Claude), Google (Gemini), and GitHub Copilot.
   - **Custom rates**: Define your own via the `customModelRates` setting if you have a negotiated agreement.
   - **Calculation**: `(inputTokens ÷ 1,000,000) × input_rate + (outputTokens ÷ 1,000,000) × output_rate = credits`
   - Example: `claude-opus-4.6` input @ ~4 credits/1M tokens, output @ ~15 credits/1M tokens.

### Data Storage: How Is It Persisted?

1. **In-Memory Database**
   - Uses [sql.js](https://sql.js.org/) to maintain a lightweight SQLite database in memory.
   - Two tables:
     - `turns`: Processed cost records (one per LLM request/response).
     - `sessions`: Aggregated data per chat session.

2. **Disk Persistence**
   - The in-memory database is **flushed to disk every 60 seconds** automatically.
   - Also saved on extension deactivate and after explicit refresh/scan commands.
   - File location: `%APPDATA%\Code\User\workspaceStorage\<hash>\copilotCostTracker\cost.db`
   - **Crash safety**: If VS Code crashes, at most 60 seconds of data is lost and automatically re-derived from the traces database on restart.

3. **Watermark Recovery**
   - On startup, the extension queries the max timestamp from the stored database.
   - It then fetches only *new* spans (since that timestamp) from the traces database.
   - **No duplicates**: Even after restarts, you never count the same interaction twice.

4. **Adaptive Polling**
   - The extension polls the traces database every 5–60 seconds (configurable).
   - Interval increases automatically when idle (to save CPU).
   - Resets to the fastest rate when new data arrives.

### Configuration Hierarchy

Settings are applied in this order (later overrides earlier):
1. **Built-in defaults** (hardcoded)
2. **User settings** (VS Code settings.json)
3. **Workspace overrides** (local `.vscode/settings.json`)

This allows per-project customization—e.g., one workspace tracks all models, another excludes test models.

---

## Architecture

### Data Flow

```
VS Code Internal Telemetry
        │
        ├─ agent-traces.db  (primary)
        │   └─ TracesDbReader (sql.js)
        │
        └─ JSONL debug logs  (fallback)
            └─ LogParser
                    │
                    ▼
             TracesIngester
             (adaptive poll + failover)
                    │
                    ▼
              PricingEngine
              (token → credits)
                    │
                    ▼
              CostDatabase
              (sql.js in-memory + disk flush)
                    │
          ┌─────────┼─────────────┐
          ▼         ▼             ▼
      TreeView   StatusBar    Dashboard
```

### Module Overview

| Module | File(s) | Responsibility |
|--------|---------|----------------|
| **Config** | `src/config.ts` | Typed, validated settings. Fires `onDidChange` events. Single source of truth. |
| **Logger** | `src/logger.ts` | Structured OutputChannel logger with level filtering (error/warn/info/debug/trace). |
| **Billing** | `src/billing.ts` | Billing period boundary math. Handles short months, year rollover, leap years. |
| **TracesDbReader** | `src/parser/tracesDbReader.ts` | Reads `agent-traces.db` by snapshotting bytes into sql.js. Avoids WAL lock issues. |
| **LogParser** | `src/parser/logParser.ts` | Parses JSONL debug log files from `workspaceStorage`. |
| **PricingEngine** | `src/pricing/pricingEngine.ts` | Cost calculation + custom rate support + fallback with dedup warnings. |
| **CostDatabase** | `src/database/costDatabase.ts` | In-memory sql.js SQLite. Tables: `turns`, `sessions`. Flushed to disk periodically and on deactivate. |
| **TracesIngester** | `src/watcher/tracesIngester.ts` | Orchestrates polling, failover, watermark tracking, and batch inserts. |
| **Views** | `src/views/` | Status bar, tree view, and webview dashboard. |
| **Extension** | `src/extension.ts` | Wires all modules together. Registers commands and disposables. |

### Data Sources & Failover

The ingester reads from two sources in priority order:

1. **`agent-traces.db`** (primary): A SQLite database written by VS Code's Copilot Chat extension. Read by snapshotting the file bytes into a sql.js in-memory database, which sidesteps WAL lock contention entirely.

2. **JSONL debug logs** (fallback): Text files in `workspaceStorage/<hash>/GitHub.copilot-chat/debug-logs/`. Parsed line by line for request/response telemetry events.

Failover triggers automatically when:
- The traces DB file does not exist.
- `telemetrySource` is explicitly set to `"jsonl"`.
- The DB has produced no data for **12 consecutive polls** (≈ 60 seconds at minimum interval).

The active source is logged to the Output Channel and resets when the DB recovers.

### Adaptive Polling

The ingester uses a `setTimeout` chain (not `setInterval`) for precise control:

- **On data found**: interval resets to `pollIntervalMin` (default 5s).
- **On empty poll**: interval doubles, capped at `pollIntervalMax` (default 60s).
- Config changes to bounds apply immediately via `updatePollingBounds()`.

This means the extension is highly responsive during active use and nearly silent during idle periods, with battery/CPU impact approaching zero when Copilot is not being used.

### Cost Calculation

```
cost_usd = (inputTokens  / 1_000_000 × inputRate)
         + (outputTokens / 1_000_000 × outputRate)
         + (cachedTokens / 1_000_000 × cachedRate)
         + (cacheWriteTokens / 1_000_000 × cacheWriteRate)  // Anthropic only

credits  = cost_usd × 100
```

Model lookup order:
1. Built-in `DEFAULT_PRICING` table (exact key match on model name).
2. `customModelRates` setting (substring match, case-insensitive).
3. GPT-4o fallback rate (a warning is logged the first time per unknown model).

### Billing Periods

The `billing.ts` module computes correct period boundaries for any `billingCycleStartDay`:

```typescript
getBillingPeriodStart(startDay: number, now?: Date): Date
getBillingPeriodEnd(startDay: number, now?: Date): Date
getBillingPeriodStartMs(startDay?: number): number  // reads from VS Code config
getBillingPeriodEndMs(startDay?: number): number
```

Edge cases handled:
- `startDay=31` in a 30-day month → last day of month
- `startDay=31` in February → Feb 28 (or 29 in leap years)
- December period end → January of next year
- Invalid `startDay` (< 1 or > 31) → clamped to valid range

All functions are pure and fully covered by 15 unit tests in `test/billing.test.ts`.

### Persistence

The cost database is an **in-memory sql.js** instance backed by a binary file:

```
<VS Code globalStoragePath>/copilot-cost-tracker.db
```

- Loaded into memory at activation; all queries run in-process with no I/O per query.
- **Flushed to disk every 60 seconds** via a `setInterval` timer registered in the extension's subscription list.
- **Saved on deactivation** via the `deactivate()` export.
- On restart, the ingester recovers its **watermark** (last processed timestamp) from `MAX(timestamp)` in the turns table — preventing reprocessing or data loss.

---

## UI Components

### Status Bar

Displays at the bottom of VS Code when `showStatusBar` is `true`:

```
$(credit-card)  +2.3 | 42.5 cr
```

- **`+2.3`** — Credits consumed in the current VS Code session (delta since last activation).
- **`42.5 cr`** — Total credits used since the start of the current billing period.

**Color coding** (based on `budgetWarningThresholds`):
- Below first threshold: no background (default theme).
- At/above first threshold (default 75%): yellow warning background.
- At/above second threshold (default 90%): red error background.

**Threshold notifications**: A VS Code notification fires once per threshold per billing period. State resets automatically when a new billing period begins.

### Cost Overview Tree View

A tree view in the Copilot Cost Tracker Activity Bar panel:

```
Budget Used: 42.5 / 180 cr (23.6%)
  ├─ This Period
  └─ 23.6% of budget
Today: 5.2 cr
  └─ [model breakdown]
This Week: 18.4 cr
This Month: 42.5 cr
Sessions
  ├─ Session abc123 — 3.1 cr · 12 turns
  └─ Session def456 — 2.1 cr · 8 turns
```

The tree refreshes via a 2-second debounced handler on the ingester's `onDidDataChange` event, coalescing rapid bursts of new data into a single UI update.

### Dashboard

Opened via the **Open Dashboard** command or the graph icon in the tree view toolbar. A retained webview panel with 6 tabs:

| Tab | Contents |
|-----|----------|
| **Overview** | Stat cards (today / week / month / budget %), daily cost bar chart (last 30 days) |
| **Budget** | Billing period progress bar with dynamic color, days remaining, budget/day allowance, per-model credits breakdown for the period |
| **Sessions** | Table: date, primary model, turn count, cost (USD), credits |
| **Models** | Bar chart + pie chart of cost share, model table with turn count and % |
| **Heatmap** | GitHub-style contribution grid (last 12 weeks), toggle between cost and turn count |
| **Tokens** | Input / output / cached token breakdown charts |

The dashboard reads live from the in-memory database on every `update()` call, triggered by the debounced refresh after any ingestion event.

---

## Pricing Model

### Built-in Model Rates

All prices are **credits per 1 million tokens** (= USD/1M tokens × 100). Effective June 3, 2026. Source: [GitHub Copilot Models and Pricing](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing).

**OpenAI**

| Model | Input cr/1M | Cached cr/1M | Output cr/1M |
|-------|------------|--------------|--------------|
| `gpt-4.1` | 200 | 50 | 800 |
| `gpt-5-mini` | 25 | 2.5 | 200 |
| `gpt-5.2` / `gpt-5.2-codex` / `gpt-5.3-codex` | 175 | 17.5 | 1400 |
| `gpt-5.4` | 250 | 25 | 1500 |
| `gpt-5.4-mini` | 75 | 7.5 | 450 |
| `gpt-5.4-nano` | 20 | 2 | 125 |
| `gpt-5.5` | 500 | 50 | 3000 |

**Anthropic** *(also includes a cache write rate)*

| Model | Input | Cached | Cache Write | Output |
|-------|-------|--------|-------------|--------|
| `claude-haiku-4.5` | 100 | 10 | 125 | 500 |
| `claude-sonnet-4` / `4.5` / `4.6` | 300 | 30 | 375 | 1500 |
| `claude-opus-4.5` / `4.6` / `4.7` / `4.8` | 500 | 50 | 625 | 2500 |

**Google**

| Model | Input | Cached | Output |
|-------|-------|--------|--------|
| `gemini-2.5-pro` | 125 | 12.5 | 1000 |
| `gemini-3-flash` | 50 | 5 | 300 |
| `gemini-3.1-pro` | 200 | 20 | 1200 |
| `gemini-3.5-flash` | 150 | 15 | 900 |

**GitHub Fine-tuned**

| Model | Input | Cached | Output |
|-------|-------|--------|--------|
| `raptor-mini` | 25 | 2.5 | 200 |

**Microsoft**

| Model | Input | Cached | Output |
|-------|-------|--------|--------|
| `mai-code-1-flash` | 75 | 7.5 | 450 |

### Custom Model Rates

Add rates for models not in the built-in table via settings:

```jsonc
"copilotCostTracker.customModelRates": {
  "my-fine-tuned-model": {
    "input": 150,    // credits per 1M input tokens
    "output": 600    // credits per 1M output tokens
  }
}
```

Matching is **substring-based and case-insensitive** — a key of `"my-fine-tuned"` matches any model name containing that string.

### Excluding Models

Models used for code completions (like `gpt-4o-mini`) are excluded by default since they are not billed under the token-based model:

```jsonc
"copilotCostTracker.excludedModels": ["gpt-4o-mini"]
```

Exclusion is applied **at ingestion time** — matching spans are watermarked (to avoid re-processing) but never inserted into the cost database. Substring matching, case-insensitive.

> **Note**: To remove already-stored data for an excluded model, delete `<globalStoragePath>/copilot-cost-tracker.db` and run **Scan Full History**.

---

## Development

### Project Structure

```
copilot-cost-tracker/
├── src/
│   ├── extension.ts           # Activation entry point — wires all modules
│   ├── config.ts              # ConfigManager + ExtensionConfig type
│   ├── logger.ts              # Structured OutputChannel logger
│   ├── billing.ts             # Billing period boundary calculations
│   ├── database/
│   │   ├── costDatabase.ts    # sql.js SQLite wrapper (in-memory + persistence)
│   │   └── index.ts
│   ├── parser/
│   │   ├── types.ts           # Shared type definitions (TraceSpan, ParsedTurn, etc.)
│   │   ├── tracesDbReader.ts  # Reads agent-traces.db via sql.js
│   │   ├── logParser.ts       # Parses JSONL debug logs
│   │   └── index.ts
│   ├── pricing/
│   │   ├── defaultPricing.ts  # Built-in model rate table (June 2026)
│   │   ├── pricingEngine.ts   # Cost calculation + custom rate support
│   │   └── index.ts
│   ├── watcher/
│   │   ├── tracesIngester.ts  # Adaptive polling + failover + watermark
│   │   ├── logWatcher.ts      # File-system log watcher (JSONL path)
│   │   └── index.ts
│   └── views/
│       ├── statusBar.ts       # StatusBarIndicator with threshold alerting
│       ├── treeViewV2.ts      # CostTreeProvider (hierarchical tree)
│       ├── dashboardPanel.ts  # DashboardPanel (webview, 6 tabs, Chart.js)
│       └── index.ts
├── test/
│   └── billing.test.ts        # 15 vitest unit tests for billing period math
├── media/
│   └── icon.svg
├── .context/
│   ├── ublang.md              # Ubiquitous language + all 18 architectural decisions
│   └── FUTURE_IDEAS.md        # Roadmap and feature ideas
├── dist/                      # Built output (esbuild bundle + sql-wasm.wasm)
├── package.json
└── tsconfig.json
```

### Build & Package

```bash
# Development build (with source maps)
npm run build

# Watch mode (rebuilds on file save)
npm run watch

# Package as .vsix
npm run package
# Answer 'y' to the repository/license prompts

# Install locally
code --install-extension copilot-cost-tracker-0.1.0.vsix
```

The build uses **esbuild** to bundle `src/extension.ts` into a single `dist/extension.js`. The `sql-wasm.wasm` WASM binary is included in the VSIX automatically. The `vscode` module is treated as external (provided by VS Code at runtime).

### Running Tests

```bash
# Run all tests once
npm test

# Watch mode
npm run test:watch
```

Tests use **Vitest 4.x** and run in a pure Node.js environment (no VS Code API, no file system). Current suite: 15 tests in `test/billing.test.ts` covering all edge cases of billing period boundary calculations.

### TypeScript Notes

`tsconfig.json` uses `strict: true`. There are **8 pre-existing type errors** in `src/database/costDatabase.ts` and `src/parser/tracesDbReader.ts` caused by `sql.js` not shipping TypeScript declarations (`TS7016`, `TS7006`). These do **not** affect the build — esbuild bundles JavaScript, not type-checks. They are tracked but excluded from new-error tracking:

```bash
# Check for any new errors (excludes pre-existing sql.js noise)
npx tsc --noEmit 2>&1 | grep -v "sql.js\|costDatabase"
```

To fix them properly: either `npm i --save-dev @types/sql.js` (if published) or add a local declaration file:

```typescript
// src/sql-js.d.ts
declare module 'sql.js';
```

---

## Troubleshooting

**No data appears / tree view is empty**

1. **Check the required VS Code settings** — the most common cause. Verify these are in your `settings.json`:
   ```jsonc
   "github.copilot.chat.otel.dbSpanExporter.enabled": true
   ```
   Without this, Copilot Chat never writes to `agent-traces.db` and the extension has nothing to read. Restart VS Code after adding it.
2. Set `logLevel` to `"info"` and check the **Copilot Cost Tracker** Output Channel.
3. Verify the traces DB path exists: `%APPDATA%\Code\User\workspaceStorage\<hash>\GitHub.copilot-chat\agent-traces.db`
4. If using the JSONL fallback, also ensure debug logging is enabled:
   ```jsonc
   "github.copilot.advanced.debug.useElectronFetcher": true,
   "github.copilot.advanced.debug.overrideLogLevels": { "*": "DEBUG" }
   ```
5. Run **Copilot Cost Tracker: Scan Full History** to force a full backfill from timestamp 0.

**gpt-4o-mini sessions still appear in history**

Exclusion is applied at ingestion time — existing stored records remain. To clear them:
1. Close VS Code.
2. Delete `<globalStoragePath>/copilot-cost-tracker.db`.
3. Reopen VS Code and run **Scan Full History** — the excluded models will be skipped.

**Cost appears wrong for a model**

1. Set `logLevel` to `"warn"` — unknown models log a warning (once per model) when the fallback rate is used.
2. Add the model's correct rate to `customModelRates` in settings.
3. For known models with wrong built-in rates, check `src/pricing/defaultPricing.ts` against the [official pricing page](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing) and open an issue.

**Budget period shows wrong start date**

- Verify `billingCycleStartDay` matches your GitHub billing cycle (found in GitHub → Settings → Billing and plans).
- For months shorter than `billingCycleStartDay` (e.g., `startDay=31` in February), the period starts on the last day of that month. This is the correct behavior per the billing module.

**Extension not activating**

- Requires VS Code `^1.85.0`.
- Activation event is `onStartupFinished` — the extension loads shortly after VS Code is fully ready, not at the instant a window opens. Wait a few seconds after launch.
- Check the VS Code Developer Console (`Help → Toggle Developer Tools`) for any activation errors.
