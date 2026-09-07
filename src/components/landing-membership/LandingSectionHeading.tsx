interface LandingSectionHeadingProps {
  eyebrow?: string;
  title: string;
  description?: string;
  align?: "left" | "center";
}

export function LandingSectionHeading({
  eyebrow,
  title,
  description,
  align = "center",
}: LandingSectionHeadingProps) {
  const alignment = align === "left" ? "text-left" : "text-center mx-auto";

  return (
    <div className={`max-w-3xl ${alignment}`}>
      {eyebrow ? (
        <p className="mb-4 text-xs font-bold uppercase tracking-[0.24em] text-orange-400">
          {eyebrow}
        </p>
      ) : null}
      <h2 className="text-3xl font-bold leading-tight text-white md:text-5xl">
        {title}
      </h2>
      {description ? (
        <p className="mt-5 text-base leading-relaxed text-zinc-400 md:text-lg">
          {description}
        </p>
      ) : null}
    </div>
  );
}
