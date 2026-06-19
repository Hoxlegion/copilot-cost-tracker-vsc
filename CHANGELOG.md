# Changelog

All notable changes to the **Copilot Cost Tracker** extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

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
