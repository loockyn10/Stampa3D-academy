"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import { secondaryMobileNavigation } from "./mobile-navigation";

interface MobileRadialMenuProps {
  open: boolean;
  onClose: () => void;
}

type RadialItemStyle = CSSProperties & {
  "--radial-x": string;
  "--radial-y": string;
};

const RADIAL_POSITIONS = [
  { x: "calc(clamp(6.25rem, 34vw, 9rem) * -1)", y: "-4.75rem" },
  { x: "calc(clamp(3.75rem, 21vw, 5.5rem) * -1)", y: "-9.25rem" },
  { x: "calc(clamp(2rem, 10vw, 2.75rem) * -1)", y: "-12.75rem" },
  { x: "clamp(2rem, 10vw, 2.75rem)", y: "-12.75rem" },
  { x: "clamp(3.75rem, 21vw, 5.5rem)", y: "-9.25rem" },
  { x: "clamp(6.25rem, 34vw, 9rem)", y: "-4.75rem" },
] as const;

export function MobileRadialMenu({ open, onClose }: MobileRadialMenuProps) {
  return (
    <>
      <button
        type="button"
        aria-label="Cerrar menú de herramientas"
        tabIndex={open ? 0 : -1}
        onClick={onClose}
        className={`fixed inset-x-0 top-0 z-[-1] bg-black/40 backdrop-blur-[1px] transition-opacity duration-200 lg:hidden ${
          open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        }`}
        style={{ bottom: "calc(var(--mobile-bottom-navigation-height) + env(safe-area-inset-bottom))" }}
      />

      <div
        id="mobile-tools-menu"
        data-open={open}
        aria-hidden={!open}
        role="menu"
        aria-label="Herramientas secundarias"
        className="mobile-radial-menu pointer-events-none absolute left-1/2 top-3.5 z-10 lg:hidden"
      >
        {secondaryMobileNavigation.map((item, index) => {
          const Icon = item.icon;
          const position = RADIAL_POSITIONS[index];
          const delay = open ? 40 + index * 50 : (secondaryMobileNavigation.length - index - 1) * 24;
          const style: RadialItemStyle = {
            "--radial-x": position.x,
            "--radial-y": position.y,
            transitionDelay: `${delay}ms`,
          };

          return (
            <Link
              key={item.href}
              href={item.href}
              role="menuitem"
              tabIndex={open ? 0 : -1}
              aria-label={item.label}
              onClick={onClose}
              style={style}
              className="mobile-radial-item absolute flex w-[4.5rem] flex-col items-center gap-1.5 text-center"
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-full border border-white/15 bg-stampa-surface text-gray-100 shadow-xl shadow-black/35 transition-colors hover:border-stampa-orange/50 hover:text-stampa-orange">
                <Icon size={20} />
              </span>
              <span className="max-w-[4.5rem] rounded-md bg-stampa-bg/90 px-1.5 py-0.5 text-[10px] font-semibold leading-tight text-gray-200 shadow-sm">
                {item.shortLabel || item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </>
  );
}
