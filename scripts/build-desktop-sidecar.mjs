#!/usr/bin/env node
import { build } from "esbuild";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const binariesDir = path.join(rootDir, "src-tauri", "binaries");
const desktopDistDir = path.join(rootDir, "dist", "desktop");
const desktopCliPath = path.join(desktopDistDir, "cli.js");
const desktopMcpCliPath = path.join(desktopDistDir, "mcpCli.js");
const targetTriple = getTargetTriple();
const sidecarName = `margent-server-${targetTriple}`;
const sidecarPath = path.join(binariesDir, sidecarName);
const cliPath = path.join(rootDir, "dist", "cli.js");

await fs.mkdir(binariesDir, { recursive: true });
await buildDesktopEntrypoints();

const script = `#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
NODE_CANDIDATES=(
  "$SCRIPT_DIR/../Resources/resources/node/bin/node"
  "$SCRIPT_DIR/../Resources/node/bin/node"
  "$SCRIPT_DIR/../resources/node/bin/node"
)
CLI_CANDIDATES=(
  "$APP_ROOT/dist/desktop/cli.js"
  "$SCRIPT_DIR/../../../dist/desktop/cli.js"
  "$SCRIPT_DIR/../Resources/_up_/dist/desktop/cli.js"
  "$SCRIPT_DIR/../Resources/dist/desktop/cli.js"
  "$SCRIPT_DIR/../../Resources/_up_/dist/desktop/cli.js"
  "$SCRIPT_DIR/../../Resources/dist/desktop/cli.js"
  "$APP_ROOT/dist/cli.js"
  "$SCRIPT_DIR/../../../dist/cli.js"
  "$SCRIPT_DIR/../Resources/dist/cli.js"
  "$SCRIPT_DIR/../Resources/_up_/dist/cli.js"
  "$SCRIPT_DIR/../../Resources/dist/cli.js"
  "$SCRIPT_DIR/../../Resources/_up_/dist/cli.js"
  "$SCRIPT_DIR/dist/cli.js"
)
NODE_BIN="\${MARGENT_NODE:-}"
if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
  NODE_BIN=""
  for CANDIDATE in "\${NODE_CANDIDATES[@]}"; do
    if [[ -x "$CANDIDATE" ]]; then
      NODE_BIN="$CANDIDATE"
      break
    fi
  done
fi
if [[ -z "$NODE_BIN" ]]; then
  NODE_BIN="$(command -v node || true)"
fi
if [[ -z "$NODE_BIN" ]]; then
  echo "Unable to locate bundled Node runtime for Margent sidecar." >&2
  exit 1
fi
for CLI_PATH in "\${CLI_CANDIDATES[@]}"; do
  if [[ -f "$CLI_PATH" ]]; then
    exec "$NODE_BIN" "$CLI_PATH" "$@"
  fi
done
echo "Unable to locate dist/cli.js for Margent sidecar." >&2
exit 1
`;

await fs.access(cliPath);
await fs.writeFile(sidecarPath, script, { mode: 0o755 });
await fs.chmod(sidecarPath, 0o755);

console.log(`Created Tauri sidecar launcher: ${path.relative(rootDir, sidecarPath)}`);

async function buildDesktopEntrypoints() {
  await fs.mkdir(desktopDistDir, { recursive: true });
  await Promise.all([
    buildDesktopEntrypoint({
      entryPoint: path.join(rootDir, "src", "cli.ts"),
      outfile: desktopCliPath
    }),
    buildDesktopEntrypoint({
      entryPoint: path.join(rootDir, "src", "mcpCli.ts"),
      outfile: desktopMcpCliPath
    })
  ]);
  await fs.chmod(desktopCliPath, 0o755);
  await fs.chmod(desktopMcpCliPath, 0o755);
  console.log(`Created desktop server bundle: ${path.relative(rootDir, desktopCliPath)}`);
  console.log(`Created desktop MCP bundle: ${path.relative(rootDir, desktopMcpCliPath)}`);
}

async function buildDesktopEntrypoint({ entryPoint, outfile }) {
  await build({
    entryPoints: [entryPoint],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    sourcemap: false,
    banner: {
      js: 'import { createRequire as __margentCreateRequire } from "node:module";\nconst require = __margentCreateRequire(import.meta.url);'
    },
    logLevel: "silent"
  });
}

function getTargetTriple() {
  const platform = os.platform();
  const arch = os.arch();

  if (platform === "darwin" && arch === "arm64") {
    return "aarch64-apple-darwin";
  }

  if (platform === "darwin" && arch === "x64") {
    return "x86_64-apple-darwin";
  }

  if (platform === "linux" && arch === "x64") {
    return "x86_64-unknown-linux-gnu";
  }

  if (platform === "win32" && arch === "x64") {
    return "x86_64-pc-windows-msvc.exe";
  }

  throw new Error(`Unsupported sidecar target: ${platform}/${arch}`);
}
