import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  bindCodexThread,
  getCodexLinkResponse,
  updateCodexDocumentLink
} from "../server/codexLink.js";
import {
  bindAgentSession,
  getProviderDisplayName,
  getAgentLinkResponse,
  loadAgentDocumentLink,
  resolveAgentTarget,
  updateAgentDocumentLink
} from "../server/agentLink.js";
import { loadReviewDocument } from "../server/document.js";
import { saveReviewDocument } from "../server/documentEdit.js";
import {
  assertReadableMarkdownFile,
  getAgentLinkPath,
  getCodexLinkPath,
  getReviewPath,
  resolveMarkdownPath
} from "../server/paths.js";
import {
  addAnnotationReply,
  createReviewEvent,
  deleteAnnotation,
  getReviewEvent,
  listReviewEvents,
  loadReviewFile,
  markReviewEventHandled,
  updateAnnotation,
  updateAnnotationReply,
  updateReviewEvent,
  updateAnnotationStatus
} from "../server/review.js";
import { getAnnotationContext } from "../server/reviewContext.js";
import type { AgentProvider, AgentSessionRole } from "../shared/agentTypes.js";
import type { CodexTargetType } from "../shared/codexTypes.js";
import type {
  AnnotationContext,
  AnnotationStatus,
  ReviewAnnotation,
  ReviewEventDeliveryStatus,
  ReviewFile
} from "../shared/reviewTypes.js";

type ToolResultPayload = Record<string, unknown>;

const STATUS_VALUES = ["open", "resolved", "all"] as const;
const ANNOTATION_STATUS_VALUES = ["open", "resolved"] as const;
const REVIEW_EVENT_STATUS_VALUES = [
  "ignored",
  "queued",
  "delivering",
  "sent",
  "processing",
  "handled",
  "failed"
] as const;
const CODEX_TARGET_ROLE_VALUES = ["source", "successor"] as const;
const AGENT_PROVIDER_VALUES = ["codex", "claude-code", "workbuddy", "custom-cli"] as const;
const AGENT_SESSION_ROLE_VALUES = ["source", "successor"] as const;

export function registerReviewerTools(server: McpServer, markdownPath?: string): void {
  server.registerTool(
    "reviewer_get_document",
    {
      title: "Get Review Document",
      description:
        "Read Markdown document content and metadata for a Margent document.",
      inputSchema: {
        documentPath: z.string().min(1).optional().describe("Markdown path.")
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ documentPath }) =>
      jsonToolResult(await getDocumentPayload(resolveToolMarkdownPath(markdownPath, documentPath)))
  );

  server.registerTool(
    "reviewer_get_agent_link",
    {
      title: "Get Agent Link",
      description:
        "Read the current document's Agent connection state, including source session, current target, and automatic annotation monitoring setting.",
      inputSchema: {
        documentPath: z.string().min(1).optional().describe("Optional Markdown path.")
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ documentPath }) =>
      jsonToolResult(await getAgentLinkPayload(markdownPath, documentPath))
  );

  server.registerTool(
    "reviewer_update_agent_link",
    {
      title: "Update Agent Link",
      description:
        "Update Agent connection metadata for the current document. Prefer reviewer_bind_current_agent_session when binding the current conversation.",
      inputSchema: {
        documentPath: z.string().min(1).optional().describe("Optional Markdown path."),
        provider: z
          .enum(AGENT_PROVIDER_VALUES)
          .optional()
          .describe("Agent provider. Defaults to codex."),
        sourceSessionId: z.string().min(1).optional().describe("Source Agent session id."),
        targetSessionId: z.string().min(1).optional().describe("Current target Agent session id."),
        targetRole: z
          .enum(AGENT_SESSION_ROLE_VALUES)
          .optional()
          .describe("Whether the target is the source or successor session."),
        cwd: z.string().min(1).optional().describe("Workspace path for the Agent session."),
        displayName: z.string().min(1).optional().describe("Agent display name."),
        autoSendNewAnnotations: z
          .boolean()
          .optional()
          .describe("Enable or disable automatic monitoring for new annotations.")
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async ({
      documentPath,
      provider,
      sourceSessionId,
      targetSessionId,
      targetRole,
      cwd,
      displayName,
      autoSendNewAnnotations
    }) =>
      jsonToolResult(
        await updateAgentLinkPayload(markdownPath, {
          documentPath,
          provider,
          sourceSessionId,
          targetSessionId,
          targetRole,
          cwd,
          displayName,
          autoSendNewAnnotations
        })
      )
  );

  server.registerTool(
    "reviewer_bind_current_agent_session",
    {
      title: "Bind Current Agent Session",
      description:
        "Bind the current Agent session as the source or successor session for this Markdown document. Use this when the user pastes a connection instruction.",
      inputSchema: {
        documentPath: z.string().min(1).optional().describe("Markdown document path."),
        provider: z
          .enum(AGENT_PROVIDER_VALUES)
          .describe("Agent provider for this session."),
        role: z
          .enum(AGENT_SESSION_ROLE_VALUES)
          .describe("Bind this Agent session as source or successor."),
        sessionId: z
          .string()
          .min(1)
          .optional()
          .describe(
            "Agent session id. Required for sessionful providers such as Codex, Claude Code, and WorkBuddy when Margent cannot detect it automatically."
          ),
        cwd: z.string().min(1).optional().describe("Optional Agent workspace path."),
        displayName: z.string().min(1).optional().describe("Optional Agent display name."),
        autoSendNewAnnotations: z
          .boolean()
          .optional()
          .describe("Optionally set automatic monitoring after binding.")
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async ({ documentPath, provider, role, sessionId, cwd, displayName, autoSendNewAnnotations }) =>
      jsonToolResult(
        await bindCurrentAgentSessionPayload(markdownPath, {
          documentPath,
          provider,
          role,
          sessionId,
          cwd,
          displayName,
          autoSendNewAnnotations
        })
      )
  );

  server.registerTool(
    "reviewer_get_codex_link",
    {
      title: "Get Codex Link",
      description:
        "Read the current document's Codex connection state, including source thread, current target, and automatic annotation monitoring setting.",
      inputSchema: {
        documentPath: z.string().min(1).optional().describe("Optional Markdown path.")
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ documentPath }) =>
      jsonToolResult(await getCodexLinkPayload(markdownPath, documentPath))
  );

  server.registerTool(
    "reviewer_update_codex_link",
    {
      title: "Update Codex Link",
      description:
        "Update Codex connection metadata for the current document. Prefer reviewer_bind_current_codex_thread when binding the current conversation.",
      inputSchema: {
        documentPath: z.string().min(1).optional().describe("Optional Markdown path."),
        sourceThreadId: z.string().min(1).optional().describe("Source Codex thread id."),
        targetThreadId: z.string().min(1).optional().describe("Current target Codex thread id."),
        targetType: z
          .enum(CODEX_TARGET_ROLE_VALUES)
          .optional()
          .describe("Whether the target is the source or successor conversation."),
        cwd: z.string().min(1).optional().describe("Workspace path for the Codex thread."),
        autoSendNewAnnotations: z
          .boolean()
          .optional()
          .describe("Enable or disable automatic monitoring for new annotations.")
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async ({
      documentPath,
      sourceThreadId,
      targetThreadId,
      targetType,
      cwd,
      autoSendNewAnnotations
    }) =>
      jsonToolResult(
        await updateCodexLinkPayload(markdownPath, {
          documentPath,
          sourceThreadId,
          targetThreadId,
          targetType,
          cwd,
          autoSendNewAnnotations
        })
      )
  );

  server.registerTool(
    "reviewer_bind_current_codex_thread",
    {
      title: "Bind Current Codex Thread",
      description:
        "Bind the current Codex conversation as the source or successor conversation for this Markdown document. Use this when the user pastes a connection instruction.",
      inputSchema: {
        documentPath: z.string().min(1).optional().describe("Markdown document path."),
        role: z
          .enum(CODEX_TARGET_ROLE_VALUES)
          .describe("Bind this Codex conversation as source or successor."),
        threadId: z
          .string()
          .min(1)
          .optional()
          .describe("Optional thread id if the Codex adapter provides it."),
        cwd: z.string().min(1).optional().describe("Optional Codex workspace path."),
        autoSendNewAnnotations: z
          .boolean()
          .optional()
          .describe("Optionally set automatic monitoring after binding.")
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async ({ documentPath, role, threadId, cwd, autoSendNewAnnotations }) =>
      jsonToolResult(
        await bindCurrentCodexThreadPayload(markdownPath, {
          documentPath,
          role,
          threadId,
          cwd,
          autoSendNewAnnotations
        })
      )
  );

  server.registerTool(
    "reviewer_list_annotations",
    {
      title: "List Review Annotations",
      description:
        "List annotations for a Margent document. Use status='open' when you are asked to handle unresolved review items; use status='all' when you need full history.",
      inputSchema: {
        documentPath: z.string().min(1).optional().describe("Optional Markdown path."),
        status: z.enum(STATUS_VALUES).optional().describe("Filter by annotation status.")
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ documentPath, status = "open" }) =>
      jsonToolResult(
        await listAnnotationsPayload(resolveToolMarkdownPath(markdownPath, documentPath), status)
      )
  );

  server.registerTool(
    "reviewer_get_annotation_context",
    {
      title: "Get Annotation Context",
      description:
        "Read one annotation with selected text, nearby Markdown, the parent heading, existing replies, and an optional trigger reply for follow-up tasks. Use this before answering or editing based on a specific annotation.",
      inputSchema: {
        documentPath: z.string().min(1).optional().describe("Optional Markdown path."),
        annotationId: z.string().min(1).describe("Annotation id, for example ann_abc123."),
        triggerReplyId: z
          .string()
          .min(1)
          .optional()
          .describe("Optional reply id that triggered this follow-up task.")
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ documentPath, annotationId, triggerReplyId }) =>
      jsonToolResult(
        await getAnnotationContextPayload(markdownPath, annotationId, documentPath, triggerReplyId)
      )
  );

  server.registerTool(
    "reviewer_add_annotation_reply",
    {
      title: "Add Annotation Reply",
      description:
        "Append an Agent reply to an annotation. If the reply fully answers a question, pass resolveAnnotation=true and eventId so Margent can mark the annotation resolved and the review event handled in the same write. If information is insufficient or the user must decide, leave it open.",
      inputSchema: {
        documentPath: z.string().min(1).optional().describe("Optional Markdown path."),
        annotationId: z.string().min(1).describe("Annotation id to reply to."),
        body: z.string().min(1).describe("Reply body to append."),
        replyToReplyId: z
          .string()
          .min(1)
          .optional()
          .describe("Optional reply id this reply is responding to."),
        authorName: z
          .string()
          .min(1)
          .optional()
          .describe("Optional agent display name. Defaults to the current Agent provider name."),
        eventId: z
          .string()
          .min(1)
          .optional()
          .describe("Optional review event id to mark handled when resolveAnnotation is true."),
        resolveAnnotation: z
          .boolean()
          .optional()
          .describe("When true, mark the annotation resolved after appending this reply.")
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async ({
      documentPath,
      annotationId,
      body,
      replyToReplyId,
      authorName,
      eventId,
      resolveAnnotation
    }) =>
      jsonToolResult(
        await addReplyPayload(
          resolveToolMarkdownPath(markdownPath, documentPath),
          annotationId,
          body,
          authorName,
          replyToReplyId,
          eventId,
          resolveAnnotation
        )
      )
  );

  server.registerTool(
    "reviewer_update_annotation_body",
    {
      title: "Update Annotation Body",
      description:
        "Edit the body text of an existing annotation. Use this for typo fixes or when the user asks to revise the annotation text itself, not the Markdown document.",
      inputSchema: {
        documentPath: z.string().min(1).optional().describe("Optional Markdown path."),
        annotationId: z.string().min(1).describe("Annotation id to edit."),
        body: z.string().min(1).describe("New annotation body text.")
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async ({ documentPath, annotationId, body }) =>
      jsonToolResult(
        await updateAnnotationPayload(resolveToolMarkdownPath(markdownPath, documentPath), annotationId, body)
      )
  );

  server.registerTool(
    "reviewer_delete_annotation",
    {
      title: "Delete Annotation",
      description:
        "Delete one annotation and its replies from the current document review file. Use only when the user explicitly asks to remove a review item.",
      inputSchema: {
        documentPath: z.string().min(1).optional().describe("Optional Markdown path."),
        annotationId: z.string().min(1).describe("Annotation id to delete.")
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async ({ documentPath, annotationId }) =>
      jsonToolResult(
        await deleteAnnotationPayload(resolveToolMarkdownPath(markdownPath, documentPath), annotationId)
      )
  );

  server.registerTool(
    "reviewer_update_annotation_reply",
    {
      title: "Update Annotation Reply",
      description:
        "Edit one existing reply on an annotation. Use this to correct or refine a previous human or agent reply.",
      inputSchema: {
        documentPath: z.string().min(1).optional().describe("Optional Markdown path."),
        annotationId: z.string().min(1).describe("Annotation id that owns the reply."),
        replyId: z.string().min(1).describe("Reply id to edit."),
        body: z.string().min(1).describe("New reply body text.")
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async ({ documentPath, annotationId, replyId, body }) =>
      jsonToolResult(
        await updateReplyPayload(resolveToolMarkdownPath(markdownPath, documentPath), annotationId, replyId, body)
      )
  );

  server.registerTool(
    "reviewer_apply_document_edit",
    {
      title: "Apply Document Edit",
      description:
        "Replace the current Markdown document content with edited Markdown. Use this only when the requested document change is clear. If this edit handles an annotation, pass annotationId and preferredSelectedText so the annotation can be re-anchored to the modified text. You may also pass replyBody and resolveAnnotation=true when the edit fully resolves the annotation. If this edit is handling a review event, pass eventId so Margent can mark that event handled when resolving.",
      inputSchema: {
        documentPath: z.string().min(1).optional().describe("Optional Markdown path."),
        content: z.string().describe("The full edited Markdown content to save."),
        annotationId: z
          .string()
          .min(1)
          .optional()
          .describe("Optional annotation id this edit is addressing."),
        preferredSelectedText: z
          .string()
          .min(1)
          .optional()
          .describe("Text in the edited document that the related annotation should anchor to."),
        replyBody: z
          .string()
          .min(1)
          .optional()
          .describe("Optional agent reply to append after saving the edit."),
        eventId: z
          .string()
          .min(1)
          .optional()
          .describe("Optional review event id to mark handled when resolveAnnotation is true."),
        resolveAnnotation: z
          .boolean()
          .optional()
          .describe("When true, mark the related annotation resolved after saving and replying.")
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async ({
      documentPath,
      content,
      annotationId,
      preferredSelectedText,
      replyBody,
      eventId,
      resolveAnnotation
    }) =>
      jsonToolResult(
        await applyDocumentEditPayload(resolveToolMarkdownPath(markdownPath, documentPath), {
          content,
          annotationId,
          preferredSelectedText,
          replyBody,
          eventId,
          resolveAnnotation
        })
      )
  );

  server.registerTool(
    "reviewer_update_annotation_status",
    {
      title: "Update Annotation Status",
      description:
        "Set an annotation to open or resolved. Mark resolved only after you have answered it or completed the requested change; reopen as open when the discussion should continue. If this status update is handling a review event, pass eventId so Margent can mark that event handled in the same write.",
      inputSchema: {
        documentPath: z.string().min(1).optional().describe("Optional Markdown path."),
        annotationId: z.string().min(1).describe("Annotation id to update."),
        status: z.enum(ANNOTATION_STATUS_VALUES).describe("New annotation status."),
        eventId: z
          .string()
          .min(1)
          .optional()
          .describe("Optional review event id to mark handled when status is resolved.")
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async ({ documentPath, annotationId, status, eventId }) =>
      jsonToolResult(
        await updateStatusPayload(
          resolveToolMarkdownPath(markdownPath, documentPath),
          annotationId,
          status,
          eventId
        )
      )
  );

  server.registerTool(
    "reviewer_create_review_event",
    {
      title: "Create Review Event",
      description:
        "Create a queued review event for an annotation. Usually the App does this automatically; use when manually routing a review task.",
      inputSchema: {
        documentPath: z.string().min(1).optional().describe("Optional Markdown path."),
        annotationId: z.string().min(1).describe("Annotation id."),
        deliveryMode: z.enum(["manual", "auto"]).describe("manual or auto."),
        triggerReplyId: z
          .string()
          .min(1)
          .optional()
          .describe("Optional reply id when this event is a follow-up to an Agent reply.")
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async ({ documentPath, annotationId, deliveryMode, triggerReplyId }) =>
      jsonToolResult(
        await createReviewEventPayload(
          resolveToolMarkdownPath(markdownPath, documentPath),
          annotationId,
          deliveryMode,
          triggerReplyId
        )
      )
  );

  server.registerTool(
    "reviewer_list_review_events",
    {
      title: "List Review Events",
      description:
        "List internal review delivery events. Use this to inspect queued, failed, or processing annotation tasks.",
      inputSchema: {
        documentPath: z.string().min(1).optional().describe("Optional Markdown path."),
        status: z.enum(REVIEW_EVENT_STATUS_VALUES).optional().describe("Filter by event status."),
        annotationId: z.string().min(1).optional().describe("Filter by annotation id.")
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ documentPath, status, annotationId }) =>
      jsonToolResult(
        await listReviewEventsPayload(resolveToolMarkdownPath(markdownPath, documentPath), {
          status,
          annotationId
        })
      )
  );

  server.registerTool(
    "reviewer_get_review_event",
    {
      title: "Get Review Event",
      description: "Read one internal review event, including delivery status and diagnostics.",
      inputSchema: {
        documentPath: z.string().min(1).optional().describe("Optional Markdown path."),
        eventId: z.string().min(1).describe("Review event id.")
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ documentPath, eventId }) =>
      jsonToolResult(
        await getReviewEventPayload(resolveToolMarkdownPath(markdownPath, documentPath), eventId)
      )
  );

  server.registerTool(
    "reviewer_update_review_event",
    {
      title: "Update Review Event",
      description:
        "Update an internal review event status. Prefer reviewer_mark_review_event_handled after completing a task.",
      inputSchema: {
        documentPath: z.string().min(1).optional().describe("Optional Markdown path."),
        eventId: z.string().min(1).describe("Review event id."),
        deliveryStatus: z
          .enum(REVIEW_EVENT_STATUS_VALUES)
          .optional()
          .describe("New event delivery status."),
        lastError: z.string().optional().describe("Optional diagnostic error.")
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async ({ documentPath, eventId, deliveryStatus, lastError }) =>
      jsonToolResult(
        await updateReviewEventPayload(
          resolveToolMarkdownPath(markdownPath, documentPath),
          eventId,
          deliveryStatus,
          lastError
        )
      )
  );

  server.registerTool(
    "reviewer_mark_review_event_handled",
    {
      title: "Mark Review Event Handled",
      description:
        "Mark a review event handled after you have replied to the annotation, edited the document, or otherwise completed the requested handling.",
      inputSchema: {
        documentPath: z.string().min(1).optional().describe("Optional Markdown path."),
        eventId: z.string().min(1).describe("Review event id.")
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async ({ documentPath, eventId }) =>
      jsonToolResult(
        await markReviewEventHandledPayload(
          resolveToolMarkdownPath(markdownPath, documentPath),
          eventId
        )
      )
  );

  server.registerTool(
    "reviewer_get_session",
    {
      title: "Get Reviewer Session",
      description: "Read the current Margent MCP session.",
      inputSchema: {
        documentPath: z.string().min(1).optional().describe("Optional Markdown path.")
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ documentPath }) => jsonToolResult(await getSessionPayload(markdownPath, documentPath))
  );

  server.registerTool(
    "reviewer_list_open_documents",
    {
      title: "List Open Documents",
      description:
        "List Markdown documents currently exposed by this MCP server. In multi-document mode, pass documentPath to document-specific tools.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async () => jsonToolResult(await listOpenDocumentsPayload(markdownPath))
  );
}

async function getDocumentPayload(markdownPath: string): Promise<ToolResultPayload> {
  const document = await loadReviewDocument(markdownPath);
  return {
    document: {
      id: document.id,
      absolutePath: document.absolutePath,
      relativePath: document.relativePath,
      reviewPath: document.reviewPath,
      agentLinkPath: document.agentLinkPath,
      codexLinkPath: document.codexLinkPath,
      headings: document.headings,
      contentHash: document.contentHash,
      loadedAt: document.loadedAt,
      content: document.content
    }
  };
}

async function getCodexLinkPayload(
  markdownPath: string | undefined,
  documentPath?: string
): Promise<ToolResultPayload> {
  return {
    codexLink: await getCodexLinkResponse(resolveToolMarkdownPath(markdownPath, documentPath))
  };
}

async function getAgentLinkPayload(
  markdownPath: string | undefined,
  documentPath?: string
): Promise<ToolResultPayload> {
  return {
    agentLink: await getAgentLinkResponse(resolveToolMarkdownPath(markdownPath, documentPath))
  };
}

async function updateAgentLinkPayload(
  markdownPath: string | undefined,
  input: {
    documentPath?: string;
    provider?: AgentProvider;
    sourceSessionId?: string;
    targetSessionId?: string;
    targetRole?: AgentSessionRole;
    cwd?: string;
    displayName?: string;
    autoSendNewAnnotations?: boolean;
  }
): Promise<ToolResultPayload> {
  const resolvedMarkdownPath = resolveToolMarkdownPath(markdownPath, input.documentPath);
  const now = new Date().toISOString();
  const provider = input.provider ?? "codex";
  await updateAgentDocumentLink(resolvedMarkdownPath, {
    source: input.sourceSessionId
      ? {
          provider,
          role: "source",
          sessionId: input.sourceSessionId,
          cwd: input.cwd,
          displayName: input.displayName,
          configuredAt: now,
          configuredBy: "agent",
          configuredVia: "source"
        }
      : undefined,
    target: input.targetSessionId
      ? {
          provider,
          role: input.targetRole ?? "source",
          sessionId: input.targetSessionId,
          cwd: input.cwd,
          displayName: input.displayName,
          configuredAt: now,
          configuredBy: "agent",
          configuredVia: input.targetRole === "successor" ? "mcp-bind-instruction" : "source"
        }
      : undefined,
    bridge:
      input.autoSendNewAnnotations === undefined
        ? undefined
        : { autoSendNewAnnotations: input.autoSendNewAnnotations }
  });
  return {
    agentLink: await getAgentLinkResponse(resolvedMarkdownPath)
  };
}

async function bindCurrentAgentSessionPayload(
  markdownPath: string | undefined,
  input: {
    documentPath?: string;
    provider: AgentProvider;
    role: AgentSessionRole;
    sessionId?: string;
    cwd?: string;
    displayName?: string;
    autoSendNewAnnotations?: boolean;
  }
): Promise<ToolResultPayload> {
  const resolvedMarkdownPath = resolveToolMarkdownPath(markdownPath, input.documentPath);
  await bindAgentSession(resolvedMarkdownPath, input);
  return {
    agentLink: await getAgentLinkResponse(resolvedMarkdownPath)
  };
}

async function updateCodexLinkPayload(
  markdownPath: string | undefined,
  input: {
    documentPath?: string;
    sourceThreadId?: string;
    targetThreadId?: string;
    targetType?: CodexTargetType;
    cwd?: string;
    autoSendNewAnnotations?: boolean;
  }
): Promise<ToolResultPayload> {
  const resolvedMarkdownPath = resolveToolMarkdownPath(markdownPath, input.documentPath);
  const now = new Date().toISOString();
  await updateCodexDocumentLink(resolvedMarkdownPath, {
    source: input.sourceThreadId
      ? {
          type: "codex",
          threadId: input.sourceThreadId,
          cwd: input.cwd,
          createdAt: now,
          updatedAt: now
        }
      : undefined,
    target: input.targetThreadId
      ? {
          type: input.targetType ?? "source",
          threadId: input.targetThreadId,
          cwd: input.cwd,
          configuredAt: now,
          configuredBy: "codex",
          configuredVia: input.targetType === "successor" ? "mcp-bind-instruction" : "source"
        }
      : undefined,
    bridge:
      input.autoSendNewAnnotations === undefined
        ? undefined
        : { autoSendNewAnnotations: input.autoSendNewAnnotations }
  });
  return {
    codexLink: await getCodexLinkResponse(resolvedMarkdownPath)
  };
}

async function bindCurrentCodexThreadPayload(
  markdownPath: string | undefined,
  input: {
    documentPath?: string;
    role: CodexTargetType;
    threadId?: string;
    cwd?: string;
    autoSendNewAnnotations?: boolean;
  }
): Promise<ToolResultPayload> {
  const resolvedMarkdownPath = resolveToolMarkdownPath(markdownPath, input.documentPath);
  await bindCodexThread(resolvedMarkdownPath, input);
  return {
    codexLink: await getCodexLinkResponse(resolvedMarkdownPath)
  };
}

async function listAnnotationsPayload(
  markdownPath: string,
  status: (typeof STATUS_VALUES)[number]
): Promise<ToolResultPayload> {
  const [document, review] = await Promise.all([
    loadReviewDocument(markdownPath),
    loadReviewFile(markdownPath)
  ]);
  const annotations = review.annotations
    .filter((annotation) => status === "all" || annotation.status === status)
    .map(summarizeAnnotation);

  return {
    document: {
      id: document.id,
      absolutePath: document.absolutePath,
      relativePath: document.relativePath,
      reviewPath: getReviewPath(markdownPath)
    },
    filter: status,
    total: annotations.length,
    annotations
  };
}

async function getAnnotationContextPayload(
  markdownPath: string | undefined,
  annotationId: string,
  documentPath?: string,
  triggerReplyId?: string
): Promise<ToolResultPayload> {
  return {
    context: await getAnnotationContext(
      resolveToolMarkdownPath(markdownPath, documentPath),
      annotationId,
      { triggerReplyId }
    )
  };
}

async function addReplyPayload(
  markdownPath: string,
  annotationId: string,
  body: string,
  authorName?: string,
  replyToReplyId?: string,
  eventId?: string,
  resolveAnnotation?: boolean
): Promise<ToolResultPayload> {
  const review = await addAnnotationReply(markdownPath, annotationId, {
    author: { type: "agent", name: authorName ?? (await getDefaultAgentAuthorName(markdownPath)) },
    body,
    replyToReplyId,
    eventId,
    resolveAnnotation
  });
  return {
    ...changedAnnotationPayload(review, annotationId),
    event: eventId ? review.events?.find((item) => item.id === eventId) : undefined
  };
}

async function updateAnnotationPayload(
  markdownPath: string,
  annotationId: string,
  body: string
): Promise<ToolResultPayload> {
  const review = await updateAnnotation(markdownPath, annotationId, { body });
  return changedAnnotationPayload(review, annotationId);
}

async function deleteAnnotationPayload(
  markdownPath: string,
  annotationId: string
): Promise<ToolResultPayload> {
  const review = await deleteAnnotation(markdownPath, annotationId);
  return {
    review: {
      documentPath: review.documentPath,
      documentId: review.documentId,
      updatedAt: review.updatedAt,
      annotationCount: review.annotations.length
    },
    deletedAnnotationId: annotationId
  };
}

async function updateReplyPayload(
  markdownPath: string,
  annotationId: string,
  replyId: string,
  body: string
): Promise<ToolResultPayload> {
  const review = await updateAnnotationReply(markdownPath, annotationId, replyId, { body });
  return changedAnnotationPayload(review, annotationId);
}

async function applyDocumentEditPayload(
  markdownPath: string,
  input: {
    content: string;
    annotationId?: string;
    preferredSelectedText?: string;
    replyBody?: string;
    eventId?: string;
    resolveAnnotation?: boolean;
  }
): Promise<ToolResultPayload> {
  const currentDocument = await loadReviewDocument(markdownPath);
  let response = await saveReviewDocument(
    markdownPath,
    {
      content: input.content,
      baseContentHash: currentDocument.contentHash
    },
    {
      annotationId: input.annotationId,
      preferredSelectedText: input.preferredSelectedText
    }
  );

  if (input.annotationId && input.replyBody) {
    const review = await addAnnotationReply(markdownPath, input.annotationId, {
      author: { type: "agent", name: await getDefaultAgentAuthorName(markdownPath) },
      body: input.replyBody
    });
    response = { ...response, review };
  }

  if (input.annotationId && input.resolveAnnotation) {
    const review = await updateAnnotationStatus(markdownPath, input.annotationId, {
      status: "resolved",
      eventId: input.eventId
    });
    response = { ...response, review };
  }

  const annotation = input.annotationId
    ? response.review.annotations.find((item) => item.id === input.annotationId)
    : undefined;

  return {
    document: {
      id: response.document.id,
      absolutePath: response.document.absolutePath,
      relativePath: response.document.relativePath,
      reviewPath: response.document.reviewPath,
      contentHash: response.document.contentHash,
      loadedAt: response.document.loadedAt,
      headings: response.document.headings
    },
    repairedAnnotations: response.repairedAnnotations,
    review: {
      documentPath: response.review.documentPath,
      documentId: response.review.documentId,
      updatedAt: response.review.updatedAt,
      annotationCount: response.review.annotations.length
    },
    annotation,
    event: input.eventId
      ? response.review.events?.find((item) => item.id === input.eventId)
      : undefined
  };
}

async function getDefaultAgentAuthorName(markdownPath: string): Promise<string> {
  const link = await loadAgentDocumentLink(markdownPath);
  const target = resolveAgentTarget(link) ?? link?.source;
  return target?.displayName ?? getProviderDisplayName(target?.provider ?? "codex");
}

async function updateStatusPayload(
  markdownPath: string,
  annotationId: string,
  status: AnnotationStatus,
  eventId?: string
): Promise<ToolResultPayload> {
  const review = await updateAnnotationStatus(markdownPath, annotationId, { status, eventId });
  return {
    ...changedAnnotationPayload(review, annotationId),
    event: eventId ? review.events?.find((item) => item.id === eventId) : undefined
  };
}

async function createReviewEventPayload(
  markdownPath: string,
  annotationId: string,
  deliveryMode: "manual" | "auto",
  triggerReplyId?: string
): Promise<ToolResultPayload> {
  const review = await createReviewEvent(markdownPath, {
    annotationId,
    deliveryMode,
    triggerReplyId
  });
  return {
    review: summarizeReview(review),
    event: review.events?.[review.events.length - 1]
  };
}

async function listReviewEventsPayload(
  markdownPath: string,
  filter: {
    status?: ReviewEventDeliveryStatus;
    annotationId?: string;
  }
): Promise<ToolResultPayload> {
  const events = await listReviewEvents(markdownPath, filter);
  return {
    documentPath: markdownPath,
    total: events.length,
    events
  };
}

async function getReviewEventPayload(
  markdownPath: string,
  eventId: string
): Promise<ToolResultPayload> {
  return {
    event: await getReviewEvent(markdownPath, eventId)
  };
}

async function updateReviewEventPayload(
  markdownPath: string,
  eventId: string,
  deliveryStatus?: ReviewEventDeliveryStatus,
  lastError?: string
): Promise<ToolResultPayload> {
  const review = await updateReviewEvent(markdownPath, eventId, {
    deliveryStatus,
    ...(lastError === undefined ? {} : { lastError })
  });
  return {
    review: summarizeReview(review),
    event: review.events?.find((item) => item.id === eventId)
  };
}

async function markReviewEventHandledPayload(
  markdownPath: string,
  eventId: string
): Promise<ToolResultPayload> {
  const review = await markReviewEventHandled(markdownPath, eventId);
  return {
    review: summarizeReview(review),
    event: review.events?.find((item) => item.id === eventId)
  };
}

async function getSessionPayload(
  markdownPath: string | undefined,
  documentPath?: string
): Promise<ToolResultPayload> {
  const resolvedMarkdownPath =
    documentPath || markdownPath ? resolveToolMarkdownPath(markdownPath, documentPath) : undefined;

  if (!resolvedMarkdownPath) {
    return {
      session: {
        hasDocument: false,
        mode: "multi-document",
        requiresDocumentPath: true
      }
    };
  }

  const document = await loadReviewDocument(resolvedMarkdownPath);
  const agentLink = await getAgentLinkResponse(resolvedMarkdownPath);
  const codexLink = await getCodexLinkResponse(resolvedMarkdownPath);
  return {
    session: {
      hasDocument: true,
      mode: markdownPath ? "default-document" : "multi-document",
      documentPath: resolvedMarkdownPath,
      reviewPath: getReviewPath(resolvedMarkdownPath),
      agentLinkPath: getAgentLinkPath(resolvedMarkdownPath),
      codexLinkPath: getCodexLinkPath(resolvedMarkdownPath),
      documentId: document.id,
      agentConnection: agentLink.connection,
      codexConnection: codexLink.connection
    }
  };
}

async function listOpenDocumentsPayload(markdownPath: string | undefined): Promise<ToolResultPayload> {
  if (!markdownPath) {
    return {
      mode: "multi-document",
      requiresDocumentPath: true,
      documents: []
    };
  }

  const document = await loadReviewDocument(markdownPath);
  return {
    mode: "default-document",
    documents: [
      {
        id: document.id,
        absolutePath: document.absolutePath,
        relativePath: document.relativePath,
        reviewPath: document.reviewPath,
        codexLinkPath: document.codexLinkPath
      }
    ]
  };
}

function changedAnnotationPayload(review: ReviewFile, annotationId: string): ToolResultPayload {
  const annotation = review.annotations.find((item) => item.id === annotationId);
  return {
    review: summarizeReview(review),
    annotation
  };
}

function summarizeReview(review: ReviewFile): Record<string, unknown> {
  return {
    documentPath: review.documentPath,
    documentId: review.documentId,
    updatedAt: review.updatedAt,
    annotationCount: review.annotations.length,
    eventCount: review.events?.length ?? 0
  };
}

function summarizeAnnotation(annotation: ReviewAnnotation): Record<string, unknown> {
  return {
    id: annotation.id,
    status: annotation.status,
    author: annotation.author,
    body: annotation.body,
    selectedText: annotation.anchor.selectedText,
    anchorKind: annotation.anchor.kind,
    headingId: annotation.anchor.headingId,
    headingText: annotation.anchor.headingText,
    replyCount: annotation.replies.length,
    createdAt: annotation.createdAt,
    updatedAt: annotation.updatedAt,
    resolvedAt: annotation.resolvedAt
  };
}

function jsonToolResult(payload: ToolResultPayload): CallToolResult {
  return {
    structuredContent: payload,
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2)
      }
    ]
  };
}

function resolveToolMarkdownPath(markdownPath: string | undefined, documentPath?: string): string {
  if (!documentPath) {
    if (!markdownPath) {
      throw new Error(
        "documentPath is required when Margent MCP is running in multi-document mode."
      );
    }
    return markdownPath;
  }

  const resolvedMarkdownPath = resolveMarkdownPath(documentPath);
  assertReadableMarkdownFile(resolvedMarkdownPath);

  return resolvedMarkdownPath;
}
