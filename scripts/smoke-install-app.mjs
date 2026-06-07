import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const sourceAppPath =
  process.env.MARGENT_APP_PATH ??
  path.join(root, "src-tauri/target/release/bundle/macos/Margent.app");
const dmgPath =
  process.env.MARGENT_DMG_PATH ??
  path.join(root, "src-tauri/target/release/bundle/dmg/Margent_0.1.0_aarch64.dmg");
const installPath = process.env.MARGENT_INSTALL_PATH ?? "/Applications/Margent.app";
const releaseFixturePath =
  process.env.MARGENT_RELEASE_FIXTURE ??
  path.join(root, "test-fixtures/release/release smoke 文档.md");

const errors = [];
const notes = [];

function assert(condition, message) {
  if (!condition) {
    errors.push(message);
  }
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
    ...options
  });
}

function tryRun(command, args, options = {}) {
  try {
    return { ok: true, output: run(command, args, options) };
  } catch (error) {
    return {
      ok: false,
      output: `${error.stdout?.toString() ?? ""}${error.stderr?.toString() ?? ""}`.trim(),
      error
    };
  }
}

function plistValue(appPath, key) {
  return run("/usr/libexec/PlistBuddy", [
    "-c",
    `Print :${key}`,
    path.join(appPath, "Contents/Info.plist")
  ]).trim();
}

function pgrepMargent() {
  const result = tryRun("pgrep", ["-x", "Margent"]);
  if (!result.ok || !result.output.trim()) {
    return [];
  }
  return result.output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

async function waitForProcessState(expectedRunning, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const running = pgrepMargent().length > 0;
    if (running === expectedRunning) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function quitMargentIfRunning() {
  if (pgrepMargent().length === 0) {
    return;
  }

  tryRun("osascript", ["-e", 'tell application id "com.margent.desktop" to quit']);
  if (!(await waitForProcessState(false, 6000))) {
    errors.push("Margent is still running; quit it before overwrite-install smoke can continue.");
  }
}

function registerLaunchServices() {
  const lsregister =
    "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
  if (!fs.existsSync(lsregister)) {
    notes.push("LaunchServices register tool not found; skipped explicit app registration.");
    return;
  }

  const result = tryRun(lsregister, ["-f", installPath]);
  if (!result.ok) {
    notes.push(`LaunchServices registration skipped/failed: ${result.output || result.error.message}`);
  }
}

function runInstalledBundleSmoke() {
  const result = tryRun(process.execPath, ["scripts/smoke-tauri-app.mjs"], {
    env: {
      ...process.env,
      MARGENT_APP_PATH: installPath,
      MARGENT_DMG_PATH: dmgPath
    }
  });
  if (!result.ok) {
    errors.push(`Installed app bundle smoke failed:\n${result.output}`);
  }
}

function reportSpctlStatus() {
  const result = tryRun("spctl", ["--assess", "--type", "execute", "--verbose=4", installPath]);
  if (result.ok) {
    notes.push("spctl accepted installed app.");
    return;
  }

  notes.push(
    `spctl did not accept installed app, expected for local ad-hoc builds without notarization: ${
      result.output || result.error.message
    }`
  );
}

async function launchInstalledAppWithFixture() {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "margent-release-fixture-"));
  const fixturePath = path.join(fixtureDir, "release smoke 中文 路径.md");
  fs.copyFileSync(releaseFixturePath, fixturePath);

  try {
    run("open", ["-a", installPath, fixturePath]);
    if (!(await waitForProcessState(true, 12000))) {
      errors.push("Installed app did not launch after open -a with release fixture.");
    }
  } finally {
    tryRun("osascript", ["-e", 'tell application id "com.margent.desktop" to quit']);
    await waitForProcessState(false, 6000);
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
}

assert(fs.existsSync(sourceAppPath), `Missing source app bundle: ${sourceAppPath}`);
assert(fs.existsSync(dmgPath), `Missing source dmg: ${dmgPath}`);
assert(fs.existsSync(releaseFixturePath), `Missing release fixture: ${releaseFixturePath}`);

if (errors.length === 0) {
  await quitMargentIfRunning();
}

if (errors.length === 0) {
  fs.rmSync(installPath, { recursive: true, force: true });
  run("ditto", [sourceAppPath, installPath]);
  registerLaunchServices();
  assert(fs.existsSync(installPath), `Installed app is missing: ${installPath}`);
  assert(plistValue(installPath, "CFBundleIdentifier") === "com.margent.desktop", "Installed app bundle id mismatch.");
  assert(plistValue(installPath, "CFBundleDisplayName") === "Margent", "Installed app display name mismatch.");
  runInstalledBundleSmoke();
  reportSpctlStatus();
}

if (errors.length === 0) {
  await launchInstalledAppWithFixture();
}

if (notes.length > 0) {
  for (const note of notes) {
    console.log(`install-smoke-note: ${note}`);
  }
}

if (errors.length > 0) {
  console.error("install-smoke failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("install-smoke-ok");
