import {
  Children,
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode
} from "react";

const DEFAULT_COLUMN_WIDTH = 180;
const MIN_COLUMN_WIDTH = 96;
const KEYBOARD_STEP = 24;

type ResizableTableProps = {
  children: ReactNode;
};

type DragState = {
  index: number;
  startX: number;
  startWidth: number;
};

type TableElementProps = {
  children?: ReactNode;
  className?: string;
};

export function ResizableTable({ children }: ResizableTableProps) {
  const columnCount = useMemo(() => getColumnCount(children), [children]);
  const [columnWidths, setColumnWidths] = useState(() => createDefaultWidths(columnCount));
  const dragRef = useRef<DragState | null>(null);

  useEffect(() => {
    setColumnWidths((current) => {
      if (current.length === columnCount) {
        return current;
      }

      return createDefaultWidths(columnCount, current);
    });
  }, [columnCount]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) {
        return;
      }

      const nextWidth = Math.max(
        MIN_COLUMN_WIDTH,
        Math.round(drag.startWidth + event.clientX - drag.startX)
      );
      setColumnWidths((current) =>
        current.map((width, index) => (index === drag.index ? nextWidth : width))
      );
    };

    const handlePointerUp = () => {
      dragRef.current = null;
      document.body.classList.remove("table-column-resizing");
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      document.body.classList.remove("table-column-resizing");
    };
  }, []);

  const startResize = useCallback(
    (index: number, event: ReactPointerEvent<HTMLSpanElement>) => {
      event.preventDefault();
      event.stopPropagation();
      dragRef.current = {
        index,
        startX: event.clientX,
        startWidth: columnWidths[index] ?? DEFAULT_COLUMN_WIDTH
      };
      document.body.classList.add("table-column-resizing");
    },
    [columnWidths]
  );

  const resizeByKeyboard = useCallback((index: number, event: KeyboardEvent<HTMLSpanElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }

    event.preventDefault();
    const delta = event.key === "ArrowRight" ? KEYBOARD_STEP : -KEYBOARD_STEP;
    setColumnWidths((current) =>
      current.map((width, columnIndex) =>
        columnIndex === index ? Math.max(MIN_COLUMN_WIDTH, width + delta) : width
      )
    );
  }, []);

  const enhancedChildren = useMemo(
    () => addResizeHandles(children, startResize, resizeByKeyboard),
    [children, resizeByKeyboard, startResize]
  );
  const tableWidth = columnWidths.reduce((sum, width) => sum + width, 0);

  return (
    <div className="table-scroll">
      <table
        className="resizable-table"
        style={{
          minWidth: "100%",
          width: tableWidth > 0 ? `${tableWidth}px` : undefined
        }}
      >
        {columnCount > 0 ? (
          <colgroup>
            {columnWidths.map((width, index) => (
              <col key={index} style={{ width: `${width}px` }} />
            ))}
          </colgroup>
        ) : null}
        {enhancedChildren}
      </table>
    </div>
  );
}

function createDefaultWidths(count: number, previous: number[] = []): number[] {
  return Array.from({ length: count }, (_, index) => previous[index] ?? DEFAULT_COLUMN_WIDTH);
}

function getColumnCount(children: ReactNode): number {
  let count = 0;

  visitTableNodes(children, (element, path) => {
    if (count > 0 || element.type !== "tr" || !path.includes("thead")) {
      return;
    }

    count = Children.toArray(element.props.children).filter(
      (child) => isValidElement(child) && (child.type === "th" || child.type === "td")
    ).length;
  });

  return count;
}

function addResizeHandles(
  children: ReactNode,
  onPointerDown: (index: number, event: ReactPointerEvent<HTMLSpanElement>) => void,
  onKeyDown: (index: number, event: KeyboardEvent<HTMLSpanElement>) => void
): ReactNode {
  let headerCellIndex = 0;

  return mapTableNodes(children, [], (element, path, mappedChildren) => {
    if (element.type !== "th" || !path.includes("thead")) {
      return cloneElement(element, undefined, mappedChildren);
    }

    const index = headerCellIndex;
    headerCellIndex += 1;
    const className = [element.props.className, "resizable-table-header"].filter(Boolean).join(" ");

    return cloneElement(
      element,
      { className },
      <>
        <span className="resizable-table-header-content">{mappedChildren}</span>
        <span
          aria-label={`Resize column ${index + 1}`}
          className="table-resize-handle"
          onKeyDown={(event) => onKeyDown(index, event)}
          onPointerDown={(event) => onPointerDown(index, event)}
          role="separator"
          tabIndex={0}
        />
      </>
    );
  });
}

function visitTableNodes(
  node: ReactNode,
  visitor: (element: ReactElement<TableElementProps>, path: string[]) => void,
  path: string[] = []
): void {
  Children.forEach(node, (child) => {
    if (!isValidElement<TableElementProps>(child)) {
      return;
    }

    const tagName = typeof child.type === "string" ? child.type : "";
    const nextPath = tagName ? [...path, tagName] : path;
    visitor(child, nextPath);

    if (child.props.children) {
      visitTableNodes(child.props.children, visitor, nextPath);
    }
  });
}

function mapTableNodes(
  node: ReactNode,
  path: string[],
  mapper: (
    element: ReactElement<TableElementProps>,
    path: string[],
    mappedChildren: ReactNode
  ) => ReactNode
): ReactNode {
  return Children.map(node, (child) => {
    if (!isValidElement<TableElementProps>(child)) {
      return child;
    }

    const tagName = typeof child.type === "string" ? child.type : "";
    const nextPath = tagName ? [...path, tagName] : path;
    const mappedChildren = child.props.children
      ? mapTableNodes(child.props.children, nextPath, mapper)
      : child.props.children;

    return mapper(child, nextPath, mappedChildren);
  });
}
