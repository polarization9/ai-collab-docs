#!/usr/bin/env node
import { build } from "esbuild";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
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
const execFileAsync = promisify(execFile);

await fs.mkdir(binariesDir, { recursive: true });
await buildDesktopEntrypoints();

const shellLauncher = `#!/usr/bin/env bash
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
if (targetTriple.endsWith("apple-darwin")) {
  await buildMacosLauncher(sidecarPath);
} else {
  await fs.writeFile(sidecarPath, shellLauncher, { mode: 0o755 });
  await fs.chmod(sidecarPath, 0o755);
}

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

async function buildMacosLauncher(outfile) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "margent-sidecar-"));
  const sourcePath = path.join(tmpDir, "margent-sidecar-launcher.c");

  try {
    await fs.writeFile(sourcePath, getMacosLauncherSource());
    await execFileAsync("clang", ["-O2", "-Wall", "-Wextra", sourcePath, "-o", outfile]);
    await fs.chmod(outfile, 0o755);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
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

function getMacosLauncherSource() {
  return String.raw`
#include <mach-o/dyld.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static int file_exists(const char *path) {
  return path != NULL && access(path, F_OK) == 0;
}

static int executable_exists(const char *path) {
  return path != NULL && access(path, X_OK) == 0;
}

static void dirname_in_place(char *path) {
  char *slash = strrchr(path, '/');
  if (slash == NULL) {
    strcpy(path, ".");
  } else if (slash == path) {
    slash[1] = '\0';
  } else {
    *slash = '\0';
  }
}

static int join_path(char *buffer, size_t buffer_len, const char *base, const char *relative) {
  int written = snprintf(buffer, buffer_len, "%s/%s", base, relative);
  return written > 0 && (size_t)written < buffer_len;
}

static int resolve_script_dir(char *buffer, size_t buffer_len) {
  uint32_t size = (uint32_t)buffer_len;
  if (_NSGetExecutablePath(buffer, &size) != 0) {
    return 0;
  }

  char resolved[PATH_MAX];
  if (realpath(buffer, resolved) != NULL) {
    strncpy(buffer, resolved, buffer_len - 1);
    buffer[buffer_len - 1] = '\0';
  }

  dirname_in_place(buffer);
  return 1;
}

int main(int argc, char *argv[]) {
  char script_dir[PATH_MAX];
  if (!resolve_script_dir(script_dir, sizeof(script_dir))) {
    fprintf(stderr, "Unable to resolve Margent sidecar directory.\n");
    return 1;
  }

  char app_root[PATH_MAX];
  if (!join_path(app_root, sizeof(app_root), script_dir, "../..")) {
    fprintf(stderr, "Unable to resolve Margent app root.\n");
    return 1;
  }

  const char *node_bin = getenv("MARGENT_NODE");
  char node_candidate[PATH_MAX];
  const char *node_relatives[] = {
    "../Resources/resources/node/bin/node",
    "../Resources/node/bin/node",
    "../resources/node/bin/node"
  };
  if (!executable_exists(node_bin)) {
    node_bin = NULL;
    for (size_t i = 0; i < sizeof(node_relatives) / sizeof(node_relatives[0]); i++) {
      if (!join_path(node_candidate, sizeof(node_candidate), script_dir, node_relatives[i])) {
        continue;
      }
      if (executable_exists(node_candidate)) {
        node_bin = node_candidate;
        break;
      }
    }
  }

  char cli_candidate[PATH_MAX];
  const char *script_relatives[] = {
    "../../../dist/desktop/cli.js",
    "../Resources/_up_/dist/desktop/cli.js",
    "../Resources/dist/desktop/cli.js",
    "../../Resources/_up_/dist/desktop/cli.js",
    "../../Resources/dist/desktop/cli.js",
    "../../../dist/cli.js",
    "../Resources/dist/cli.js",
    "../Resources/_up_/dist/cli.js",
    "../../Resources/dist/cli.js",
    "../../Resources/_up_/dist/cli.js",
    "dist/cli.js"
  };

  char app_root_cli[PATH_MAX];
  if (join_path(app_root_cli, sizeof(app_root_cli), app_root, "dist/desktop/cli.js") &&
      file_exists(app_root_cli)) {
    strncpy(cli_candidate, app_root_cli, sizeof(cli_candidate) - 1);
    cli_candidate[sizeof(cli_candidate) - 1] = '\0';
  } else {
    cli_candidate[0] = '\0';
    for (size_t i = 0; i < sizeof(script_relatives) / sizeof(script_relatives[0]); i++) {
      char candidate[PATH_MAX];
      if (!join_path(candidate, sizeof(candidate), script_dir, script_relatives[i])) {
        continue;
      }
      if (file_exists(candidate)) {
        strncpy(cli_candidate, candidate, sizeof(cli_candidate) - 1);
        cli_candidate[sizeof(cli_candidate) - 1] = '\0';
        break;
      }
    }
  }

  if (cli_candidate[0] == '\0') {
    fprintf(stderr, "Unable to locate dist/cli.js for Margent sidecar.\n");
    return 1;
  }

  int child_argc = argc + 1;
  char **child_argv = calloc((size_t)child_argc + 1, sizeof(char *));
  if (child_argv == NULL) {
    fprintf(stderr, "Unable to allocate Margent sidecar arguments.\n");
    return 1;
  }

  child_argv[0] = node_bin != NULL ? (char *)node_bin : "node";
  child_argv[1] = cli_candidate;
  for (int i = 1; i < argc; i++) {
    child_argv[i + 1] = argv[i];
  }
  child_argv[child_argc] = NULL;

  if (node_bin != NULL) {
    execv(node_bin, child_argv);
  } else {
    execvp("node", child_argv);
  }

  perror("Unable to launch Margent sidecar node runtime");
  free(child_argv);
  return 1;
}
`;
}
