const fs = require("fs");
const path = require("path");
const os = require("os");

// Rough token estimate: ~4 chars per token for English text
const CHARS_PER_TOKEN = 4;

function estimateTokens(text) {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function getLogPath() {
  const dir = path.join(os.homedir(), ".claude", "token-tracker");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "compress-log.jsonl");
}

function buildStats(originalText, compressedText, command, ruleName) {
  const originalChars = originalText.length;
  const compressedChars = compressedText.length;
  const originalLines = originalText.split("\n").length;
  const compressedLines = compressedText.split("\n").length;
  const originalTokens = estimateTokens(originalText);
  const compressedTokens = estimateTokens(compressedText);
  const savedTokens = originalTokens - compressedTokens;
  const savingsPercent = originalTokens > 0
    ? Math.round((savedTokens / originalTokens) * 100)
    : 0;

  return {
    timestamp: new Date().toISOString(),
    command: command || "unknown",
    rule: ruleName || "generic",
    original: { chars: originalChars, lines: originalLines, tokens: originalTokens },
    compressed: { chars: compressedChars, lines: compressedLines, tokens: compressedTokens },
    saved: { chars: originalChars - compressedChars, lines: originalLines - compressedLines, tokens: savedTokens },
    savingsPercent,
  };
}

function logStats(stats) {
  try {
    const logPath = getLogPath();
    fs.appendFileSync(logPath, JSON.stringify(stats) + "\n");
  } catch {
    // Silently fail — logging should never break compression
  }
}

function readLog() {
  const logPath = getLogPath();
  if (!fs.existsSync(logPath)) return [];

  const lines = fs.readFileSync(logPath, "utf8").trim().split("\n");
  const entries = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // skip malformed
    }
  }
  return entries;
}

function summarize(entries) {
  if (!entries.length) return null;

  let totalOriginalTokens = 0;
  let totalCompressedTokens = 0;
  let totalSavedTokens = 0;
  const byCommand = {};
  const byRule = {};

  for (const e of entries) {
    totalOriginalTokens += e.original.tokens;
    totalCompressedTokens += e.compressed.tokens;
    totalSavedTokens += e.saved.tokens;

    // Group by base command (first word)
    const baseCmd = (e.command || "unknown").split(" ")[0];
    if (!byCommand[baseCmd]) byCommand[baseCmd] = { runs: 0, savedTokens: 0 };
    byCommand[baseCmd].runs++;
    byCommand[baseCmd].savedTokens += e.saved.tokens;

    // Group by rule
    const rule = e.rule || "generic";
    if (!byRule[rule]) byRule[rule] = { runs: 0, savedTokens: 0 };
    byRule[rule].runs++;
    byRule[rule].savedTokens += e.saved.tokens;
  }

  return {
    totalRuns: entries.length,
    totalOriginalTokens,
    totalCompressedTokens,
    totalSavedTokens,
    overallSavingsPercent: totalOriginalTokens > 0
      ? Math.round((totalSavedTokens / totalOriginalTokens) * 100)
      : 0,
    byCommand: Object.entries(byCommand)
      .sort((a, b) => b[1].savedTokens - a[1].savedTokens)
      .map(([cmd, data]) => ({ command: cmd, ...data })),
    byRule: Object.entries(byRule)
      .sort((a, b) => b[1].savedTokens - a[1].savedTokens)
      .map(([rule, data]) => ({ rule, ...data })),
  };
}

function summarizeDaily(entries) {
  if (!entries.length) return [];
  const byDay = {};
  for (const e of entries) {
    const day = new Date(e.timestamp).toISOString().slice(0, 10);
    if (!byDay[day]) byDay[day] = { date: day, savedTokens: 0, runs: 0 };
    byDay[day].savedTokens += e.saved.tokens;
    byDay[day].runs++;
  }
  return Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date));
}

module.exports = { estimateTokens, buildStats, logStats, readLog, summarize, summarizeDaily, getLogPath };
