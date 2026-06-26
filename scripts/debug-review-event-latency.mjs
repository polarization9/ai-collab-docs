#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const inputPath = process.argv[2];
const intervalMs = Number(process.argv[3] ?? 500);

if (!inputPath) {
  console.error("Usage: node scripts/debug-review-event-latency.mjs <Document.md|Document.review.json> [intervalMs]");
  process.exit(1);
}

const reviewPath = resolveReviewPath(inputPath);
const seen = new Map();

console.log(`[margent-latency] watching ${reviewPath}`);
console.log(`[margent-latency] polling every ${intervalMs}ms`);

poll();
const timer = setInterval(poll, Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 500);

process.on("SIGINT", () => {
  clearInterval(timer);
  console.log("\n[margent-latency] stopped");
  process.exit(0);
});

function poll() {
  let review;
  try {
    review = JSON.parse(fs.readFileSync(reviewPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return;
    }
    log("read-error", String(error?.message ?? error));
    return;
  }

  for (const event of review.events ?? []) {
    observeEvent(event);
  }
}

function observeEvent(event) {
  const previous = seen.get(event.id);
  const fingerprint = [
    event.deliveryStatus,
    event.updatedAt,
    event.lastError ?? "",
    event.delivery?.adapter ?? "",
    event.delivery?.provider ?? "",
    event.delivery?.sessionId ?? event.delivery?.threadId ?? "",
    event.delivery?.turnId ?? "",
    event.delivery?.deliveryId ?? "",
    event.delivery?.lastAttemptAt ?? ""
  ].join("|");

  if (previous?.fingerprint === fingerprint) {
    return;
  }

  const createdAt = toTime(event.createdAt);
  const updatedAt = toTime(event.updatedAt);
  const lastAttemptAt = toTime(event.delivery?.lastAttemptAt);
  const now = Date.now();
  const totalMs = createdAt ? (updatedAt ?? now) - createdAt : undefined;
  const attemptMs = lastAttemptAt && createdAt ? lastAttemptAt - createdAt : undefined;

  const transition = previous
    ? `${previous.status} -> ${event.deliveryStatus}`
    : `new ${event.deliveryStatus}`;
  const pieces = [
    transition,
    `event=${event.id}`,
    `annotation=${event.annotationId}`,
    event.delivery?.provider ? `provider=${event.delivery.provider}` : undefined,
    event.delivery?.adapter ? `adapter=${event.delivery.adapter}` : undefined,
    event.delivery?.turnId ? `turn=${event.delivery.turnId}` : undefined,
    formatDuration("total", totalMs),
    formatDuration("attempt", attemptMs),
    event.lastError ? `error=${event.lastError}` : undefined
  ].filter(Boolean);

  log("event", pieces.join(" "));
  seen.set(event.id, {
    fingerprint,
    status: event.deliveryStatus,
    observedAt: now
  });
}

function resolveReviewPath(filePath) {
  const absolutePath = path.resolve(filePath);
  if (absolutePath.endsWith(".review.json")) {
    return absolutePath;
  }
  const parsed = path.parse(absolutePath);
  return path.join(parsed.dir, `${parsed.name}.review.json`);
}

function toTime(value) {
  if (typeof value !== "string" || !value) {
    return undefined;
  }
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : undefined;
}

function formatDuration(label, value) {
  if (!Number.isFinite(value)) {
    return undefined;
  }
  return `${label}=${(value / 1000).toFixed(1)}s`;
}

function log(kind, message) {
  const timestamp = new Date().toLocaleTimeString();
  console.log(`[${timestamp}] [${kind}] ${message}`);
}
