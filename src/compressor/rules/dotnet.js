const { stripAnsi, collapseBlankLines, truncate, dedup } = require("../filters");

function matches(cmd) {
  return cmd.startsWith("dotnet ") || cmd.startsWith("msbuild");
}

function compress(text, cmd) {
  let lines = text.split("\n");
  lines = stripAnsi(lines);

  if (/^dotnet\s+(build|publish)/.test(cmd) || cmd.startsWith("msbuild")) return compressBuild(lines);
  if (/^dotnet\s+(test|vstest)/.test(cmd)) return compressTest(lines);
  if (/^dotnet\s+ef\s/.test(cmd)) return compressEf(lines);
  if (/^dotnet\s+(restore|add|remove|nuget)/.test(cmd)) return compressRestore(lines);
  if (/^dotnet\s+run/.test(cmd)) return compressRun(lines);
  if (/^dotnet\s+format/.test(cmd)) return compressFormat(lines);
  if (/^dotnet\s+watch/.test(cmd)) return compressWatch(lines);
  if (/^dotnet\s+(clean|list)/.test(cmd)) return compressCleanOrList(lines);

  // Generic dotnet compression
  lines = stripDotnetNoise(lines);
  lines = collapseBlankLines(lines);
  lines = truncate(lines, 60);
  return lines.join("\n");
}

function stripDotnetNoise(lines) {
  return lines.filter((l) => {
    const t = l.trim();
    return !t.startsWith("Microsoft (R) Build Engine") &&
      !t.startsWith("Copyright (C) Microsoft") &&
      !t.startsWith("  Determining projects to restore") &&
      !t.match(/^\s*Restore completed in/) &&
      !t.match(/^\s*\d+ Warning\(s\)\s*$/) &&
      !t.match(/^\s*0 Error\(s\)\s*$/) &&
      !t.match(/^\s*$/) &&
      !t.startsWith("Build started") &&
      !t.startsWith("The build succeeded") &&
      !t.startsWith("Time Elapsed");
  });
}

function compressBuild(lines) {
  const result = [];
  let succeeded = false;
  let errors = 0;
  let warnings = 0;
  const errorLines = [];

  for (const line of lines) {
    const t = line.trim();

    // Build succeeded/failed
    if (t.startsWith("Build succeeded")) succeeded = true;
    if (t.startsWith("Build FAILED")) succeeded = false;

    // Error/warning counts
    const errMatch = t.match(/(\d+) Error\(s\)/);
    if (errMatch) errors = parseInt(errMatch[1]);
    const warnMatch = t.match(/(\d+) Warning\(s\)/);
    if (warnMatch) warnings = parseInt(warnMatch[1]);

    // Capture actual error/warning messages (CS/MSB/NU/NETSDK/CA/IDE/BC codes)
    if (t.match(/:\s*(error|warning)\s+(CS|MSB|NU|NETSDK|CA|IDE|BC)\d+/i)) {
      errorLines.push(t);
    }

    // Project output lines
    if (t.match(/^\s*.*->\s+.*\.(dll|exe|nupkg)/)) {
      result.push(t);
    }
  }

  result.unshift(succeeded ? "build succeeded" : "BUILD FAILED");
  if (errors > 0) result.push(`errors: ${errors}`);
  if (warnings > 0) result.push(`warnings: ${warnings}`);
  result.push(...errorLines.slice(0, 20));

  return result.join("\n");
}

function compressTest(lines) {
  const result = [];
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let total = 0;
  const failedTests = [];

  for (const line of lines) {
    const t = line.trim();

    // dotnet test summary: "Passed!  - Failed: 0, Passed: 5, Skipped: 0, Total: 5"
    const summaryMatch = t.match(/(?:Passed|Failed)!\s*-\s*Failed:\s*(\d+),\s*Passed:\s*(\d+),\s*Skipped:\s*(\d+),\s*Total:\s*(\d+)/);
    if (summaryMatch) {
      failed = parseInt(summaryMatch[1]);
      passed = parseInt(summaryMatch[2]);
      skipped = parseInt(summaryMatch[3]);
      total = parseInt(summaryMatch[4]);
    }

    // Individual test pass/fail counts
    const totalMatch = t.match(/Total tests:\s*(\d+)/);
    if (totalMatch) total = parseInt(totalMatch[1]);
    const passMatch = t.match(/Passed:\s*(\d+)/);
    if (passMatch) passed = parseInt(passMatch[1]);
    const failMatch = t.match(/Failed:\s*(\d+)/);
    if (failMatch) failed = parseInt(failMatch[1]);

    // Failed test names
    if (t.startsWith("Failed ") || t.match(/^\s*X\s+/)) {
      failedTests.push(t);
    }

    // Error messages in test output
    if (t.match(/^\s*(Assert|Expected|Message)/i)) {
      failedTests.push("  " + t);
    }
  }

  if (total > 0 || passed > 0 || failed > 0) {
    result.push(`${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ""}, ${total} total`);
  }
  result.push(...failedTests.slice(0, 20));

  return result.length ? result.join("\n") : truncate(stripDotnetNoise(lines), 40).join("\n");
}

function compressEf(lines) {
  const result = [];
  const cleaned = stripDotnetNoise(lines);

  for (const line of cleaned) {
    const t = line.trim();
    if (!t) continue;

    // Migration names
    if (t.match(/^\d{14}_/)) {
      result.push(t);
      continue;
    }

    // Key EF messages
    if (t.match(/^(Done|Build started|Applying migration|Reverting migration|Creating|Dropping|Already exists|No migrations)/i)) {
      result.push(t);
    }
  }

  if (!result.length) {
    return truncate(cleaned.filter(l => l.trim()), 30).join("\n");
  }
  return result.join("\n");
}

function compressRestore(lines) {
  const result = [];

  for (const line of lines) {
    const t = line.trim();

    // Package added/removed
    if (t.match(/^(info|log)\s*:\s*(Adding|Removing|Installing|Restoring)/i) || t.match(/PackageReference.*was added/i)) {
      result.push(t);
    }

    // Restore summary
    if (t.match(/Restore completed|restored|up-to-date|No further actions/i)) {
      result.push(t);
    }
  }

  return result.length ? result.join("\n") : "restore completed";
}

function compressRun(lines) {
  // For dotnet run, keep output but strip build noise
  const cleaned = stripDotnetNoise(lines);
  const filtered = collapseBlankLines(cleaned);
  return truncate(filtered, 60).join("\n");
}

function compressFormat(lines) {
  // Keep formatted file paths and the completion/error lines
  const result = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (t.match(/Formatted\s+\d+|No files|Format complete/i)) {
      result.push(t);
    } else if (t.match(/\.(cs|vb|fs|csproj|vbproj|fsproj)['".\s]/i) || t.match(/\.(cs|vb|fs|csproj|vbproj|fsproj)$/i)) {
      result.push(t);
    } else if (t.match(/error|warning/i)) {
      result.push(t);
    }
  }
  return result.length ? result.join("\n") : "format completed";
}

function compressWatch(lines) {
  // Strip repeated build noise from dotnet watch, keep actual application output
  const result = [];
  for (const line of lines) {
    const t = line.trim();
    // Skip watch-specific noise
    if (t.match(/^watch\s*:/i)) continue;
    result.push(line);
  }
  const cleaned = stripDotnetNoise(result);
  return truncate(collapseBlankLines(cleaned), 60).join("\n");
}

function compressCleanOrList(lines) {
  const cleaned = stripDotnetNoise(lines);
  return truncate(collapseBlankLines(cleaned), 40).join("\n");
}

module.exports = { matches, compress };
