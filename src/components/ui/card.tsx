import React from "react";

interface CardProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}

export function Card({ children, className = "", onClick }: CardProps) {
  return (
    <div
      onClick={onClick}
      className={`rounded-2xl border border-white/10 bg-[#111] shadow-sm transition-all duration-200 ${onClick ? "cursor-pointer hover:-translate-y-0.5 hover:shadow-md hover:border-[#ff6a00]/30" : ""
        } ${className}`}
    >
      {children}
    </div>
  );
}
