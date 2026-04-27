#!/usr/bin/env node

import { execSync } from "child_process";
import { cpSync, readdirSync, renameSync, rmSync } from "fs";
import { join } from "path";

// Clean output
rmSync("lib", { recursive: true, force: true });

// Build ESM with tsc
console.log("Building ESM...");
execSync("npx tsc -p tsconfig.build.json", { stdio: "inherit" });

// Build CJS with tsc (to lib-cjs temporarily)
console.log("Building CJS...");
execSync("npx tsc -p tsconfig.build.cjs.json --outDir lib-cjs", {
  stdio: "inherit",
});

// Rename .js to .cjs and .d.ts to .d.cts in lib-cjs recursively
function renameFiles(dir) {
  const files = readdirSync(dir, { withFileTypes: true });
  for (const file of files) {
    const fullPath = join(dir, file.name);
    if (file.isDirectory()) {
      renameFiles(fullPath);
    } else if (file.name.endsWith(".js")) {
      const newPath = fullPath.replace(/\.js$/, ".cjs");
      renameSync(fullPath, newPath);
    } else if (file.name.endsWith(".d.ts")) {
      const newPath = fullPath.replace(/\.d\.ts$/, ".d.cts");
      renameSync(fullPath, newPath);
    }
  }
}

renameFiles("lib-cjs");

// Merge lib-cjs into lib
cpSync("lib-cjs", "lib", { recursive: true });

// Cleanup
rmSync("lib-cjs", { recursive: true, force: true });

console.log("Build complete: ESM (.js, .d.ts) and CJS (.cjs, .d.cts) in lib/");
