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
    primary: "bg-stampa-orange text-neutral-950 hover:bg-stampa-orange-hover active:bg-stampa-orange shadow-sm shadow-stampa-orange/10 border-transparent",
    ghost: "border-stampa-border bg-stampa-surface-soft text-stampa-text-muted hover:bg-white/10 hover:text-white active:bg-white/20"
  };

  const baseClass = `inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-all duration-150 outline-none focus:ring-2 focus:ring-stampa-orange/50 active:scale-[0.98] hover:scale-[1.01] ${styles[variant]} ${className}`;

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
