#!/usr/bin/env node

/**
 * CLI wrapper for the compressor.
 *
 * Usage:
 *   some-command | node compress.js [command-hint]
 *   node compress.js --command "git status" < input.txt
 *
 * The command hint tells the compressor which rules to apply.
 * If omitted, generic compression is used.
 */

const { compressOutput } = require("../src/compressor");

const args = process.argv.slice(2);
let command = "";

// Parse --command flag
const cmdIdx = args.indexOf("--command");
if (cmdIdx !== -1 && args[cmdIdx + 1]) {
  command = args[cmdIdx + 1];
} else if (args.length > 0 && !args[0].startsWith("--")) {
  // Positional: compress.js "git status"
  command = args.join(" ");
}

// Read stdin
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  const compressed = compressOutput(input, command);
  process.stdout.write(compressed);
  if (!compressed.endsWith("\n")) process.stdout.write("\n");
});

// Handle piped input timeout — if nothing on stdin after 100ms and we have args, show help
if (process.stdin.isTTY) {
  console.log(`
  Token Tracker — Output Compressor
  ==================================

  Pipe command output through this to reduce tokens:

    git status | node bin/compress.js git status
    npm test   | node bin/compress.js npm test
    docker ps  | node bin/compress.js docker ps

  Or use the shell aliases:
    source shell/aliases.sh
    git status   # automatically compressed
`);
  process.exit(0);
}
