/**
 * Main compressor entry point.
 * Detects the command and applies command-specific + generic compression.
 * Logs compression stats to ~/.claude/token-tracker/compress-log.jsonl
 */

const { compress } = require("./filters");
const gitRules = require("./rules/git");
const npmRules = require("./rules/npm");
const dockerRules = require("./rules/docker");
const dotnetRules = require("./rules/dotnet");
const generalRules = require("./rules/general");
const { buildStats, logStats } = require("./stats");

const commandRules = [
  { name: "git", ...gitRules },
  { name: "npm", ...npmRules },
  { name: "docker", ...dockerRules },
  { name: "dotnet", ...dotnetRules },
  { name: "general", ...generalRules },
];

function compressOutput(text, command = "", options = {}) {
  const cmd = command.toLowerCase().trim();
  let result;
  let ruleName = "generic";

  // Find the first matching rule set
  for (const rules of commandRules) {
    if (rules.matches(cmd)) {
      result = rules.compress(text, cmd);
      ruleName = rules.name;
      break;
    }
  }

  // Fallback to generic compression
  if (result === undefined) {
    result = compress(text);
  }

  // Log stats unless disabled
  if (options.log !== false) {
    const stats = buildStats(text, result, command, ruleName);
    logStats(stats);
  }

  return result;
}

module.exports = { compressOutput };
