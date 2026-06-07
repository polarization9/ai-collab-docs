import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const root = process.cwd();
const cliPath = path.join(root, "dist/cli.js");
const thresholds = {
  emptyInteractiveMs: 2000,
  open100kbMs: 1000,
  open1mbMs: 3000
};

if (!fs.existsSync(cliPath)) {
  console.error("performance-smoke failed: dist/cli.js is missing. Run npm run build first.");
  process.exit(1);
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "margent-performance-"));
const appDataDir = path.join(tempRoot, "app-data");
fs.mkdirSync(appDataDir, { recursive: true });

const results = [];
const warnings = [];

function createMarkdownFixture(name, approximateBytes) {
  const filePath = path.join(tempRoot, name);
  const section = [
    "## Section",
    "",
    "这是一段用于性能 smoke 的 Markdown 内容，包含中文、英文 words, list items, and stable repeated text.",
    "",
    "- item one",
    "- item two",
    "",
    "| 名称 | 状态 |",
    "| --- | --- |",
    "| 性能 | smoke |",
    ""
  ].join("\n");
  let content = "# Release Performance Fixture\n\n";
  while (Buffer.byteLength(content, "utf8") < approximateBytes) {
    content += section;
  }
  content += "\nEND-OF-PERFORMANCE-FIXTURE\n";
  fs.writeFileSync(filePath, content, "utf8");
  return filePath;
}

function startCliServer(documentPath) {
  const args = [cliPath, "--desktop-server", "--port", "0"];
  if (documentPath) {
    args.push("--document", documentPath);
  }

  const child = spawn(process.execPath, args, {
    cwd: root,
    env: {
      ...process.env,
      MARGENT_APP_DATA_DIR: appDataDir,
      MARGENT_DISABLE_CODEX_BRIDGE: "1"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  const ready = new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      rejectReady(new Error(`Server did not become ready.\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    }, 12000);

    function resolveReady(server) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve(server);
    }

    function rejectReady(error) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      void terminateChild(child);
      reject(error);
    }

    child.stdout.on("data", () => {
      for (const line of stdout.split("\n")) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === "server-ready" && parsed.url) {
            resolveReady({ child, url: parsed.url });
          }
        } catch {
          // Keep waiting until the JSON readiness line arrives.
        }
      }
    });

    child.on("exit", (code) => {
      rejectReady(new Error(`Server exited before ready with code ${code}.\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    });
  });

  return ready;
}

async function stopServer(server) {
  await terminateChild(server.child);
}

function terminateChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const forceKill = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }, 2000);

    child.once("exit", () => {
      clearTimeout(forceKill);
      resolve();
    });

    child.kill("SIGTERM");
  });
}

async function measure(label, thresholdMs, run) {
  const startedAt = performance.now();
  await run();
  const elapsedMs = Math.round(performance.now() - startedAt);
  results.push({ label, elapsedMs, thresholdMs });
  if (elapsedMs > thresholdMs) {
    warnings.push(`${label} took ${elapsedMs}ms, above target ${thresholdMs}ms.`);
  }
}

let browser;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  const emptyServer = await startCliServer();
  try {
    await measure("empty startup to open button", thresholds.emptyInteractiveMs, async () => {
      await page.goto(emptyServer.url);
      await page.getByRole("button", { name: /打开|Open/ }).waitFor({ state: "visible" });
    });
  } finally {
    await stopServer(emptyServer);
  }

  const oneHundredKb = createMarkdownFixture("performance-100kb.md", 100 * 1024);
  const oneMb = createMarkdownFixture("performance-1mb.md", 1024 * 1024);

  for (const [label, filePath, thresholdMs] of [
    ["open 100KB markdown to heading", oneHundredKb, thresholds.open100kbMs],
    ["open 1MB markdown to heading", oneMb, thresholds.open1mbMs]
  ]) {
    const server = await startCliServer(filePath);
    try {
      await measure(label, thresholdMs, async () => {
        await page.goto(server.url);
        await page.getByRole("heading", { name: "Release Performance Fixture" }).waitFor({
          state: "visible"
        });
      });
    } finally {
      await stopServer(server);
    }
  }
} finally {
  await browser?.close();
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log("performance-smoke-results:");
for (const result of results) {
  console.log(`- ${result.label}: ${result.elapsedMs}ms target=${result.thresholdMs}ms`);
}
for (const warning of warnings) {
  console.warn(`performance-smoke-warning: ${warning}`);
}
console.log("performance-smoke-ok");
