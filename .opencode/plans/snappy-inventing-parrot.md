# Plan: Replace Adaptive Polling with Event-Driven File Watching

## Problem
The status bar uses adaptive polling (5s-60s exponential backoff + 2s debounce), causing 7-62s delay after a Copilot turn completes. This feels broken to users who expect near-instant status bar updates.

## Architecture Change

**Before:**
```
PollingScheduler (5s-60s backoff) → ingester.ingest() → onDataChanged → debouncedRefresh (2s) → UI
```

**After:**
```
fs.watch(agent-traces.db) ──► unified debouncer (300ms) ──► ingester.ingest() ──► onDataChanged ──► immediate UI refresh
setInterval(30s fallback) ──┘
```

Both triggers route through the same trailing-edge debouncer. If `fs.watch` fires 10 times from SQLite writes, the debouncer collapses them into one ingestion. If `fs.watch` fails, the 30s heartbeat catches it.

## Files to Change

### 1. NEW: `src/watcher/fileWatcherStrategy.ts`
Create `FileWatcherStrategy` class replacing `PollingScheduler`:
- Constructor takes: `watchPath: string | null`, `callback: () => Promise<number>`, `options: { debounceMs, fallbackIntervalMs }`
- Sets up `fs.watch()` on the given file path (when non-null)
- Sets up `setInterval` fallback at `fallbackIntervalMs` (default 30000)
- Both triggers push into a shared trailing-edge debouncer (`clearTimeout`/`setTimeout` at `debounceMs`, default 300)
- Debouncer calls `callback()` (which will be `ingester.ingest()`)
- `updateWatchPath(path)` — re-target the watcher when source changes (e.g., auto-failover)
- `updateOptions(debounceMs, fallbackIntervalMs)` — runtime reconfiguration from settings
- `dispose()` — close watcher + clear interval + clear timer
- Guard against concurrent ingestion runs (if ingest is already running, skip)
- Handle `fs.watch` errors gracefully (log + continue with fallback poll only)

### 2. MODIFY: `src/watcher/tracesIngester.ts`
- Replace `PollingScheduler` field with `FileWatcherStrategy`
- Replace `startPolling(minMs, maxMs)` with `startWatching(watchPath, debounceMs, fallbackIntervalMs)`
- Replace `updatePollingBounds()` with `updateWatchOptions(debounceMs, fallbackIntervalMs)`
- Add `setWatchPath(path: string | null)` — called when `resolveSource()` switches between database/JSONL
  - Database mode: pass `reader.path` (the agent-traces.db path)
  - JSONL mode: pass `null` (rely on fallback poll only, since JSONL logs are scattered)
- Wire the watcher callback to call `this.ingest()` and use the return value for logging
- In `resolveSource()`: when `activeSource` changes, call `setWatchPath()` accordingly
- Keep `onDataChanged` EventEmitter as-is (downstream consumers unchanged)
- Keep `ingest()`, `fullIngest()`, `ingestFromTracesDb()`, `ingestFromJsonl()` unchanged

### 3. MODIFY: `src/extension.ts`
- Remove the `debouncedRefresh()` function and `refreshTimer` variable entirely
- Replace `ingester.onDidDataChange(() => debouncedRefresh())` with immediate refresh:
  ```typescript
  ingester.onDidDataChange(() => {
    treeProvider.refresh();
    contextTracker.update();
    statusBar.update();
    if (DashboardPanel.currentPanel) {
      void DashboardPanel.currentPanel.update();
    }
  });
  ```
- Replace `ingester.startPolling(min, max)` with:
  ```typescript
  const tracesDbPath = reader.exists() ? reader.path : null;
  ingester.startWatching(tracesDbPath, cfg.refreshDebounceMs, cfg.pollIntervalMax);
  ```
- In the `configManager.onDidChange` handler:
  - Replace `ingester.updatePollingBounds()` with `ingester.updateWatchOptions()`
  - Remove `refreshDebounceMs` local variable (no longer needed in extension.ts)

### 4. MODIFY: `src/config.ts`
- Change `refreshDebounceMs` default from `2000` to `300`
- Change `pollIntervalMax` default from `60000` to `30000` (now serves as fallback interval)
- Keep `pollIntervalMin` for backward compat but it's no longer used by the watcher
- Update the `ExtensionConfig` interface comments to reflect new semantics

### 5. MODIFY: `package.json`
- Update `copilotCostTracker.refreshDebounceMs` default to `300`, update description
- Update `copilotCostTracker.pollIntervalMax` default to `30000`, update description to "Fallback poll interval..."
- Update `copilotCostTracker.pollIntervalMin` description to note it's deprecated/unused

### 6. MODIFY: `src/watcher/index.ts`
- Add export for `FileWatcherStrategy`
- Keep `PollingScheduler` export for now (backward compat)

### 7. MODIFY: `test/ingester.test.ts`
- Update "Adaptive Polling" describe block → rename to "File Watcher Strategy"
- Replace interval-doubling tests with debouncer tests:
  - Test that rapid successive events collapse into one ingestion (debounce)
  - Test that fallback poll triggers ingestion when no file events arrive
  - Test that watcher path changes when source switches between database/JSONL
- Keep "Source Resolution", "Watermark Management", "Error Handling", "Data Flow" tests (still valid)

### 8. KEEP (unchanged): `src/watcher/pollingStrategy.ts`
- Keep the file and class intact for backward compatibility
- It's no longer used by `TracesIngester` but may be useful elsewhere or for rollback

### 9. KEEP (unchanged): `src/views/statusBar.ts`, `src/views/contextTracker.ts`
- No changes needed — they already respond to being told to `update()`
- The only change is HOW they get told (immediate vs debounced), which is handled in `extension.ts`

## Edge Cases
- **fs.watch not supported**: If `fs.watch()` throws, log a warning and fall back to poll-only mode
- **File doesn't exist yet**: If `agent-traces.db` doesn't exist on activation, start with `null` watch path. When `resolveSource()` detects the DB appears, call `setWatchPath()`
- **Concurrent ingestion guard**: If the debouncer fires while `ingest()` is still running from a previous trigger, skip (don't queue)
- **Rapid file changes**: SQLite writes may trigger multiple `fs.watch` events — the 300ms trailing debouncer collapses them
- **Extension disposal**: `FileWatcherStrategy.dispose()` must close the `fs.FSWatcher`, clear the `setInterval`, and clear any pending debounce timer

## Verification
1. Run `npm run lint` and `npm run typecheck` (or equivalent)
2. Run `npx vitest run` to execute all tests
3. Manual test: open VS Code with extension loaded, send a Copilot chat message, observe status bar updates within ~500ms of the response completing
