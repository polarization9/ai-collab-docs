export type AgentProvider = "codex" | "claude-code" | "custom-cli";

export type AgentSessionRole = "source" | "successor";

export type AgentConfiguredBy = "agent" | "user";

export type AgentConfiguredVia =
  | "source"
  | "mcp-bind-instruction"
  | "manual"
  | "local-discovery";

export type AgentSessionReference = {
  provider: AgentProvider;
  role?: AgentSessionRole;
  sessionId?: string;
  turnId?: string;
  cwd?: string;
  displayName?: string;
  configuredAt?: string;
  configuredBy?: AgentConfiguredBy;
  configuredVia?: AgentConfiguredVia;
};

export type AgentDocumentLink = {
  version: 1;
  documentPath: string;
  source?: AgentSessionReference;
  target?: AgentSessionReference;
  bridge?: {
    autoSendNewAnnotations?: boolean;
    lastDeliveredEventId?: string;
    lastDeliveryAt?: string;
  };
};

export type AgentLinkConnection = {
  hasSource: boolean;
  hasTarget: boolean;
  provider: AgentProvider | null;
  targetRole: AgentSessionRole | null;
  autoSendNewAnnotations: boolean;
  sourceAvailable: boolean | null;
};

export type AgentLinkResponse = {
  documentPath: string;
  agentLinkPath: string;
  legacyCodexLinkPath?: string;
  link: AgentDocumentLink | null;
  connection: AgentLinkConnection;
};

export type UpdateAgentLinkRequest = {
  source?: AgentDocumentLink["source"];
  target?: AgentDocumentLink["target"];
  bridge?: AgentDocumentLink["bridge"];
};

export type AgentSuccessorInstructionResponse = {
  documentPath: string;
  provider: AgentProvider;
  instruction: string;
};
