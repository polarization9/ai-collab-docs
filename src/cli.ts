#!/usr/bin/env node
import { spawn } from "node:child_process";
import { assertReadableMarkdownFile, resolveMarkdownPath } from "./server/paths.js";
import { startServer } from "./server/index.js";
import { startReviewerMcpServer } from "./mcp/server.js";

type CliOptions = {
  markdownPath?: string;
  port: number;
  dev: boolean;
  mcp: boolean;
  desktopServer: boolean;
  desktopToken?: string;
  openBrowser: boolean;
  help: boolean;
};

const DEFAULT_PORT = 4317;
const VITE_DEV_URL = "http://127.0.0.1:5173";

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.help || (!options.markdownPath && !options.desktopServer)) {
    printUsage();
    process.exit(options.help ? 0 : 1);
  }

  const markdownPath = options.markdownPath
    ? resolveMarkdownPath(options.markdownPath)
    : undefined;

  if (markdownPath) {
    assertReadableMarkdownFile(markdownPath);
  }

  if (options.mcp) {
    if (!markdownPath) {
      throw new Error("MCP mode requires a Markdown file.");
    }
    await startReviewerMcpServer({ markdownPath });
    return;
  }

  try {
    const started = await startServer({
      markdownPath,
      port: options.port,
      dev: options.dev,
      desktopToken: options.desktopToken
    });

    const appUrl = options.dev ? VITE_DEV_URL : started.url;
    if (options.desktopServer) {
      console.log(
        JSON.stringify({
          type: "server-ready",
          url: started.url,
          port: new URL(started.url).port
        })
      );
    } else {
      console.log(`Margent is running at ${appUrl}`);
      console.log(`Reading ${markdownPath}`);
    }

    if (options.openBrowser) {
      openUrl(appUrl);
    }
  } catch (error) {
    if (isAddressInUseError(error)) {
      console.error(`Error: Port ${options.port} is already in use. Try --port <port>.`);
      process.exit(1);
    }

    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    port: DEFAULT_PORT,
    dev: false,
    mcp: false,
    desktopServer: false,
    openBrowser: true,
    help: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--dev") {
      options.dev = true;
      continue;
    }

    if (arg === "--mcp") {
      options.mcp = true;
      options.openBrowser = false;
      continue;
    }

    if (arg === "--desktop-server") {
      options.desktopServer = true;
      options.openBrowser = false;
      continue;
    }

    if (arg === "--desktop-token") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("Missing --desktop-token value.");
      }
      options.desktopToken = value;
      index += 1;
      continue;
    }

    if (arg === "--document") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("Missing --document value.");
      }
      options.markdownPath = value;
      index += 1;
      continue;
    }

    if (arg === "--no-open") {
      options.openBrowser = false;
      continue;
    }

    if (arg === "--port") {
      const value = args[index + 1];
      const port = Number(value);
      if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new Error("Invalid --port value.");
      }
      options.port = port;
      index += 1;
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
  console.log(`Usage: margent <markdown-file> [--port 4317] [--mcp]`);
  console.log(`       margent --desktop-server [--port 0] [--document <markdown-file>]`);
}

function openUrl(url: string): void {
  const platform = process.platform;
  const command =
    platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore"
  });
  child.unref();
}

function isAddressInUseError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "EADDRINUSE"
  );
}

main().catch((error: unknown) => {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
