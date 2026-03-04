import { Mark } from "@tiptap/core";

export const CommentMark = Mark.create({
  name: "comment",
  addAttributes() {
    return {
      commentId: { default: null },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-comment-id]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", {
      "data-comment-id": HTMLAttributes.commentId,
      class: "comment-highlight",
      ...HTMLAttributes,
    }, 0];
  },
});
