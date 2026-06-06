import express from "express";
import { execFile } from "node:child_process";
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
import { discoverCodexSourceForDocument } from "./codexDiscovery.js";
import {
  listRecentDocuments,
  loadAppSettings,
  rememberRecentDocument,
  removeRecentDocument,
  saveAppSettings
} from "./appState.js";
import {
  dispatchReviewEvents,
  retryReviewEvent,
  sendAnnotationToCodex
} from "./bridge.js";
import { loadReviewDocument } from "./document.js";
import { DocumentConflictError, saveReviewDocument } from "./documentEdit.js";
import { repairReviewAnchors } from "./reviewAnchorRepair.js";
import { assertReadableMarkdownFile, getCodexLinkPath, getReviewPath, resolveMarkdownPath } from "./paths.js";
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
import type { SaveDocumentRequest } from "../shared/editTypes.js";
import type {
  AddReplyRequest,
  CreateAnnotationRequest,
  CreateReviewEventRequest,
  ReviewEventDeliveryStatus,
  ReviewFile,
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
      await discoverCodexSourceIfEnabled(nextMarkdownPath);
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
      await discoverCodexSourceIfEnabled(nextMarkdownPath);
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

  app.get("/api/review", async (request, response) => {
    try {
      const currentMarkdownPath = getRequestMarkdownPath(request, markdownPath);
      response.json(await loadReviewFile(currentMarkdownPath));
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
      const codexLink = await getCodexLinkResponse(currentMarkdownPath);
      if (
        created &&
        codexLink.connection.autoSendNewAnnotations &&
        codexLink.connection.hasTarget
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
      response.json(
        await addAnnotationReply(
          currentMarkdownPath,
          request.params.id,
          request.body as AddReplyRequest
        )
      );
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
      response.json(await getAnnotationContext(currentMarkdownPath, request.params.id));
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
      response.json(
        await updateReviewEvent(
          currentMarkdownPath,
          request.params.eventId,
          request.body as UpdateReviewEventRequest
        )
      );
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
      codexLinkPath: null,
      sourceThreadId: null
    };
  }

  const link = await loadCodexDocumentLink(markdownPath);
  return {
    hasDocument: true,
    documentPath: markdownPath,
    reviewPath: getReviewPath(markdownPath),
    codexLinkPath: getCodexLinkPath(markdownPath),
    sourceThreadId: getSourceThreadId(link)
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
      codexLink: null
    };
  }

  const [document, review, codexLink] = await Promise.all([
    loadReviewDocument(markdownPath),
    loadReviewFile(markdownPath),
    getCodexLinkResponse(markdownPath)
  ]);

  return {
    hasDocument: true,
    session,
    document,
    review,
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

async function discoverCodexSourceIfEnabled(markdownPath: string): Promise<void> {
  const settings = await loadAppSettings();
  if (!settings.codexSourceDiscoveryEnabled) {
    return;
  }
  await discoverCodexSourceForDocument(markdownPath);
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

function dispatchReviewEventsInBackground(markdownPath: string): void {
  setTimeout(() => {
    void dispatchReviewEvents(markdownPath).catch((error) => {
      console.error(
        `[Margent] Failed to dispatch review events for ${markdownPath}:`,
        error
      );
    });
  }, 0);
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
