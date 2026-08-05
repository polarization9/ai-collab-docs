export const EXTRA_BLANK_LINE_CLASS = "markdown-extra-blank-line";

type PositionedNode = {
  type: string;
  position?: {
    start: { line: number };
    end: { line: number };
  };
  [key: string]: unknown;
};

type MarkdownRoot = {
  type: "root";
  children: PositionedNode[];
};

export function remarkPreserveExtraBlankLines() {
  return (tree: unknown) => {
    if (!isMarkdownRoot(tree)) {
      return;
    }

    const children: PositionedNode[] = [];
    let previousSourceNode: PositionedNode | null = null;

    for (const child of tree.children) {
      const blankLineCount = getBlankLineCount(previousSourceNode, child);
      const extraBlankLineCount = Math.max(0, blankLineCount - 1);
      for (let index = 0; index < extraBlankLineCount; index += 1) {
        children.push(createBlankLineNode());
      }
      children.push(child);
      previousSourceNode = child;
    }

    tree.children = children;
  };
}

function isMarkdownRoot(tree: unknown): tree is MarkdownRoot {
  return (
    typeof tree === "object" &&
    tree !== null &&
    "type" in tree &&
    tree.type === "root" &&
    "children" in tree &&
    Array.isArray(tree.children)
  );
}

function getBlankLineCount(previous: PositionedNode | null, current: PositionedNode): number {
  if (!previous?.position || !current.position) {
    return 0;
  }
  return Math.max(0, current.position.start.line - previous.position.end.line - 1);
}

function createBlankLineNode(): PositionedNode {
  return {
    type: "margentBlankLine",
    data: {
      hName: "div",
      hProperties: {
        className: [EXTRA_BLANK_LINE_CLASS],
        ariaHidden: "true"
      }
    }
  };
}
