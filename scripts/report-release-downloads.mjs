import { execFileSync } from "node:child_process";

const repo = process.argv[2] ?? detectRepo();

if (!repo) {
  console.error("Usage: node scripts/report-release-downloads.mjs <owner/repo>");
  console.error("Or run it inside a git repository with a GitHub origin remote.");
  process.exit(1);
}

const releases = fetchReleases(repo);
const rows = releases.flatMap((release) =>
  release.assets.map((asset) => ({
    release: release.tag_name || release.name || "(untagged)",
    draft: release.draft,
    prerelease: release.prerelease,
    asset: asset.name,
    downloads: asset.download_count,
    sizeMb: asset.size ? (asset.size / 1024 / 1024).toFixed(1) : "0.0",
    createdAt: asset.created_at
  }))
);

const totalDownloads = rows.reduce((sum, row) => sum + row.downloads, 0);

console.log(`Repository: ${repo}`);
console.log(`Release assets: ${rows.length}`);
console.log(`Total downloads: ${totalDownloads}`);
console.log("");

if (rows.length === 0) {
  console.log("No release assets found.");
  process.exit(0);
}

console.table(rows);

function fetchReleases(repoName) {
  const output = execFileSync("gh", ["api", `/repos/${repoName}/releases`, "--paginate"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  return JSON.parse(output);
}

function detectRepo() {
  try {
    const remote = execFileSync("git", ["remote", "get-url", "origin"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    const httpsMatch = remote.match(/github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?$/);
    if (!httpsMatch) {
      return null;
    }
    return `${httpsMatch[1]}/${httpsMatch[2]}`;
  } catch {
    return null;
  }
}
