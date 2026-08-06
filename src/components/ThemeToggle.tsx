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
          className="flex items-center justify-center p-2 rounded-xl bg-[#F3F4F6] hover:bg-[#E5E7EB] dark:bg-[#18181B] dark:hover:bg-[#27272A] border border-[#E5E7EB] dark:border-[#27272A] text-[#374151] dark:text-[#FAFAFA] transition-all duration-200 cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#FF5A00]/50"
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
            className="absolute right-0 z-50 mt-2 w-40 rounded-xl border border-[#E5E7EB] dark:border-[#27272A] bg-white dark:bg-[#121212] p-1.5 shadow-xl focus:outline-none"
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
                          ? "bg-[#FF5A00] text-white"
                          : "text-[#374151] dark:text-[#A1A1AA] hover:bg-[#F3F4F6] dark:hover:bg-[#18181B] hover:text-[#111827] dark:hover:text-[#FAFAFA]"
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
