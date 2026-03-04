import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

export const BlockId = Extension.create({
  name: "blockId",
  addGlobalAttributes() {
    return [{
      types: ["heading", "paragraph", "image", "table", "bulletList", "orderedList", "blockquote", "codeBlock", "horizontalRule", "docSection", "pageCanvas", "positionedImage"],
      attributes: {
        blockId: {
          default: null,
          parseHTML: (el) => el.getAttribute("data-block-id"),
          renderHTML: (attrs) => {
            if (!attrs.blockId) return {};
            return { "data-block-id": attrs.blockId };
          },
        },
      },
    }];
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("blockId"),
        appendTransaction: (_, __, newState) => {
          const { tr } = newState;
          let modified = false;
          newState.doc.descendants((node, pos) => {
            if (node.isBlock && node.attrs.blockId === null && node.type.spec.attrs?.blockId !== undefined) {
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, blockId: crypto.randomUUID() });
              modified = true;
            }
          });
          return modified ? tr : null;
        },
      }),
    ];
  },
});
