const { copyFileSync, existsSync, mkdirSync } = require("node:fs");
const { join } = require("node:path");

const distDir = join(__dirname, "..", "dist");
if (!existsSync(distDir)) {
    mkdirSync(distDir, { recursive: true });
}

copyFileSync(
    join(__dirname, "..", "node_modules", "sql.js", "dist", "sql-wasm.wasm"),
    join(distDir, "sql-wasm.wasm")
)