import type { AgentLinkResponse } from "./agentTypes.js";
import type { CodexLinkResponse } from "./codexTypes.js";
import type { ReviewFile } from "./reviewTypes.js";

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export type Heading = {
  id: string;
  level: HeadingLevel;
  text: string;
};

export type ReviewDocument = {
  id: string;
  absolutePath: string;
  relativePath: string;
  reviewPath: string;
  agentLinkPath: string;
  codexLinkPath: string;
  content: string;
  contentHash: string;
  loadedAt: string;
  headings: Heading[];
};

export type ReviewSession = {
  hasDocument: boolean;
  documentPath: string | null;
  reviewPath: string | null;
  agentLinkPath: string | null;
  codexLinkPath: string | null;
  sourceAgentSessionId: string | null;
  sourceThreadId: string | null;
};

export type OpenDocumentRequest = {
  path: string;
};

export type ReviewBootstrap =
  | {
      hasDocument: false;
      session: ReviewSession;
      document: null;
      review: null;
      agentLink: null;
      codexLink: null;
    }
  | {
      hasDocument: true;
      session: ReviewSession;
      document: ReviewDocument;
      review: ReviewFile;
      agentLink: AgentLinkResponse;
      codexLink: CodexLinkResponse;
    };

export type ApiError = {
  error: string;
};
