const { stripAnsi, collapseBlankLines, truncate } = require("../filters");

function matches(cmd) {
  return cmd.startsWith("terraform ");
}

function compress(text, cmd) {
  let lines = text.split("\n");
  lines = stripAnsi(lines);

  if (/^terraform\s+(plan|apply)/.test(cmd)) return compressPlan(lines);
  if (/^terraform\s+init/.test(cmd)) return compressInit(lines);
  if (/^terraform\s+(output|show)/.test(cmd)) return compressOutput(lines);

  lines = collapseBlankLines(lines);
  return truncate(lines, 50).join("\n");
}

function compressPlan(lines) {
  const result = [];
  let add = 0, change = 0, destroy = 0;
  const resources = [];

  for (const line of lines) {
    const t = line.trim();

    // Resource action lines: # aws_instance.foo will be created
    const resMatch = t.match(/^#\s+(.+)\s+will be\s+(created|destroyed|updated|replaced)/);
    if (resMatch) {
      resources.push(`${resMatch[2]}: ${resMatch[1]}`);
      continue;
    }

    // Summary line: Plan: 2 to add, 1 to change, 0 to destroy
    const summaryMatch = t.match(/Plan:\s*(\d+) to add,\s*(\d+) to change,\s*(\d+) to destroy/);
    if (summaryMatch) {
      add = parseInt(summaryMatch[1]);
      change = parseInt(summaryMatch[2]);
      destroy = parseInt(summaryMatch[3]);
      continue;
    }

    // "No changes" case
    if (t.includes("No changes") || t.includes("Infrastructure is up-to-date")) {
      return t;
    }

    // Error lines
    if (t.startsWith("Error:") || t.startsWith("Warning:")) {
      result.push(t);
    }
  }

  if (add || change || destroy) {
    result.unshift(`plan: +${add} ~${change} -${destroy}`);
  }

  // Show up to 15 resources, summarize the rest
  if (resources.length <= 15) {
    result.push(...resources.map((r) => "  " + r));
  } else {
    result.push(...resources.slice(0, 10).map((r) => "  " + r));
    result.push(`  ... (+${resources.length - 10} more resources)`);
  }

  return result.length ? result.join("\n") : truncate(collapseBlankLines(lines), 50).join("\n");
}

function compressInit(lines) {
  const result = [];

  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith("Initializing") || t.startsWith("Terraform has been successfully")) {
      result.push(t);
    }
    if (t.startsWith("Error:") || t.startsWith("Warning:")) {
      result.push(t);
    }
    // Provider installation
    if (t.match(/^- Installing|^- Using/)) {
      result.push(t);
    }
  }

  return result.length ? result.join("\n") : "init completed";
}

function compressOutput(lines) {
  // For terraform output/show, strip known-after-apply noise and truncate
  const filtered = lines.filter((l) => {
    const t = l.trim();
    return !t.includes("(known after apply)") &&
      !t.includes("(sensitive value)") &&
      !t.match(/^\s*#.*$/);
  });
  return truncate(collapseBlankLines(filtered), 50).join("\n");
}

module.exports = { matches, compress };
