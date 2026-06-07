import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const appPath =
  process.env.MARGENT_APP_PATH ??
  path.join(root, "src-tauri/target/release/bundle/macos/Margent.app");
const dmgPath =
  process.env.MARGENT_DMG_PATH ??
  path.join(root, "src-tauri/target/release/bundle/dmg/Margent_0.1.0_aarch64.dmg");

const errors = [];

function assert(condition, message) {
  if (!condition) {
    errors.push(message);
  }
}

function exists(relativePath) {
  return fs.existsSync(path.join(appPath, relativePath));
}

function isExecutable(relativePath) {
  try {
    fs.accessSync(path.join(appPath, relativePath), fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function plistValue(key) {
  return execFileSync("/usr/libexec/PlistBuddy", [
    "-c",
    `Print :${key}`,
    path.join(appPath, "Contents/Info.plist")
  ], {
    encoding: "utf8"
  }).trim();
}

assert(fs.existsSync(appPath), `Missing app bundle: ${appPath}`);
assert(fs.existsSync(dmgPath), `Missing dmg bundle: ${dmgPath}`);

if (fs.existsSync(appPath)) {
  assert(exists("Contents/Info.plist"), "Missing Contents/Info.plist");
  assert(exists("Contents/Resources/en.lproj"), "Missing English native resource folder");
  assert(exists("Contents/Resources/zh-Hans.lproj"), "Missing Chinese native resource folder");
  assert(exists("Contents/Resources/_up_/dist"), "Missing packaged server/web dist");
  assert(
    exists("Contents/Resources/_up_/examples/Margent Quickstart.md"),
    "Missing packaged Quickstart example"
  );
  assert(exists("Contents/Resources/_up_/node_modules"), "Missing packaged node_modules");
  assert(isExecutable("Contents/MacOS/Margent"), "Missing executable Margent binary");
  assert(isExecutable("Contents/MacOS/margent-server"), "Missing executable server sidecar");
  assert(isExecutable("Contents/Resources/resources/node/bin/node"), "Missing executable bundled Node runtime");

  if (exists("Contents/Info.plist")) {
    try {
      assert(plistValue("CFBundleName") === "Margent", "CFBundleName is not Margent");
      assert(plistValue("CFBundleDisplayName") === "Margent", "CFBundleDisplayName is not Margent");
      assert(plistValue("CFBundleExecutable") === "Margent", "CFBundleExecutable is not Margent");
      assert(plistValue("CFBundleIdentifier") === "com.margent.desktop", "Unexpected bundle identifier");
      assert(plistValue("CFBundleURLTypes:0:CFBundleURLSchemes:0") === "margent", "Missing margent URL scheme");
      const documentExtensions = execFileSync("/usr/libexec/PlistBuddy", [
        "-c",
        "Print :CFBundleDocumentTypes:0:CFBundleTypeExtensions",
        path.join(appPath, "Contents/Info.plist")
      ], {
        encoding: "utf8"
      });
      assert(documentExtensions.includes("md"), "Missing .md file association");
      assert(documentExtensions.includes("markdown"), "Missing .markdown file association");
    } catch (error) {
      errors.push(`Unable to inspect Info.plist: ${error.message}`);
    }
  }

  try {
    execFileSync("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath], {
      stdio: "pipe"
    });
  } catch (error) {
    errors.push(`codesign verification failed: ${error.stderr?.toString().trim() || error.message}`);
  }
}

if (errors.length > 0) {
  console.error("desktop-smoke failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("desktop-smoke-ok");
