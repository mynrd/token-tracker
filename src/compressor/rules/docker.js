const { stripAnsi, collapseBlankLines, truncate, dedup } = require("../filters");

function matches(cmd) {
  return cmd.startsWith("docker ") || cmd.startsWith("docker-compose ") ||
    cmd.startsWith("podman ");
}

function compress(text, cmd) {
  let lines = text.split("\n");
  lines = stripAnsi(lines);

  if (/docker\s+build/.test(cmd)) return compressBuild(lines);
  if (/docker\s+(ps|container\s+ls)/.test(cmd)) return compressPs(lines);
  if (/docker\s+logs/.test(cmd)) return compressLogs(lines);
  if (/docker\s+(pull|push)/.test(cmd)) return compressPullPush(lines);

  lines = collapseBlankLines(lines);
  lines = truncate(lines, 60);
  return lines.join("\n");
}

function compressBuild(lines) {
  const result = [];
  const steps = [];

  for (const line of lines) {
    const t = line.trim();
    // Keep STEP lines but compress them
    const stepMatch = t.match(/^(?:#\d+\s+)?(?:\[.+\]\s+)?(?:STEP|Step)\s+\d+\/\d+\s*:\s*(.*)/i) ||
      t.match(/^#\d+\s+\[\d+\/\d+\]\s+(.*)/);
    if (stepMatch) {
      steps.push(stepMatch[1]);
      continue;
    }
    // Keep error lines
    if (t.toLowerCase().includes("error")) {
      result.push(t);
    }
    // Keep final "Successfully built" / "Successfully tagged"
    if (t.startsWith("Successfully") || t.startsWith("naming to")) {
      result.push(t);
    }
  }

  if (steps.length) {
    result.unshift(`${steps.length} build steps`);
    // Show last 3 steps
    const show = steps.slice(-3);
    for (const s of show) result.splice(1, 0, "  " + s);
  }

  return result.join("\n") || "build completed";
}

function compressPs(lines) {
  // Docker ps output is already tabular, just truncate if too long
  return truncate(lines.filter((l) => l.trim()), 30).join("\n");
}

function compressLogs(lines) {
  lines = collapseBlankLines(lines);
  lines = dedup(lines);
  return truncate(lines, 50).join("\n");
}

function compressPullPush(lines) {
  // Strip layer download progress, keep only summary
  const result = lines.filter((l) => {
    const t = l.trim();
    return !t.match(/^[a-f0-9]+:\s*(Downloading|Extracting|Waiting|Pulling fs layer|Pull complete|Already exists|Pushed|Preparing|Layer already|Verifying)/) &&
      !t.match(/^\s*\d+(\.\d+)?[kKmMgG]?B\//) && // download progress
      t !== "";
  });
  return (result.length ? result : ["pull/push completed"]).join("\n");
}

module.exports = { matches, compress };
