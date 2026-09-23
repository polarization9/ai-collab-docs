#!/usr/bin/env node
import fs from "node:fs";
import readline from "node:readline";

const statePath = process.env.MARGENT_CODEX_TEST_STATE;
const logPath = process.env.MARGENT_CODEX_TEST_LOG;
function send(value) { process.stdout.write(JSON.stringify(value) + "\n"); }
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const request = JSON.parse(line);
  fs.appendFileSync(logPath, JSON.stringify(request) + "\n");
  if (!request.id) return;
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  const result = (value) => send({ id: request.id, result: value });
  switch (request.method) {
    case "initialize": result({ userAgent: "mock-codex" }); break;
    case "thread/turns/list": result({ data: state.turns ?? [] }); break;
    case "thread/resume": result({ thread: { id: request.params.threadId } }); break;
    case "mcpServerStatus/list": result({ data: [{ name: "margent", tools: [
      "reviewer_get_annotation_context", "reviewer_add_annotation_reply", "reviewer_apply_document_edit",
      "reviewer_update_annotation_status", "reviewer_mark_review_event_handled"
    ] }] }); break;
    case "mcpServer/tool/call": result({}); break;
    case "turn/start":
      result({ turn: { id: "legacy-turn" } });
      setTimeout(() => send({ method: "turn/completed", params: { turn: { id: "legacy-turn", status: "completed" } } }), 100);
      break;
    default: send({ id: request.id, error: { code: -32601, message: "Unknown method" } });
  }
});
