"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus } from "lucide-react";
import {
  isMobileNavigationItemActive,
  mainMobileNavigation,
  type MobileNavigationItem,
} from "./mobile-navigation";
import { MobileRadialMenu } from "./mobile-radial-menu";

interface MobileBottomNavigationProps {
  toolsOpen: boolean;
  onToolsOpenChange: (open: boolean) => void;
}

function NavigationLink({ item, pathname }: { item: MobileNavigationItem; pathname: string }) {
  const Icon = item.icon;
  const active = isMobileNavigationItemActive(pathname, item);

  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={`flex min-h-11 min-w-0 flex-col items-center justify-center gap-0.5 px-1 text-[10px] font-semibold transition-colors ${
        active ? "text-stampa-orange" : "text-gray-500 hover:text-gray-200"
      }`}
    >
      <Icon size={20} strokeWidth={active ? 2.4 : 2} />
      <span className="max-w-full truncate">{item.shortLabel || item.label}</span>
    </Link>
  );
}

export function MobileBottomNavigation({
  toolsOpen,
  onToolsOpenChange,
}: MobileBottomNavigationProps) {
  const pathname = usePathname();
  const leftItems = mainMobileNavigation.slice(0, 2);
  const rightItems = mainMobileNavigation.slice(2);

  useEffect(() => {
    onToolsOpenChange(false);
  }, [pathname, onToolsOpenChange]);

  useEffect(() => {
    if (!toolsOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onToolsOpenChange(false);
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [toolsOpen, onToolsOpenChange]);

  return (
    <div className="fixed inset-x-0 bottom-0 z-[60] lg:hidden">
      <MobileRadialMenu open={toolsOpen} onClose={() => onToolsOpenChange(false)} />

      <nav
        aria-label="Navegación principal"
        className="relative border-t border-white/10 bg-stampa-bg/95 shadow-[0_-12px_35px_rgba(0,0,0,0.3)] backdrop-blur-xl"
        style={{
          height: "calc(var(--mobile-bottom-navigation-height) + env(safe-area-inset-bottom))",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        <div className="grid h-[var(--mobile-bottom-navigation-height)] grid-cols-[minmax(0,1fr)_minmax(0,1fr)_4.5rem_minmax(0,1fr)_minmax(0,1fr)] items-center px-1">
          {leftItems.map((item) => (
            <NavigationLink key={item.href} item={item} pathname={pathname} />
          ))}

          <span aria-hidden="true" />

          {rightItems.map((item) => (
            <NavigationLink key={item.href} item={item} pathname={pathname} />
          ))}
        </div>

        <button
          type="button"
          aria-label={toolsOpen ? "Cerrar herramientas" : "Abrir herramientas"}
          aria-expanded={toolsOpen}
          aria-controls="mobile-tools-menu"
          onClick={() => onToolsOpenChange(!toolsOpen)}
          className="absolute left-1/2 top-0 z-20 flex h-16 w-16 -translate-x-1/2 -translate-y-[18px] items-center justify-center rounded-full border-4 border-stampa-bg bg-gradient-to-br from-stampa-orange to-orange-500 text-white shadow-[0_8px_28px_rgba(255,120,10,0.32)] transition-transform duration-200 active:scale-95"
        >
          <Plus
            size={28}
            strokeWidth={2.5}
            className={`transition-transform duration-200 ${toolsOpen ? "rotate-45" : "rotate-0"}`}
          />
        </button>
      </nav>
    </div>
  );
}
