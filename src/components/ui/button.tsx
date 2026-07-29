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
    primary: "bg-[#ff6a00] text-white hover:bg-[#ff7a1a] active:bg-[#e65c00] shadow-sm shadow-[#ff6a00]/10 border-transparent",
    ghost: "border-white/10 bg-white/5 text-gray-300 hover:bg-white/10 hover:text-white active:bg-white/20"
  };

  const baseClass = `inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-all duration-150 outline-none focus:ring-2 focus:ring-[#ff6a00]/50 active:scale-[0.98] hover:scale-[1.01] ${styles[variant]} ${className}`;

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
