import { Node, mergeAttributes } from "@tiptap/core";

export const PageBreak = Node.create({
  name: "pageBreak",
  group: "block",
  atom: true,

  addAttributes() {
    return {
      blockId: { default: null },
      pageNumber: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-page-break]" }];
  },

  renderHTML({ HTMLAttributes, node }) {
    const page = node.attrs.pageNumber;
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-page-break": "true", class: "page-break-marker" }),
      ["span", { class: "page-break-label" }, `Page ${page}`],
    ];
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("div");
      dom.className = "page-break-marker";
      dom.setAttribute("data-page-break", "true");
      dom.setAttribute("contenteditable", "false");

      const label = document.createElement("span");
      label.className = "page-break-label";
      label.textContent = `Page ${node.attrs.pageNumber ?? ""}`;
      dom.appendChild(label);

      return { dom };
    };
  },
});
