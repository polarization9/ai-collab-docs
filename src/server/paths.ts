import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function isMarkdownPath(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ext === ".md" || ext === ".markdown";
}

export function resolveMarkdownPath(inputPath: string, cwd = process.cwd()): string {
  return path.resolve(cwd, inputPath);
}

export function assertReadableMarkdownFile(absolutePath: string): void {
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Markdown file not found: ${absolutePath}`);
  }

  const stat = fs.statSync(absolutePath);
  if (!stat.isFile()) {
    throw new Error(`Markdown path is not a file: ${absolutePath}`);
  }

  if (!isMarkdownPath(absolutePath)) {
    throw new Error("Only .md and .markdown files are supported.");
  }
}

export function getDisplayRelativePath(absolutePath: string, cwd = process.cwd()): string {
  const relative = path.relative(cwd, absolutePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return absolutePath;
  }
  return relative.startsWith(".") ? relative : `.${path.sep}${relative}`;
}

export function getReviewPath(absolutePath: string): string {
  const parsed = path.parse(absolutePath);
  return path.join(parsed.dir, `${parsed.name}.review.json`);
}

export function getCodexLinkPath(absolutePath: string): string {
  const parsed = path.parse(absolutePath);
  return path.join(parsed.dir, `${parsed.name}.codex.json`);
}

export function getAgentLinkPath(absolutePath: string): string {
  const parsed = path.parse(absolutePath);
  return path.join(parsed.dir, `${parsed.name}.margent-agent.json`);
}

export function getDocumentId(absolutePath: string): string {
  const hash = crypto.createHash("sha1").update(absolutePath).digest("hex").slice(0, 8);
  return `doc_${hash}`;
}
