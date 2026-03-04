import { forwardRef, type ReactNode, type ButtonHTMLAttributes } from "react";

interface ToolbarButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  children: ReactNode;
}

export const ToolbarButton = forwardRef<HTMLButtonElement, ToolbarButtonProps>(
  function ToolbarButton({ active, children, className, disabled, ...props }, ref) {
    return (
      <button
        ref={ref}
        className={`
        flex items-center justify-center w-8 h-8 rounded-md text-[#0F172A]
        transition-colors duration-100
        ${active ? "bg-[#F97066]/20 text-[#F97066]" : "hover:bg-stone-100/80"}
        ${disabled ? "opacity-30 cursor-not-allowed" : "cursor-pointer"}
        ${className || ""}
      `}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
    );
  }
);
