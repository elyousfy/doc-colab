import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import FontFamily from "@tiptap/extension-font-family";
import { CustomImage } from "./custom-image";
import { Table } from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import { CustomTableCell } from "./table-cell-attrs";
import TableHeader from "@tiptap/extension-table-header";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import Placeholder from "@tiptap/extension-placeholder";
import CharacterCount from "@tiptap/extension-character-count";
import { FontSize } from "./font-size";
import { BlockId } from "./block-id";
import { BlockHandle } from "./block-handle";
import { CommentMark } from "./comment-mark";
import { DocSection } from "./doc-section";
import { HeadingId } from "./heading-id";
import { PageCanvas } from "./page-canvas";
import { PositionedImage } from "./positioned-image";

export const editorExtensions = [
  StarterKit.configure({ heading: { levels: [1, 2, 3, 4, 5, 6] } }),
  Underline,
  TextStyle,
  Color,
  Highlight.configure({ multicolor: true }),
  TextAlign.configure({ types: ["heading", "paragraph"] }),
  FontFamily,
  FontSize,
  CustomImage.configure({ inline: false, allowBase64: true }),
  Table.configure({ resizable: true }),
  TableRow,
  CustomTableCell,
  TableHeader,
  Subscript,
  Superscript,
  Placeholder.configure({ placeholder: "Start typing or upload a document…" }),
  CharacterCount,
  PageCanvas,
  PositionedImage,
  BlockId,
  BlockHandle,
  CommentMark,
  DocSection,
  HeadingId,
];
