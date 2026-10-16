import type { Nodes, PhrasingContent, Root } from "mdast";

export function remarkPreserveLineBreaks() {
  return (tree: Root) => visitParagraphs(tree);
}

function visitParagraphs(node: Nodes): void {
  if (node.type === "paragraph") {
    node.children = preserveLineBreaks(node.children);
    return;
  }

  if ("children" in node) {
    node.children.forEach(visitParagraphs);
  }
}

function preserveLineBreaks(children: PhrasingContent[]): PhrasingContent[] {
  return children.flatMap((child): PhrasingContent[] => {
    if (child.type === "text" && /[\r\n]/.test(child.value)) {
      // Source text is still distinct from the layout whitespace added when rendering lists.
      // Keep the CR in CRLF text so rendering a break does not shorten saved anchor offsets.
      const lines = child.value.split(/\r(?!\n)|\n/);
      const nodes: PhrasingContent[] = [];
      lines.forEach((line, index) => {
        if (index > 0) {
          nodes.push({ type: "break" });
        }
        if (line) {
          nodes.push({ type: "text", value: line });
        }
      });
      return nodes;
    }

    if ("children" in child) {
      child.children = preserveLineBreaks(child.children);
    }
    return [child];
  });
}
