import React from "react";
import Link from "next/link";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  variant?: "primary" | "ghost";
  className?: string;
  href?: string;
  target?: string;
  rel?: string;
}

export function Button({ children, variant = "primary", className = "", href, target, rel, ...props }: ButtonProps) {
  const styles = {
    primary: "bg-orange-500 text-white hover:bg-orange-600 active:bg-orange-700 shadow-sm border-transparent",
    ghost: "border-gray-200 bg-white text-gray-700 hover:bg-gray-50 active:bg-gray-100"
  };

  const baseClass = `inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-colors duration-150 outline-none focus:ring-2 focus:ring-orange-100 ${styles[variant]} ${className}`;

  if (href) {
    return (
      <Link href={href} className={baseClass} target={target} rel={rel}>
        {children}
      </Link>
    );
  }

  return (
    <button className={baseClass} {...props}>
      {children}
    </button>
  );
}

// Aliases for compatibility
export function PrimaryButton(props: ButtonProps) {
  return <Button variant="primary" {...props} />;
}

export function GhostButton(props: ButtonProps) {
  return <Button variant="ghost" {...props} />;
}
