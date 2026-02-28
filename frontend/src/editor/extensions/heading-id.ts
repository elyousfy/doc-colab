import { Extension } from "@tiptap/core";

/**
 * Renders each heading's blockId as an `id` attribute on the DOM element,
 * enabling anchor-based scroll targets for TOC entries.
 */
export const HeadingId = Extension.create({
  name: "headingId",

  addGlobalAttributes() {
    return [
      {
        types: ["heading"],
        attributes: {
          id: {
            default: null,
            parseHTML: (el) => el.getAttribute("id"),
            renderHTML: (attrs) => {
              if (!attrs.blockId) return {};
              return { id: attrs.blockId };
            },
          },
        },
      },
    ];
  },
});
