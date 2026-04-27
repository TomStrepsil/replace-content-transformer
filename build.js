#!/usr/bin/env node

import { execSync } from "child_process";
import { readdirSync, renameSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

// Clean output
rmSync("lib", { recursive: true, force: true });

// Build ESM with tsc
console.log("Building ESM...");
execSync("npx tsc -p tsconfig.build.json", { stdio: "inherit" });

// Build CJS with tsc
console.log("Building CJS...");
execSync("npx tsc -p tsconfig.build.cjs.json", { stdio: "inherit" });

// Mark lib/cjs as CommonJS so Node resolves .js files as CJS
writeFileSync("lib/cjs/package.json", JSON.stringify({ type: "commonjs" }, null, 2) + "\n");

// Rename .d.ts to .d.cts in lib/cjs recursively (for TypeScript CJS consumers)
function renameDts(dir) {
  const files = readdirSync(dir, { withFileTypes: true });
  for (const file of files) {
    const fullPath = join(dir, file.name);
    if (file.isDirectory()) {
      renameDts(fullPath);
    } else if (file.name.endsWith(".d.ts")) {
      renameSync(fullPath, fullPath.replace(/\.d\.ts$/, ".d.cts"));
    }
  }
}

renameDts("lib/cjs");

console.log("Build complete: ESM in lib/esm/ (.js, .d.ts), CJS in lib/cjs/ (.js, .d.cts)");
