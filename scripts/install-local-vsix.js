const { existsSync } = require("node:fs");
const { join } = require("node:path");
const { spawnSync } = require("node:child_process");

const pkg = require("../package.json");

const vsixName = `${pkg.name}-${pkg.version}.vsix`;
const vsixPath = join(__dirname, "..", vsixName);

if (!existsSync(vsixPath)) {
  console.error(`VSIX not found: ${vsixPath}`);
  process.exit(1);
}

const result = spawnSync("code", ["--install-extension", vsixPath, "--force"], {
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (result.error) {
  console.error(result.error.message);
  process.exit(result.status ?? 1);
}

process.exit(result.status ?? 0);