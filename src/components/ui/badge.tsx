import React from "react";

interface BadgeProps {
  children: React.ReactNode;
  tone?: "orange" | "dark" | "gray" | "green";
  className?: string;
}

export function Badge({ children, tone = "orange", className = "" }: BadgeProps) {
  const tones = {
    orange: "bg-orange-50 text-orange-600 border-orange-200",
    dark: "bg-gray-900 text-white border-gray-900",
    gray: "bg-gray-100 text-gray-600 border-gray-200",
    green: "bg-green-50 text-green-700 border-green-200",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
