const { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } = require("node:fs");
const { join } = require("node:path");

const distDir = join(__dirname, "..", "dist");
if (!existsSync(distDir)) {
  mkdirSync(distDir, { recursive: true });
}

copyFileSync(
  join(__dirname, "..", "node_modules", "sql.js", "dist", "sql-wasm.wasm"),
  join(distDir, "sql-wasm.wasm")
);

const webviewDir = join(distDir, "webview");
if (existsSync(webviewDir)) {
  const files = readdirSync(webviewDir);
  for (const file of files) {
    const src = join(webviewDir, file);
    if (statSync(src).isFile()) {
      console.log(`Webview asset: ${file}`);
    }
  }
}
