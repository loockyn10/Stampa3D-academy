import React from "react";

interface BadgeProps {
  children: React.ReactNode;
  tone?: "orange" | "dark" | "gray" | "green";
  className?: string;
}

export function Badge({ children, tone = "orange", className = "" }: BadgeProps) {
  const tones = {
    orange: "bg-stampa-orange/10 text-stampa-orange border-[#ff6a00]/20",
    dark: "bg-white/5 text-white border-stampa-border",
    gray: "bg-white/5 text-gray-400 border-stampa-border",
    green: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
