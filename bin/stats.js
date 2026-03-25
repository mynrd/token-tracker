#!/usr/bin/env node

/**
 * View compression stats — what was optimized and how much was saved.
 *
 * Usage:
 *   node bin/stats.js              # summary of all time
 *   node bin/stats.js --today      # today only
 *   node bin/stats.js --days 7     # last 7 days
 *   node bin/stats.js --tail 20    # last 20 compression runs
 *   node bin/stats.js --raw        # dump raw JSONL entries as JSON
 *   node bin/stats.js --clear      # clear the log
 */

const { readLog, summarize, getLogPath } = require("../src/compressor/stats");
const fs = require("fs");

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
  Token Tracker — Compression Stats
  ==================================

  Usage:
    node bin/stats.js              Show all-time summary
    node bin/stats.js --today      Today's compressions only
    node bin/stats.js --days N     Last N days
    node bin/stats.js --tail N     Last N individual runs (default 10)
    node bin/stats.js --raw        Raw JSON output
    node bin/stats.js --clear      Clear the log file
`);
  process.exit(0);
}

if (args.includes("--clear")) {
  const logPath = getLogPath();
  if (fs.existsSync(logPath)) {
    const entries = readLog();
    fs.unlinkSync(logPath);
    console.log(`  Cleared ${entries.length} entries from ${logPath}`);
  } else {
    console.log("  No log file found.");
  }
  process.exit(0);
}

let entries = readLog();

if (entries.length === 0) {
  console.log("\n  No compression stats yet. Pipe some commands through the compressor first:");
  console.log("    git status | node bin/compress.js git status\n");
  process.exit(0);
}

// Time filters
if (args.includes("--today")) {
  const today = new Date().toISOString().slice(0, 10);
  entries = entries.filter((e) => e.timestamp.startsWith(today));
} else if (args.includes("--days")) {
  const idx = args.indexOf("--days");
  const n = parseInt(args[idx + 1], 10) || 7;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - n);
  entries = entries.filter((e) => new Date(e.timestamp) >= cutoff);
}

// Raw output
if (args.includes("--raw")) {
  console.log(JSON.stringify(entries, null, 2));
  process.exit(0);
}

// Tail mode — show last N individual runs
if (args.includes("--tail")) {
  const idx = args.indexOf("--tail");
  const n = parseInt(args[idx + 1], 10) || 10;
  const tail = entries.slice(-n);

  console.log(`\n  Last ${tail.length} compression runs:`);
  console.log("  " + "-".repeat(70));
  console.log(
    "  " +
    "Time".padEnd(22) +
    "Command".padEnd(22) +
    "Before".padStart(8) +
    "After".padStart(8) +
    "Saved".padStart(8) +
    "%".padStart(5)
  );
  console.log("  " + "-".repeat(70));

  for (const e of tail) {
    const time = e.timestamp.slice(11, 19);
    const date = e.timestamp.slice(0, 10);
    const cmd = (e.command || "unknown").slice(0, 20);
    console.log(
      "  " +
      `${date} ${time}`.padEnd(22) +
      cmd.padEnd(22) +
      `${e.original.tokens}`.padStart(8) +
      `${e.compressed.tokens}`.padStart(8) +
      `${e.saved.tokens}`.padStart(8) +
      `${e.savingsPercent}%`.padStart(5)
    );
  }
  console.log();
  process.exit(0);
}

// Summary mode (default)
const summary = summarize(entries);

function fmtTokens(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toString();
}

console.log(`\n  Compression Stats`);
console.log("  " + "=".repeat(50));
console.log(`  Total runs:           ${summary.totalRuns.toLocaleString()}`);
console.log(`  Original tokens:      ${fmtTokens(summary.totalOriginalTokens)}`);
console.log(`  Compressed tokens:    ${fmtTokens(summary.totalCompressedTokens)}`);
console.log(`  Tokens saved:         ${fmtTokens(summary.totalSavedTokens)}`);
console.log(`  Overall savings:      ${summary.overallSavingsPercent}%`);

if (summary.byCommand.length > 0) {
  console.log(`\n  By Command:`);
  console.log("  " + "-".repeat(50));
  console.log("  " + "Command".padEnd(20) + "Runs".padStart(8) + "Saved".padStart(12));
  console.log("  " + "-".repeat(50));
  for (const c of summary.byCommand) {
    console.log(
      "  " +
      c.command.padEnd(20) +
      c.runs.toLocaleString().padStart(8) +
      fmtTokens(c.savedTokens).padStart(12)
    );
  }
}

if (summary.byRule.length > 0) {
  console.log(`\n  By Rule:`);
  console.log("  " + "-".repeat(50));
  console.log("  " + "Rule".padEnd(20) + "Runs".padStart(8) + "Saved".padStart(12));
  console.log("  " + "-".repeat(50));
  for (const r of summary.byRule) {
    console.log(
      "  " +
      r.rule.padEnd(20) +
      r.runs.toLocaleString().padStart(8) +
      fmtTokens(r.savedTokens).padStart(12)
    );
  }
}

console.log(`\n  Log: ${getLogPath()}\n`);
