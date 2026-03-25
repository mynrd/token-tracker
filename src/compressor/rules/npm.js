const { stripAnsi, collapseBlankLines, truncate, dedup } = require("../filters");

function matches(cmd) {
  return cmd.startsWith("npm ") || cmd.startsWith("yarn ") ||
    cmd.startsWith("pnpm ") || cmd.startsWith("npx ");
}

function compress(text, cmd) {
  let lines = text.split("\n");
  lines = stripAnsi(lines);

  if (/^(npm|yarn|pnpm)\s+(install|add|ci)/.test(cmd)) return compressInstall(lines);
  if (/^(npm|yarn|pnpm)\s+(test|run\s+test)/.test(cmd)) return compressTest(lines);
  if (/^(npm|yarn|pnpm)\s+(run\s+build|build)/.test(cmd)) return compressBuild(lines);

  // Generic npm compression
  lines = stripNpmNoise(lines);
  lines = collapseBlankLines(lines);
  lines = truncate(lines, 60);
  return lines.join("\n");
}

function stripNpmNoise(lines) {
  return lines.filter((l) => {
    const t = l.trim();
    return !t.startsWith("npm warn") &&
      !t.startsWith("npm notice") &&
      !t.startsWith("npm WARN") &&
      !t.match(/^\s*⸨/) &&
      !t.match(/^[\s]*[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/) &&
      !t.match(/^\s*\d+%\s*[|█▓▒░#=\->]+/);
  });
}

function compressInstall(lines) {
  const result = [];
  let added = 0;
  let removed = 0;
  let audited = 0;
  let vulns = null;
  let time = null;

  for (const line of lines) {
    const t = line.trim();
    const addMatch = t.match(/added (\d+) packages?/);
    if (addMatch) added = parseInt(addMatch[1]);
    const rmMatch = t.match(/removed (\d+) packages?/);
    if (rmMatch) removed = parseInt(rmMatch[1]);
    const auditMatch = t.match(/audited (\d+) packages?/);
    if (auditMatch) audited = parseInt(auditMatch[1]);
    const vulnMatch = t.match(/found (\d+ .+vulnerabilit\w+)/);
    if (vulnMatch) vulns = vulnMatch[1];
    const timeMatch = t.match(/in (\d+[.\d]*\s*[ms]+)/);
    if (timeMatch) time = timeMatch[1];
    if (t.startsWith("up to date")) {
      result.push("up to date");
    }
  }

  if (added) result.push(`added ${added} packages`);
  if (removed) result.push(`removed ${removed} packages`);
  if (audited) result.push(`audited ${audited} packages`);
  if (time) result.push(`time: ${time}`);
  if (vulns) result.push(`vulnerabilities: ${vulns}`);

  return result.length ? result.join(", ") : stripNpmNoise(lines).join("\n");
}

function compressTest(lines) {
  const result = [];
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  const failures = [];

  for (const line of lines) {
    const t = line.trim();

    // Jest-style summary
    const testMatch = t.match(/Tests:\s+(?:(\d+) failed,?\s*)?(?:(\d+) skipped,?\s*)?(?:(\d+) passed,?\s*)?(\d+) total/);
    if (testMatch) {
      failed = parseInt(testMatch[1] || 0);
      skipped = parseInt(testMatch[2] || 0);
      passed = parseInt(testMatch[3] || 0);
    }

    // PASS/FAIL lines
    if (t.startsWith("FAIL ")) result.push(t);

    // Jest failure details - capture expect/received
    if (t.startsWith("Expected:") || t.startsWith("Received:") || t.startsWith("expect(")) {
      failures.push("  " + t);
    }

    // Error location
    if (t.match(/at .+:\d+:\d+/) && failures.length > 0) {
      failures.push("  " + t);
    }

    // Vitest/mocha counts
    const passMatch = t.match(/(\d+) passing/);
    if (passMatch) passed = parseInt(passMatch[1]);
    const failMatch = t.match(/(\d+) failing/);
    if (failMatch) failed = parseInt(failMatch[1]);
    const skipMatch = t.match(/(\d+) pending|(\d+) skipped/);
    if (skipMatch) skipped = parseInt(skipMatch[1] || skipMatch[2]);
  }

  if (passed || failed || skipped) {
    result.unshift(`${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ""}`);
  }
  result.push(...failures.slice(0, 20));

  return result.length ? result.join("\n") : truncate(stripNpmNoise(lines), 40).join("\n");
}

function compressBuild(lines) {
  const cleaned = stripNpmNoise(lines);
  const result = [];
  let hasError = false;

  for (const line of cleaned) {
    const t = line.trim();
    // Keep error/warning lines and final output lines
    if (t.toLowerCase().includes("error") || t.toLowerCase().includes("warning")) {
      result.push(t);
      hasError = true;
    }
    // Keep build output summary lines
    if (t.match(/built|compiled|bundled|created|output|size|gzip/i)) {
      result.push(t);
    }
  }

  if (!hasError && result.length === 0) {
    result.push("build completed successfully");
  }

  return truncate(result, 40).join("\n");
}

module.exports = { matches, compress };
