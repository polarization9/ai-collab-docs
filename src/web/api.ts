import type { ApiError, ReviewDocument } from "../shared/types";

export async function fetchDocument(): Promise<ReviewDocument> {
  const response = await fetch("/api/document");

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
