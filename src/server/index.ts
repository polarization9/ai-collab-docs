import express from "express";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createSuccessorInstruction,
  getCodexLinkResponse,
  getSourceThreadId,
  loadCodexDocumentLink,
  updateCodexDocumentLink
} from "./codexLink.js";
import {
  createAgentSuccessorInstruction,
  getAgentLinkResponse,
  getSourceSessionId,
  loadAgentDocumentLink,
  updateAgentDocumentLink
} from "./agentLink.js";
import { discoverAgentSourceForDocument } from "./agentDiscovery.js";
import {
  listRecentDocuments,
  loadAppSettings,
  rememberRecentDocument,
  removeRecentDocument,
  saveAppSettings
} from "./appState.js";
import {
  dispatchReviewEvents,
  dispatchReviewEventsInBackground,
  retryReviewEvent,
  sendAnnotationToAgent,
  sendAnnotationToCodex
} from "./bridge.js";
import { loadReviewDocument } from "./document.js";
import { DocumentConflictError, saveReviewDocument } from "./documentEdit.js";
import { getDocumentMergeStatus } from "./documentMerge.js";
import { repairReviewAnchors } from "./reviewAnchorRepair.js";
import { assertReadableMarkdownFile, getAgentLinkPath, getCodexLinkPath, getReviewPath, resolveMarkdownPath } from "./paths.js";
import { getAnnotationContext } from "./reviewContext.js";
import {
  addAnnotationReply,
  AnnotationNotFoundError,
  createAnnotation,
  createReviewEvent,
  deleteAnnotation,
  getReviewEvent,
  loadReviewFile,
  ReplyNotFoundError,
  ReviewEventNotFoundError,
  listReviewEvents,
  replaceReviewFile,
  saveReviewFile,
  updateAnnotation,
  updateAnnotationReply,
  updateReviewEvent,
  updateAnnotationStatus,
  withReviewFileMutation
} from "./review.js";
import type { UpdateCodexLinkRequest } from "../shared/codexTypes.js";
import type { AgentProvider, UpdateAgentLinkRequest } from "../shared/agentTypes.js";
import type { DocumentMergeStatusRequest, SaveDocumentRequest } from "../shared/editTypes.js";
import type {
  AddReplyRequest,
  CreateAnnotationRequest,
  CreateReviewEventRequest,
  ReviewEventDeliveryStatus,
  ReviewFile,
  ReviewReply,
  UpdateAnnotationRequest,
  UpdateAnnotationStatusRequest,
  UpdateReviewEventRequest,
  UpdateReplyRequest
} from "../shared/reviewTypes.js";
import type { AppSettings } from "../shared/appSettingsTypes.js";
import type { OpenDocumentRequest, ReviewBootstrap, ReviewSession } from "../shared/types.js";

export type StartServerOptions = {
  markdownPath?: string;
  port: number;
  dev?: boolean;
  desktopToken?: string;
};

export type StartedServer = {
  app: express.Express;
  server: http.Server;
  url: string;
};

const DOCUMENT_ASSET_EXTENSIONS = new Set([
  ".avif",
  ".bmp",
  ".gif",
  ".jpeg",
  ".jpg",
  ".png",
  ".svg",
  ".webp"
]);
const API_JSON_BODY_LIMIT = "8mb";

export function startServer(options: StartServerOptions): Promise<StartedServer> {
  const app = express();
  const host = "127.0.0.1";
  let markdownPath = options.markdownPath;
  const documentContentCache = new Map<string, string>();

  app.use(express.json({ limit: API_JSON_BODY_LIMIT }));

  app.get("/health", (_request, response) => {
    response.json({ ok: true });
  });

  app.use("/api", createDesktopTokenMiddleware(options.desktopToken));

  app.get("/api/session", async (_request, response) => {
    try {
      response.json(await getReviewSession(markdownPath));
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get("/api/bootstrap", async (_request, response) => {
    try {
      response.json(await getReviewBootstrap(markdownPath));
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get("/api/app/settings", async (_request, response) => {
    try {
      response.json(await loadAppSettings());
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.put("/api/app/settings", async (request, response) => {
    try {
      response.json(await saveAppSettings(request.body as Partial<AppSettings>));
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get("/api/recent-documents", async (_request, response) => {
    try {
      response.json(await listRecentDocuments());
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.delete("/api/recent-documents", async (request, response) => {
    try {
      if (typeof request.query.path !== "string") {
        throw new Error("Recent document path is required.");
      }
      response.json(await removeRecentDocument(request.query.path));
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post("/api/session/document", async (request, response) => {
    try {
      const nextMarkdownPath = openMarkdownPathFromRequest(request.body as OpenDocumentRequest);
      markdownPath = nextMarkdownPath;
      const document = await loadReviewDocument(nextMarkdownPath);
      documentContentCache.set(nextMarkdownPath, document.content);
      await rememberRecentDocument(nextMarkdownPath);
      discoverAgentSourceAndDispatchReviewEventsInBackground(nextMarkdownPath);
      response.json(document);
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post("/api/session/pick-document", async (_request, response) => {
    try {
      const selectedPath = await pickMarkdownPath();
      const nextMarkdownPath = openMarkdownPath(selectedPath);
      markdownPath = nextMarkdownPath;
      const document = await loadReviewDocument(nextMarkdownPath);
      documentContentCache.set(nextMarkdownPath, document.content);
      await rememberRecentDocument(nextMarkdownPath);
      discoverAgentSourceAndDispatchReviewEventsInBackground(nextMarkdownPath);
      response.json(document);
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get("/api/document", async (request, response) => {
    try {
      const currentMarkdownPath = getRequestMarkdownPath(request, markdownPath);
      const document = await loadDocumentAndRepairExternalChanges(
        currentMarkdownPath,
        documentContentCache
      );
      response.json(document);
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get("/api/document-asset", (request, response) => {
    try {
      const currentMarkdownPath = getRequestMarkdownPath(request, markdownPath);
      const assetPath = resolveDocumentAssetPath(currentMarkdownPath, request.query.src);
      response.sendFile(assetPath, (error) => {
        if (error && !response.headersSent) {
          sendApiError(response, error);
        }
      });
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.put("/api/document", async (request, response) => {
    try {
      const currentMarkdownPath = getRequestMarkdownPath(request, markdownPath);
      const result = await saveReviewDocument(
        currentMarkdownPath,
        request.body as SaveDocumentRequest
      );
      documentContentCache.set(currentMarkdownPath, result.document.content);
      response.json(result);
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post("/api/document/merge-status", async (request, response) => {
    try {
      const currentMarkdownPath = getRequestMarkdownPath(request, markdownPath);
      response.json(
        await getDocumentMergeStatus(
          currentMarkdownPath,
          request.body as DocumentMergeStatusRequest
        )
      );
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get("/api/review", async (request, response) => {
    try {
      const currentMarkdownPath = getRequestMarkdownPath(request, markdownPath);
      response.json(await loadReviewFile(currentMarkdownPath));
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get("/api/agent-link", async (request, response) => {
    try {
      const currentMarkdownPath = getRequestMarkdownPath(request, markdownPath);
      response.json(await getAgentLinkResponse(currentMarkdownPath));
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.put("/api/agent-link", async (request, response) => {
    try {
      const currentMarkdownPath = getRequestMarkdownPath(request, markdownPath);
      const link = await updateAgentDocumentLink(
        currentMarkdownPath,
        request.body as UpdateAgentLinkRequest
      );
      response.json(await getAgentLinkResponse(link.documentPath));
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post("/api/agent-link/successor-instruction", async (request, response) => {
    try {
      const currentMarkdownPath = getRequestMarkdownPath(request, markdownPath);
      response.json(
        createAgentSuccessorInstruction(currentMarkdownPath, readAgentProviderRequest(request))
      );
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post("/api/agent-link/successor-instruction/copy", async (request, response) => {
    try {
      const currentMarkdownPath = getRequestMarkdownPath(request, markdownPath);
      const instruction = createAgentSuccessorInstruction(
        currentMarkdownPath,
        readAgentProviderRequest(request)
      );
      await writeSystemClipboardText(instruction.instruction);
      response.json(instruction);
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get("/api/codex-link", async (request, response) => {
    try {
      const currentMarkdownPath = getRequestMarkdownPath(request, markdownPath);
      response.json(await getCodexLinkResponse(currentMarkdownPath));
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.put("/api/codex-link", async (request, response) => {
    try {
      const currentMarkdownPath = getRequestMarkdownPath(request, markdownPath);
      const link = await updateCodexDocumentLink(
        currentMarkdownPath,
        request.body as UpdateCodexLinkRequest
      );
      response.json(await getCodexLinkResponse(link.documentPath));
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post("/api/codex-link/successor-instruction", async (request, response) => {
    try {
      const currentMarkdownPath = getRequestMarkdownPath(request, markdownPath);
      response.json(createSuccessorInstruction(currentMarkdownPath));
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post("/api/codex-link/successor-instruction/copy", async (request, response) => {
    try {
      const currentMarkdownPath = getRequestMarkdownPath(request, markdownPath);
      const instruction = createSuccessorInstruction(currentMarkdownPath);
      await writeSystemClipboardText(instruction.instruction);
      response.json(instruction);
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post("/api/clipboard/text", async (request, response) => {
    try {
      await writeSystemClipboardText(readClipboardTextRequest(request.body));
      response.json({ ok: true });
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.put("/api/review", async (request, response) => {
    try {
      const currentMarkdownPath = getRequestMarkdownPath(request, markdownPath);
      response.json(await replaceReviewFile(currentMarkdownPath, request.body as ReviewFile));
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post("/api/review/annotations", async (request, response) => {
    try {
      const currentMarkdownPath = getRequestMarkdownPath(request, markdownPath);
      let review = await createAnnotation(
        currentMarkdownPath,
        request.body as CreateAnnotationRequest
      );
      const created = review.annotations[review.annotations.length - 1];
      const agentLink = await getAgentLinkResponse(currentMarkdownPath);
      if (
        created &&
        agentLink.connection.autoSendNewAnnotations &&
        agentLink.connection.hasTarget
      ) {
        review = await createReviewEvent(currentMarkdownPath, {
          annotationId: created.id,
          deliveryMode: "auto"
        });
        dispatchReviewEventsInBackground(currentMarkdownPath);
      }
      response.status(201).json(review);
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post("/api/review/annotations/:id/replies", async (request, response) => {
    try {
      const currentMarkdownPath = getRequestMarkdownPath(request, markdownPath);
      const replyRequest = request.body as AddReplyRequest;
      let review = await addAnnotationReply(currentMarkdownPath, request.params.id, replyRequest);
      const createdReply = findLatestReply(review, request.params.id);
      if (shouldAutoSendReplyFollowup(createdReply)) {
        review = await createReviewEvent(currentMarkdownPath, {
          annotationId: request.params.id,
          deliveryMode: "auto",
          triggerReplyId: createdReply.id
        });
        dispatchReviewEventsInBackground(currentMarkdownPath);
      }
      response.json(review);
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.patch("/api/review/annotations/:id", async (request, response) => {
    try {
      const currentMarkdownPath = getRequestMarkdownPath(request, markdownPath);
      response.json(
        await updateAnnotation(
          currentMarkdownPath,
          request.params.id,
          request.body as UpdateAnnotationRequest
        )
      );
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.delete("/api/review/annotations/:id", async (request, response) => {
    try {
      const currentMarkdownPath = getRequestMarkdownPath(request, markdownPath);
      response.json(await deleteAnnotation(currentMarkdownPath, request.params.id));
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.patch("/api/review/annotations/:id/replies/:replyId", async (request, response) => {
    try {
      const currentMarkdownPath = getRequestMarkdownPath(request, markdownPath);
      response.json(
        await updateAnnotationReply(
          currentMarkdownPath,
          request.params.id,
          request.params.replyId,
          request.body as UpdateReplyRequest
        )
      );
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.patch("/api/review/annotations/:id/status", async (request, response) => {
    try {
      const currentMarkdownPath = getRequestMarkdownPath(request, markdownPath);
      response.json(
        await updateAnnotationStatus(
          currentMarkdownPath,
          request.params.id,
          request.body as UpdateAnnotationStatusRequest
        )
      );
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get("/api/review/annotations/:id/context", async (request, response) => {
    try {
      const currentMarkdownPath = getRequestMarkdownPath(request, markdownPath);
      response.json(
        await getAnnotationContext(currentMarkdownPath, request.params.id, {
          triggerReplyId: parseOptionalString(request.query.triggerReplyId)
        })
      );
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get("/api/review-events", async (request, response) => {
    try {
      const currentMarkdownPath = getRequestMarkdownPath(request, markdownPath);
      response.json(
        await listReviewEvents(currentMarkdownPath, {
          status: parseReviewEventStatus(request.query.status),
          annotationId:
            typeof request.query.annotationId === "string"
              ? request.query.annotationId
              : undefined
        })
      );
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get("/api/review-events/:eventId", async (request, response) => {
    try {
      const currentMarkdownPath = getRequestMarkdownPath(request, markdownPath);
      response.json(await getReviewEvent(currentMarkdownPath, request.params.eventId));
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post("/api/review-events", async (request, response) => {
    try {
      const currentMarkdownPath = getRequestMarkdownPath(request, markdownPath);
      response
        .status(201)
        .json(
          await createReviewEvent(currentMarkdownPath, request.body as CreateReviewEventRequest)
        );
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.patch("/api/review-events/:eventId", async (request, response) => {
    try {
      const currentMarkdownPath = getRequestMarkdownPath(request, markdownPath);
      const eventUpdate = request.body as UpdateReviewEventRequest;
      const review = await updateReviewEvent(
        currentMarkdownPath,
        request.params.eventId,
        eventUpdate
      );
      if (shouldResumeReviewQueueAfterEventUpdate(eventUpdate.deliveryStatus)) {
        dispatchReviewEventsInBackground(currentMarkdownPath);
      }
      response.json(review);
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post("/api/bridge/annotations/:id/send", async (request, response) => {
    try {
      const currentMarkdownPath = getRequestMarkdownPath(request, markdownPath);
      response.json(await sendAnnotationToCodex(currentMarkdownPath, request.params.id));
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post("/api/bridge/annotations/:id/send-to-agent", async (request, response) => {
    try {
      const currentMarkdownPath = getRequestMarkdownPath(request, markdownPath);
      response.json(await sendAnnotationToAgent(currentMarkdownPath, request.params.id));
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post("/api/bridge/events/:eventId/retry", async (request, response) => {
    try {
      const currentMarkdownPath = getRequestMarkdownPath(request, markdownPath);
      response.json(await retryReviewEvent(currentMarkdownPath, request.params.eventId));
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post("/api/bridge/dispatch", async (request, response) => {
    try {
      const currentMarkdownPath = getRequestMarkdownPath(request, markdownPath);
      response.json(await dispatchReviewEvents(currentMarkdownPath));
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get("/api/bridge/status", async (_request, response) => {
    response.json({
      ok: true,
      adapterConfigured: false
    });
  });

  if (!options.dev) {
    const webDir = getWebDir();
    app.use(express.static(webDir));
    app.use((request, response, next) => {
      if (request.method !== "GET") {
        next();
        return;
      }
      response.sendFile(path.join(webDir, "index.html"));
    });
  }

  return new Promise((resolve, reject) => {
    const server = app.listen(options.port, host, () => {
      const address = server.address() as AddressInfo;
      const actualUrl = `http://${host}:${address.port}`;
      if (markdownPath) {
        dispatchReviewEventsInBackground(markdownPath);
      }
      resolve({ app, server, url: actualUrl });
    });

    server.on("error", reject);
  });
}

function createDesktopTokenMiddleware(
  desktopToken: string | undefined
): express.RequestHandler {
  return (request, response, next) => {
    if (!desktopToken) {
      next();
      return;
    }

    if (request.header("x-margent-token") === desktopToken) {
      next();
      return;
    }

    response.status(401).json({ error: "Invalid desktop session token." });
  };
}

async function getReviewSession(markdownPath: string | undefined): Promise<ReviewSession> {
  if (!markdownPath) {
    return {
      hasDocument: false,
      documentPath: null,
      reviewPath: null,
      agentLinkPath: null,
      codexLinkPath: null,
      sourceAgentSessionId: null,
      sourceThreadId: null
    };
  }

  const [agentLink, codexLink] = await Promise.all([
    loadAgentDocumentLink(markdownPath),
    loadCodexDocumentLink(markdownPath)
  ]);
  return {
    hasDocument: true,
    documentPath: markdownPath,
    reviewPath: getReviewPath(markdownPath),
    agentLinkPath: getAgentLinkPath(markdownPath),
    codexLinkPath: getCodexLinkPath(markdownPath),
    sourceAgentSessionId: getSourceSessionId(agentLink),
    sourceThreadId: getSourceThreadId(codexLink)
  };
}

async function getReviewBootstrap(markdownPath: string | undefined): Promise<ReviewBootstrap> {
  const session = await getReviewSession(markdownPath);
  if (!markdownPath) {
    return {
      hasDocument: false,
      session,
      document: null,
      review: null,
      agentLink: null,
      codexLink: null
    };
  }

  const [document, review, agentLink, codexLink] = await Promise.all([
    loadReviewDocument(markdownPath),
    loadReviewFile(markdownPath),
    getAgentLinkResponse(markdownPath),
    getCodexLinkResponse(markdownPath)
  ]);

  return {
    hasDocument: true,
    session,
    document,
    review,
    agentLink,
    codexLink
  };
}

async function loadDocumentAndRepairExternalChanges(
  markdownPath: string,
  documentContentCache: Map<string, string>
) {
  const document = await loadReviewDocument(markdownPath);
  const previousContent = documentContentCache.get(markdownPath);

  if (previousContent !== undefined && previousContent !== document.content) {
    await withReviewFileMutation(markdownPath, async () => {
      const review = await loadReviewFile(markdownPath);
      const repaired = repairReviewAnchors(review, previousContent, document.content);
      if (repaired.review.annotations.length > 0) {
        await saveReviewFile(markdownPath, repaired.review);
      }
    });
  }

  documentContentCache.set(markdownPath, document.content);
  return document;
}

async function discoverAgentSourceIfEnabled(markdownPath: string): Promise<void> {
  const settings = await loadAppSettings();
  if (!settings.codexSourceDiscoveryEnabled) {
    return;
  }
  await discoverAgentSourceForDocument(markdownPath);
}

function discoverAgentSourceAndDispatchReviewEventsInBackground(markdownPath: string): void {
  setTimeout(() => {
    void (async () => {
      try {
        await discoverAgentSourceIfEnabled(markdownPath);
      } catch (error) {
        console.error(
          `[Margent] Failed to discover agent source for ${markdownPath}:`,
          error
        );
      }
      dispatchReviewEventsInBackground(markdownPath);
    })();
  }, 0);
}

function openMarkdownPathFromRequest(body: OpenDocumentRequest): string {
  if (
    typeof body !== "object" ||
    body === null ||
    !("path" in body) ||
    typeof body.path !== "string"
  ) {
    throw new Error("Markdown file path is required.");
  }
  return openMarkdownPath(body.path);
}

function openMarkdownPath(inputPath: string): string {
  const markdownPath = resolveMarkdownPath(inputPath.trim());
  assertReadableMarkdownFile(markdownPath);
  return markdownPath;
}

function getCurrentMarkdownPath(markdownPath: string | undefined): string {
  if (!markdownPath) {
    throw new NoDocumentOpenError();
  }
  return markdownPath;
}

function getRequestMarkdownPath(
  request: express.Request,
  activeMarkdownPath: string | undefined
): string {
  const requestedPath =
    typeof request.query.documentPath === "string"
      ? request.query.documentPath
      : undefined;

  if (!requestedPath) {
    return getCurrentMarkdownPath(activeMarkdownPath);
  }

  return openMarkdownPath(requestedPath);
}

function resolveDocumentAssetPath(markdownPath: string, inputSrc: unknown): string {
  if (typeof inputSrc !== "string" || !inputSrc.trim()) {
    throw new Error("Image source is required.");
  }

  const src = inputSrc.trim();
  if (/^[a-z][a-z\d+.-]*:/i.test(src) || src.startsWith("//")) {
    throw new Error("Remote image sources are not served by Margent.");
  }

  const [srcWithoutHash] = src.split("#");
  const [encodedAssetReference] = srcWithoutHash.split("?");
  const assetReference = decodeAssetReference(encodedAssetReference);
  if (!assetReference) {
    throw new Error("Image source is required.");
  }

  if (/^[a-z][a-z\d+.-]*:/i.test(assetReference) || assetReference.startsWith("//")) {
    throw new Error("Remote image sources are not served by Margent.");
  }

  const markdownDir = path.dirname(markdownPath);
  const assetPath = path.isAbsolute(assetReference)
    ? path.resolve(assetReference)
    : path.resolve(markdownDir, assetReference);
  const relativeToDocumentDir = path.relative(markdownDir, assetPath);

  if (relativeToDocumentDir.startsWith("..") || path.isAbsolute(relativeToDocumentDir)) {
    throw new Error("Image assets must be inside the current document directory.");
  }

  const extension = path.extname(assetPath).toLowerCase();
  if (!DOCUMENT_ASSET_EXTENSIONS.has(extension)) {
    throw new Error("Unsupported image asset type.");
  }

  if (!fs.existsSync(assetPath) || !fs.statSync(assetPath).isFile()) {
    throw new Error(`Image asset not found: ${assetReference}`);
  }

  return assetPath;
}

function decodeAssetReference(assetReference: string): string {
  try {
    return decodeURIComponent(assetReference);
  } catch {
    throw new Error("Image source is not a valid encoded path.");
  }
}

function pickMarkdownPath(): Promise<string> {
  if (process.platform !== "darwin") {
    throw new Error("File picker is only supported on macOS for now.");
  }

  return new Promise((resolve, reject) => {
    execFile(
      "osascript",
      ["-e", 'POSIX path of (choose file with prompt "选择 Markdown 文件")'],
      { timeout: 120000 },
      (error, stdout, stderr) => {
        if (error) {
          const output = `${stderr || ""}${stdout || ""}`;
          reject(new Error(output.includes("User canceled") ? "未选择文件。" : "选择文件失败。"));
          return;
        }

        resolve(stdout.trim());
      }
    );
  });
}

function readClipboardTextRequest(body: unknown): string {
  if (!body || typeof body !== "object" || typeof (body as { text?: unknown }).text !== "string") {
    throw new Error("Clipboard text is required.");
  }
  return (body as { text: string }).text;
}

function readAgentProviderRequest(request: express.Request): AgentProvider {
  const bodyProvider =
    typeof request.body === "object" &&
    request.body !== null &&
    typeof (request.body as { provider?: unknown }).provider === "string"
      ? (request.body as { provider: string }).provider
      : undefined;
  const queryProvider =
    typeof request.query.provider === "string" ? request.query.provider : undefined;
  return parseAgentProvider(bodyProvider ?? queryProvider);
}

function parseAgentProvider(provider: string | undefined): AgentProvider {
  if (!provider) {
    return "codex";
  }
  if (
    provider === "codex" ||
    provider === "claude-code" ||
    provider === "workbuddy" ||
    provider === "custom-cli"
  ) {
    return provider;
  }
  throw new Error(`Unsupported Agent provider: ${provider}`);
}

function writeSystemClipboardText(text: string): Promise<void> {
  if (process.platform !== "darwin") {
    throw new Error("System clipboard copy is only supported on macOS for now.");
  }

  return new Promise<void>((resolve, reject) => {
    const child = spawn("/usr/bin/pbcopy", [], {
      stdio: ["pipe", "ignore", "pipe"]
    });
    let stderr = "";
    let settled = false;

    const finish = (error?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      if (error) {
        reject(error);
        return;
      }
      resolve();
    };

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      finish(new Error(`Unable to open clipboard: ${error.message}`));
    });
    child.on("close", (code) => {
      if (code === 0) {
        finish();
        return;
      }
      finish(new Error(stderr.trim() || "Clipboard write was rejected."));
    });
    child.stdin.on("error", (error) => {
      finish(new Error(`Unable to write clipboard text: ${error.message}`));
    });
    child.stdin.end(text, "utf8");
  }).then(async () => {
    const writtenText = await readSystemClipboardText();
    if (writtenText !== text) {
      throw new Error("Clipboard write verification failed.");
    }
  });
}

function readSystemClipboardText(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "/usr/bin/pbpaste",
      [],
      { timeout: 5000 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message));
          return;
        }
        resolve(stdout);
      }
    );
  });
}

function sendApiError(response: express.Response, error: unknown): void {
  const status =
    error instanceof AnnotationNotFoundError ||
    error instanceof ReplyNotFoundError ||
    error instanceof ReviewEventNotFoundError
      ? 404
      : error instanceof DocumentConflictError
        ? 409
        : error instanceof NoDocumentOpenError
          ? 404
          : 500;
  response.status(status).json({
    error: error instanceof Error ? error.message : "Request failed."
  });
}

function findLatestReply(review: ReviewFile, annotationId: string): ReviewReply | undefined {
  return review.annotations.find((annotation) => annotation.id === annotationId)?.replies.at(-1);
}

function shouldResumeReviewQueueAfterEventUpdate(
  status: ReviewEventDeliveryStatus | undefined
): boolean {
  return status === "handled" || status === "failed" || status === "ignored";
}

function shouldAutoSendReplyFollowup(reply: ReviewReply | undefined): reply is ReviewReply {
  return reply?.author.type === "user" && reply.replyTo?.authorType === "agent";
}

function parseOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseReviewEventStatus(value: unknown): ReviewEventDeliveryStatus | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  if (
    value === "ignored" ||
    value === "queued" ||
    value === "delivering" ||
    value === "sent" ||
    value === "processing" ||
    value === "handled" ||
    value === "failed"
  ) {
    return value;
  }
  throw new Error("Invalid review event status.");
}

class NoDocumentOpenError extends Error {
  constructor() {
    super("No document is open.");
    this.name = "NoDocumentOpenError";
  }
}

function getWebDir(): string {
  const filename = fileURLToPath(import.meta.url);
  const dirname = path.dirname(filename);
  return path.resolve(dirname, "../web");
}
