export type CodexTargetType = "source" | "successor";

export type CodexThreadReference = {
  type: "codex";
  threadId?: string;
  turnId?: string;
  cwd?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type CodexTargetReference = {
  type: CodexTargetType;
  threadId?: string;
  cwd?: string;
  configuredAt?: string;
  configuredBy?: "codex" | "user";
  configuredVia?: "source" | "mcp-bind-instruction" | "manual";
};

export type CodexDocumentLink = {
  version: 1;
  documentPath: string;
  source?: CodexThreadReference;
  target?: CodexTargetReference;
  bridge?: {
    autoSendNewAnnotations?: boolean;
    lastDeliveredEventId?: string;
    lastDeliveryAt?: string;
  };
};

export type CodexLinkConnection = {
  hasSource: boolean;
  hasTarget: boolean;
  targetType: CodexTargetType | null;
  autoSendNewAnnotations: boolean;
  sourceAvailable: boolean | null;
};

export type CodexLinkResponse = {
  documentPath: string;
  codexLinkPath: string;
  link: CodexDocumentLink | null;
  connection: CodexLinkConnection;
};

export type UpdateCodexLinkRequest = {
  source?: CodexDocumentLink["source"];
  target?: CodexDocumentLink["target"];
  bridge?: CodexDocumentLink["bridge"];
};

export type SuccessorInstructionResponse = {
  documentPath: string;
  instruction: string;
};
