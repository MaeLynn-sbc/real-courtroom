/**
 * Runs every *.integration.ts script in the repo in sequence (not
 * parallel — several of them share fixture dates/cleanup and shouldn't
 * race each other) and fails loudly if any of them exits non-zero. This
 * is what `npm run test:integration` actually invokes, so a new
 * integration test just needs to be named *.integration.ts to be picked
 * up automatically — nobody has to remember to wire it in by hand.
 */
import "dotenv/config";

import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
const IGNORED_DIRS = new Set(["node_modules", ".next", ".git"]);

function findIntegrationTests(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (IGNORED_DIRS.has(entry)) {
      continue;
    }
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...findIntegrationTests(fullPath));
    } else if (entry.endsWith(".integration.ts")) {
      results.push(fullPath);
    }
  }
  return results;
}

function main(): void {
  const tests = findIntegrationTests(ROOT).sort();

  if (tests.length === 0) {
    console.log("No *.integration.ts files found.");
    return;
  }

  console.log(`Running ${tests.length} integration test file(s):\n${tests.map((t) => `  - ${t.replace(ROOT + "/", "")}`).join("\n")}\n`);

  for (const test of tests) {
    console.log(`\n=== ${test.replace(ROOT + "/", "")} ===`);
    execFileSync("npx", ["tsx", test], { stdio: "inherit", cwd: ROOT });
  }

  console.log(`\nAll ${tests.length} integration test file(s) passed.`);
}

main();
