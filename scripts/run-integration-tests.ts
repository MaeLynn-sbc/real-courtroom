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

import { env } from "../lib/env";

const ROOT = join(__dirname, "..");
const IGNORED_DIRS = new Set(["node_modules", ".next", ".git"]);

// Deploy prep (BUILD-SPEC.md §0 process rule): every *.integration.ts
// script is destructive by design — each one creates fixture rows and
// deletes them (or anything matching its cleanup query) as part of its
// own test lifecycle. Unlike prisma/seed.ts's ALLOW_PROD_SEED, there is
// no legitimate reason to ever run this against a real database, so
// there's no override flag — just refuse. Guards the documented,
// scripted entry point (`npm run test:integration`); a developer
// directly invoking a single `npx tsx some.integration.ts` file is
// using their own local .env by choice, a different risk than a
// CI/CD pipeline or automation accidentally pointing this at production.
function assertNotProduction(): void {
  if (env.NODE_ENV === "production") {
    console.error(
      "Refusing to run integration tests: NODE_ENV=production. These scripts create and " +
        "delete real rows as part of their own cleanup — never point them at a production " +
        "database. If this really is a non-production database that happens to have " +
        "NODE_ENV=production set, fix the environment, not this check.",
    );
    process.exit(1);
  }
}

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
  assertNotProduction();

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
