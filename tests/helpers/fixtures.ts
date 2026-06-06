import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CodexDocumentLink } from "../../src/shared/codexTypes.js";
import { getCodexLinkPath } from "../../src/server/paths.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureRoot = path.join(repoRoot, "test-fixtures");

export type TempFixture = {
  dir: string;
  markdownPath: string;
  cleanup(): Promise<void>;
};

export async function createTempFixture(
  markdownName = "p0 mixed path 文档.md"
): Promise<TempFixture> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "margent-p0-"));
  await fs.cp(path.join(fixtureRoot, "markdown"), path.join(dir, "markdown"), {
    recursive: true
  });
  await fs.cp(path.join(fixtureRoot, "images"), path.join(dir, "markdown", "images"), {
    recursive: true
  });
  return {
    dir,
    markdownPath: path.join(dir, "markdown", markdownName),
    cleanup: () => fs.rm(dir, { recursive: true, force: true })
  };
}

export async function writeCodexLink(
  markdownPath: string,
  link: Partial<CodexDocumentLink>
): Promise<void> {
  await fs.writeFile(
    getCodexLinkPath(markdownPath),
    `${JSON.stringify(
      {
        version: 1,
        documentPath: markdownPath,
        ...link
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

export async function fetchJson<T>(
  url: string,
  init?: RequestInit
): Promise<{ status: number; body: T }> {
  const response = await fetch(url, init);
  const body = (await response.json()) as T;
  return { status: response.status, body };
}
