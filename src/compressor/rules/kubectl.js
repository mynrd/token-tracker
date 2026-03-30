const { stripAnsi, collapseBlankLines, truncate } = require("../filters");

function matches(cmd) {
  return cmd.startsWith("kubectl ") || cmd.startsWith("helm ");
}

function compress(text, cmd) {
  let lines = text.split("\n");
  lines = stripAnsi(lines);

  if (/^kubectl\s+(get|describe)/.test(cmd)) return compressGet(lines, cmd);
  if (/^kubectl\s+logs/.test(cmd)) return compressLogs(lines);
  if (/^kubectl\s+apply/.test(cmd)) return compressApply(lines);
  if (/^helm\s+(install|upgrade|list)/.test(cmd)) return compressHelm(lines);

  lines = collapseBlankLines(lines);
  return truncate(lines, 50).join("\n");
}

function compressGet(lines, cmd) {
  // Tabular output — keep header + first/last rows, strip managedFields from YAML/JSON
  if (lines.length === 0) return "";

  // Detect YAML/JSON output (from -o yaml / -o json)
  const firstNonEmpty = lines.find((l) => l.trim());
  if (firstNonEmpty && (firstNonEmpty.trim().startsWith("{") || firstNonEmpty.trim().startsWith("apiVersion:"))) {
    return compressYaml(lines);
  }

  // Tabular: keep header + rows, truncate middle
  const nonEmpty = lines.filter((l) => l.trim());
  if (nonEmpty.length <= 25) return nonEmpty.join("\n");

  const header = nonEmpty[0];
  const dataRows = nonEmpty.slice(1);
  const headRows = dataRows.slice(0, 10);
  const tailRows = dataRows.slice(-5);
  const omitted = dataRows.length - 15;

  return [
    header,
    ...headRows,
    `  ... (${omitted} rows omitted) ...`,
    ...tailRows,
  ].join("\n");
}

function compressYaml(lines) {
  const result = [];
  let skipBlock = false;
  let skipIndent = 0;

  for (const line of lines) {
    const t = line.trim();

    // Skip managedFields, annotations (very verbose, rarely useful)
    if (t.startsWith("managedFields:") || t.startsWith("\"managedFields\":")) {
      skipBlock = true;
      skipIndent = line.search(/\S/);
      result.push(line.replace(/:.*/, ": [omitted]"));
      continue;
    }
    if (t.startsWith("annotations:") || t.startsWith("\"annotations\":")) {
      skipBlock = true;
      skipIndent = line.search(/\S/);
      result.push(line.replace(/:.*/, ": [omitted]"));
      continue;
    }

    if (skipBlock) {
      const indent = line.search(/\S/);
      if (indent <= skipIndent && t !== "" && !t.startsWith("-")) {
        skipBlock = false;
      } else {
        continue;
      }
    }

    // Skip resourceVersion, selfLink, uid (metadata noise)
    if (t.match(/^(resourceVersion|selfLink|uid|generation|creationTimestamp)\s*:/)) continue;

    result.push(line);
  }

  return truncate(result, 60).join("\n");
}

function compressLogs(lines) {
  lines = collapseBlankLines(lines);
  // For logs, keep tail-heavy (more recent = more relevant)
  if (lines.length <= 50) return lines.join("\n");

  const headCount = 10;
  const tailCount = 35;
  const omitted = lines.length - headCount - tailCount;

  return [
    ...lines.slice(0, headCount),
    `  ... (${omitted} lines omitted) ...`,
    ...lines.slice(-tailCount),
  ].join("\n");
}

function compressApply(lines) {
  const result = [];
  let created = 0, configured = 0, unchanged = 0;

  for (const line of lines) {
    const t = line.trim();
    // Match kubectl apply output: "resource/name created|configured|unchanged"
    if (t.match(/\screated$/)) created++;
    else if (t.match(/\sconfigured$/)) configured++;
    else if (t.match(/\sunchanged$/)) unchanged++;

    // Keep error/warning lines
    if (t.startsWith("error:") || t.startsWith("Error") || t.startsWith("Warning")) {
      result.push(t);
    }
  }

  const counts = [];
  if (created) counts.push(`${created} created`);
  if (configured) counts.push(`${configured} configured`);
  if (unchanged) counts.push(`${unchanged} unchanged`);
  if (counts.length) result.unshift(counts.join(", "));

  return result.length ? result.join("\n") : truncate(lines, 30).join("\n");
}

function compressHelm(lines) {
  const result = [];

  for (const line of lines) {
    const t = line.trim();
    // Keep status, name, revision, chart info
    if (t.match(/^(NAME|NAMESPACE|STATUS|REVISION|CHART|APP VERSION|LAST DEPLOYED)\s*:/i) ||
        t.match(/^(NAME|NAMESPACE|REVISION|UPDATED|STATUS|CHART|APP VERSION)\s/) ||
        t.startsWith("Release ") ||
        t.startsWith("Error:") || t.startsWith("WARNING:")) {
      result.push(t);
    }
  }

  // If tabular output (helm list), keep header + rows
  if (!result.length) {
    const nonEmpty = lines.filter((l) => l.trim());
    return truncate(nonEmpty, 30).join("\n");
  }

  return result.join("\n");
}

module.exports = { matches, compress };
