/**
 * ⚠ KNOWN ISSUE (logged 2026-08-18, deliberately not fixed): this harness
 * reports FILE counts, not case counts — its summary is "All N integration
 * test file(s) passed". Adding five cases to an EXISTING file moves no
 * counter at all, and adding one new file moves it by one regardless of
 * how many cases are inside. So the number is not evidence that cases ran;
 * only each script's own PASS lines are. Caused real confusion during the
 * payroll batches, where "5 tests added" showed up as 143 -> 144. A jest-
 * style per-case count would need each script to report its own case
 * total, which is its own change.
 *
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
import { prisma } from "../lib/prisma";
import { settingsService } from "../services/settings/settings.service";

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

// Guaranteed pre-flight reset — not a post-run cleanup. booking-
// prepayment-switch-off.integration.ts (sorts alphabetically before
// booking-prepayment-switch-on.integration.ts, so it always runs first
// within any single suite invocation) was observed reading the shared
// prepayment Setting row as a stale `true` on some back-to-back runs.
// Root cause: booking-prepayment-switch-on.integration.ts and
// coach-session-phase8-interaction.integration.ts — the only two files
// that ever flip this row true — each reset it in their own
// try/finally, which is correct against a normal JS-level throw but
// powerless if that PRIOR run's process was killed outright (OOM, a
// forced abort, a sandbox timeout) before the finally's own `await`
// could finish committing. No JS-level cleanup can ever be made
// crash-proof — only a guaranteed clean starting state can. So rather
// than trust whatever the previous run left behind, force this row
// back to its production default before a single test file runs.
// Every script in this suite is already destructive/self-cleaning by
// design (see assertNotProduction above), so resetting shared Setting
// state here is exactly as safe as everything else this harness does.
async function resetSharedMutableSettings(): Promise<void> {
  const owner = await prisma.user.findFirst({ where: { username: "owner" } });
  if (!owner) {
    // Fresh/unseeded DB — nothing to reset. Tests that need "owner" will
    // fail loudly on their own; that's a seeding problem, not this one.
    return;
  }
  await settingsService.setBookingRequirePrepayment(false, owner.id);
  console.log("Pre-flight: booking prepayment switch confirmed OFF before running any integration test.\n");
}

async function main(): Promise<void> {
  assertNotProduction();
  await resetSharedMutableSettings();

  const tests = findIntegrationTests(ROOT).sort();

  if (tests.length === 0) {
    console.log("No *.integration.ts files found.");
    process.exit(0);
  }

  console.log(`Running ${tests.length} integration test file(s):\n${tests.map((t) => `  - ${t.replace(ROOT + "/", "")}`).join("\n")}\n`);

  for (const test of tests) {
    console.log(`\n=== ${test.replace(ROOT + "/", "")} ===`);
    execFileSync("npx", ["tsx", test], { stdio: "inherit", cwd: ROOT });
  }

  console.log(`\nAll ${tests.length} integration test file(s) passed.`);
  // The pre-flight reset above opened this process's own Prisma
  // connection (findIntegrationTests never needed one before) — exit
  // explicitly rather than leaving that pool open waiting to be GC'd.
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
