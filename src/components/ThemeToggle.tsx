import { useState, useRef, useEffect } from "react";
import { Sun, Moon, Monitor } from "lucide-react";
import { useTheme, ThemeMode } from "../hooks/useTheme";
import { motion, AnimatePresence } from "motion/react";

export default function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Handle keyboard events inside the dropdown
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setIsOpen(false);
    }
  };

  const options: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
    { value: "light", label: "Modo Claro", icon: Sun },
    { value: "dark", label: "Modo Escuro", icon: Moon },
    { value: "system", label: "Sistema", icon: Monitor },
  ];

  // Get current active option details
  const currentOption = options.find((opt) => opt.value === theme) || options[2];
  const CurrentIcon = currentOption.icon;

  return (
    <div 
      className="relative inline-block text-left" 
      ref={dropdownRef}
      onKeyDown={handleKeyDown}
    >
      <div>
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center justify-center p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 hover:text-white transition-all duration-200 cursor-pointer focus:outline-hidden focus:ring-2 focus:ring-indigo-500/50"
          id="theme-menu-button"
          aria-expanded={isOpen}
          aria-haspopup="true"
          aria-label="Alterar tema"
          title="Alterar tema do painel"
        >
          <CurrentIcon className="w-4.5 h-4.5" />
        </button>
      </div>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -4 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="absolute right-0 z-50 mt-2 w-40 rounded-xl border border-white/10 bg-[#161c2e] p-1.5 shadow-2xl focus:outline-hidden"
            role="menu"
            aria-orientation="vertical"
            aria-labelledby="theme-menu-button"
          >
            <div className="py-0.5 space-y-1">
              {options.map((option) => {
                const Icon = option.icon;
                const isSelected = theme === option.value;
                return (
                  <button
                    key={option.value}
                    onClick={() => {
                      setTheme(option.value);
                      setIsOpen(false);
                    }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium rounded-lg transition-colors cursor-pointer text-left
                      ${
                        isSelected
                          ? "bg-indigo-600 text-white"
                          : "text-slate-300 hover:bg-white/5 hover:text-white"
                      }`}
                    role="menuitem"
                    aria-selected={isSelected}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{option.label}</span>
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
