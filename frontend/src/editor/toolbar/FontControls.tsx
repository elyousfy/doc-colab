import type { Editor } from "@tiptap/react";
import { useRef, useEffect, useState } from "react";
import { Palette, Highlighter } from "lucide-react";
import { ToolbarButton } from "./ToolbarButton";
import { ToolbarSelect } from "./ToolbarSelect";

const HEADING_OPTIONS = [
  { value: "paragraph", label: "Normal" },
  { value: "1", label: "Heading 1" },
  { value: "2", label: "Heading 2" },
  { value: "3", label: "Heading 3" },
  { value: "4", label: "Heading 4" },
  { value: "5", label: "Heading 5" },
  { value: "6", label: "Heading 6" },
];

const FONT_OPTIONS = [
  { value: "", label: "Font" },
  { value: "Arial", label: "Arial" },
  { value: "Times New Roman", label: "Times New Roman" },
  { value: "Georgia", label: "Georgia" },
  { value: "Courier New", label: "Courier New" },
  { value: "Calibri", label: "Calibri" },
  { value: "Verdana", label: "Verdana" },
];

const FONT_SIZE_OPTIONS = Array.from({ length: 65 }, (_, i) => i + 8).map((n) => ({
  value: `${n}pt`,
  label: `${n}`,
}));

const PRESET_COLORS = [
  "#000000", "#434343", "#666666", "#999999", "#B7B7B7", "#CCCCCC", "#D9D9D9", "#EFEFEF",
  "#F2F2F2", "#FFFFFF", "#980000", "#FF0000", "#FF9900", "#FFFF00", "#00FF00", "#00FFFF",
  "#4A86E8", "#0000FF", "#9900FF", "#FF00FF", "#E6B8AF", "#F4CCCC", "#FCE5CD", "#FFF2CC",
  "#D9EAD3", "#D0E0E3", "#C9DAF8", "#CFE2F3", "#D9D2E9", "#EAD1DC", "#DD7E6B", "#EA9999",
  "#F9CB9C", "#FFE599", "#B6D7A8", "#A2C4C9", "#A4C2F4", "#9FC5E8", "#B4A7D6", "#D5A6BD",
].slice(0, 20);

const HIGHLIGHT_COLORS = [
  "#F97066", "#FFEB3B", "#8BC34A", "#00BCD4", "#9C27B0",
  "#FF9800", "#E91E63", "#3F51B5", "#009688", "#795548",
  "#F44336", "#4CAF50", "#2196F3", "#FF5722", "#607D8B",
  "#000000", "#FFFFFF", "#FFD54F", "#81C784", "#64B5F6",
].slice(0, 20);

function ColorPopover({
  colors,
  currentColor: _,
  onSelect,
  onClose,
  anchorRef,
  title,
}: {
  colors: string[];
  currentColor: string;
  onSelect: (hex: string) => void;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  title: string;
}) {
  const [position, setPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (anchorRef.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      setPosition({ top: rect.bottom + 4, left: rect.left });
    }
  }, [anchorRef]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (anchorRef.current && !anchorRef.current.contains(e.target as Node)) {
        const popover = document.querySelector("[data-color-popover]");
        if (popover && !popover.contains(e.target as Node)) {
          onClose();
        }
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose, anchorRef]);

  return (
    <div
      data-color-popover
      className="fixed z-50 p-2 bg-[#FAFAF8] border border-stone-200 rounded-lg shadow-lg"
      style={{ top: position.top, left: position.left }}
    >
      <div className="text-[10px] text-[#0F172A]/70 mb-1.5 font-medium">{title}</div>
      <div className="grid grid-cols-5 gap-1">
        {colors.map((hex) => (
          <button
            key={hex}
            type="button"
            className="w-5 h-5 rounded border border-stone-300 hover:ring-1 ring-[#F97066] transition-shadow"
            style={{ backgroundColor: hex }}
            title={hex}
            onClick={() => {
              onSelect(hex);
              onClose();
            }}
          />
        ))}
      </div>
    </div>
  );
}

export function FontControls({ editor }: { editor: Editor }) {
  const textColorRef = useRef<HTMLButtonElement>(null);
  const highlightRef = useRef<HTMLButtonElement>(null);
  const [showTextColor, setShowTextColor] = useState(false);
  const [showHighlight, setShowHighlight] = useState(false);

  const headingValue = (() => {
    if (editor.isActive("heading", { level: 1 })) return "1";
    if (editor.isActive("heading", { level: 2 })) return "2";
    if (editor.isActive("heading", { level: 3 })) return "3";
    if (editor.isActive("heading", { level: 4 })) return "4";
    if (editor.isActive("heading", { level: 5 })) return "5";
    if (editor.isActive("heading", { level: 6 })) return "6";
    return "paragraph";
  })();

  const fontFamily = editor.getAttributes("textStyle").fontFamily || "";
  const fontSize = editor.getAttributes("textStyle").fontSize || "12pt";
  const textColor = editor.getAttributes("textStyle").color || "#000000";
  const highlightColor = editor.getAttributes("highlight").color || "#F97066";

  return (
    <div className="flex items-center gap-1">
      <ToolbarSelect
        value={headingValue}
        options={HEADING_OPTIONS}
        onChange={(v) => {
          if (v === "paragraph") {
            editor.chain().focus().setParagraph().run();
          } else {
            editor.chain().focus().toggleHeading({ level: parseInt(v, 10) as 1 | 2 | 3 | 4 | 5 | 6 }).run();
          }
        }}
        title="Heading"
      />

      <ToolbarSelect
        value={fontFamily}
        options={FONT_OPTIONS}
        onChange={(v) => editor.chain().focus().setFontFamily(v).run()}
        title="Font family"
      />

      <ToolbarSelect
        value={fontSize || "12pt"}
        options={[{ value: "", label: "Size" }, ...FONT_SIZE_OPTIONS]}
        onChange={(v) => v && editor.chain().focus().setFontSize(v).run()}
        title="Font size"
      />

      <div className="relative">
        <ToolbarButton
          ref={textColorRef}
          onClick={() => setShowTextColor((s) => !s)}
          title="Text color"
        >
          <div className="flex items-center gap-1">
            <Palette size={16} />
            <div
              className="w-3 h-3 rounded-sm border border-stone-300"
              style={{ backgroundColor: textColor }}
            />
          </div>
        </ToolbarButton>
        {showTextColor && (
          <ColorPopover
            colors={PRESET_COLORS}
            currentColor={textColor}
            onSelect={(hex) => editor.chain().focus().setColor(hex).run()}
            onClose={() => setShowTextColor(false)}
            anchorRef={textColorRef}
            title="Text color"
          />
        )}
      </div>

      <div className="relative">
        <ToolbarButton
          ref={highlightRef}
          onClick={() => setShowHighlight((s) => !s)}
          title="Highlight"
          active={editor.isActive("highlight")}
        >
          <div className="flex items-center gap-1">
            <Highlighter size={16} />
            <div
              className="w-3 h-3 rounded-sm border border-stone-300"
              style={{ backgroundColor: highlightColor }}
            />
          </div>
        </ToolbarButton>
        {showHighlight && (
          <ColorPopover
            colors={HIGHLIGHT_COLORS}
            currentColor={highlightColor}
            onSelect={(hex) => editor.chain().focus().toggleHighlight({ color: hex }).run()}
            onClose={() => setShowHighlight(false)}
            anchorRef={highlightRef}
            title="Highlight"
          />
        )}
      </div>
    </div>
  );
}
