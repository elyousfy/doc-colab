import { mergeAttributes, NodeViewRenderer } from "@tiptap/core";
import Image from "@tiptap/extension-image";

const HANDLE_DIRS = ["n", "ne", "e", "se", "s", "sw", "w", "nw"] as const;
type Dir = (typeof HANDLE_DIRS)[number];
const MIN = 50;

function parseNumeric(value: string | null): number | null {
  if (!value) return null;
  const n = Number.parseFloat(value.replace("px", "").trim());
  return Number.isFinite(n) ? n : null;
}

const makeNodeView: NodeViewRenderer = ({ node, getPos, editor }) => {
  const wrapper = document.createElement("div");
  wrapper.className = "image-block-wrapper";

  const img = document.createElement("img");
  img.src = node.attrs.src || "";
  img.alt = node.attrs.alt || "";
  if (node.attrs.title) img.title = node.attrs.title;
  if (node.attrs.width) img.style.width = `${node.attrs.width}px`;
  if (node.attrs.height) img.style.height = `${node.attrs.height}px`;

  wrapper.appendChild(img);

  // Create 8 resize handles
  for (const dir of HANDLE_DIRS) {
    const h = document.createElement("div");
    h.className = `image-resize-handle image-resize-${dir}`;
    h.dataset.dir = dir;
    wrapper.appendChild(h);
  }

  // Hide handles when not selected — toggle via class
  let isSelected = false;
  const setSelected = (on: boolean) => {
    isSelected = on;
    wrapper.classList.toggle("image-selected", on);
  };

  wrapper.addEventListener("click", () => {
    const pos = typeof getPos === "function" ? getPos() : null;
    if (pos == null) return;
    editor.commands.setNodeSelection(pos);
  });

  // Resize logic
  wrapper.addEventListener("mousedown", (e) => {
    const handleEl = (e.target as HTMLElement).closest(".image-resize-handle") as HTMLElement | null;
    if (!handleEl) return;
    e.preventDefault();
    e.stopPropagation();

    const dir = handleEl.dataset.dir as Dir;
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = img.offsetWidth;
    const startH = img.offsetHeight;
    const ratio = startW / startH;

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      let newW = startW;
      let newH = startH;

      if (dir.includes("e")) newW = startW + dx;
      if (dir.includes("w")) newW = startW - dx;
      if (dir.includes("s")) newH = startH + dy;
      if (dir.includes("n")) newH = startH - dy;

      if (ev.shiftKey && startW && startH) {
        // Preserve aspect ratio: pick the larger change
        if (Math.abs(newW - startW) >= Math.abs(newH - startH)) {
          newH = newW / ratio;
        } else {
          newW = newH * ratio;
        }
      }

      newW = Math.max(MIN, Math.round(newW));
      newH = Math.max(MIN, Math.round(newH));

      img.style.width = `${newW}px`;
      img.style.height = `${newH}px`;
    };

    const onUp = (ev: MouseEvent) => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);

      const newW = Math.max(MIN, img.offsetWidth);
      const newH = Math.max(MIN, img.offsetHeight);

      const pos = typeof getPos === "function" ? getPos() : null;
      if (pos == null) return;
      editor.chain()
        .setNodeSelection(pos)
        .updateAttributes("image", { width: newW, height: newH })
        .run();
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });

  return {
    dom: wrapper,

    update(updatedNode) {
      if (updatedNode.type.name !== "image") return false;
      img.src = updatedNode.attrs.src || "";
      img.alt = updatedNode.attrs.alt || "";
      if (updatedNode.attrs.title) img.title = updatedNode.attrs.title;
      img.style.width = updatedNode.attrs.width ? `${updatedNode.attrs.width}px` : "";
      img.style.height = updatedNode.attrs.height ? `${updatedNode.attrs.height}px` : "";
      return true;
    },

    selectNode() {
      setSelected(true);
    },

    deselectNode() {
      setSelected(false);
    },

    destroy() {
      // nothing to clean up
    },
  };
};

export const CustomImage = Image.extend({
  group: "block",

  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (el) =>
          parseNumeric(el.getAttribute("data-width") || el.getAttribute("width")),
        renderHTML: (attrs) =>
          attrs.width ? { "data-width": String(attrs.width), width: String(Math.round(attrs.width)) } : {},
      },
      height: {
        default: null,
        parseHTML: (el) =>
          parseNumeric(el.getAttribute("data-height") || el.getAttribute("height")),
        renderHTML: (attrs) =>
          attrs.height ? { "data-height": String(attrs.height), height: String(Math.round(attrs.height)) } : {},
      },
    };
  },

  addNodeView() {
    return makeNodeView;
  },
});
