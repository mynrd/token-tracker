#!/usr/bin/env node

const { compressOutput } = require("../src/compressor");

let passed = 0;
let failed = 0;

function assert(name, actual, expected) {
  if (typeof expected === "function") {
    if (expected(actual)) {
      passed++;
    } else {
      failed++;
      console.log(`  FAIL: ${name}`);
      console.log(`    Got: ${JSON.stringify(actual).slice(0, 200)}`);
    }
  } else if (actual.includes(expected)) {
    passed++;
  } else {
    failed++;
    console.log(`  FAIL: ${name}`);
    console.log(`    Expected to include: ${expected}`);
    console.log(`    Got: ${actual.slice(0, 200)}`);
  }
}

// --- Git Status ---
const gitStatusInput = `On branch main
Your branch is up to date with 'origin/main'.

Changes not staged for commit:
  (use "git add <file>..." to update what will be committed)
  (use "git restore <file>..." to discard changes in working directory)
\tmodified:   src/auth.js
\tmodified:   src/utils.js

Untracked files:
  (use "git add <file>..." to include in what will be committed)
\tnew-file.txt
\tanother.txt

no changes added to commit (use "git add" and/or "git commit -a")`;

const statusResult = compressOutput(gitStatusInput, "git status");
assert("git status: has branch", statusResult, "branch: main");
assert("git status: has modified files", statusResult, "modified");
assert("git status: strips hints", statusResult, (r) => !r.includes('use "git add'));
assert("git status: is shorter", statusResult, (r) => r.length < gitStatusInput.length * 0.7);

// --- Git Log ---
const gitLogInput = `commit abc123def456789012345678901234567890
Author: John Doe <john@example.com>
Date:   Mon Mar 24 2026 10:00:00

    Fix authentication bug in login flow

commit def456abc789012345678901234567890123
Author: Jane Smith <jane@example.com>
Date:   Sun Mar 23 2026 09:00:00

    Add user profile page`;

const logResult = compressOutput(gitLogInput, "git log");
assert("git log: has commit hash", logResult, "abc123def45");
assert("git log: has message", logResult, "Fix authentication bug");
assert("git log: strips author/date lines", logResult, (r) => !r.includes("Author:"));

// --- NPM Install ---
const npmInstallInput = `npm warn deprecated inflight@1.0.6: This module is not supported
npm warn deprecated glob@7.2.3: Glob versions prior to v9 are no longer supported
npm warn deprecated @humanwhocodes/config-array@0.13.0: Use @eslint/config-array instead

added 487 packages, and audited 488 packages in 12s

98 packages are looking for funding
  run \`npm fund\` for details

found 0 vulnerabilities`;

const installResult = compressOutput(npmInstallInput, "npm install");
assert("npm install: has package count", installResult, "added 487 packages");
assert("npm install: strips warnings", installResult, (r) => !r.includes("npm warn"));
assert("npm install: is shorter", installResult, (r) => r.length < npmInstallInput.length * 0.5);

// --- NPM Test ---
const npmTestInput = `> jest --verbose

PASS src/utils.test.js (0.8s)
  ✓ formats date (3ms)
  ✓ parses input (2ms)
  ✓ validates email (1ms)
FAIL src/auth.test.js (1.2s)
  ✕ validates token (15ms)
    Expected: true
    Received: false

Tests: 1 failed, 3 passed, 4 total
Time:  2.1s`;

const testResult = compressOutput(npmTestInput, "npm test");
assert("npm test: has summary", testResult, "3 passed");
assert("npm test: has failure", testResult, "FAIL");
assert("npm test: has expected/received", testResult, "Expected");

// --- Generic compression ---
const ansiInput = "\x1B[31mERROR\x1B[0m: something broke\n\x1B[32mOK\x1B[0m: something worked";
const ansiResult = compressOutput(ansiInput, "some-command");
assert("generic: strips ANSI", ansiResult, (r) => !r.includes("\x1B["));
assert("generic: preserves content", ansiResult, "ERROR: something broke");

// --- Dedup ---
const dedupInput = Array(20).fill("processing chunk...").join("\n");
const dedupResult = compressOutput(dedupInput, "some-command");
assert("dedup: collapses repeated lines", dedupResult, "[x20]");
assert("dedup: is much shorter", dedupResult, (r) => r.length < dedupInput.length * 0.3);

// --- Truncation ---
const longInput = Array.from({ length: 200 }, (_, i) => `line ${i + 1}: content here`).join("\n");
const longResult = compressOutput(longInput, "some-command");
assert("truncation: caps output", longResult, (r) => r.split("\n").length <= 82);
assert("truncation: shows omitted count", longResult, "lines omitted");

// --- Results ---
console.log(`\n  Compressor Tests: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
