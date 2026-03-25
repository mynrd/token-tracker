const { stripAnsi, collapseBlankLines, truncate, dedup } = require("../filters");

const GIT_COMMANDS = [
  "git status", "git log", "git diff", "git show", "git branch",
  "git stash", "git pull", "git push", "git fetch", "git merge",
  "git rebase", "git cherry-pick", "git blame", "git remote",
  "git tag", "git checkout", "git switch", "git restore",
];

function matches(cmd) {
  return cmd.startsWith("git ");
}

function compress(text, cmd) {
  let lines = text.split("\n");
  lines = stripAnsi(lines);

  if (cmd.startsWith("git status")) return compressStatus(lines);
  if (cmd.startsWith("git log")) return compressLog(lines);
  if (cmd.startsWith("git diff") || cmd.startsWith("git show")) return compressDiff(lines);
  if (cmd.startsWith("git branch")) return compressBranch(lines);
  if (cmd.startsWith("git push") || cmd.startsWith("git pull") || cmd.startsWith("git fetch")) return compressRemote(lines);

  // Generic git compression
  lines = collapseBlankLines(lines);
  lines = stripGitHints(lines);
  lines = truncate(lines, 60);
  return lines.join("\n");
}

function stripGitHints(lines) {
  return lines.filter((l) => {
    const t = l.trim();
    return !t.startsWith("(use \"git ") && !t.startsWith("hint:");
  });
}

function compressStatus(lines) {
  const branch = [];
  const staged = [];
  const modified = [];
  const untracked = [];

  let section = null;
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith("On branch ")) {
      branch.push(t.replace("On branch ", "branch: "));
    } else if (t.startsWith("Your branch is")) {
      branch.push(t.replace("Your branch is ", "").replace(/[.']/g, "").trim());
    } else if (t.includes("Changes to be committed")) {
      section = "staged";
    } else if (t.includes("Changes not staged")) {
      section = "modified";
    } else if (t.includes("Untracked files")) {
      section = "untracked";
    } else if (t.startsWith("(use ")) {
      continue;
    } else if (t.startsWith("modified:") || t.startsWith("new file:") || t.startsWith("deleted:") || t.startsWith("renamed:")) {
      const file = t.replace(/^(modified|new file|deleted|renamed):\s*/, "");
      if (section === "staged") staged.push(t.split(":")[0] + ": " + file);
      else modified.push(t.split(":")[0] + ": " + file);
    } else if (section === "untracked" && t && !t.startsWith("(") && !t.includes("nothing") && !t.includes("no changes") && !t.includes("use \"git")) {
      untracked.push(t);
    }
  }

  const result = [...branch];
  if (staged.length) result.push(`staged (${staged.length}): ${formatFileList(staged)}`);
  if (modified.length) result.push(`modified (${modified.length}): ${formatFileList(modified)}`);
  if (untracked.length) result.push(`untracked (${untracked.length}): ${formatFileList(untracked)}`);
  if (!staged.length && !modified.length && !untracked.length) result.push("clean working tree");

  return result.join("\n");
}

function formatFileList(items) {
  if (items.length <= 5) return items.join(", ");
  return items.slice(0, 3).join(", ") + ` (+${items.length - 3} more)`;
}

function compressLog(lines) {
  // Keep commit hashes, authors, dates, and messages — strip decorations
  const commits = [];
  let current = null;

  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith("commit ")) {
      if (current) commits.push(current);
      current = { hash: t.slice(7, 18) };
    } else if (t.startsWith("Author:")) {
      if (current) current.author = t.replace("Author:", "").trim().replace(/<.*>/, "").trim();
    } else if (t.startsWith("Date:")) {
      if (current) current.date = t.replace("Date:", "").trim();
    } else if (current && t && !t.startsWith("Merge:")) {
      current.msg = current.msg ? current.msg + " " + t : t;
    }
  }
  if (current) commits.push(current);

  if (commits.length === 0) {
    return truncate(collapseBlankLines(lines), 40).join("\n");
  }

  return commits
    .slice(0, 20) // cap at 20 commits
    .map((c) => `${c.hash} ${c.msg || "(no message)"}`)
    .join("\n");
}

function compressDiff(lines) {
  const result = [];
  let fileHeader = null;
  let addCount = 0;
  let delCount = 0;
  let hunkLines = [];

  function flushHunk() {
    if (hunkLines.length > 0) {
      const capped = hunkLines.length > 30
        ? [...hunkLines.slice(0, 15), `  ... (${hunkLines.length - 25} lines omitted) ...`, ...hunkLines.slice(-10)]
        : hunkLines;
      result.push(...capped);
      hunkLines = [];
    }
  }

  for (const line of lines) {
    if (line.startsWith("diff --git")) {
      flushHunk();
      if (fileHeader) {
        result.push(`  +${addCount} -${delCount}`);
      }
      const file = line.replace(/^diff --git a\/.+ b\//, "");
      fileHeader = `--- ${file}`;
      result.push(fileHeader);
      addCount = 0;
      delCount = 0;
    } else if (line.startsWith("@@")) {
      flushHunk();
      result.push(line);
    } else if (line.startsWith("index ") || line.startsWith("---") || line.startsWith("+++") || line.startsWith("new file") || line.startsWith("deleted file")) {
      // Skip redundant headers
    } else if (line.startsWith("+")) {
      addCount++;
      hunkLines.push(line);
    } else if (line.startsWith("-")) {
      delCount++;
      hunkLines.push(line);
    } else {
      hunkLines.push(line);
    }
  }

  flushHunk();
  if (fileHeader) {
    result.push(`  +${addCount} -${delCount}`);
  }

  return result.join("\n");
}

function compressBranch(lines) {
  const branches = lines
    .map((l) => l.trim())
    .filter((l) => l);

  if (branches.length <= 15) return branches.join("\n");
  const current = branches.find((b) => b.startsWith("*"));
  return [
    current || "(no current branch)",
    `${branches.length} branches total`,
    ...branches.filter((b) => b.startsWith("*") === false).slice(0, 10),
    `... (+${branches.length - 11} more)`,
  ].join("\n");
}

function compressRemote(lines) {
  const result = stripGitHints(lines);
  // Strip verbose "Enumerating objects", "Counting objects" lines
  return result
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith("Enumerating") &&
        !t.startsWith("Counting") &&
        !t.startsWith("Compressing") &&
        !t.startsWith("Writing objects") &&
        !t.startsWith("Total ") &&
        !t.startsWith("remote: Counting") &&
        !t.startsWith("remote: Compressing") &&
        !t.startsWith("remote: Total") &&
        !t.match(/^\s*\d+%/);
    })
    .join("\n");
}

module.exports = { matches, compress };
