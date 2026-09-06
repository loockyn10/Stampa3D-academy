import type { ReactNode } from "react";

type LandingV2SectionHeadingProps = {
  eyebrow: string;
  title: ReactNode;
  description?: ReactNode;
  align?: "left" | "center";
  className?: string;
};

export function LandingV2SectionHeading({
  eyebrow,
  title,
  description,
  align = "left",
  className = "",
}: LandingV2SectionHeadingProps) {
  const centered = align === "center";

  return (
    <div className={`${centered ? "mx-auto text-center" : ""} max-w-3xl ${className}`}>
      <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-stampa-orange sm:text-xs">
        {eyebrow}
      </p>
      <h2 className="mt-4 text-3xl font-semibold leading-tight tracking-[-0.035em] text-white sm:text-4xl lg:text-5xl">
        {title}
      </h2>
      {description ? (
        <p className={`mt-5 text-base leading-7 text-zinc-400 sm:text-lg ${centered ? "mx-auto max-w-2xl" : "max-w-2xl"}`}>
          {description}
        </p>
      ) : null}
    </div>
  );
}
