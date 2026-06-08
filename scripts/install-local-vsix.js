const { existsSync } = require("node:fs");
const { join } = require("node:path");
const { spawnSync } = require("node:child_process");

const pkg = require("../package.json");

const vsixName = `${pkg.name}-${pkg.version}.vsix`;
const vsixPath = join(__dirname, "..", vsixName);
const extensionId = `${pkg.publisher}.${pkg.name}`;

if (!existsSync(vsixPath)) {
  console.error(`VSIX not found: ${vsixPath}`);
  process.exit(1);
}

function runCode(args, { allowNonZero = false } = {}) {
  const result = spawnSync("code", args, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(result.status ?? 1);
  }

  if (!allowNonZero && result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  return result;
}

// Prevent VS Code CLI "restart before reinstall" by clearing old install state first.
runCode(["--uninstall-extension", extensionId], { allowNonZero: true });
const installResult = runCode(["--install-extension", `"${vsixPath}"`, "--force"], {
  allowNonZero: true,
});

process.exit(installResult.status ?? 0);