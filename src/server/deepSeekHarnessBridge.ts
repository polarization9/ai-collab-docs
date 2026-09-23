export const DEFAULT_DEEPSEEK_HARNESS_WEB_URL = "http://127.0.0.1:3080";

const DEEPSEEK_HARNESS_RPC_TIMEOUT_MS = 8_000;

export type DeepSeekHarnessSessionState = {
  found: boolean;
  running: boolean;
  updatedAt: number;
};

export function resolveDeepSeekHarnessEndpoint(value?: string): string {
  const candidate = value?.trim() || DEFAULT_DEEPSEEK_HARNESS_WEB_URL;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error(`DeepSeek Harness Web URL is invalid: ${candidate}`);
  }

  const hostname = url.hostname.toLowerCase();
  if (
    url.protocol !== "http:" ||
    (hostname !== "127.0.0.1" &&
      hostname !== "localhost" &&
      hostname !== "::1" &&
      hostname !== "[::1]")
  ) {
    throw new Error("DeepSeek Harness delivery endpoint must be a local HTTP URL.");
  }
  if (url.username || url.password) {
    throw new Error("DeepSeek Harness delivery endpoint must not contain credentials.");
  }

  return url.origin;
}

export async function sendDeepSeekHarnessPrompt(input: {
  endpoint?: string;
  sessionId: string;
  prompt: string;
  rpcId: string;
  clientTimeZone?: string;
}): Promise<void> {
  const value = await callDeepSeekHarnessRpc(
    input.endpoint,
    "session.prompt",
    {
      sessionId: input.sessionId,
      mode: "queue",
      content: [{ type: "text", text: input.prompt }],
      clientTimeZone: input.clientTimeZone
    },
    input.rpcId
  );
  if (!isRecord(value) || value.accepted !== true) {
    throw new Error("DeepSeek Harness did not accept the queued prompt.");
  }
}

export async function getDeepSeekHarnessSessionState(input: {
  endpoint?: string;
  sessionId: string;
}): Promise<DeepSeekHarnessSessionState> {
  const value = await callDeepSeekHarnessRpc(
    input.endpoint,
    "session.list",
    {},
    `margent-session-list-${Date.now()}`
  );
  const items = isRecord(value) && Array.isArray(value.items) ? value.items : [];
  const session = items.find(
    (item) => isRecord(item) && item.sessionId === input.sessionId
  );
  if (!isRecord(session)) {
    return { found: false, running: false, updatedAt: 0 };
  }
  return {
    found: true,
    running: session.running === true,
    updatedAt: typeof session.updatedAt === "number" ? session.updatedAt : 0
  };
}

async function callDeepSeekHarnessRpc(
  endpoint: string | undefined,
  method: string,
  payload: Record<string, unknown>,
  rpcId: string
): Promise<unknown> {
  const baseUrl = resolveDeepSeekHarnessEndpoint(endpoint);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEEPSEEK_HARNESS_RPC_TIMEOUT_MS);

  try {
    const response = await fetch(`${baseUrl}/api/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "client-request",
        rpcId,
        method,
        payload
      }),
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`DeepSeek Harness Web API returned HTTP ${response.status}.`);
    }

    const parsed = (await response.json()) as unknown;
    if (!isRecord(parsed) || !isRecord(parsed.result)) {
      throw new Error("DeepSeek Harness Web API returned an invalid response.");
    }
    if (parsed.result.ok !== true) {
      throw new Error(formatRpcError(parsed.result.error));
    }
    return parsed.result.value;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("DeepSeek Harness Web API request timed out.");
    }
    if (error instanceof Error && error.message.startsWith("DeepSeek Harness")) {
      throw error;
    }
    throw new Error(
      "Cannot connect to DeepSeek Harness. Keep `dsh web` running, then reconnect this document or set DEEPSEEK_HARNESS_WEB_URL."
    );
  } finally {
    clearTimeout(timeout);
  }
}

function formatRpcError(value: unknown): string {
  if (isRecord(value)) {
    const message = typeof value.message === "string" ? value.message.trim() : "";
    const code = typeof value.code === "string" ? value.code.trim() : "";
    if (message) {
      return code ? `DeepSeek Harness ${code}: ${message}` : `DeepSeek Harness: ${message}`;
    }
  }
  return "DeepSeek Harness rejected the request.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
