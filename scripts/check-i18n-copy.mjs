import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const zhPath = path.join(root, "src/web/i18n/locales/zh-CN.ts");
const enPath = path.join(root, "src/web/i18n/locales/en-US.ts");
const resources = [
  path.join(root, "src-tauri/resources/en.lproj/InfoPlist.strings"),
  path.join(root, "src-tauri/resources/zh-Hans.lproj/InfoPlist.strings")
];

function extractMessages(source) {
  const messages = new Map();
  const pattern = /"([^"\\]+)"\s*:\s*"((?:\\.|[^"\\])*)"/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    messages.set(match[1], match[2]);
  }
  return messages;
}

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(fullPath)));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

async function collectUsedKeys() {
  const files = await walk(path.join(root, "src/web"));
  const used = new Map();
  const pattern = /\bt\(\s*["']([^"']+)["']/g;
  for (const file of files) {
    const source = await fs.readFile(file, "utf8");
    let match;
    while ((match = pattern.exec(source)) !== null) {
      const key = match[1];
      if (!used.has(key)) {
        used.set(key, []);
      }
      used.get(key).push(path.relative(root, file));
    }
  }
  return used;
}

async function checkNativeResource(resourcePath, errors) {
  let source;
  try {
    source = await fs.readFile(resourcePath, "utf8");
  } catch (error) {
    errors.push(`Missing native i18n resource: ${path.relative(root, resourcePath)}`);
    return;
  }

  for (const key of ["CFBundleDisplayName", "CFBundleName", "CFBundleTypeName"]) {
    const pattern = new RegExp(`"?${key}"?\\s*=\\s*"([^"]+)"`);
    const match = source.match(pattern);
    if (!match || !match[1].trim()) {
      errors.push(`${path.relative(root, resourcePath)} is missing ${key}`);
    }
  }
}

const errors = [];
const [zhSource, enSource] = await Promise.all([
  fs.readFile(zhPath, "utf8"),
  fs.readFile(enPath, "utf8")
]);
const zhMessages = extractMessages(zhSource);
const enMessages = extractMessages(enSource);

for (const key of zhMessages.keys()) {
  if (!enMessages.has(key)) {
    errors.push(`Missing en-US copy for key: ${key}`);
  }
}
for (const key of enMessages.keys()) {
  if (!zhMessages.has(key)) {
    errors.push(`Extra en-US copy key not present in zh-CN: ${key}`);
  }
}

for (const [locale, messages] of [
  ["zh-CN", zhMessages],
  ["en-US", enMessages]
]) {
  for (const [key, value] of messages.entries()) {
    if (!value.trim()) {
      errors.push(`${locale} copy is empty for key: ${key}`);
    }
    if (value.trim() === key) {
      errors.push(`${locale} copy appears to expose raw key: ${key}`);
    }
  }
}

const usedKeys = await collectUsedKeys();
for (const [key, files] of usedKeys.entries()) {
  if (!zhMessages.has(key)) {
    errors.push(`Missing zh-CN copy for used key ${key} in ${files.join(", ")}`);
  }
  if (!enMessages.has(key)) {
    errors.push(`Missing en-US copy for used key ${key} in ${files.join(", ")}`);
  }
}

await Promise.all(resources.map((resourcePath) => checkNativeResource(resourcePath, errors)));

if (errors.length > 0) {
  console.error("i18n-copy-check failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("i18n-copy-ok");
