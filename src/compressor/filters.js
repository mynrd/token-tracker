/**
 * Core compression filters for CLI output.
 * Each filter is a function: (lines: string[]) => string[]
 */

// Strip ANSI escape codes
function stripAnsi(lines) {
  const ansiRegex = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
  return lines.map((line) => line.replace(ansiRegex, ""));
}

// Remove blank/whitespace-only lines (collapse to max 1)
function collapseBlankLines(lines) {
  const result = [];
  let lastBlank = false;
  for (const line of lines) {
    if (line.trim() === "") {
      if (!lastBlank) result.push("");
      lastBlank = true;
    } else {
      result.push(line);
      lastBlank = false;
    }
  }
  return result;
}

// Remove spinner/progress lines (lines that are just dots, spinners, percentages)
function stripProgress(lines) {
  const progressPatterns = [
    /^[\s]*[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏|/\\-]{1,3}\s/,   // spinner characters
    /^\s*\d+%\s*[|█▓▒░#=\->]+/,                  // progress bars
    /^\s*[.]{3,}\s*$/,                             // just dots
    /^\s*\[[\s#=\->]+\]\s*\d+%/,                  // [=====>  ] 45%
    /^npm warn/i,                                   // npm warnings
    /^npm notice/i,                                 // npm notices
    /^\s*⸨[^⸩]*⸩\s/,                              // npm progress indicators
  ];
  return lines.filter(
    (line) => !progressPatterns.some((p) => p.test(line))
  );
}

// Deduplicate consecutive identical/similar lines
function dedup(lines) {
  const result = [];
  let lastLine = null;
  let count = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === lastLine) {
      count++;
    } else {
      if (count > 1) {
        result.push(`  [x${count}] ${lastLine}`);
      } else if (lastLine !== null) {
        result.push(lastLine);
      }
      lastLine = trimmed;
      count = 1;
    }
  }
  // Flush last
  if (count > 1) {
    result.push(`  [x${count}] ${lastLine}`);
  } else if (lastLine !== null) {
    result.push(lastLine);
  }

  return result;
}

// Truncate output beyond maxLines, keeping head and tail
function truncate(lines, maxLines = 80) {
  if (lines.length <= maxLines) return lines;

  const headCount = Math.floor(maxLines * 0.6);
  const tailCount = maxLines - headCount - 1;
  const omitted = lines.length - headCount - tailCount;

  return [
    ...lines.slice(0, headCount),
    `  ... (${omitted} lines omitted) ...`,
    ...lines.slice(lines.length - tailCount),
  ];
}

// Strip common boilerplate hints (e.g., git's "use git add", npm's "Run npm audit")
function stripHints(lines) {
  const hintPatterns = [
    /^\s*\(use "git /,
    /^\s*hint:/i,
    /^\s*Run `npm audit`/,
    /^\s*added \d+ packages?.*in/,
    /^\s*up to date/,
    /^\s*found \d+ vulnerabilit/,
  ];
  return lines.filter(
    (line) => !hintPatterns.some((p) => p.test(line))
  );
}

// Group similar lines by prefix pattern
function groupSimilar(lines) {
  // Group lines that share the same prefix pattern (e.g., "  modified: ...")
  const groups = [];
  let currentPrefix = null;
  let currentItems = [];

  for (const line of lines) {
    const match = line.match(/^(\s*(?:modified|deleted|new file|renamed|copied|untracked|warning|error|PASS|FAIL)\s*:\s*)/i);
    if (match) {
      const prefix = match[1].trim().replace(/:.*/, "");
      if (prefix === currentPrefix) {
        currentItems.push(line.slice(match[1].length).trim());
      } else {
        if (currentItems.length > 3) {
          groups.push(`${currentPrefix}: ${currentItems.slice(0, 2).join(", ")} (+${currentItems.length - 2} more)`);
        } else if (currentItems.length > 0) {
          for (const item of currentItems) {
            groups.push(`${currentPrefix}: ${item}`);
          }
        }
        currentPrefix = prefix;
        currentItems = [line.slice(match[1].length).trim()];
      }
    } else {
      // Flush current group
      if (currentItems.length > 3) {
        groups.push(`${currentPrefix}: ${currentItems.slice(0, 2).join(", ")} (+${currentItems.length - 2} more)`);
      } else if (currentItems.length > 0) {
        for (const item of currentItems) {
          groups.push(`${currentPrefix}: ${item}`);
        }
      }
      currentPrefix = null;
      currentItems = [];
      groups.push(line);
    }
  }

  // Flush remaining
  if (currentItems.length > 3) {
    groups.push(`${currentPrefix}: ${currentItems.slice(0, 2).join(", ")} (+${currentItems.length - 2} more)`);
  } else if (currentItems.length > 0) {
    for (const item of currentItems) {
      groups.push(`${currentPrefix}: ${item}`);
    }
  }

  return groups;
}

// Apply all filters in sequence
function compress(text, options = {}) {
  const maxLines = options.maxLines || 80;
  let lines = text.split("\n");

  lines = stripAnsi(lines);
  lines = stripProgress(lines);
  lines = stripHints(lines);
  lines = collapseBlankLines(lines);
  lines = dedup(lines);
  lines = groupSimilar(lines);
  lines = truncate(lines, maxLines);

  return lines.join("\n");
}

module.exports = {
  stripAnsi,
  collapseBlankLines,
  stripProgress,
  dedup,
  truncate,
  stripHints,
  groupSimilar,
  compress,
};
