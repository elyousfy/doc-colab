import { Node, mergeAttributes, Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

function normText(s: string): string {
  // Strip trailing page numbers like "... 12" or "12" and normalize whitespace
  return s.replace(/[\s.…]+\d+\s*$/, "").trim().toLowerCase().replace(/\s+/g, " ");
}

export const DocSection = Node.create({
  name: "docSection",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      blockId: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-block-id"),
        renderHTML: (attrs) => {
          if (!attrs.blockId) return {};
          return { "data-block-id": attrs.blockId };
        },
      },
      sectionType: {
        default: "generic",
        parseHTML: (el) => el.getAttribute("data-section-type"),
        renderHTML: (attrs) => ({
          "data-section-type": attrs.sectionType,
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-section-type]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { class: "doc-section" }),
      0,
    ];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("tocClick"),
        props: {
          handleClick(view, _pos, event) {
            const target = event.target as HTMLElement;
            const tocSection = target.closest('[data-section-type="toc"]');
            if (!tocSection) return false;

            const para = target.closest("p");
            if (!para) return false;

            const rawText = para.textContent || "";
            const searchText = normText(rawText);
            if (!searchText) return false;

            // Find a heading in the document whose text matches
            let matched = false;
            view.state.doc.descendants((node, pos) => {
              if (matched) return false;
              if (node.type.name !== "heading") return true;

              const headingText = normText(node.textContent);
              if (
                headingText === searchText ||
                headingText.startsWith(searchText.slice(0, 30)) ||
                searchText.startsWith(headingText.slice(0, 30))
              ) {
                const dom = view.nodeDOM(pos);
                if (dom instanceof HTMLElement) {
                  dom.scrollIntoView({ behavior: "smooth", block: "start" });
                  matched = true;
                }
              }
              return true;
            });

            return matched;
          },
        },
      }),
    ];
  },
});
