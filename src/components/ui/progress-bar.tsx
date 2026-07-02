import React from "react";

interface ProgressBarProps {
  value: number;
  className?: string;
}

export function ProgressBar({ value, className = "" }: ProgressBarProps) {
  return (
    <div className={`h-1.5 w-full rounded-full bg-gray-100 ${className}`}>
      <div
        className="h-1.5 rounded-full bg-orange-500 transition-all duration-500"
        style={{ width: `${value}%` }}
      />
    </div>
  );
}
