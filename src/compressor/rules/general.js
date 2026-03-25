const { compress } = require("../filters");

// Catch-all rule — always matches
function matches() {
  return true;
}

function compressOutput(text, cmd) {
  // Apply command-specific tweaks before generic compression
  let maxLines = 80;

  // Build tools — tsc, eslint, prettier, cargo, go
  if (/^(tsc|eslint|prettier|cargo|go |rustc|gcc|make)/.test(cmd)) {
    maxLines = 60;
  }

  // Angular CLI
  if (/^ng\s/.test(cmd)) {
    maxLines = 60;
  }

  // Azure CLI
  if (/^az\s/.test(cmd)) {
    maxLines = 60;
  }

  // Terraform
  if (/^terraform\s/.test(cmd)) {
    maxLines = 50;
  }

  // Python / pip
  if (/^(pip|pip3|python|python3)\s/.test(cmd)) {
    maxLines = 60;
  }

  // SQL tools
  if (/^(sqlcmd|bcp|sqlpackage)/.test(cmd)) {
    maxLines = 50;
  }

  // kubectl/k8s
  if (/^(kubectl|k9s|helm)/.test(cmd)) {
    maxLines = 50;
  }

  // Test runners
  if (/^(jest|vitest|pytest|mocha|cargo test|go test)/.test(cmd)) {
    maxLines = 60;
  }

  // ls/find/tree — heavy output
  if (/^(ls|find|tree|dir)/.test(cmd)) {
    maxLines = 40;
  }

  // curl/wget — strip headers, keep body
  if (/^(curl|wget)/.test(cmd)) {
    return compressCurl(text);
  }

  return compress(text, { maxLines });
}

function compressCurl(text) {
  const lines = text.split("\n");
  const result = [];
  let inHeaders = false;

  for (const line of lines) {
    const t = line.trim();
    // Skip curl progress meter
    if (t.match(/^\s*%\s+Total/) || t.match(/^\s*\d+\s+\d+/) || t.match(/^[- ]+$/)) continue;
    // Skip HTTP headers (lines like "Header: Value")
    if (t.startsWith("HTTP/") || t.startsWith("> ")) {
      inHeaders = true;
      if (t.startsWith("HTTP/")) result.push(t); // keep status line
      continue;
    }
    if (t.startsWith("< ")) {
      // Response headers — skip most, keep content-type
      if (t.toLowerCase().includes("content-type")) result.push(t.slice(2));
      continue;
    }
    if (t === "" && inHeaders) {
      inHeaders = false;
      continue;
    }
    if (t.startsWith("* ")) continue; // curl verbose info
    result.push(line);
  }

  // If the body is JSON, try to keep it compact
  const body = result.join("\n").trim();
  if (body.length > 3000) {
    const truncated = body.slice(0, 2500) + "\n... (truncated, " + body.length + " chars total)";
    return truncated;
  }

  return body;
}

module.exports = { matches, compress: compressOutput };
