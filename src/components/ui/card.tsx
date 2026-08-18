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
      className={`rounded-2xl border border-stampa-border bg-stampa-surface shadow-lg shadow-black/20 ${onClick ? "cursor-pointer stampa-card-interactive" : ""
        } ${className}`}
    >
      {children}
    </div>
  );
}
