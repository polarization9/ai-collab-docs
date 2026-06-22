import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerReviewerTools } from "./tools.js";

export type ReviewerMcpServerOptions = {
  markdownPath?: string;
};

export function createReviewerMcpServer(options: ReviewerMcpServerOptions): McpServer {
  const server = new McpServer(
    {
      name: "margent",
      version: "0.1.0"
    },
    {
      instructions:
        "Use this MCP server to read and edit local Markdown documents and their Margent annotations. Pass documentPath when operating on a specific document. Read annotation context before replying or editing. When a requested document change is clear, call reviewer_apply_document_edit with the full edited Markdown and pass annotationId plus preferredSelectedText when editing for a specific annotation so it can be re-anchored to the changed text. Add replies when you answer a question or report a completed change. Mark annotations resolved only when the issue is actually handled; if you are handling a review event delivered by the App, pass eventId to reviewer_update_annotation_status or reviewer_apply_document_edit so Margent can mark that event handled in the same write. Reopen as open when discussion should continue. If you handled the review event but kept the annotation open, call reviewer_mark_review_event_handled after replying or explaining why it remains open. Use reviewer_bind_current_agent_session when the user asks to connect this Agent session as the document source or successor; reviewer_bind_current_codex_thread remains available as a Codex compatibility alias."
    }
  );

  registerReviewerTools(server, options.markdownPath);
  return server;
}

export async function startReviewerMcpServer(options: ReviewerMcpServerOptions): Promise<void> {
  const server = createReviewerMcpServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
