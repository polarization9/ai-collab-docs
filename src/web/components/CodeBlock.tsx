import { ClipboardCopy } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "../i18n";
import { copyText } from "../utils/clipboard";

export type CodeBlockAction = {
  label: string;
  icon: ReactNode;
  onClick: () => void | Promise<void>;
};

type CodeBlockProps = {
  code: string;
  className?: string;
  language?: string;
  reviewBlockProps?: Record<string, string>;
  extraActions?: CodeBlockAction[];
};

export function CodeBlock({
  code,
  className,
  language,
  reviewBlockProps,
  extraActions = []
}: CodeBlockProps) {
  const { t } = useI18n();
  const [feedback, setFeedback] = useState<string | null>(null);
  const feedbackTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current) {
        window.clearTimeout(feedbackTimerRef.current);
      }
    };
  }, []);

  const showFeedback = (message: string) => {
    setFeedback(message);
    if (feedbackTimerRef.current) {
      window.clearTimeout(feedbackTimerRef.current);
    }
    feedbackTimerRef.current = window.setTimeout(() => setFeedback(null), 1400);
  };

  const runAction = async (message: string, action: () => void | Promise<void>) => {
    try {
      await action();
      showFeedback(message);
    } catch (error) {
      showFeedback(error instanceof Error ? error.message : t("code.actionFailed"));
    }
  };

  return (
    <div className="code-block-shell">
      <div className="code-block-toolbar" aria-label={t("code.toolbar")}>
        <CodeBlockButton
          label={t("code.copy")}
          onClick={() => runAction(t("code.copied"), () => copyText(code))}
        >
          <ClipboardCopy size={15} />
        </CodeBlockButton>
        {extraActions.map((action) => (
          <CodeBlockButton
            key={action.label}
            label={action.label}
            onClick={() => runAction(action.label, action.onClick)}
          >
            {action.icon}
          </CodeBlockButton>
        ))}
      </div>
      <pre {...reviewBlockProps} data-code-language={language ?? ""}>
        <code className={className}>{code}</code>
      </pre>
      {feedback ? <div className="code-block-feedback">{feedback}</div> : null}
    </div>
  );
}

function CodeBlockButton({
  children,
  label,
  onClick
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="code-block-button"
      aria-label={label}
      data-tooltip={label}
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}
