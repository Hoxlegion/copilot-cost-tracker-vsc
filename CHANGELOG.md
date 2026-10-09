# Changelog

All notable changes to the **Copilot Cost Tracker** extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.8.0] - 2026-10-09

GitHub Copilot CLI as a separate data source, with GitHub's billed credits and deduplication.

### Features
- **Copilot CLI tracking**: usage is imported from the CLI's session logs (`~/.copilot/session-state/<id>/events.jsonl`, or under `COPILOT_HOME`) as its own source next to Copilot Chat. Credits come from the billed amount GitHub reports in those logs; only usage without a billed amount is estimated from token prices
- Newer CLIs write a usage record for every model call, and each call becomes a row. Older CLIs only save usage when a session exits normally; that usage becomes one row per exit and model
- **Deduplication**: a changed log is re-read in full and replaces that session's earlier rows, so re-reading a log, appended events, and resumed sessions never count twice. Session snapshots only add usage that no per-call record covers. When Copilot Chat recorded the same session, the Chat data is kept, and a session found in several CLI folders is counted once from its newest log
- **Dashboard source filter**: an All / Chat / CLI switch in the filter bar, shown once CLI data exists. Totals, charts, breakdowns, sessions, and insight metrics follow the filter; Turn Explorer, alerts, and context insights stay Chat-only. CLI sessions get a badge in the Activity tab
- **Sidebar**: period credits split into Copilot Chat and Copilot CLI, a CLI badge in recent sessions, and a hint with the number of CLI sessions this period whose usage was not fully saved
- **Turns count model calls**: a CLI row that combines several calls counts each call, so turn counts and cost per turn stay comparable between sources
- **Export**: CSV and JSON exports include `source` and `requestCount`
- New settings: `cliEnabled` (default on), `cliHomePaths` for other CLI homes such as a WSL home, and `includeCliInBudget` (default on). With `includeCliInBudget` off, CLI credits are left out of the budget, pace, status bar, and sidebar totals

### Bug Fixes
- Sorting a numeric dashboard table column puts placeholders such as "—" below real numbers instead of in arbitrary order

### Internal
- Turns get `source` (`chat`/`cli`) and `request_count` columns; existing turns become Chat turns of one request. A new `cli_sources` table keeps a fingerprint of every CLI log, so unchanged logs are not re-read and a re-import without changes writes nothing
- The Chat watermark and the latency, context, and alert queries only use Chat rows
- The legacy session-merge migration skips CLI sessions, whose generated titles can repeat
- Git remote parsing moved to `src/shared/gitRemote.ts`, so CLI sessions get the same `Org/Repo` workspace labels as Chat sessions
- `scripts/inspect-cli-sessions.js` prints the structure and usage numbers of local CLI logs without their content
- New tests cover the CLI parser (legacy, cumulative, and mixed sessions, resumes, duplicate records, partial and half-written logs, missing billed amounts, BYOK), the CLI ingester against a real database, source filters, the database upgrade, and the dashboard filter messages

## [0.7.1] - 2026-10-09

Lower refresh memory and bounded ingestion for large traces databases.

### Performance
- **Incremental WAL refresh**: new commits are read from the end of the WAL and applied to the existing in-memory snapshot instead of reloading the whole traces database. On an 825 MB database a refresh after a commit takes 27 ms instead of 429 ms, and peak memory during a refresh drops from about 1,655 MiB to 863 MiB
- **In-place reloads**: a WAL restart, a removed WAL, or a replaced database reloads into the same memory, so two full snapshots never coexist
- **Bounded ingestion**: spans are streamed in batches of 1,000, each in its own transaction, with a yield to the event loop between batches
- **Fewer database exports**: the cost database is only written when it changed, so periodic saves, scans without new data, and closing a window no longer export an unchanged database
- The session-to-repository map is cached per snapshot, which makes repeated span queries faster

### Bug Fixes
- **Late spans**: incremental ingestion re-reads 15 minutes before the watermark because Copilot writes a span when it ends. Replaying 30 days of telemetry recovered 9 turns (453 credits) that 0.7.0 only picked up after a manual refresh. Unchanged turns are ignored, so the overlap cannot double count
- Spans that share a start time across a batch boundary are no longer skipped
- Refresh and scan messages now count new or updated turns instead of every re-processed span

### CI
- Typechecks for the extension, the tests, and the Svelte webview (`svelte-check` 4.7.6) run in CI and release builds
- The extension bundle targets Node 18 (VS Code 1.85), and lint rejects `node:sqlite` imports in extension code

### Internal
- `scripts/measure-traces.js` compares a baseline checkout with the current code on a frozen capture, including real WAL commits and restarts, a late-span replay, export counts, and stored-turn digests
- New tests cover incremental WAL application, checkpoints, restarts, truncated and removed WALs, growth, shrinkage, replaced files, pinned iteration, change tracking for saves, and overlap ingestion

## [0.7.0] - 2026-10-09

Architecture review hardening across ingestion, parsing, views, pricing, and configuration.

### Bug Fixes
- **Traces WAL visibility**: committed turns and billing attributes are read from a checksum-validated main/WAL snapshot before checkpointing; the watcher follows WAL creation, updates, and resets without changing Copilot's database
- **Ingestion watermark** no longer advances when a span batch produces zero new turns, so turns hidden by an excluded-model filter reappear if settings change
- **Concurrent ingestion** is now serialized with a mutex, preventing SQLite "cannot start a transaction within a transaction" errors when the file watcher and manual commands overlap
- **Config reads** in the sidebar and dashboard now route through `ConfigManager` for consistent clamping/validation (fixes inconsistent budget defaults)
- **Billing period** totals now respect `billingCycleStartDay` instead of always using the calendar month start
- **Custom pricing rates** now match model names more precisely (exact or prefix match) before falling back to substring matching
- **Day-1 pace** no longer triggers false "pace high" alerts caused by clamping fractional elapsed days to 1
- **CSP nonce** for both webviews now uses a cryptographically secure random source
- **Migration sentinel** replaced with `PRAGMA user_version`, removing the fake `__migration_merge_v2__` row from the sessions table
- **Non-null assertion** in span batch processing is now guarded against empty input
- **Repo name parsing** handles `git://` URLs and Windows local paths

### Security
- **Remote pricing responses** are limited to 512 KiB before JSON parsing, including streamed bodies with absent or misleading length headers; rejected responses are canceled and previously validated prices remain available

### Performance
- **Async DB reads**: the traces DB is now read with `fs.promises` instead of a blocking `readFileSync`, and a promise-singleton guards against a concurrency race in the loader
- **JSONL backfill** is wrapped in a single transaction, dramatically speeding up first-run ingestion
- **JSONL parsing** now streams line-by-line instead of loading the whole file into memory
- **Dashboard session fetch** is capped (configurable) instead of always loading up to 1000 sessions
- **Token counting** prefers cheap/mini local models instead of the most expensive ones
- **Remote pricing fetch** enforces a 500-entry cap and JSON content-type check to bound memory
- **Workspace name cache** is now size-bounded (max 500 entries)

### Features
- **Export command** (`Copilot Cost Tracker: Export Usage Data`) exports all turns to JSON or CSV
- **VS Code fork support**: automatically detects Insiders, Cursor, Windsurf, and Portable Mode, with a `userDataPath` override
- **New settings**: `currency`, `exchangeRate`, `userDataPath`, `alertWindowHours`, `dashboardSessionLimit`, `weekStartDay`
- **Configurable alert window** replaces the hardcoded 24-hour lookback
- **Sidebar** now updates in place via `postMessage` instead of rebuilding its HTML, eliminating flicker and scroll-position loss

### Internal
- Added real WAL integration tests for committed-only snapshots, checkpoint races, resets, checksum failures, source-file preservation, and watcher latency, plus a reproducible traces-ingestion measurement script
- Alert threshold constants consolidated into `src/insights/alertThresholds.ts`
- Removed the deprecated, unused `pollIntervalMin` config field

## [0.6.6] - 2026-10-09

### Security

- Updated vulnerable transitive dependencies, including `brace-expansion`, `fast-uri`, `js-yaml`, `linkify-it`, `postcss`, `undici`, and `source-map-js`.
- Upgraded `@vscode/vsce` to 4.0.0, removing the vulnerable `secretlint`/`globby`/`braces` dependency chain.
- Updated `vitest` and `@vitest/coverage-v8` together to the patched 4.1.11 release.

### Changed

- Updated `sql.js` from 1.14.1 to 1.14.2.
- Refreshed Svelte, Vite, esbuild, ESLint, TypeScript-ESLint, Lucide, and Node.js type dependencies.
- CI now tests Node.js 22 and 24. Building and packaging require Node.js 22 or newer; the minimum supported VS Code version remains 1.85.0.
- Updated `actions/setup-node` to v7 in the CI and release workflows.

## [0.6.5] - 2026-06-22

### Security
- Resolved CodeQL "file-system race condition" (TOCTOU) findings: the traces-DB and session-title caches now stat and read through a single file descriptor (`open` → `fstat` → `read`), and git-config discovery reads `.git` directly (handling the directory case via `EISDIR`) instead of checking then reading the same path
- CI now runs `npm audit --audit-level=high` after install, failing the build on any high/critical dependency vulnerability

## [0.6.4] - 2026-06-22

### Fixed
- Context-size **pop-up notifications** now match their thresholds: the 20K warning no longer mislabels a moderate session as "extremely heavy", and the 40K/80K messages are scaled to their actual severity (previously every threshold fell through to the same alarming text)

### Changed
- **Efficiency alerts & playbook** are now driven by the single shared insight engine, so the Dashboard and Efficiency tabs surface the full set of signals — including micro-turn bloat, large uncached pastes, and premium-model misallocation — that were previously computed but never displayed
- **Playbook** status now uses semantic colored indicators instead of emoji, consistent with the rest of the UI
- **Efficiency Grade & Optimization Score** were recalibrated for realistic agentic usage: Input:Output now uses *net (non-cached)* input so cached context no longer unfairly tanks the score, the cache band only rewards the upper range where it actually varies, and the A–F bands span achievable values (a clean session can now reach an A instead of capping at C). Both readouts share one scoring function so they always agree.

## [0.6.3] - 2026-06-22

### Fixed
- Daily charts (cost, tokens, agent breakdown) now bucket turns by **local calendar day** instead of UTC, so activity near midnight no longer lands on the wrong day

### Changed
- **Cache Hit** columns in the Activity and Models tables now show the value plainly and only highlight unusually low hit rates (< 40%); the always-full proportional bar was removed since agentic cache hit rates are uniformly high and the bar added no signal

### Performance
- The Copilot traces database is now kept open and re-read only when the file changes (mtime/size), eliminating repeated full-file reads on every dashboard refresh and watcher-driven ingest
- Session title files (`title-*.jsonl`) are cached per file and re-parsed only when they change, instead of being re-read on every ingest poll

## [0.6.2] - 2026-06-22

### Changed
- Status bar now shows the **active chat** cost (the conversation you're in) instead of a "since activation" delta, so it persists when you reopen a chat instead of resetting to $0.00
- Status bar cost and context are scoped to the current window's git repo, so multiple windows on different repos stay independent
- Active chat context no longer disappears after 2 minutes of inactivity; it's kept and marked idle in the tooltip
- Tooltip now breaks down Active chat, Period (global budget), and Since window opened (this repo)

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
