import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundle = path.join(root, "src-tauri/target/release/bundle/macos");
const [command, ...args] = process.argv.slice(2);
const cargoArgs = [command === "test" ? "test" : "run", "--locked", "--manifest-path", path.join(root, "scripts/updater-archive/Cargo.toml")];
if (command !== "test") {
  const defaults = command === "pack"
    ? [path.join(bundle, "Margent.app"), path.join(bundle, "Margent.app.tar.gz")]
    : [path.join(bundle, "Margent.app.tar.gz")];
  cargoArgs.push("--", command, ...(args.length ? args : defaults));
}
try {
  execFileSync("cargo", cargoArgs, {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      PATH: `${path.join(os.homedir(), ".cargo/bin")}${path.delimiter}${process.env.PATH || ""}`,
      CARGO_TARGET_DIR: path.join(root, "src-tauri/target/updater-archive")
    }
  });
} catch (error) {
  if (error.code === "ENOENT") console.error("Cargo is required to verify macOS updater archives.");
  process.exit(error.status || 1);
}
