#!/usr/bin/env node

import { execSync } from "child_process";
import { rmSync, writeFileSync } from "fs";

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

console.log("Build complete: ESM in lib/esm/ (.js, .d.ts), CJS in lib/cjs/ (.js, .d.ts)");
