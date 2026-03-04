interface ToolbarSelectProps {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  className?: string;
  title?: string;
}

export function ToolbarSelect({ value, options, onChange, className, title }: ToolbarSelectProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      title={title}
      className={`
        h-8 px-2 rounded-md text-xs text-[#0F172A] bg-transparent
        border border-transparent hover:border-stone-300 focus:border-[#F97066]
        focus:outline-none cursor-pointer appearance-none
        ${className || ""}
      `}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}
