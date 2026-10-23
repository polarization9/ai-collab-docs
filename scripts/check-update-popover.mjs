import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { build } from "esbuild";

// This UI check requires the guarded Playwright wrapper and its WebKit runtime.
const root = fileURLToPath(new URL("..", import.meta.url));
const wrapper = process.env.PLAYWRIGHT_CLI_WRAPPER ?? path.join(
  process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"),
  "skills/playwright/scripts/playwright_cli.sh"
);
const session = `codex-margent-update-popover-${process.pid}`;
const output = path.join(root, "outputs/update-popover");
const execFileAsync = promisify(execFile);
const controller = new AbortController();
const interrupt = () => controller.abort();
const cli = async (args, cleanup = false) => (await execFileAsync(wrapper, args, {
  cwd: output,
  encoding: "utf8",
  maxBuffer: 8 * 1024 * 1024,
  timeout: 180000,
  signal: cleanup ? undefined : controller.signal
})).stdout;

await fs.access(wrapper);
await fs.mkdir(output, { recursive: true });
assert.match(await cli(["list", "--all"]), /\(no browsers\)/, "Another browser task is active");
const bundle = await build({
  entryPoints: [path.join(root, "scripts/fixtures/update-popover.tsx")],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  define: {
    "process.env.NODE_ENV": '"development"',
    "import.meta.env": '{"VITE_MARGENT_DISTRIBUTION":"github"}'
  }
});
const styles = await fs.readFile(path.join(root, "src/web/styles.css"));
const server = http.createServer((request, response) => {
  const url = new URL(request.url, "http://localhost");
  if (url.pathname === "/") {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
  } else if (url.pathname === "/fixture.js") {
    response.setHeader("Content-Type", "application/javascript");
    response.end(bundle.outputFiles[0].contents);
  } else if (url.pathname === "/styles.css") {
    response.setHeader("Content-Type", "text/css");
    response.end(styles);
  } else {
    response.statusCode = 404;
    response.end();
  }
});

const check = async (page) => {
  const trigger = page.locator(".document-tab-update-button");
  const popover = page.locator(".document-tab-update-popover");
  const checks = [];
  const date = "2026-01-01T00:00:00.000Z";
  const available = { status: "available", version: "0.1.11", lastCheckedAt: date };
  const latest = { status: "not-available", lastCheckedAt: date };
  const error = { status: "error", message: "Fixture update error" };
  const ready = { status: "ready-to-restart", version: "0.1.11" };
  const readCalls = () => page.evaluate(() => ({ ...window.updatePopoverFixture.calls }));
  const reset = (state) => page.evaluate((value) => window.updatePopoverFixture.reset(value), state);
  const waitStatus = (status) => page.waitForFunction(
    (value) => window.updatePopoverFixture.state.status === value, status
  );
  const finishCheck = async (state) => {
    await page.evaluate((value) => window.updatePopoverFixture.finishCheck(value), state);
    await waitStatus(state.status);
  };
  const assertOpen = async (open) => {
    if (await trigger.getAttribute("aria-expanded") !== String(open)) throw Error(`Wrong expanded state: ${open}`);
    if (Boolean(await popover.count()) !== open) throw Error(`Wrong popover visibility: ${open}`);
  };
  const states = [
    { status: "idle" }, { status: "unsupported" }, { status: "checking" }, latest,
    available, { status: "downloading", version: "0.1.11", downloaded: 50, total: 100 }, ready, error
  ];

  for (const width of [1440, 800, 390]) {
    await page.setViewportSize({ width, height: 800 });
    for (const state of states) {
      await reset(state);
      await trigger.click();
      if (["idle", "not-available", "error"].includes(state.status)) {
        await finishCheck(state.status === "idle" ? latest : state);
      }
      await assertOpen(true);
      const beforeClose = await readCalls();
      await trigger.click();
      await assertOpen(false);
      if ((await readCalls()).check !== beforeClose.check) throw Error("Closing started another check");

      await trigger.click();
      await assertOpen(true);
      await popover.locator("p").click();
      await assertOpen(true);
      await page.locator("#outside").click();
      await assertOpen(false);
      if ((await readCalls()).outside !== 1) throw Error("Dismissal swallowed the outside click");

      await trigger.click();
      await assertOpen(true);
      await page.keyboard.press("Escape");
      await assertOpen(false);
      checks.push(`${width}: ${state.status}: toggle, outside, Escape`);
    }

    await reset({ status: "idle" });
    await trigger.focus();
    await page.keyboard.press("Enter");
    await waitStatus("checking");
    await page.keyboard.press("Enter");
    await assertOpen(false);
    await finishCheck(available);
    await assertOpen(false);
    if ((await readCalls()).checkCompleted !== 1) throw Error("Closing cancelled the check");
    if (await page.locator(".document-tab-update-badge").count() !== 1) throw Error("Hidden result lost update badge");

    await trigger.click();
    await popover.getByRole("button", { name: "下载并安装" }).click();
    await waitStatus("downloading");
    await assertOpen(true);
    await trigger.click();
    await assertOpen(false);
    await page.evaluate(() => window.updatePopoverFixture.setState({
      status: "downloading", version: "0.1.11", downloaded: 75, total: 100
    }));
    await assertOpen(false);
    await trigger.click();
    if (!(await popover.innerText()).includes("75%")) throw Error("Reopened progress is stale");
    await page.keyboard.press("Escape");
    await page.evaluate((value) => window.updatePopoverFixture.finishInstall(value), ready);
    await waitStatus("ready-to-restart");
    await assertOpen(false);
    const calls = await readCalls();
    if (calls.install !== 1 || calls.installCompleted !== 1 || calls.check !== 1) throw Error("Dismissal restarted or cancelled an update");
    await trigger.click();
    await popover.getByRole("button", { name: "重启", exact: true }).click();
    if ((await readCalls()).relaunch !== 1) throw Error("Relaunch action is broken");
    checks.push(`${width}: closed check/download complete without reopening; progress and restart preserved`);

    await reset(error);
    await trigger.click();
    await finishCheck(error);
    const retry = popover.getByRole("button", { name: "重试" });
    await retry.click();
    await assertOpen(true);
    if ((await readCalls()).check !== 2) throw Error("Retry action is broken");
    await finishCheck(error);
    await retry.focus();
    await page.keyboard.press("Escape");
    await assertOpen(false);
    if (!(await trigger.evaluate((element) => element === document.activeElement))) throw Error("Escape lost keyboard focus");
    checks.push(`${width}: retry stays usable; Escape restores trigger focus`);

    await trigger.click();
    await page.getByRole("textbox", { name: "Outside input" }).focus();
    await page.keyboard.press("Escape");
    await assertOpen(false);
    if (!(await page.getByRole("textbox").evaluate((element) => element === document.activeElement))) throw Error("Escape stole outside focus");
    await page.evaluate(() => window.updatePopoverFixture.unmount());
    await page.locator("body").dispatchEvent("pointerdown");
    await page.keyboard.press("Escape");

    await reset({ status: "idle" });
    await trigger.click();
    await finishCheck(latest);
    const box = await popover.boundingBox();
    if (!box || box.x < 0 || box.x + box.width > width) throw Error("Popover exceeds viewport");
    await page.screenshot({ path: __OUTPUT__ + `/open-${width}.png` });
    await page.keyboard.press("Escape");
    await assertOpen(false);
  }
  return { ok: true, checks };
};

let attemptedOpen = false;
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);
try {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  attemptedOpen = true;
  console.log(await cli(["--session", session, "open", base, "--browser", "webkit"]));
  const result = await cli(["--session", session, "run-code", check.toString().replaceAll("__OUTPUT__", JSON.stringify(output))]);
  await fs.writeFile(path.join(output, "verification.log"), result);
  const lines = result.split(/\r?\n/);
  const resultIndex = lines.indexOf("### Result");
  assert.notEqual(resultIndex, -1, "Playwright returned no result");
  const report = JSON.parse(lines[resultIndex + 1]);
  assert.equal(report.ok, true, "UI regression check failed");
  assert.equal(report.checks.length, 30);
  console.log(JSON.stringify(report, null, 2));
} finally {
  try {
    if (attemptedOpen) console.log(await cli(["--session", session, "close"], true));
    const remaining = await cli(["list", "--all"], true);
    console.log(remaining);
    assert.match(remaining, /\(no browsers\)/, "Browser cleanup failed");
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
  }
}
