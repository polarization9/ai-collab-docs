import { useCallback, useEffect, useState } from "react";
import type {
  AddReplyRequest,
  AnnotationStatus,
  CreateAnnotationRequest,
  ReviewFile,
  UpdateAnnotationRequest,
  UpdateReplyRequest
} from "../../shared/reviewTypes";
import {
  addAnnotationReply,
  createAnnotation,
  deleteAnnotation,
  fetchReview,
  updateAnnotation,
  updateAnnotationReply,
  updateAnnotationStatus
} from "../api";

type ReviewLoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; review: ReviewFile };

export function useReview(
  documentId: string,
  initialReview: ReviewFile | null = null,
  documentPath?: string
) {
  const [state, setState] = useState<ReviewLoadState>(
    initialReview?.documentId === documentId
      ? { status: "ready", review: initialReview }
      : { status: "loading" }
  );
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);

  const reload = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!options.silent) {
      setState({ status: "loading" });
    }

    try {
      const review = await fetchReview(documentPath);
      setState((current) => {
        if (
          current.status === "ready" &&
          current.review.updatedAt === review.updatedAt
        ) {
          return current;
        }
        return { status: "ready", review };
      });
      return review;
    } catch (error) {
      if (!options.silent) {
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "Unable to load review."
        });
      }
      return null;
    }
  }, [documentPath]);

  useEffect(() => {
    if (initialReview?.documentId === documentId) {
      return;
    }
    void reload();
  }, [documentId, initialReview, reload]);

  const create = useCallback(async (request: CreateAnnotationRequest) => {
    const review = await createAnnotation(request, documentPath);
    setState({ status: "ready", review });
    const created = review.annotations[review.annotations.length - 1];
    setSelectedAnnotationId(created?.id ?? null);
    return { review, annotation: created ?? null };
  }, [documentPath]);

  const reply = useCallback(async (annotationId: string, request: AddReplyRequest) => {
    const review = await addAnnotationReply(annotationId, request, documentPath);
    setState({ status: "ready", review });
    setSelectedAnnotationId(annotationId);
  }, [documentPath]);

  const editAnnotation = useCallback(
    async (annotationId: string, request: UpdateAnnotationRequest) => {
      const review = await updateAnnotation(annotationId, request, documentPath);
      setState({ status: "ready", review });
      setSelectedAnnotationId(annotationId);
    },
    [documentPath]
  );

  const removeAnnotation = useCallback(async (annotationId: string) => {
    const review = await deleteAnnotation(annotationId, documentPath);
    setState({ status: "ready", review });
    setSelectedAnnotationId((current) => (current === annotationId ? null : current));
  }, [documentPath]);

  const editReply = useCallback(
    async (annotationId: string, replyId: string, request: UpdateReplyRequest) => {
      const review = await updateAnnotationReply(annotationId, replyId, request, documentPath);
      setState({ status: "ready", review });
      setSelectedAnnotationId(annotationId);
    },
    [documentPath]
  );

  const setStatus = useCallback(async (
    annotationId: string,
    status: AnnotationStatus,
    eventId?: string
  ) => {
    const review = await updateAnnotationStatus(annotationId, { status, eventId }, documentPath);
    setState({ status: "ready", review });
    setSelectedAnnotationId(annotationId);
  }, [documentPath]);

  const replaceReview = useCallback((review: ReviewFile) => {
    setState({ status: "ready", review });
  }, []);

  return {
    state,
    selectedAnnotationId,
    setSelectedAnnotationId,
    reload,
    create,
    reply,
    editAnnotation,
    removeAnnotation,
    editReply,
    setStatus,
    replaceReview
  };
}
