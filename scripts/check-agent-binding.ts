import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import * as zlib from "node:zlib";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createReviewerMcpServer } from "../src/mcp/server.js";
import {
  applyDiscoveredAgentTarget,
  bindAgentSession,
  createAgentSuccessorInstruction,
  getAgentLinkResponse
} from "../src/server/agentLink.js";
import { createDiscoveryEvidence } from "../src/server/agentDiscoveryTypes.js";
import { findDeepSeekHarnessDiscoveryCandidates } from "../src/server/deepSeekHarnessDiscoveryCandidates.js";
import {
  getCodexCommandCandidates,
  sendAnnotationToAgent
} from "../src/server/bridge.js";
import {
  createAnnotation,
  loadReviewFile,
  updateAnnotationStatus
} from "../src/server/review.js";

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "margent-agent-binding-"));
const markdownPath = path.join(tempDir, "test.md");

try {
  await fs.writeFile(markdownPath, "# Test\n", "utf8");

  const macCodexCandidates = getCodexCommandCandidates("darwin");
  const chatGptCodexPath = "/Applications/ChatGPT.app/Contents/Resources/codex";
  const legacyCodexPath = "/Applications/Codex.app/Contents/Resources/codex";
  assert.ok(macCodexCandidates.includes(chatGptCodexPath));
  assert.ok(macCodexCandidates.includes(legacyCodexPath));
  assert.ok(
    macCodexCandidates.indexOf(chatGptCodexPath) <
      macCodexCandidates.indexOf(legacyCodexPath)
  );

  const adaptiveInstruction = createAgentSuccessorInstruction(markdownPath);
  assert.equal(adaptiveInstruction.provider, "custom-cli");
  assert.match(adaptiveInstruction.instruction, /reviewer_bind_current_agent_session/);
  assert.match(adaptiveInstruction.instruction, /DeepSeek Harness/);
  assert.doesNotMatch(adaptiveInstruction.instruction, /reviewer_bind_current_codex_thread/);

  await assert.rejects(
    bindAgentSession(markdownPath, {
      provider: "custom-cli",
      role: "successor"
    }),
    /displayName is required/
  );

  await bindAgentSession(markdownPath, {
    provider: "custom-cli",
    role: "successor",
    sessionId: "hermes-session",
    cwd: tempDir,
    displayName: "Hermes"
  });

  const customLink = await getAgentLinkResponse(markdownPath);
  assert.equal(customLink.connection.hasTarget, true);
  assert.equal(customLink.connection.canDeliver, false);
  assert.equal(customLink.connection.provider, "custom-cli");
  assert.equal(customLink.connection.displayName, "Hermes");

  await applyDiscoveredAgentTarget(markdownPath, {
    target: {
      provider: "codex",
      role: "source",
      sessionId: "codex-session",
      displayName: "Codex"
    }
  });

  const protectedLink = await getAgentLinkResponse(markdownPath);
  assert.equal(protectedLink.connection.provider, "custom-cli");
  assert.equal(protectedLink.connection.displayName, "Hermes");

  const codexInstruction = createAgentSuccessorInstruction(markdownPath, "codex", "Codex");
  assert.match(codexInstruction.instruction, /reviewer_bind_current_agent_session/);
  assert.match(codexInstruction.instruction, /provider: "codex"/);
  assert.doesNotMatch(codexInstruction.instruction, /reviewer_bind_current_codex_thread/);

  await bindAgentSession(markdownPath, {
    provider: "codex",
    role: "successor",
    sessionId: "codex-session",
    displayName: "Codex"
  });
  const codexLink = await getAgentLinkResponse(markdownPath);
  assert.equal(codexLink.connection.provider, "codex");
  assert.equal(codexLink.connection.displayName, "Codex");
  assert.equal(codexLink.connection.canDeliver, true);

  const mcpServer = createReviewerMcpServer({});
  const mcpClient = new Client({ name: "agent-binding-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await mcpServer.connect(serverTransport);
    await mcpClient.connect(clientTransport);
    const togglePath = path.join(tempDir, "toggle.md");
    await fs.writeFile(togglePath, "# Toggle\n");
    const updateLink = async (args: Record<string, unknown>) => {
      const result = await mcpClient.callTool({
        name: "reviewer_update_agent_link",
        arguments: { documentPath: togglePath, ...args }
      });
      assert.notEqual(result.isError, true, JSON.stringify(result));
      return getAgentLinkResponse(togglePath);
    };

    const unbound = await updateLink({ autoSendNewAnnotations: true });
    assert.equal(unbound.connection.autoSendNewAnnotations, false);
    for (const provider of ["codex", "claude-code", "workbuddy", "deepseek-harness"] as const) {
      await bindAgentSession(togglePath, {
        provider, role: "successor", sessionId: `${provider}-session`
      });
      const enabled = await updateLink({ autoSendNewAnnotations: true });
      assert.equal(enabled.connection.autoSendNewAnnotations, true, provider);
      assert.equal(enabled.connection.provider, provider);
      assert.equal(enabled.link?.target?.sessionId, `${provider}-session`);
      const disabled = await updateLink({ autoSendNewAnnotations: false });
      assert.equal(disabled.connection.autoSendNewAnnotations, false, provider);
    }

    await bindAgentSession(togglePath, {
      provider: "codex", role: "successor", sessionId: "codex-target"
    });
    const sourceOnly = await updateLink({
      provider: "custom-cli", displayName: "Hermes", sourceSessionId: "hermes-source",
      autoSendNewAnnotations: true
    });
    assert.equal(sourceOnly.link?.source?.provider, "custom-cli");
    assert.equal(sourceOnly.connection.provider, "codex");
    assert.equal(sourceOnly.connection.autoSendNewAnnotations, true);

    const customTarget = await updateLink({
      provider: "custom-cli", displayName: "Hermes", targetSessionId: "hermes-target",
      targetRole: "successor", autoSendNewAnnotations: true
    });
    assert.equal(customTarget.connection.provider, "custom-cli");
    assert.equal(customTarget.connection.autoSendNewAnnotations, false);
    assert.equal((await updateLink({ autoSendNewAnnotations: true })).connection.autoSendNewAnnotations, false);
    assert.equal((await updateLink({ provider: "codex", autoSendNewAnnotations: true })).connection.autoSendNewAnnotations, false);
  } finally {
    await mcpClient.close();
    await mcpServer.close();
  }

  await bindAgentSession(markdownPath, {
    provider: "custom-cli",
    role: "successor",
    sessionId: "session-deepseek-legacy",
    cwd: tempDir,
    displayName: "DeepSeek Harness"
  });
  const migratedHarnessLink = await getAgentLinkResponse(markdownPath);
  assert.equal(migratedHarnessLink.connection.provider, "deepseek-harness");
  assert.equal(migratedHarnessLink.connection.canDeliver, true);

  const harnessInstruction = createAgentSuccessorInstruction(
    markdownPath,
    "deepseek-harness",
    "DeepSeek Harness"
  );
  assert.match(harnessInstruction.instruction, /provider: "deepseek-harness"/);

  await bindAgentSession(markdownPath, {
    provider: "deepseek-harness",
    role: "successor",
    sessionId: "session-deepseek-test",
    cwd: tempDir,
    endpoint: "http://127.0.0.1:3080"
  });
  const harnessLink = await getAgentLinkResponse(markdownPath);
  assert.equal(harnessLink.connection.provider, "deepseek-harness");
  assert.equal(harnessLink.connection.displayName, "DeepSeek Harness");
  assert.equal(harnessLink.connection.canDeliver, true);
  assert.equal(harnessLink.link?.target?.endpoint, "http://127.0.0.1:3080");

  const dshToolLog = [
    JSON.stringify({
      type: "tool/call",
      data: {
        name: "bash",
        arguments: JSON.stringify({
          command: `mcporter call margent.reviewer_bind_current_agent_session documentPath=${markdownPath} role=successor`
        })
      }
    }),
    JSON.stringify({
      type: "assistant/message",
      data: {
        message: {
          content: [
            {
              type: "tool-call",
              name: "edit",
              arguments: { file_path: markdownPath }
            }
          ]
        }
      }
    })
  ].join("\n");
  const evidence = createDiscoveryEvidence(
    dshToolLog,
    markdownPath,
    JSON.stringify(markdownPath).slice(1, -1)
  );
  assert.equal(evidence.explicitBindCount, 1);
  assert.equal(evidence.successorRoleCount, 1);
  assert.equal(evidence.documentEditSignalCount, 1);

  const evidencePath = path.join(tempDir, "write-guide with spaces.md");
  const otherPath = path.join(tempDir, "other.md");
  const bindingTool = "reviewer_bind_current_agent_session";
  const bindingCommand = `mcporter call margent.${bindingTool} 'documentPath=${evidencePath}' role=successor`;
  const toolEvidence = (name: string, args: unknown) => createDiscoveryEvidence(
    JSON.stringify({ type: "function_call", name, arguments: JSON.stringify(args) }),
    evidencePath, JSON.stringify(evidencePath).slice(1, -1)
  );
  const noStrongEvidence = (name: string, args: unknown) => {
    const result = toolEvidence(name, args);
    assert.ok(result.pathMentionCount > 0);
    assert.equal(result.documentEditSignalCount, 0, `${name}: ${JSON.stringify(args)}`);
    assert.equal(result.explicitBindCount, 0, `${name}: ${JSON.stringify(args)}`);
    assert.equal(result.margentOperationCount, 0, `${name}: ${JSON.stringify(args)}`);
  };
  noStrongEvidence("Read", { file_path: evidencePath });
  noStrongEvidence("Write", { file_path: otherPath, content: `${bindingTool} ${evidencePath}` });
  noStrongEvidence("reviewer_add_annotation_reply", { documentPath: otherPath, body: evidencePath });
  noStrongEvidence("bash", { command: `rg ${bindingTool} '${evidencePath}'` });
  noStrongEvidence("bash", { command: `echo "${bindingCommand}"` });
  noStrongEvidence("Read", { file_path: otherPath, example: bindingCommand });
  noStrongEvidence("bash", { command: `${bindingCommand} --help` });
  noStrongEvidence("bash", { command: `false && ${bindingCommand}` });
  noStrongEvidence("bash", { command: `${bindingCommand} | cat` });
  noStrongEvidence("bash", { command: `${bindingCommand} sessionId=$SESSION_ID` });
  noStrongEvidence("apply_patch", { patch: `*** Begin Patch\n*** Update File: ${otherPath}\n@@\n+${evidencePath}\n*** End Patch` });

  for (const name of ["Write", "Edit", "MultiEdit", "write", "edit", "multiedit"]) {
    const edited = toolEvidence(name, { file_path: evidencePath, content: bindingTool });
    assert.equal(edited.documentEditSignalCount, 1, name);
    assert.equal(edited.explicitBindCount, 0, name);
  }
  for (const name of [bindingTool, `mcp__margent__${bindingTool}`, `mcp__prd_reviewer__${bindingTool}`]) {
    const bound = toolEvidence(name, { documentPath: evidencePath, role: "successor", body: "role=source" });
    assert.equal(bound.explicitBindCount, 1, name);
    assert.equal(bound.successorRoleCount, 1, name);
    assert.equal(bound.sourceRoleCount, 0, name);
    assert.equal(bound.documentEditSignalCount, 0, name);
  }
  for (const command of [
    bindingCommand,
    `/usr/local/bin/${bindingCommand} --output json`,
    `mcporter call prd_reviewer.${bindingTool} --args '${JSON.stringify({ documentPath: evidencePath, role: "successor" })}'`
  ]) {
    const bound = toolEvidence("bash", { command });
    assert.equal(bound.explicitBindCount, 1, command);
    assert.equal(bound.successorRoleCount, 1, command);
  }
  const contextRead = toolEvidence("reviewer_get_annotation_context", { documentPath: evidencePath });
  assert.equal(contextRead.margentOperationCount, 1);
  assert.equal(contextRead.documentEditSignalCount, 0);
  const patchEvidence = createDiscoveryEvidence(JSON.stringify({
    type: "response_item",
    payload: {
      type: "custom_tool_call", name: "apply_patch",
      input: `*** Begin Patch\n*** Update File: ${evidencePath}\n@@\n-old\n+new\n*** End Patch`
    }
  }), evidencePath, JSON.stringify(evidencePath).slice(1, -1));
  assert.equal(patchEvidence.documentEditSignalCount, 1);

  const forkHome = path.join(tempDir, "dsh-fork-home");
  const sessionHeaders = [
    { id: "main" },
    { id: "user-fork", parentSession: "main" },
    { id: "user-fork-id", parentSessionId: "main" },
    { id: "subagent", parentSession: "main", origin: "subagent" },
    { id: "subagent-no-parent", origin: "subagent" }
  ];
  for (const header of sessionHeaders) {
    const directory = path.join(forkHome, "sessions", "--test--", header.id);
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, "session.jsonl"),
      `${JSON.stringify({ type: "session", cwd: tempDir, ...header })}\n${dshToolLog}\n`);
  }
  const previousForkHome = process.env.DEEPSEEK_HARNESS_HOME;
  process.env.DEEPSEEK_HARNESS_HOME = forkHome;
  try {
    const candidates = await findDeepSeekHarnessDiscoveryCandidates(markdownPath);
    assert.deepEqual(candidates.map(candidate => candidate.sessionId).sort(), ["main", "user-fork", "user-fork-id"]);
    assert.ok(candidates.every(candidate => candidate.evidence.explicitBindCount === 1));
  } finally {
    if (previousForkHome === undefined) delete process.env.DEEPSEEK_HARNESS_HOME;
    else process.env.DEEPSEEK_HARNESS_HOME = previousForkHome;
  }

  const zstdCompress = (
    zlib as unknown as { zstdCompressSync?: (source: Buffer) => Buffer }
  ).zstdCompressSync;
  if (zstdCompress) {
    const dshHome = path.join(tempDir, "dsh-home");
    const sessionDir = path.join(
      dshHome,
      "sessions",
      "--test--",
      "session-deepseek-test"
    );
    await fs.mkdir(sessionDir, { recursive: true });
    const header = `${JSON.stringify({
      type: "session",
      version: 0,
      id: "session-deepseek-test",
      parentSession: "parent-session",
      cwd: tempDir
    })}\n`;
    await fs.writeFile(
      path.join(sessionDir, "session.jsonl.zstd"),
      Buffer.concat([
        zstdCompress(Buffer.from(header)),
        zstdCompress(Buffer.from(`${dshToolLog}\n`))
      ])
    );
    const previousDshHome = process.env.DEEPSEEK_HARNESS_HOME;
    process.env.DEEPSEEK_HARNESS_HOME = dshHome;
    try {
      const candidates = await findDeepSeekHarnessDiscoveryCandidates(markdownPath);
      assert.equal(candidates.length, 1);
      assert.equal(candidates[0]?.provider, "deepseek-harness");
      assert.equal(candidates[0]?.sessionId, "session-deepseek-test");
      assert.equal(candidates[0]?.role, "successor");
    } finally {
      if (previousDshHome === undefined) {
        delete process.env.DEEPSEEK_HARNESS_HOME;
      } else {
        process.env.DEEPSEEK_HARNESS_HOME = previousDshHome;
      }
    }
  }

  let promptAccepted = false;
  let postPromptListCount = 0;
  let completionError: unknown;
  let completionApplied = false;
  let receivedPromptPayload: Record<string, unknown> | undefined;
  const mockDsh = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.from(chunk));
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
      rpcId: string;
      method: string;
      payload: Record<string, unknown>;
    };
    response.setHeader("content-type", "application/json");

    if (body.method === "session.list") {
      if (promptAccepted) {
        postPromptListCount += 1;
      }
      if (promptAccepted && postPromptListCount >= 3 && !completionApplied) {
        completionApplied = true;
        try {
          const review = await loadReviewFile(markdownPath);
          const event = review.events?.[review.events.length - 1];
          if (!event) {
            throw new Error("DeepSeek Harness mock event was not created.");
          }
          await updateAnnotationStatus(markdownPath, event.annotationId, {
            status: "resolved",
            eventId: event.id
          });
        } catch (error) {
          completionError = error;
        }
      }
      response.end(
        JSON.stringify({
          type: "server-response",
          rpcId: body.rpcId,
          result: {
            ok: true,
            value: {
              items: [
                {
                  sessionId: "session-deepseek-test",
                  updatedAt: promptAccepted && postPromptListCount >= 2 ? 2 : 1,
                  running: !promptAccepted || postPromptListCount === 2,
                  blank: false,
                  cwd: tempDir
                }
              ]
            }
          }
        })
      );
      return;
    }

    if (body.method === "session.prompt") {
      promptAccepted = true;
      receivedPromptPayload = body.payload;
      response.end(
        JSON.stringify({
          type: "server-response",
          rpcId: body.rpcId,
          result: { ok: true, value: { accepted: true } }
        })
      );
      return;
    }

    response.statusCode = 404;
    response.end();
  });
  await new Promise<void>((resolve) => mockDsh.listen(0, "127.0.0.1", resolve));
  try {
    const address = mockDsh.address() as AddressInfo;
    await bindAgentSession(markdownPath, {
      provider: "deepseek-harness",
      role: "successor",
      sessionId: "session-deepseek-test",
      cwd: tempDir,
      endpoint: `http://127.0.0.1:${address.port}`
    });
    const review = await createAnnotation(markdownPath, {
      body: "Reply with a short confirmation.",
      anchor: {
        kind: "document",
        headingId: null,
        headingText: null,
        selectedText: ""
      }
    });
    const annotation = review.annotations[review.annotations.length - 1];
    assert.ok(annotation);
    const delivery = await sendAnnotationToAgent(markdownPath, annotation.id);
    assert.equal(delivery.ok, true);
    assert.equal(delivery.event?.deliveryStatus, "handled");
    assert.equal(completionError, undefined);
    assert.equal(receivedPromptPayload?.sessionId, "session-deepseek-test");
    assert.equal(receivedPromptPayload?.mode, "queue");
    assert.match(JSON.stringify(receivedPromptPayload), /DeepSeek Harness/);
  } finally {
    await new Promise<void>((resolve, reject) =>
      mockDsh.close((error) => (error ? reject(error) : resolve()))
    );
  }

  console.log("agent-binding-ok");
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}
