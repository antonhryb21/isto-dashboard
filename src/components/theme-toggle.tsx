"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  useEffect(() => {
    // Sync with the value the inline script applied before hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  }, []);
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      className="btn px-2.5"
      aria-label={next === "dark" ? "Темна тема" : "Світла тема"}
      title={next === "dark" ? "Темна тема" : "Світла тема"}
      onClick={() => {
        document.documentElement.dataset.theme = next;
        try {
          localStorage.setItem("isto-theme", next);
        } catch {}
        setTheme(next);
        window.dispatchEvent(new Event("isto-theme"));
      }}
    >
      {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
    </button>
  );
}
