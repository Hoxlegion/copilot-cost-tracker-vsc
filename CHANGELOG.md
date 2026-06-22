# Changelog

All notable changes to the **Copilot Cost Tracker** extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.6.1] - 2026-06-22

### Fixed
- Multi-window workspace attribution: turns are now attributed to their session's git repo (read from the traces DB) instead of whichever VS Code window ingested the shared global database, so sessions no longer appear under the wrong workspace
- Cost-database upsert self-heals a turn's workspace to an authoritative `Org/Repo` label when a later ingest provides one
- Pinned `@types/vscode` to `1.85.0` to match `engines.vscode` (fixes `vsce package` failure)
- Resolved CodeQL and Sonar findings (webview HTML construction, message origin/shape validation, `Statement.run` typing, redundant array check, duplicate/constant test conditions)

## [0.6.0] - 2026-06-22

### Added
- Efficiency Grade (A–F) with gauge, scoring cache reuse, context size, and input:output ratio
- "Context Tax" hero visualization showing how much conversation history each turn resends
- Cost Story digest — plain-language summary of spend, top model, priciest session, and cache health
- Productivity metrics: cost per turn and cost per active hour
- 14-day credit sparkline in the sidebar panel
- Theme-aware brand palette (`utils/palette.ts`) shared across charts and components

### Changed
- Dashboard consolidated into 5 tabs (Dashboard, Activity, Models, Efficiency, Budget)
- Charts, legends, and tooltips now derive colors from the active VS Code theme (fixes light-theme legibility)
- Model cost is attributed via accurate per-model breakdown across multi-model sessions
- Daily Activity chart shows Cost + Turns (replaced the redundant Credits line) and dropped the toggle
- Tabular numerals applied across the dashboard and sidebar for aligned figures
- Replaced emoji status indicators with Lucide icons (smart alerts, budget pacing)

### Fixed
- Chart legends were invisible on light themes (hardcoded white text)
- Status bar context-cost estimate used a hardcoded fallback model and could leave a stale tooltip
- "LLM Calls" column in the Activity workspace summary actually showed turn counts (relabeled "Turns")
- "Tail (ms)" latency silently fell back to the median; now a true P90 shown only with ≥20 samples

## [0.5.2] - 2026-06-15

### Added
- Turn Discovery tab showing per-turn LLM calls, tool calls, and cache hit rates
- Session title discovery from debug log `title-*.jsonl` files
- Per-model latency tracking (average and P90/P50 tail latency)
- Surface-level cost breakdown (pie chart + table)
- Workspace summary view with multi-workspace cost comparison
- Cache savings metrics and visualization
- Estimates tab with projected period cost and hours-saved calculations
- Heatmap visualization for daily cost/turns activity

### Changed
- Dashboard now supports global date range filtering with presets (Today, 7d, 30d, Period, Custom)
- Improved session deduplication with merge migration for title-mapped duplicates
- Model breakdown table now includes token counts and cache percentage

### Fixed
- Fixed duplicate session records caused by title mapping to both parent and conversation IDs
- Fixed billing period calculation for months with fewer days than the start day

## [0.5.1] - 2026-05-20

### Added
- Context weight tracking with real-time notifications
- CodeLens token preview for prompt files (`.prompt.md`, `.instructions.md`)
- Hover provider showing token count on first line of prompt files
- Configurable file extension filter for prompt cost intelligence

### Changed
- Switched from polling-only to file watcher strategy with debounced fallback
- Improved traces DB failover logic with recovery probing

### Fixed
- Fixed context refresh timer not respecting disposal on deactivation

## [0.5.0] - 2026-05-01

### Added
- Svelte-based webview dashboard with interactive charts (Chart.js)
- Daily cost/credits trend chart with dual Y-axis
- Model bar chart and pie chart breakdown
- Agent breakdown table with per-agent cost attribution
- Budget usage bar with configurable credit limits
- Token flow stacked bar chart (cached input / net input / output)
- Insight engine with actionable alerts (high verbosity, context bloat, cache decay, micro-turn trap)
- Playbook section with optimization strategies and status indicators
- Remote pricing URL support for custom model rates

### Changed
- Migrated from HTML string templates to Svelte components for webview
- Dashboard data assembler now pre-computes all view data server-side

## [0.4.0] - 2026-04-01

### Added
- Tree view (v2) with collapsible sections for sessions, models, and budget
- Status bar indicator with cost/credits display and budget pace
- Configurable billing cycle start day and budget warning thresholds
- Pricing engine with per-model rates and cache write token support
- SQLite (sql.js WASM) database for persistent cost storage
- Automatic database pruning based on configurable retention days
- Configuration manager with change notification events

### Changed
- Replaced in-memory storage with sql.js WASM database
- Improved data ingestion pipeline with batch processing (5,000 turns per batch)

## [0.3.0] - 2026-03-01

### Added
- Traces DB reader for Copilot's `agent-traces.db` OTEL span exporter
- Auto-failover from traces DB to JSONL when DB is empty or unavailable
- Watermark-based incremental ingestion (skips already-processed spans)
- Auto-enable `github.copilot.chat.otel.dbSpanExporter.enabled` setting on activation

### Changed
- Default telemetry source changed from `jsonl` to `auto` (prefers traces DB)

## [0.2.0] - 2026-02-01

### Added
- JSONL debug log parser for `main.jsonl` session files
- Multi-workspace session discovery
- Basic cost calculation from LLM request entries
- Initial tree view with session list

## [0.1.0] - 2026-01-15

### Added
- Initial release
- Extension scaffold with activation on startup
- Basic project structure
