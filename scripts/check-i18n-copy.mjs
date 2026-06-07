import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

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

function shouldScanForHardcodedCopy(file) {
  const relative = path.relative(root, file);
  return (
    relative.endsWith(".tsx") &&
    relative.startsWith("src/web/") &&
    !relative.startsWith("src/web/i18n/") &&
    !relative.startsWith("src/web/prototypes/")
  );
}

function normalizeCopy(text) {
  return text.replace(/\s+/g, " ").trim();
}

function hasHumanCopy(text) {
  return /[A-Za-z\u4e00-\u9fff]/.test(text);
}

function locationFor(sourceFile, position) {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(position);
  return `${path.relative(root, sourceFile.fileName)}:${line + 1}:${character + 1}`;
}

function collectHardcodedCopyIssues(file, source) {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const issues = [];

  function addIssue(node, text, kind) {
    const normalized = normalizeCopy(text);
    if (!normalized || !hasHumanCopy(normalized)) {
      return;
    }
    issues.push(`${locationFor(sourceFile, node.getStart(sourceFile))} hardcoded ${kind}: "${normalized}"`);
  }

  function visit(node) {
    if (ts.isJsxText(node)) {
      addIssue(node, node.getText(sourceFile), "visible copy");
    }

    if (ts.isJsxAttribute(node) && isCopyAttribute(node.name.text)) {
      const initializer = node.initializer;
      if (initializer && ts.isStringLiteral(initializer)) {
        addIssue(initializer, initializer.text, `${node.name.text} copy`);
      } else if (
        initializer &&
        ts.isJsxExpression(initializer) &&
        initializer.expression &&
        hasHardcodedStringExpression(initializer.expression)
      ) {
        addIssue(initializer.expression, initializer.expression.getText(sourceFile), `${node.name.text} copy`);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return issues;
}

function isCopyAttribute(name) {
  return name === "aria-label" || name === "title" || name === "placeholder";
}

function hasHardcodedStringExpression(expression) {
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return hasHumanCopy(expression.text);
  }

  if (ts.isTemplateExpression(expression)) {
    return hasHumanCopy(expression.head.text) ||
      expression.templateSpans.some((span) => hasHumanCopy(span.literal.text));
  }

  if (ts.isConditionalExpression(expression)) {
    return hasHardcodedStringExpression(expression.whenTrue) ||
      hasHardcodedStringExpression(expression.whenFalse);
  }

  return false;
}

async function checkHardcodedProductionCopy(errors) {
  const files = await walk(path.join(root, "src/web"));
  for (const file of files.filter(shouldScanForHardcodedCopy)) {
    const source = await fs.readFile(file, "utf8");
    errors.push(...collectHardcodedCopyIssues(file, source));
  }
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
await checkHardcodedProductionCopy(errors);

if (errors.length > 0) {
  console.error("i18n-copy-check failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("i18n-copy-ok");
