#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const os = require("os");
const readline = require("readline");
const { calculateCost } = require("../shared/pricing");
const { readLog, summarize } = require("../compressor/stats");

function getClaudeDir() {
  return path.join(os.homedir(), ".claude");
}

function normalizePath(p) {
  if (!p) return p;
  // Normalize Windows drive letter to uppercase and use consistent separators
  return p.replace(/^([a-z]):/, (_, d) => d.toUpperCase() + ":");
}

async function parseTranscriptFile(filePath) {
  const records = [];
  const fileStream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let projectCwd = null;

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      // Capture the project working directory from any entry that has cwd
      if (!projectCwd && entry.cwd) {
        projectCwd = entry.cwd;
      }
      if (entry.type === "assistant" && entry.message?.usage) {
        const usage = entry.message.usage;
        records.push({
          timestamp: entry.timestamp,
          sessionId: entry.sessionId,
          model: entry.message.model || "unknown",
          project: normalizePath(entry.cwd || projectCwd) || "unknown",
          inputTokens: usage.input_tokens || 0,
          outputTokens: usage.output_tokens || 0,
          cacheReadTokens: usage.cache_read_input_tokens || 0,
          cacheCreationTokens: usage.cache_creation_input_tokens || 0,
          cost: calculateCost(usage, entry.message.model),
        });
      }
    } catch {
      // Skip malformed lines
    }
  }
  return records;
}

async function findTranscriptFiles() {
  const projectsDir = path.join(getClaudeDir(), "projects");
  const files = [];

  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Skip memory directories
        if (entry.name === "memory") continue;
        walk(fullPath);
      } else if (entry.name.endsWith(".jsonl")) {
        files.push(fullPath);
      }
    }
  }

  walk(projectsDir);
  return files;
}

function filterByDate(records, startDate, endDate) {
  return records.filter((r) => {
    const d = new Date(r.timestamp);
    return d >= startDate && d <= endDate;
  });
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfWeek(date) {
  const d = startOfDay(date);
  d.setDate(d.getDate() - d.getDay()); // Sunday
  return d;
}

function startOfMonth(date) {
  const d = startOfDay(date);
  d.setDate(1);
  return d;
}

function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function formatNumber(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toString();
}

function formatCost(cost) {
  return "$" + cost.toFixed(4);
}

function aggregateRecords(records) {
  const totals = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    cost: 0,
    apiCalls: records.length,
    sessions: new Set(),
  };

  for (const r of records) {
    totals.inputTokens += r.inputTokens;
    totals.outputTokens += r.outputTokens;
    totals.cacheReadTokens += r.cacheReadTokens;
    totals.cacheCreationTokens += r.cacheCreationTokens;
    totals.cost += r.cost;
    totals.sessions.add(r.sessionId);
  }

  return totals;
}

function printSummary(label, records) {
  if (records.length === 0) {
    console.log(`\n  ${label}: No data found.\n`);
    return;
  }

  const totals = aggregateRecords(records);
  const totalTokens =
    totals.inputTokens +
    totals.outputTokens +
    totals.cacheReadTokens +
    totals.cacheCreationTokens;

  console.log(`\n  ${label}`);
  console.log("  " + "─".repeat(50));
  console.log(`  API Calls:        ${totals.apiCalls.toLocaleString()}`);
  console.log(`  Sessions:         ${totals.sessions.size.toLocaleString()}`);
  console.log(`  Total Tokens:     ${formatNumber(totalTokens)}`);
  console.log(`    Input:          ${formatNumber(totals.inputTokens)}`);
  console.log(`    Output:         ${formatNumber(totals.outputTokens)}`);
  console.log(`    Cache Read:     ${formatNumber(totals.cacheReadTokens)}`);
  console.log(`    Cache Create:   ${formatNumber(totals.cacheCreationTokens)}`);
  console.log(`  Estimated Cost:   ${formatCost(totals.cost)}`);
  console.log();
}

function printByGroup(records, groupBy) {
  const groups = {};
  for (const r of records) {
    let key;
    if (groupBy === "project") {
      key = r.project;
    } else if (groupBy === "model") {
      key = r.model;
    } else if (groupBy === "date") {
      key = new Date(r.timestamp).toLocaleDateString("en-CA"); // YYYY-MM-DD
    }
    if (!groups[key]) groups[key] = [];
    groups[key].push(r);
  }

  const sorted = Object.entries(groups).sort((a, b) => {
    const costA = a[1].reduce((s, r) => s + r.cost, 0);
    const costB = b[1].reduce((s, r) => s + r.cost, 0);
    return costB - costA;
  });

  console.log();
  console.log(
    "  " +
      "Name".padEnd(45) +
      "Calls".padStart(8) +
      "Tokens".padStart(10) +
      "Cost".padStart(12)
  );
  console.log("  " + "─".repeat(75));

  for (const [key, recs] of sorted) {
    const totals = aggregateRecords(recs);
    const totalTokens =
      totals.inputTokens +
      totals.outputTokens +
      totals.cacheReadTokens +
      totals.cacheCreationTokens;

    const displayName =
      key.length > 44 ? "..." + key.slice(key.length - 41) : key;
    console.log(
      "  " +
        displayName.padEnd(45) +
        totals.apiCalls.toLocaleString().padStart(8) +
        formatNumber(totalTokens).padStart(10) +
        formatCost(totals.cost).padStart(12)
    );
  }

  const grandTotals = aggregateRecords(records);
  const grandTotal =
    grandTotals.inputTokens +
    grandTotals.outputTokens +
    grandTotals.cacheReadTokens +
    grandTotals.cacheCreationTokens;

  console.log("  " + "─".repeat(75));
  console.log(
    "  " +
      "TOTAL".padEnd(45) +
      grandTotals.apiCalls.toLocaleString().padStart(8) +
      formatNumber(grandTotal).padStart(10) +
      formatCost(grandTotals.cost).padStart(12)
  );
  console.log();
}

function printCsv(records) {
  console.log(
    "timestamp,session_id,model,project,input_tokens,output_tokens,cache_read_tokens,cache_creation_tokens,cost_usd"
  );
  for (const r of records) {
    console.log(
      [
        r.timestamp,
        r.sessionId,
        r.model,
        `"${r.project}"`,
        r.inputTokens,
        r.outputTokens,
        r.cacheReadTokens,
        r.cacheCreationTokens,
        r.cost.toFixed(6),
      ].join(",")
    );
  }
}

function printDailyBreakdown(records) {
  console.log("\n  Daily Breakdown");
  console.log("  " + "─".repeat(75));
  printByGroup(records, "date");
}

function printHelp() {
  console.log(`
  Claude Token Tracker
  ====================

  Usage: node tracker.js [options]

  Time Filters:
    --today          Today's usage only
    --yesterday      Yesterday's usage only
    --week           This week (Sun-Sat)
    --month          This month
    --days N         Last N days
    --from YYYY-MM-DD --to YYYY-MM-DD   Custom date range

  Grouping:
    --by-project     Group by project
    --by-model       Group by model
    --daily          Day-by-day breakdown

  Output:
    --csv            Output as CSV (for spreadsheets)
    --json           Output as JSON

  Examples:
    node tracker.js --today
    node tracker.js --week --by-project
    node tracker.js --days 7 --daily
    node tracker.js --month --csv
    node tracker.js --from 2026-03-01 --to 2026-03-25 --by-project
`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  console.log("\n  Scanning Claude Code transcripts...");

  const files = await findTranscriptFiles();
  if (files.length === 0) {
    console.log("  No transcript files found in ~/.claude/projects/");
    return;
  }

  let allRecords = [];
  for (const file of files) {
    const records = await parseTranscriptFile(file);
    allRecords.push(...records);
  }

  allRecords.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  if (allRecords.length === 0) {
    console.log("  No usage data found in transcripts.");
    return;
  }

  console.log(
    `  Found ${allRecords.length.toLocaleString()} API calls across ${files.length} transcript files.`
  );

  // Apply time filters
  const now = new Date();
  let filtered = allRecords;
  let label = "All Time";

  if (args.includes("--today")) {
    filtered = filterByDate(allRecords, startOfDay(now), endOfDay(now));
    label = `Today (${now.toLocaleDateString("en-CA")})`;
  } else if (args.includes("--yesterday")) {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    filtered = filterByDate(
      allRecords,
      startOfDay(yesterday),
      endOfDay(yesterday)
    );
    label = `Yesterday (${yesterday.toLocaleDateString("en-CA")})`;
  } else if (args.includes("--week")) {
    filtered = filterByDate(allRecords, startOfWeek(now), endOfDay(now));
    label = `This Week (from ${startOfWeek(now).toLocaleDateString("en-CA")})`;
  } else if (args.includes("--month")) {
    filtered = filterByDate(allRecords, startOfMonth(now), endOfDay(now));
    label = `This Month (${now.toLocaleDateString("en-CA", { month: "long", year: "numeric" })})`;
  } else if (args.includes("--days")) {
    const idx = args.indexOf("--days");
    const n = parseInt(args[idx + 1], 10) || 7;
    const start = new Date(now);
    start.setDate(start.getDate() - n);
    filtered = filterByDate(allRecords, startOfDay(start), endOfDay(now));
    label = `Last ${n} Days`;
  } else if (args.includes("--from")) {
    const fromIdx = args.indexOf("--from");
    const fromDate = new Date(args[fromIdx + 1]);
    let toDate = endOfDay(now);
    if (args.includes("--to")) {
      const toIdx = args.indexOf("--to");
      toDate = endOfDay(new Date(args[toIdx + 1]));
    }
    filtered = filterByDate(allRecords, startOfDay(fromDate), toDate);
    label = `${fromDate.toLocaleDateString("en-CA")} to ${toDate.toLocaleDateString("en-CA")}`;
  }

  // Output format
  if (args.includes("--csv")) {
    printCsv(filtered);
    return;
  }

  if (args.includes("--json")) {
    console.log(JSON.stringify(filtered, null, 2));
    return;
  }

  // Display
  printSummary(label, filtered);

  if (args.includes("--by-project")) {
    console.log("  By Project:");
    printByGroup(filtered, "project");
  }

  if (args.includes("--by-model")) {
    console.log("  By Model:");
    printByGroup(filtered, "model");
  }

  if (args.includes("--daily")) {
    printDailyBreakdown(filtered);
  }

  // If no grouping specified and not just a time filter, show a quick project + model summary
  if (
    !args.includes("--by-project") &&
    !args.includes("--by-model") &&
    !args.includes("--daily") &&
    !args.includes("--csv") &&
    !args.includes("--json")
  ) {
    console.log("  Tip: Use --by-project, --by-model, or --daily for breakdowns.");
    console.log("  Run with --help for all options.\n");
  }

  // Show compression savings if available
  printCompressSavings();
}

function printCompressSavings() {
  try {
    const entries = readLog();
    if (entries.length === 0) return;
    const summary = summarize(entries);
    if (!summary) return;

    console.log("  Compression Savings");
    console.log("  " + "─".repeat(50));
    console.log(`  Total compressions: ${summary.totalRuns.toLocaleString()}`);
    console.log(`  Tokens saved:       ${formatNumber(summary.totalSavedTokens)} (${summary.overallSavingsPercent}% reduction)`);
    console.log(`  Original tokens:    ${formatNumber(summary.totalOriginalTokens)}`);
    console.log(`  Compressed tokens:  ${formatNumber(summary.totalCompressedTokens)}`);

    if (summary.byCommand.length > 0) {
      console.log();
      console.log(
        "  " +
          "Command".padEnd(20) +
          "Runs".padStart(8) +
          "Saved".padStart(12)
      );
      console.log("  " + "─".repeat(40));
      for (const c of summary.byCommand.slice(0, 5)) {
        console.log(
          "  " +
            c.command.padEnd(20) +
            c.runs.toLocaleString().padStart(8) +
            formatNumber(c.savedTokens).padStart(12)
        );
      }
    }
    console.log();
  } catch {
    // Silently skip if compress stats unavailable
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
