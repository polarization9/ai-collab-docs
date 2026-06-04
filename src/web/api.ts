import type {
  ApiError,
  OpenDocumentRequest,
  ReviewBootstrap,
  ReviewDocument,
  ReviewSession
} from "../shared/types";
import type {
  CodexLinkResponse,
  SuccessorInstructionResponse,
  UpdateCodexLinkRequest
} from "../shared/codexTypes";
import type {
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

export async function fetchDocument(): Promise<ReviewDocument> {
  const response = await fetch("/api/document", {
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

export async function fetchSession(): Promise<ReviewSession> {
  return requestJson<ReviewSession>("/api/session");
}

export async function fetchBootstrap(): Promise<ReviewBootstrap> {
  return requestJson<ReviewBootstrap>("/api/bootstrap");
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

export async function fetchReview(): Promise<ReviewFile> {
  return requestJson<ReviewFile>("/api/review");
}

export async function fetchCodexLink(): Promise<CodexLinkResponse> {
  return requestJson<CodexLinkResponse>("/api/codex-link");
}

export async function updateCodexLink(
  request: UpdateCodexLinkRequest
): Promise<CodexLinkResponse> {
  return requestJson<CodexLinkResponse>("/api/codex-link", {
    method: "PUT",
    body: JSON.stringify(request)
  });
}

export async function createSuccessorInstruction(): Promise<SuccessorInstructionResponse> {
  return requestJson<SuccessorInstructionResponse>("/api/codex-link/successor-instruction", {
    method: "POST"
  });
}

export async function saveDocument(request: SaveDocumentRequest): Promise<SaveDocumentResponse> {
  return requestJson<SaveDocumentResponse>("/api/document", {
    method: "PUT",
    body: JSON.stringify(request)
  });
}

export async function createAnnotation(request: CreateAnnotationRequest): Promise<ReviewFile> {
  return requestJson<ReviewFile>("/api/review/annotations", {
    method: "POST",
    body: JSON.stringify(request)
  });
}

export async function addAnnotationReply(
  annotationId: string,
  request: AddReplyRequest
): Promise<ReviewFile> {
  return requestJson<ReviewFile>(`/api/review/annotations/${annotationId}/replies`, {
    method: "POST",
    body: JSON.stringify(request)
  });
}

export async function updateAnnotation(
  annotationId: string,
  request: UpdateAnnotationRequest
): Promise<ReviewFile> {
  return requestJson<ReviewFile>(`/api/review/annotations/${annotationId}`, {
    method: "PATCH",
    body: JSON.stringify(request)
  });
}

export async function deleteAnnotation(annotationId: string): Promise<ReviewFile> {
  return requestJson<ReviewFile>(`/api/review/annotations/${annotationId}`, {
    method: "DELETE"
  });
}

export async function updateAnnotationReply(
  annotationId: string,
  replyId: string,
  request: UpdateReplyRequest
): Promise<ReviewFile> {
  return requestJson<ReviewFile>(`/api/review/annotations/${annotationId}/replies/${replyId}`, {
    method: "PATCH",
    body: JSON.stringify(request)
  });
}

export async function updateAnnotationStatus(
  annotationId: string,
  request: UpdateAnnotationStatusRequest
): Promise<ReviewFile> {
  return requestJson<ReviewFile>(`/api/review/annotations/${annotationId}/status`, {
    method: "PATCH",
    body: JSON.stringify(request)
  });
}

export async function fetchAnnotationContext(annotationId: string): Promise<AnnotationContext> {
  return requestJson<AnnotationContext>(`/api/review/annotations/${annotationId}/context`);
}

export async function fetchReviewEvents(filter: {
  status?: ReviewEventDeliveryStatus;
  annotationId?: string;
} = {}): Promise<ReviewEvent[]> {
  const params = new URLSearchParams();
  if (filter.status) {
    params.set("status", filter.status);
  }
  if (filter.annotationId) {
    params.set("annotationId", filter.annotationId);
  }
  const query = params.toString();
  return requestJson<ReviewEvent[]>(`/api/review-events${query ? `?${query}` : ""}`);
}

export async function updateReviewEvent(
  eventId: string,
  request: UpdateReviewEventRequest
): Promise<ReviewFile> {
  return requestJson<ReviewFile>(`/api/review-events/${eventId}`, {
    method: "PATCH",
    body: JSON.stringify(request)
  });
}

export async function sendAnnotationToCodex(
  annotationId: string
): Promise<BridgeSendAnnotationResponse> {
  return requestJson<BridgeSendAnnotationResponse>(
    `/api/bridge/annotations/${annotationId}/send`,
    {
      method: "POST"
    }
  );
}

export async function retryReviewEvent(eventId: string): Promise<BridgeSendAnnotationResponse> {
  return requestJson<BridgeSendAnnotationResponse>(`/api/bridge/events/${eventId}/retry`, {
    method: "POST"
  });
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
    apiHeaders["X-AI-MD-Reviewer-Token"] = desktopToken;
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

  const existing = window.sessionStorage.getItem("ai-md-reviewer-token");
  if (existing) {
    return existing;
  }

  const token = new URLSearchParams(window.location.search).get("desktopToken");
  if (!token) {
    return null;
  }

  window.sessionStorage.setItem("ai-md-reviewer-token", token);
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
