import type {
  ApiError,
  OpenDocumentRequest,
  ReviewBootstrap,
  ReviewDocument,
  ReviewSession
} from "../shared/types";
import type {
  AppSettings,
  RecentDocument
} from "../shared/appSettingsTypes";
import type {
  AgentLinkResponse,
  AgentProvider,
  AgentSuccessorInstructionResponse,
  UpdateAgentLinkRequest
} from "../shared/agentTypes";
import type {
  CodexLinkResponse,
  SuccessorInstructionResponse,
  UpdateCodexLinkRequest
} from "../shared/codexTypes";
import type {
  DocumentMergeStatusRequest,
  DocumentMergeStatusResponse,
  SaveDocumentRequest,
  SaveDocumentResponse
} from "../shared/editTypes";
import type {
  AddReplyRequest,
  AnnotationContext,
  BridgeSendAnnotationResponse,
  CreateAnnotationRequest,
  ReviewEvent,
  ReviewEventDeliveryStatus,
  ReviewFile,
  UpdateAnnotationRequest,
  UpdateAnnotationStatusRequest,
  UpdateReviewEventRequest,
  UpdateReplyRequest
} from "../shared/reviewTypes";

export async function fetchDocument(documentPath?: string): Promise<ReviewDocument> {
  const response = await fetch(withDocumentPath("/api/document", documentPath), {
    headers: getApiHeaders(false)
  });

  if (!response.ok) {
    let message = "Unable to load document.";
    try {
      const error = (await response.json()) as ApiError;
      message = error.error || message;
    } catch {
      // Keep the simple default message when the server returns non-JSON.
    }
    throw new Error(message);
  }

  return (await response.json()) as ReviewDocument;
}

export async function fetchDocumentAssetObjectUrl(
  src: string,
  documentPath: string
): Promise<string> {
  const response = await fetch(
    withDocumentPath(`/api/document-asset?src=${encodeURIComponent(src)}`, documentPath),
    {
      headers: getApiHeaders(false)
    }
  );

  if (!response.ok) {
    throw new Error(await readApiError(response));
  }

  return URL.createObjectURL(await response.blob());
}

export async function fetchSession(): Promise<ReviewSession> {
  return requestJson<ReviewSession>("/api/session");
}

export async function fetchBootstrap(): Promise<ReviewBootstrap> {
  return requestJson<ReviewBootstrap>("/api/bootstrap");
}

export async function fetchAppSettings(): Promise<AppSettings> {
  return requestJson<AppSettings>("/api/app/settings");
}

export async function updateAppSettings(
  settings: Partial<AppSettings>
): Promise<AppSettings> {
  return requestJson<AppSettings>("/api/app/settings", {
    method: "PUT",
    body: JSON.stringify(settings)
  });
}

export async function fetchRecentDocuments(): Promise<RecentDocument[]> {
  return requestJson<RecentDocument[]>("/api/recent-documents");
}

export async function removeRecentDocument(path: string): Promise<RecentDocument[]> {
  return requestJson<RecentDocument[]>(
    `/api/recent-documents?path=${encodeURIComponent(path)}`,
    {
      method: "DELETE"
    }
  );
}

export async function openDocument(request: OpenDocumentRequest): Promise<ReviewDocument> {
  return requestJson<ReviewDocument>("/api/session/document", {
    method: "POST",
    body: JSON.stringify(request)
  });
}

export async function pickDocumentOnServer(): Promise<ReviewDocument> {
  return requestJson<ReviewDocument>("/api/session/pick-document", {
    method: "POST"
  });
}

export async function fetchReview(documentPath?: string): Promise<ReviewFile> {
  return requestJson<ReviewFile>(withDocumentPath("/api/review", documentPath));
}

export async function fetchCodexLink(documentPath?: string): Promise<CodexLinkResponse> {
  return requestJson<CodexLinkResponse>(withDocumentPath("/api/codex-link", documentPath));
}

export async function fetchAgentLink(documentPath?: string): Promise<AgentLinkResponse> {
  return requestJson<AgentLinkResponse>(withDocumentPath("/api/agent-link", documentPath));
}

export async function updateAgentLink(
  request: UpdateAgentLinkRequest,
  documentPath?: string
): Promise<AgentLinkResponse> {
  return requestJson<AgentLinkResponse>(withDocumentPath("/api/agent-link", documentPath), {
    method: "PUT",
    body: JSON.stringify(request)
  });
}

export async function updateCodexLink(
  request: UpdateCodexLinkRequest,
  documentPath?: string
): Promise<CodexLinkResponse> {
  return requestJson<CodexLinkResponse>(withDocumentPath("/api/codex-link", documentPath), {
    method: "PUT",
    body: JSON.stringify(request)
  });
}

export async function createSuccessorInstruction(
  documentPath?: string
): Promise<SuccessorInstructionResponse> {
  return requestJson<SuccessorInstructionResponse>(
    withDocumentPath("/api/codex-link/successor-instruction", documentPath),
    {
      method: "POST"
    }
  );
}

export async function createAgentSuccessorInstruction(
  documentPath?: string,
  provider: AgentProvider = "codex"
): Promise<AgentSuccessorInstructionResponse> {
  return requestJson<AgentSuccessorInstructionResponse>(
    withDocumentPath("/api/agent-link/successor-instruction", documentPath),
    {
      method: "POST",
      body: JSON.stringify({ provider })
    }
  );
}

export async function copySuccessorInstruction(
  documentPath?: string
): Promise<SuccessorInstructionResponse> {
  return requestJson<SuccessorInstructionResponse>(
    withDocumentPath("/api/codex-link/successor-instruction/copy", documentPath),
    {
      method: "POST"
    }
  );
}

export async function copyAgentSuccessorInstruction(
  documentPath?: string,
  provider: AgentProvider = "codex"
): Promise<AgentSuccessorInstructionResponse> {
  return requestJson<AgentSuccessorInstructionResponse>(
    withDocumentPath("/api/agent-link/successor-instruction/copy", documentPath),
    {
      method: "POST",
      body: JSON.stringify({ provider })
    }
  );
}

export async function copyTextToSystemClipboard(text: string): Promise<void> {
  await requestJson<{ ok: boolean }>("/api/clipboard/text", {
    method: "POST",
    body: JSON.stringify({ text })
  });
}

export async function saveDocument(
  request: SaveDocumentRequest,
  documentPath?: string
): Promise<SaveDocumentResponse> {
  return requestJson<SaveDocumentResponse>(withDocumentPath("/api/document", documentPath), {
    method: "PUT",
    body: JSON.stringify(request)
  });
}

export async function checkDocumentMergeStatus(
  request: DocumentMergeStatusRequest,
  documentPath?: string
): Promise<DocumentMergeStatusResponse> {
  return requestJson<DocumentMergeStatusResponse>(
    withDocumentPath("/api/document/merge-status", documentPath),
    {
      method: "POST",
      body: JSON.stringify(request)
    }
  );
}

export async function createAnnotation(
  request: CreateAnnotationRequest,
  documentPath?: string
): Promise<ReviewFile> {
  return requestJson<ReviewFile>(withDocumentPath("/api/review/annotations", documentPath), {
    method: "POST",
    body: JSON.stringify(request)
  });
}

export async function addAnnotationReply(
  annotationId: string,
  request: AddReplyRequest,
  documentPath?: string
): Promise<ReviewFile> {
  return requestJson<ReviewFile>(
    withDocumentPath(`/api/review/annotations/${annotationId}/replies`, documentPath),
    {
      method: "POST",
      body: JSON.stringify(request)
    }
  );
}

export async function updateAnnotation(
  annotationId: string,
  request: UpdateAnnotationRequest,
  documentPath?: string
): Promise<ReviewFile> {
  return requestJson<ReviewFile>(withDocumentPath(`/api/review/annotations/${annotationId}`, documentPath), {
    method: "PATCH",
    body: JSON.stringify(request)
  });
}

export async function deleteAnnotation(
  annotationId: string,
  documentPath?: string
): Promise<ReviewFile> {
  return requestJson<ReviewFile>(withDocumentPath(`/api/review/annotations/${annotationId}`, documentPath), {
    method: "DELETE"
  });
}

export async function updateAnnotationReply(
  annotationId: string,
  replyId: string,
  request: UpdateReplyRequest,
  documentPath?: string
): Promise<ReviewFile> {
  return requestJson<ReviewFile>(
    withDocumentPath(`/api/review/annotations/${annotationId}/replies/${replyId}`, documentPath),
    {
      method: "PATCH",
      body: JSON.stringify(request)
    }
  );
}

export async function updateAnnotationStatus(
  annotationId: string,
  request: UpdateAnnotationStatusRequest,
  documentPath?: string
): Promise<ReviewFile> {
  return requestJson<ReviewFile>(
    withDocumentPath(`/api/review/annotations/${annotationId}/status`, documentPath),
    {
      method: "PATCH",
      body: JSON.stringify(request)
    }
  );
}

export async function fetchAnnotationContext(
  annotationId: string,
  documentPath?: string
): Promise<AnnotationContext> {
  return requestJson<AnnotationContext>(
    withDocumentPath(`/api/review/annotations/${annotationId}/context`, documentPath)
  );
}

export async function fetchReviewEvents(filter: {
  status?: ReviewEventDeliveryStatus;
  annotationId?: string;
  documentPath?: string;
} = {}): Promise<ReviewEvent[]> {
  const params = new URLSearchParams();
  if (filter.status) {
    params.set("status", filter.status);
  }
  if (filter.annotationId) {
    params.set("annotationId", filter.annotationId);
  }
  if (filter.documentPath) {
    params.set("documentPath", filter.documentPath);
  }
  const query = params.toString();
  return requestJson<ReviewEvent[]>(`/api/review-events${query ? `?${query}` : ""}`);
}

export async function updateReviewEvent(
  eventId: string,
  request: UpdateReviewEventRequest,
  documentPath?: string
): Promise<ReviewFile> {
  return requestJson<ReviewFile>(withDocumentPath(`/api/review-events/${eventId}`, documentPath), {
    method: "PATCH",
    body: JSON.stringify(request)
  });
}

export async function sendAnnotationToCodex(
  annotationId: string,
  documentPath?: string
): Promise<BridgeSendAnnotationResponse> {
  return sendAnnotationToAgent(annotationId, documentPath);
}

export async function sendAnnotationToAgent(
  annotationId: string,
  documentPath?: string
): Promise<BridgeSendAnnotationResponse> {
  return requestJson<BridgeSendAnnotationResponse>(
    withDocumentPath(`/api/bridge/annotations/${annotationId}/send-to-agent`, documentPath),
    {
      method: "POST"
    }
  );
}

export async function retryReviewEvent(
  eventId: string,
  documentPath?: string
): Promise<BridgeSendAnnotationResponse> {
  return requestJson<BridgeSendAnnotationResponse>(
    withDocumentPath(`/api/bridge/events/${eventId}/retry`, documentPath),
    {
      method: "POST"
    }
  );
}

function withDocumentPath(url: string, documentPath?: string): string {
  if (!documentPath) {
    return url;
  }

  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}documentPath=${encodeURIComponent(documentPath)}`;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: getApiHeaders(true, init?.headers)
  });

  if (!response.ok) {
    throw new Error(await readApiError(response));
  }

  return (await response.json()) as T;
}

function getApiHeaders(
  includeContentType: boolean,
  headers?: HeadersInit
): HeadersInit {
  const apiHeaders: Record<string, string> = {};
  const desktopToken = getDesktopToken();

  if (includeContentType) {
    apiHeaders["Content-Type"] = "application/json";
  }

  if (desktopToken) {
    apiHeaders["X-Margent-Token"] = desktopToken;
  }

  return {
    ...apiHeaders,
    ...headers
  };
}

function getDesktopToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  const existing = window.sessionStorage.getItem("margent-token");
  if (existing) {
    return existing;
  }

  const token = new URLSearchParams(window.location.search).get("desktopToken");
  if (!token) {
    return null;
  }

  window.sessionStorage.setItem("margent-token", token);
  const url = new URL(window.location.href);
  url.searchParams.delete("desktopToken");
  window.history.replaceState(null, "", url);
  return token;
}

async function readApiError(response: Response): Promise<string> {
  let message = "Request failed.";
  try {
    const error = (await response.json()) as ApiError;
    message = error.error || message;
  } catch {
    // Keep default message.
  }
  return message;
}
