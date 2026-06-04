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

export function useReview(documentId: string, initialReview: ReviewFile | null = null) {
  const [state, setState] = useState<ReviewLoadState>(
    initialReview?.documentId === documentId
      ? { status: "ready", review: initialReview }
      : { status: "loading" }
  );
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setState({ status: "loading" });
    try {
      setState({ status: "ready", review: await fetchReview() });
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "Unable to load review."
      });
    }
  }, []);

  useEffect(() => {
    if (initialReview?.documentId === documentId) {
      return;
    }
    void reload();
  }, [documentId, initialReview, reload]);

  const create = useCallback(async (request: CreateAnnotationRequest) => {
    const review = await createAnnotation(request);
    setState({ status: "ready", review });
    const created = review.annotations[review.annotations.length - 1];
    setSelectedAnnotationId(created?.id ?? null);
  }, []);

  const reply = useCallback(async (annotationId: string, request: AddReplyRequest) => {
    const review = await addAnnotationReply(annotationId, request);
    setState({ status: "ready", review });
    setSelectedAnnotationId(annotationId);
  }, []);

  const editAnnotation = useCallback(
    async (annotationId: string, request: UpdateAnnotationRequest) => {
      const review = await updateAnnotation(annotationId, request);
      setState({ status: "ready", review });
      setSelectedAnnotationId(annotationId);
    },
    []
  );

  const removeAnnotation = useCallback(async (annotationId: string) => {
    const review = await deleteAnnotation(annotationId);
    setState({ status: "ready", review });
    setSelectedAnnotationId((current) => (current === annotationId ? null : current));
  }, []);

  const editReply = useCallback(
    async (annotationId: string, replyId: string, request: UpdateReplyRequest) => {
      const review = await updateAnnotationReply(annotationId, replyId, request);
      setState({ status: "ready", review });
      setSelectedAnnotationId(annotationId);
    },
    []
  );

  const setStatus = useCallback(async (annotationId: string, status: AnnotationStatus) => {
    const review = await updateAnnotationStatus(annotationId, { status });
    setState({ status: "ready", review });
    setSelectedAnnotationId(annotationId);
  }, []);

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
