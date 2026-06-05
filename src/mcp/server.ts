import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerReviewerTools } from "./tools.js";

export type ReviewerMcpServerOptions = {
  markdownPath: string;
};

export function createReviewerMcpServer(options: ReviewerMcpServerOptions): McpServer {
  const server = new McpServer(
    {
      name: "margent",
      version: "0.1.0"
    },
    {
      instructions:
        "Use this MCP server to read and edit a local Markdown document and its Margent annotations. Read annotation context before replying or editing. When a requested document change is clear, call reviewer_apply_document_edit with the full edited Markdown and pass annotationId plus preferredSelectedText when editing for a specific annotation so it can be re-anchored to the changed text. Add replies when you answer a question or report a completed change. Mark annotations resolved only when the issue is actually handled; reopen as open when discussion should continue. If you are handling a review event delivered by the App, inspect the event when needed and call reviewer_mark_review_event_handled after the annotation has been replied to, edited, or otherwise handled. Use reviewer_bind_current_codex_thread only when the user asks to connect this Codex conversation as the document source or successor."
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
