import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();
const tauriConfigPath = path.join(repoRoot, "src-tauri", "tauri.conf.json");
const bundleDir = path.join(repoRoot, "src-tauri", "target", "release", "bundle");
const macosBundleDir = path.join(bundleDir, "macos");

const tauriConfig = JSON.parse(fs.readFileSync(tauriConfigPath, "utf8"));
const version = process.env.MARGENT_RELEASE_VERSION || tauriConfig.version;
const notes =
  process.env.MARGENT_RELEASE_NOTES ||
  readExistingNotes(path.join(macosBundleDir, "latest.json")) ||
  `Margent ${version}`;
const pubDate = process.env.MARGENT_RELEASE_PUB_DATE || new Date().toISOString();
const signaturePath = path.join(macosBundleDir, "Margent.app.tar.gz.sig");
const signature = fs.readFileSync(signaturePath, "utf8").trim();

const githubBaseUrl =
  process.env.MARGENT_GITHUB_RELEASE_BASE_URL ||
  `https://github.com/polarization9/ai-collab-docs/releases/download/v${version}`;
const mirrorBaseUrl =
  process.env.MARGENT_MIRROR_RELEASE_BASE_URL ||
  `https://download.margent.org/releases/v${version}`;

writeManifest("latest.github.json", `${githubBaseUrl}/Margent.app.tar.gz`);
writeManifest("latest.mirror.json", `${mirrorBaseUrl}/Margent.app.tar.gz`);

console.log(`Wrote updater manifests for Margent ${version}:`);
console.log(`- ${path.join(macosBundleDir, "latest.github.json")}`);
console.log(`- ${path.join(macosBundleDir, "latest.mirror.json")}`);

function writeManifest(fileName, url) {
  const manifest = {
    version,
    notes,
    pub_date: pubDate,
    platforms: {
      "darwin-aarch64": {
        signature,
        url
      }
    }
  };
  fs.writeFileSync(path.join(macosBundleDir, fileName), `${JSON.stringify(manifest, null, 2)}\n`);
}

function readExistingNotes(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return typeof parsed.notes === "string" ? parsed.notes : "";
  } catch {
    return "";
  }
}
