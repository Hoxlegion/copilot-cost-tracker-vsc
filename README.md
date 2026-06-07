# Copilot Cost Footer

Minimal GitHub Copilot cost tracking for VS Code. This variant keeps only the live footer indicator, refresh command, and budget warnings.

## What It Does

- Shows a live status bar footer with session spend, billing-period spend, and pacing.
- Warns when you cross configured budget thresholds.
- Reads Copilot telemetry from the traces database, with the existing pricing and model-filter logic intact.
- Lets you refresh the footer manually from the Command Palette or the footer quick pick.

## What It Removes

- Activity bar view
- Tree view
- Dashboard webview
- Prompt hover and code lens features
- Extra analytics and insight surfaces

## Requirement

Enable Copilot telemetry export so VS Code writes the usage data this extension reads:

```jsonc
"github.copilot.chat.otel.dbSpanExporter.enabled": true
```

## Quick Start

1. Enable the telemetry setting above.
2. Install the VSIX built from this branch.
3. Use Copilot normally and watch the footer update.
4. Click the footer to refresh data or open the extension settings.

## Main Settings

- `copilotCostTracker.budgetCredits`
- `copilotCostTracker.budgetWarningThresholds`
- `copilotCostTracker.billingCycleStartDay`
- `copilotCostTracker.showStatusBar`
- `copilotCostTracker.excludedModels`
- `copilotCostTracker.customModelRates`
- `copilotCostTracker.telemetrySource`
- `copilotCostTracker.logLevel`

## Development

```bash
npm install
npm test
npm run build
npm run package
```

The build now packages only the extension runtime and static assets needed by the footer-only variant.

## Project Structure

```text
src/
  extension.ts
  config.ts
  billing.ts
  database/
  parser/
  pricing/
  watcher/
  views/statusBar.ts
test/
  *.test.ts
```

## License

MIT License. See LICENSE.
