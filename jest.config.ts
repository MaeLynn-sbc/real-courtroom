// Pinned BEFORE anything else in this file, and before jest forks its
// workers — they inherit this env, and Node fixes a process's zone on its
// first Date use, so it has to be set this early to take effect.
//
// Matches lib/env.ts's boot assertion (UTC+8, non-DST) and the Dockerfile's
// ENV TZ=Asia/Manila. Those guard the running app; neither guarded the test
// run, so date-only behaviour was previously verified in whatever zone the
// developer's machine happened to be in. Pinning here means a zone-dependent
// test can actually fail in CI instead of passing for the wrong reason
// locally — see compute-day.test.ts's "night differential is interpreted in
// Manila time".
//
// Deliberately overrides an inherited TZ rather than defaulting to it: the
// suite asserts Manila-local behaviour, so running it in another zone is a
// misconfiguration, not a scenario worth supporting.
process.env.TZ = "Asia/Manila";

import type { Config } from "jest";
import nextJest from "next/jest.js";

const createJestConfig = nextJest({
  dir: "./",
});

const config: Config = {
  testEnvironment: "jest-environment-jsdom",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
  testPathIgnorePatterns: ["<rootDir>/node_modules/", "<rootDir>/e2e/", "<rootDir>/.next/"],
};

export default createJestConfig(config);
