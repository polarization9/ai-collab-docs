import { useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Copy,
  FileText,
  Link2,
  MessageSquareText,
  RefreshCw,
  Settings2
} from "lucide-react";

type ScenarioId = "off" | "on" | "source-missing" | "mcp-failed";

type AnnotationStatus = "open" | "queued" | "delivering" | "processing" | "handled" | "failed";

type AnnotationCard = {
  id: string;
  status: AnnotationStatus;
  title: string;
  body: string;
  meta: string;
};

type Scenario = {
  id: ScenarioId;
  title: string;
  shortTitle: string;
  description: string;
  monitorOn: boolean;
  connectionLabel: string;
  connectionTone: "neutral" | "success" | "warning" | "danger";
  queueSummary: string;
  codexTitle: string;
  codexSubtitle: string;
  codexMode: "quiet" | "prompt" | "binding" | "failed";
  annotations: AnnotationCard[];
};

const scenarios: Scenario[] = [
  {
    id: "off",
    title: "关闭监控：只本地保存批注",
    shortTitle: "关闭监控",
    description: "用户可以连续批注，Codex 不会被自动唤起；每条批注保留手动发送入口。",
    monitorOn: false,
    connectionLabel: "已关联来源会话",
    connectionTone: "neutral",
    queueSummary: "未开启自动队列",
    codexTitle: "Codex 来源会话",
    codexSubtitle: "没有自动消息，等待用户手动发送",
    codexMode: "quiet",
    annotations: [
      {
        id: "ann_041",
        status: "open",
        title: "未发送",
        body: "这里的“接续对话”需要再解释一下用户如何理解。",
        meta: "0 条回复 · 14:22"
      },
      {
        id: "ann_040",
        status: "open",
        title: "未发送",
        body: "自动监控关闭时，批注应该只保存，不创建投递事件。",
        meta: "0 条回复 · 14:18"
      }
    ]
  },
  {
    id: "on",
    title: "开启监控：串行投递到目标会话",
    shortTitle: "开启监控",
    description: "新批注进入队列，同一文档同一目标会话一次只处理一条，避免多个 turn 同时改正文。",
    monitorOn: true,
    connectionLabel: "来源会话 · 自动监控中",
    connectionTone: "success",
    queueSummary: "1 条处理中 · 2 条待投递",
    codexTitle: "Codex 来源会话",
    codexSubtitle: "收到 Reviewer 自动投递的批注任务",
    codexMode: "prompt",
    annotations: [
      {
        id: "ann_044",
        status: "processing",
        title: "处理中",
        body: "补充自动监控开启后，Codex 会话里会出现什么。",
        meta: "事件 evt_118 · source"
      },
      {
        id: "ann_045",
        status: "queued",
        title: "待投递",
        body: "这里要展示串行队列，不要一次性把所有批注都发过去。",
        meta: "排队第 1 位"
      },
      {
        id: "ann_046",
        status: "queued",
        title: "待投递",
        body: "投递 prompt 里要提醒 Codex 通过 MCP 读取上下文。",
        meta: "排队第 2 位"
      }
    ]
  },
  {
    id: "source-missing",
    title: "来源不可用：复制指令绑定接续对话",
    shortTitle: "来源不可用",
    description: "产品不要求用户找 thread id，而是生成绑定指令，让目标 Codex 会话通过 MCP 绑定自己。",
    monitorOn: false,
    connectionLabel: "来源会话不可用",
    connectionTone: "warning",
    queueSummary: "1 条失败 · 等待接续绑定",
    codexTitle: "新的 Codex 对话",
    codexSubtitle: "用户粘贴绑定指令后，Codex 自动调用 MCP",
    codexMode: "binding",
    annotations: [
      {
        id: "ann_047",
        status: "failed",
        title: "未投递",
        body: "请按这个批注更新 PRD，但来源会话现在无法连接。",
        meta: "source thread unavailable"
      }
    ]
  },
  {
    id: "mcp-failed",
    title: "异常处理：MCP 未连接或回写失败",
    shortTitle: "异常处理",
    description: "任务不会被假装成已处理；Reviewer 留在失败状态，Codex 侧说明缺少工具，用户可以修复后重试。",
    monitorOn: true,
    connectionLabel: "接续对话 · MCP 需要处理",
    connectionTone: "danger",
    queueSummary: "队列暂停 · 1 条失败",
    codexTitle: "Codex 接续对话",
    codexSubtitle: "任务已收到，但工具不可用",
    codexMode: "failed",
    annotations: [
      {
        id: "ann_048",
        status: "failed",
        title: "处理失败",
        body: "把异常处理写得更像用户真实会遇到的情况。",
        meta: "MCP tool unavailable"
      },
      {
        id: "ann_049",
        status: "queued",
        title: "暂停等待",
        body: "后续批注不要继续投递，避免扩大失败。",
        meta: "队列暂停"
      }
    ]
  }
];

const reconnectInstruction = `请通过 Margent MCP 绑定当前会话：

bind_codex_thread({
  documentPath: "/Users/me/docs/Margent PRD.md",
  role: "successor",
  autoSendNewAnnotations: true
})

绑定后读取未解决批注，并从 ann_047 开始处理。`;

export function CodexBridgePrototype() {
  const [activeId, setActiveId] = useState<ScenarioId>("on");
  const [toast, setToast] = useState<string | null>(null);
  const active = useMemo(
    () => scenarios.find((scenario) => scenario.id === activeId) ?? scenarios[0],
    [activeId]
  );

  async function copyReconnectInstruction() {
    try {
      await navigator.clipboard.writeText(reconnectInstruction);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = reconnectInstruction;
      textarea.setAttribute("readonly", "true");
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }

    setToast("指令复制成功，粘贴到目标会话发送给 Codex 即可重连");
    window.setTimeout(() => setToast(null), 2600);
  }

  return (
    <main className="prototype-page">
      {toast ? <div className="prototype-toast">{toast}</div> : null}
      <section className="prototype-topbar" aria-label="prototype navigation">
        <div>
          <p className="prototype-kicker">Margent</p>
          <h1>Codex 批注桥接关键原型</h1>
        </div>
        <div className="prototype-doc-chip">
          <FileText size={16} />
          docs/产品外壳与 Codex 连接 PRD.md
        </div>
      </section>

      <section className="prototype-layout">
        <aside className="prototype-scenarios" aria-label="prototype scenarios">
          <p className="prototype-panel-label">场景</p>
          {scenarios.map((scenario) => (
            <button
              className={`prototype-scenario-button ${
                scenario.id === active.id ? "prototype-scenario-button-active" : ""
              }`}
              key={scenario.id}
              type="button"
              onClick={() => setActiveId(scenario.id)}
            >
              <span>{scenario.shortTitle}</span>
              <small>{scenario.description}</small>
            </button>
          ))}
        </aside>

        <section className="prototype-stage">
          <div className="prototype-stage-header">
            <div>
              <p className="prototype-panel-label">当前原型</p>
              <h2>{active.title}</h2>
              <p>{active.description}</p>
            </div>
            <div className="prototype-toggle-card" data-on={active.monitorOn}>
              <span>Codex 自动监控</span>
              <strong>{active.monitorOn ? "开启" : "关闭"}</strong>
            </div>
          </div>

          <div className="prototype-dual-screen">
            <ReviewerMock scenario={active} onCopyReconnect={copyReconnectInstruction} />
            <CodexMock scenario={active} onCopyReconnect={copyReconnectInstruction} />
          </div>
        </section>
      </section>
    </main>
  );
}

function ReviewerMock({
  scenario,
  onCopyReconnect
}: {
  scenario: Scenario;
  onCopyReconnect: () => void;
}) {
  return (
    <section className="prototype-window prototype-reviewer">
      <header className="prototype-window-bar">
        <div className="prototype-window-controls" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="prototype-window-title">Reviewer 文档窗口</div>
        <button className="prototype-icon-button" type="button" aria-label="设置">
          <Settings2 size={15} />
        </button>
      </header>

      <div className="prototype-reviewer-body">
        <article className="prototype-document">
          <div className="prototype-doc-path">/Users/me/docs/Margent PRD.md</div>
          <h3>7.3 批注事件与自动监控</h3>
          <p>
            文档级提供“Codex 自动监控批注”开关。这个开关只负责把新批注投递给当前目标会话，
            不替代 Codex 的上下文，也不自动生成摘要。
          </p>
          <p className="prototype-highlight">
            自动监控开启后，新批注保存到本地，并按文档维度进入串行投递队列。
          </p>
          <p>
            如果来源会话不可用，用户可以复制接续对话绑定指令，粘贴到新的 Codex 会话中完成绑定。
          </p>
        </article>

        <aside className="prototype-annotation-panel">
          <div className="prototype-annotation-head">
            <div>
              <p className="prototype-panel-label">Review</p>
              <h4>批注</h4>
            </div>
            <button className="prototype-icon-button" type="button" aria-label="刷新状态">
              <RefreshCw size={15} />
            </button>
          </div>

          <div className={`prototype-connection prototype-connection-${scenario.connectionTone}`}>
            <div>
              <span>{scenario.connectionLabel}</span>
              <strong>{scenario.queueSummary}</strong>
            </div>
            {scenario.id === "source-missing" ? (
              <button className="prototype-connection-action" type="button" onClick={onCopyReconnect}>
                <Copy size={14} />
                复制接续指令
              </button>
            ) : null}
          </div>

          <div className="prototype-filter-tabs" aria-label="批注状态筛选">
            <button className="prototype-filter-tab-active" type="button">
              全部
            </button>
            <button type="button">已解决</button>
            <button type="button">未解决</button>
          </div>

          <div className="prototype-annotation-list">
            {scenario.annotations.map((annotation) => (
              <AnnotationPreview annotation={annotation} key={annotation.id} />
            ))}
          </div>
        </aside>
      </div>
    </section>
  );
}

function AnnotationPreview({ annotation }: { annotation: AnnotationCard }) {
  const Icon = getStatusIcon(annotation.status);
  return (
    <article className={`prototype-annotation prototype-annotation-${annotation.status}`}>
      <div className="prototype-annotation-status">
        <div className="prototype-annotation-status-left">
          <span>
            <Icon size={14} />
            {annotation.title}
          </span>
          {annotation.status === "failed" ? (
            <button className="prototype-status-icon-button" type="button" aria-label="重试投递">
              <RefreshCw size={13} />
            </button>
          ) : null}
        </div>
        <code>{annotation.id}</code>
      </div>
      <p>{annotation.body}</p>
      <small>{annotation.meta}</small>
      {annotation.status === "open" ? (
        <div className="prototype-annotation-actions">
          <button type="button">回复</button>
          <button type="button">编辑</button>
          <button type="button">@codex</button>
        </div>
      ) : null}
    </article>
  );
}

function CodexMock({
  scenario,
  onCopyReconnect
}: {
  scenario: Scenario;
  onCopyReconnect: () => void;
}) {
  return (
    <section className="prototype-window prototype-codex">
      <header className="prototype-window-bar">
        <div className="prototype-window-controls" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="prototype-window-title">{scenario.codexTitle}</div>
        <div className="prototype-codex-status">{scenario.codexSubtitle}</div>
      </header>
      <div className="prototype-codex-body">
        {scenario.codexMode === "quiet" ? <QuietCodex /> : null}
        {scenario.codexMode === "prompt" ? <PromptCodex /> : null}
        {scenario.codexMode === "binding" ? <BindingCodex onCopyReconnect={onCopyReconnect} /> : null}
        {scenario.codexMode === "failed" ? <FailedCodex /> : null}
      </div>
    </section>
  );
}

function QuietCodex() {
  return (
    <div className="prototype-empty-codex">
      <MessageSquareText size={28} />
      <h4>这个会话不会被自动打扰</h4>
      <p>关闭监控时，Reviewer 只保存批注。用户手动发送后，这里才会出现处理任务。</p>
    </div>
  );
}

function PromptCodex() {
  return (
    <>
      <div className="prototype-codex-message prototype-codex-message-user">
        <p className="prototype-panel-label">Reviewer 自动投递</p>
        <h4>Margent 有一条新的批注任务需要处理。</h4>
        <dl>
          <div>
            <dt>文档路径</dt>
            <dd>/Users/me/docs/Margent PRD.md</dd>
          </div>
          <div>
            <dt>批注 ID</dt>
            <dd>ann_044</dd>
          </div>
          <div>
            <dt>事件 ID</dt>
            <dd>evt_118</dd>
          </div>
          <div>
            <dt>目标类型</dt>
            <dd>source</dd>
          </div>
        </dl>
        <pre>{`1. 调用 MCP 读取批注上下文
2. 判断是提问还是明确修改
3. 需要正文时通过 MCP 读取本地文档
4. 回复批注，必要时修改正文
5. 完成后标记事件 handled`}</pre>
      </div>

      <div className="prototype-tool-stream">
        <ToolCall status="done" label="get_annotation_context" detail="读取 ann_044 命中正文段落" />
        <ToolCall status="active" label="update_markdown_document" detail="保存正文修改并修复锚点" />
        <ToolCall status="waiting" label="mark_review_event_handled" detail="等待正文保存成功" />
      </div>
    </>
  );
}

function BindingCodex({ onCopyReconnect }: { onCopyReconnect: () => void }) {
  return (
    <>
      <div className="prototype-binding-card">
        <div>
          <p className="prototype-panel-label">复制到新 Codex 对话</p>
          <h4>把这个会话绑定为接续对话</h4>
        </div>
        <button type="button" onClick={onCopyReconnect}>
          <Copy size={14} />
          复制指令
        </button>
      </div>
      <pre className="prototype-command">{reconnectInstruction}</pre>
      <div className="prototype-tool-stream">
        <ToolCall status="done" label="bind_codex_thread" detail="当前会话已绑定为 successor" />
        <ToolCall status="active" label="list_annotations" detail="读取未解决批注" />
      </div>
    </>
  );
}

function FailedCodex() {
  return (
    <>
      <div className="prototype-codex-message prototype-codex-message-error">
        <AlertCircle size={18} />
        <div>
          <h4>MCP 工具不可用</h4>
          <p>Codex 已收到任务，但无法调用 Margent MCP。事件保持 failed，不继续投递下一条。</p>
        </div>
      </div>
      <div className="prototype-tool-stream">
        <ToolCall status="failed" label="get_annotation_context" detail="tool not found" />
        <ToolCall status="waiting" label="retry_delivery" detail="用户修复 MCP 后手动重试" />
      </div>
    </>
  );
}

function ToolCall({
  label,
  detail,
  status
}: {
  label: string;
  detail: string;
  status: "done" | "active" | "waiting" | "failed";
}) {
  return (
    <div className={`prototype-tool-call prototype-tool-call-${status}`}>
      <span>{status === "done" ? <CheckCircle2 size={15} /> : <Clock3 size={15} />}</span>
      <div>
        <strong>{label}</strong>
        <small>{detail}</small>
      </div>
    </div>
  );
}

function getStatusIcon(status: AnnotationStatus) {
  switch (status) {
    case "handled":
      return CheckCircle2;
    case "failed":
      return AlertCircle;
    case "queued":
    case "delivering":
    case "processing":
      return Clock3;
    case "open":
    default:
      return Link2;
  }
}
