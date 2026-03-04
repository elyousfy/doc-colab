import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, type NodeViewProps, ReactNodeViewRenderer } from "@tiptap/react";
import { useCallback, useRef } from "react";

const MIN_W = 80;
const MIN_H = 60;

function snap(value: number, grid: number) {
  if (!grid || grid <= 1) return value;
  return Math.round(value / grid) * grid;
}

function PositionedImageView({ node, updateAttributes }: NodeViewProps) {
  const startRef = useRef<{
    mouseX: number;
    mouseY: number;
    x: number;
    y: number;
    width: number;
    height: number;
    mode: "drag" | "resize";
    grid: number;
  } | null>(null);

  const attrs = node.attrs as {
    src?: string;
    alt?: string;
    title?: string | null;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    zIndex?: number;
    locked?: boolean;
  };

  const src = attrs.src || "";
  const x = Number(attrs.x ?? 0);
  const y = Number(attrs.y ?? 0);
  const width = Math.max(MIN_W, Number(attrs.width ?? 320));
  const height = Math.max(MIN_H, Number(attrs.height ?? 200));
  const zIndex = Number(attrs.zIndex ?? 1);
  const locked = Boolean(attrs.locked);
  const grid = 8;

  const onStart = useCallback(
    (e: React.MouseEvent, mode: "drag" | "resize") => {
      if (locked) return;
      e.preventDefault();
      e.stopPropagation();

      startRef.current = {
        mouseX: e.clientX,
        mouseY: e.clientY,
        x,
        y,
        width,
        height,
        mode,
        grid,
      };

      const onMove = (ev: MouseEvent) => {
        const s = startRef.current;
        if (!s) return;
        const dx = ev.clientX - s.mouseX;
        const dy = ev.clientY - s.mouseY;

        if (s.mode === "drag") {
          updateAttributes({
            x: Math.max(0, snap(s.x + dx, s.grid)),
            y: Math.max(0, snap(s.y + dy, s.grid)),
          });
          return;
        }

        updateAttributes({
          width: Math.max(MIN_W, snap(s.width + dx, s.grid)),
          height: Math.max(MIN_H, snap(s.height + dy, s.grid)),
        });
      };

      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        startRef.current = null;
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [grid, height, locked, updateAttributes, width, x, y]
  );

  return (
    <NodeViewWrapper
      className="positioned-image-node"
      contentEditable={false}
      style={{
        position: "absolute",
        left: `${x}px`,
        top: `${y}px`,
        width: `${width}px`,
        height: `${height}px`,
        zIndex,
      }}
    >
      <img
        src={src}
        alt={attrs.alt || ""}
        draggable={false}
        style={{ width: "100%", height: "100%", objectFit: "contain" }}
      />
      <button
        type="button"
        className="positioned-image-lock"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          updateAttributes({ locked: !locked });
        }}
        title={locked ? "Unlock image" : "Lock image"}
      >
        {locked ? "Locked" : "Move"}
      </button>
      {!locked && (
        <>
          <div className="positioned-image-drag" onMouseDown={(e) => onStart(e, "drag")} />
          <div className="positioned-image-resize" onMouseDown={(e) => onStart(e, "resize")} title="Resize image" />
        </>
      )}
    </NodeViewWrapper>
  );
}

export const PositionedImage = Node.create({
  name: "positionedImage",
  inline: false,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      blockId: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-block-id"),
        renderHTML: (attrs) => (attrs.blockId ? { "data-block-id": attrs.blockId } : {}),
      },
      src: { default: "" },
      alt: { default: "" },
      title: { default: null },
      x: { default: 0 },
      y: { default: 0 },
      width: { default: 320 },
      height: { default: 200 },
      zIndex: { default: 1 },
      locked: { default: false },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-type='positioned-image']" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "positioned-image",
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(PositionedImageView);
  },
});

