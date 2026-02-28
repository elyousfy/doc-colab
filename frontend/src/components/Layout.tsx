import { type ReactNode } from "react";
import { UserSwitcher } from "./UserSwitcher";
import { FileText } from "lucide-react";

interface LayoutProps {
  children: ReactNode;
  onNavigateHome?: () => void;
}

export function Layout({ children, onNavigateHome }: LayoutProps) {
  return (
    <div className="min-h-screen bg-[var(--color-paper)]">
      <header className="app-header">
        <button onClick={onNavigateHome} className="app-logo">
          <FileText size={18} className="app-logo-icon" />
          <span className="app-logo-name">DocCollab</span>
        </button>
        <div className="user-switcher-dark">
          <UserSwitcher />
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}
