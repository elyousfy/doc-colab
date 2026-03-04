import { Node, mergeAttributes } from "@tiptap/core";

export const PageCanvas = Node.create({
  name: "pageCanvas",
  group: "block",
  content: "positionedImage*",
  isolating: true,
  defining: true,

  addAttributes() {
    return {
      blockId: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-block-id"),
        renderHTML: (attrs) => (attrs.blockId ? { "data-block-id": attrs.blockId } : {}),
      },
      width: {
        default: 816,
        parseHTML: (el) => Number.parseFloat(el.getAttribute("data-width") || "816"),
        renderHTML: (attrs) => ({ "data-width": String(attrs.width ?? 816) }),
      },
      height: {
        default: 1200,
        parseHTML: (el) => Number.parseFloat(el.getAttribute("data-height") || "1200"),
        renderHTML: (attrs) => ({ "data-height": String(attrs.height ?? 1200) }),
      },
      grid: {
        default: 8,
        parseHTML: (el) => Number.parseFloat(el.getAttribute("data-grid") || "8"),
        renderHTML: (attrs) => ({ "data-grid": String(attrs.grid ?? 8) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-type='page-canvas']" }];
  },

  renderHTML({ HTMLAttributes }) {
    const width = Number(HTMLAttributes["data-width"] ?? 816);
    const height = Number(HTMLAttributes["data-height"] ?? 1200);
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "page-canvas",
        class: "page-canvas",
        style: `width:${width}px;min-height:${height}px;`,
      }),
      0,
    ];
  },
});

