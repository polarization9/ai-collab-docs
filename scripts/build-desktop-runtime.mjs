#!/usr/bin/env node
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeRoot = path.join(rootDir, "src-tauri", "resources", "node");
const runtimeBinDir = path.join(runtimeRoot, "bin");
const runtimeNodePath = path.join(runtimeBinDir, os.platform() === "win32" ? "node.exe" : "node");
const sourceNodePath = process.execPath;

await assertPortableNode(sourceNodePath);

await fs.rm(runtimeRoot, { recursive: true, force: true });
await fs.mkdir(runtimeBinDir, { recursive: true });
await fs.copyFile(sourceNodePath, runtimeNodePath);
await fs.chmod(runtimeNodePath, 0o755);
await fs.writeFile(
  path.join(runtimeRoot, "runtime.json"),
  JSON.stringify(
    {
      source: sourceNodePath,
      version: process.version,
      platform: process.platform,
      arch: process.arch,
      generatedAt: new Date().toISOString()
    },
    null,
    2
  ) + "\n"
);

console.log(`Bundled desktop Node runtime: ${path.relative(rootDir, runtimeNodePath)}`);

async function assertPortableNode(nodePath) {
  if (process.platform !== "darwin") {
    return;
  }

  const { stdout } = await execFileAsync("otool", ["-L", nodePath]);
  const unsafeDependencies = stdout
    .split("\n")
    .map((line) => line.trim().split(" ")[0])
    .filter(Boolean)
    .filter((dependency) => {
      if (dependency === `${nodePath}:`) {
        return false;
      }
      if (dependency === nodePath) {
        return false;
      }
      return !(
        dependency.startsWith("/System/Library/") ||
        dependency.startsWith("/usr/lib/") ||
        dependency.startsWith("@executable_path/")
      );
    });

  if (unsafeDependencies.length > 0) {
    throw new Error(
      [
        "Current Node binary is not portable enough for app bundling.",
        `Node: ${nodePath}`,
        "Non-system dependencies:",
        ...unsafeDependencies.map((dependency) => `- ${dependency}`)
      ].join("\n")
    );
  }
}
