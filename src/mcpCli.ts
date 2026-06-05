#!/usr/bin/env node
import { assertReadableMarkdownFile, resolveMarkdownPath } from "./server/paths.js";
import { startReviewerMcpServer } from "./mcp/server.js";

type McpCliOptions = {
  markdownPath?: string;
  help: boolean;
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printUsage();
    process.exit(0);
  }

  const markdownPath = options.markdownPath ? resolveMarkdownPath(options.markdownPath) : undefined;
  if (markdownPath) {
    assertReadableMarkdownFile(markdownPath);
  }

  await startReviewerMcpServer({ markdownPath });
}

function parseArgs(args: string[]): McpCliOptions {
  const options: McpCliOptions = {
    help: false
  };

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (!options.markdownPath) {
      options.markdownPath = arg;
      continue;
    }

    throw new Error(`Unexpected argument: ${arg}`);
  }

  return options;
}

function printUsage(): void {
  console.error("Usage: margent-mcp [markdown-file]");
}

main().catch((error: unknown) => {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
