import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const repo = args.repo ?? detectRepo();
const outputDir = path.resolve(args.outputDir ?? ".margent-metrics");

if (!repo) {
  console.error("Usage: node scripts/github-metrics-snapshot.mjs [owner/repo]");
  console.error("Or run it inside a git repository with a GitHub origin remote.");
  process.exit(1);
}

const capturedAt = new Date().toISOString();
const [views, clones, referrers, popularPaths, releases] = await Promise.all([
  ghApi(`/repos/${repo}/traffic/views`),
  ghApi(`/repos/${repo}/traffic/clones`),
  ghApi(`/repos/${repo}/traffic/popular/referrers`),
  ghApi(`/repos/${repo}/traffic/popular/paths`),
  ghApi(`/repos/${repo}/releases`, ["--paginate"])
]);

const releaseAssets = releases.flatMap((release) =>
  release.assets.map((asset) => ({
    release: release.tag_name || release.name || "(untagged)",
    draft: release.draft,
    prerelease: release.prerelease,
    asset: asset.name,
    downloads: asset.download_count,
    size: asset.size,
    createdAt: asset.created_at,
    updatedAt: asset.updated_at,
    url: asset.browser_download_url
  }))
);

const snapshot = {
  capturedAt,
  repo,
  releaseDownloads: {
    total: releaseAssets.reduce((sum, asset) => sum + asset.downloads, 0),
    assets: releaseAssets
  },
  traffic: {
    views,
    clones,
    referrers,
    popularPaths
  }
};

fs.mkdirSync(outputDir, { recursive: true });
fs.appendFileSync(
  path.join(outputDir, "github-traffic-snapshots.jsonl"),
  `${JSON.stringify(snapshot)}\n`,
  "utf8"
);
fs.writeFileSync(path.join(outputDir, "latest.json"), `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

const latestView = views.views?.at(-1);
const latestClone = clones.clones?.at(-1);

console.log(`Repository: ${repo}`);
console.log(`Captured at: ${capturedAt}`);
console.log(`Release downloads total: ${snapshot.releaseDownloads.total}`);
console.log(
  `Traffic window views: ${views.count ?? 0} views, ${views.uniques ?? 0} unique visitors`
);
console.log(`Traffic window clones: ${clones.count ?? 0} clones, ${clones.uniques ?? 0} unique cloners`);
if (latestView) {
  console.log(
    `Latest view day: ${latestView.timestamp} — ${latestView.count} views, ${latestView.uniques} uniques`
  );
}
if (latestClone) {
  console.log(
    `Latest clone day: ${latestClone.timestamp} — ${latestClone.count} clones, ${latestClone.uniques} uniques`
  );
}
console.log(`Snapshot written: ${path.join(outputDir, "github-traffic-snapshots.jsonl")}`);

function parseArgs(rawArgs) {
  const parsed = {
    repo: undefined,
    outputDir: undefined
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--output-dir") {
      parsed.outputDir = rawArgs[index + 1];
      index += 1;
      continue;
    }
    if (!arg.startsWith("-") && !parsed.repo) {
      parsed.repo = arg;
    }
  }

  return parsed;
}

function ghApi(route, extraArgs = []) {
  const output = execFileSync("gh", ["api", route, ...extraArgs], {
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
