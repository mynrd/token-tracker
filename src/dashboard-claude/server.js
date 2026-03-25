#!/usr/bin/env node

const http = require("http");
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const os = require("os");
const { calculateCost } = require("../shared/pricing");
const { readLog, summarize, summarizeDaily, summarizeByProject } = require("../compressor/stats");
const { DEFAULT_PRICING } = require("../shared/pricing");

const PORT = process.argv.includes("--port")
  ? parseInt(process.argv[process.argv.indexOf("--port") + 1], 10)
  : 3456;

function normalizePath(p) {
  if (!p) return p;
  return p.replace(/^([a-z]):/, (_, d) => d.toUpperCase() + ":");
}

function getClaudeDir() {
  return path.join(os.homedir(), ".claude");
}

function findTranscriptFiles() {
  const projectsDir = path.join(getClaudeDir(), "projects");
  const files = [];
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
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

async function parseTranscriptFile(filePath) {
  const records = [];
  const fileStream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
  let projectCwd = null;

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (!projectCwd && entry.cwd) projectCwd = entry.cwd;
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
      // skip
    }
  }
  return records;
}

let cachedData = null;
let cacheTime = 0;
const CACHE_TTL = 60_000; // 1 minute

async function getAllRecords() {
  if (cachedData && Date.now() - cacheTime < CACHE_TTL) return cachedData;
  const files = findTranscriptFiles();
  let all = [];
  for (const f of files) {
    all.push(...(await parseTranscriptFile(f)));
  }
  all.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  cachedData = all;
  cacheTime = Date.now();
  return all;
}

function filterByRange(records, from, to) {
  const start = from ? new Date(from) : new Date(0);
  const end = to ? new Date(to + "T23:59:59.999") : new Date();
  return records.filter((r) => {
    const d = new Date(r.timestamp);
    return d >= start && d <= end;
  });
}

function buildApiResponse(records) {
  // Summary
  const sessions = new Set();
  let totalInput = 0, totalOutput = 0, totalCacheRead = 0, totalCacheCreate = 0, totalCost = 0;
  for (const r of records) {
    sessions.add(r.sessionId);
    totalInput += r.inputTokens;
    totalOutput += r.outputTokens;
    totalCacheRead += r.cacheReadTokens;
    totalCacheCreate += r.cacheCreationTokens;
    totalCost += r.cost;
  }

  // Daily
  const daily = {};
  for (const r of records) {
    const day = new Date(r.timestamp).toISOString().slice(0, 10);
    if (!daily[day]) daily[day] = { date: day, apiCalls: 0, cost: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, sessions: new Set() };
    daily[day].apiCalls++;
    daily[day].cost += r.cost;
    daily[day].inputTokens += r.inputTokens;
    daily[day].outputTokens += r.outputTokens;
    daily[day].cacheReadTokens += r.cacheReadTokens;
    daily[day].cacheCreationTokens += r.cacheCreationTokens;
    daily[day].sessions.add(r.sessionId);
  }
  const dailyArr = Object.values(daily)
    .map((d) => ({ ...d, sessions: d.sessions.size }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // By project
  const projects = {};
  for (const r of records) {
    const p = r.project;
    if (!projects[p]) projects[p] = { project: p, apiCalls: 0, cost: 0, tokens: 0, sessions: new Set() };
    projects[p].apiCalls++;
    projects[p].cost += r.cost;
    projects[p].tokens += r.inputTokens + r.outputTokens + r.cacheReadTokens + r.cacheCreationTokens;
    projects[p].sessions.add(r.sessionId);
  }
  const projectsArr = Object.values(projects)
    .map((p) => ({ ...p, sessions: p.sessions.size }))
    .sort((a, b) => b.cost - a.cost);

  // By model
  const models = {};
  for (const r of records) {
    const m = r.model;
    if (!models[m]) models[m] = { model: m, apiCalls: 0, cost: 0, tokens: 0 };
    models[m].apiCalls++;
    models[m].cost += r.cost;
    models[m].tokens += r.inputTokens + r.outputTokens + r.cacheReadTokens + r.cacheCreationTokens;
  }
  const modelsArr = Object.values(models).sort((a, b) => b.cost - a.cost);

  // Hourly heatmap (hour of day vs day of week)
  const heatmap = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const r of records) {
    const d = new Date(r.timestamp);
    heatmap[d.getDay()][d.getHours()] += r.cost;
  }

  return {
    summary: {
      apiCalls: records.length,
      sessions: sessions.size,
      inputTokens: totalInput,
      outputTokens: totalOutput,
      cacheReadTokens: totalCacheRead,
      cacheCreationTokens: totalCacheCreate,
      totalCost: totalCost,
    },
    daily: dailyArr,
    projects: projectsArr,
    models: modelsArr,
    heatmap,
  };
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname === "/api/data") {
    const records = await getAllRecords();
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const filtered = from || to ? filterByRange(records, from, to) : records;
    const data = buildApiResponse(filtered);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
    return true;
  }
  if (url.pathname === "/api/compress-stats") {
    let entries = readLog();
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const projectFilter = url.searchParams.get("project");
    if (from || to) {
      const start = from ? new Date(from) : new Date(0);
      const end = to ? new Date(to + "T23:59:59.999") : new Date();
      entries = entries.filter((e) => {
        const d = new Date(e.timestamp);
        return d >= start && d <= end;
      });
    }
    if (projectFilter) {
      entries = entries.filter((e) => e.project === projectFilter);
    }
    const summary = summarize(entries);
    const dailySavings = summarizeDaily(entries);
    const byProject = summarizeByProject(entries);
    // Also include recent individual runs
    const recent = entries.slice(-50).reverse();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ summary, dailySavings, byProject, recent, totalEntries: entries.length, inputPricePerMTok: DEFAULT_PRICING.input }));
    return true;
  }
  if (url.pathname === "/api/refresh") {
    cachedData = null;
    const records = await getAllRecords();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ recordCount: records.length }));
    return true;
  }
  return false;
}

function serveDashboard(req, res) {
  const htmlPath = path.join(__dirname, "public", "index.html");
  if (fs.existsSync(htmlPath)) {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(fs.readFileSync(htmlPath, "utf8"));
  } else {
    res.writeHead(404);
    res.end("dashboard.html not found");
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith("/api/")) {
      const handled = await handleApi(req, res);
      if (handled) return;
    }
    serveDashboard(req, res);
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
  }
});

server.listen(PORT, () => {
  console.log(`\n  Claude Token Tracker Dashboard`);
  console.log(`  ==============================`);
  console.log(`  Running at: http://localhost:${PORT}`);
  console.log(`  Press Ctrl+C to stop.\n`);
});
