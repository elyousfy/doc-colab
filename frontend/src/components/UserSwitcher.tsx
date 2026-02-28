import { useState, useRef, useEffect } from "react";
import { useUserStore } from "../stores/userStore";
import { ChevronDown, Check } from "lucide-react";

export function UserSwitcher() {
  const { users, currentUser, switchUser } = useUserStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  if (!currentUser) return null;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          padding: "0.25rem 0.625rem 0.25rem 0.25rem",
          borderRadius: "8px",
          background: "rgba(255, 255, 255, 0.08)",
          border: "1px solid rgba(255, 255, 255, 0.1)",
          cursor: "pointer",
          transition: "background 0.1s ease",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.13)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
      >
        <div
          style={{
            width: "26px",
            height: "26px",
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: currentUser.color,
            color: "white",
            fontSize: "11px",
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          {currentUser.name.charAt(0)}
        </div>
        <span style={{ fontSize: "0.8125rem", color: "rgba(255,255,255,0.85)", fontWeight: 500 }}>
          {currentUser.name}
        </span>
        <ChevronDown size={12} style={{ color: "rgba(255,255,255,0.4)" }} />
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 6px)",
            width: "210px",
            background: "#1e2535",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: "10px",
            boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
            padding: "6px",
            zIndex: 200,
          }}
        >
          <div
            style={{
              padding: "4px 8px 6px",
              fontSize: "10px",
              fontWeight: 600,
              color: "rgba(255,255,255,0.3)",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            Switch User
          </div>
          {users.map((u) => (
            <button
              key={u.id}
              onClick={() => { switchUser(u); setOpen(false); }}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: "0.625rem",
                padding: "0.4rem 0.5rem",
                borderRadius: "6px",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                transition: "background 0.1s ease",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.07)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <div
                style={{
                  width: "24px",
                  height: "24px",
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: u.color,
                  color: "white",
                  fontSize: "10px",
                  fontWeight: 600,
                  flexShrink: 0,
                }}
              >
                {u.name.charAt(0)}
              </div>
              <span style={{ fontSize: "0.8125rem", color: "rgba(255,255,255,0.75)", flex: 1, textAlign: "left" }}>
                {u.name}
              </span>
              {u.id === currentUser.id && (
                <Check size={12} style={{ color: "var(--color-coral)" }} />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
