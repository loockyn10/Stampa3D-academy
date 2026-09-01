const normalize = (text: string | null | undefined) => {
  if (!text) return "";
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
};

export type CourseLevelKey = "beginner" | "intermediate" | "advanced";

export interface CourseLevelStyle {
  key: CourseLevelKey;
  label: string;
  accentClassName: string;
  badgeClassName: string;
  dotClassName: string;
}

const COURSE_LEVEL_STYLES: Record<CourseLevelKey, CourseLevelStyle> = {
  beginner: {
    key: "beginner",
    label: "Principiante",
    accentClassName: "bg-emerald-500 shadow-[4px_0_16px_rgba(16,185,129,0.28)] group-hover:shadow-[5px_0_22px_rgba(16,185,129,0.4)]",
    badgeClassName: "border-emerald-500/40 bg-emerald-500/15 text-emerald-200",
    dotClassName: "bg-emerald-400",
  },
  intermediate: {
    key: "intermediate",
    label: "Intermedio",
    accentClassName: "bg-amber-400 shadow-[4px_0_16px_rgba(251,191,36,0.25)] group-hover:shadow-[5px_0_22px_rgba(251,191,36,0.38)]",
    badgeClassName: "border-amber-400/40 bg-amber-400/15 text-amber-100",
    dotClassName: "bg-amber-300",
  },
  advanced: {
    key: "advanced",
    label: "Avanzado",
    accentClassName: "bg-red-500 shadow-[4px_0_16px_rgba(239,68,68,0.25)] group-hover:shadow-[5px_0_22px_rgba(239,68,68,0.38)]",
    badgeClassName: "border-red-500/40 bg-red-500/15 text-red-200",
    dotClassName: "bg-red-400",
  },
};

export function getCourseLevelStyle(level: unknown): CourseLevelStyle | null {
  if (typeof level !== "string") return null;

  switch (normalize(level)) {
    case "beginner":
    case "principiante":
      return COURSE_LEVEL_STYLES.beginner;
    case "intermediate":
    case "intermedio":
      return COURSE_LEVEL_STYLES.intermediate;
    case "advanced":
    case "avanzado":
      return COURSE_LEVEL_STYLES.advanced;
    default:
      return null;
  }
}

export function getCourseLevelLabel(course: any): string {
  if (!course) return "Principiante";

  // Check multiple fields to extract potential level text
  const fields = [
    course.level,
    course.title,
    course.category,
    course.type,
  ];

  for (const field of fields) {
    if (!field) continue;
    const norm = normalize(String(field));

    if (
      norm.includes("cero a intermedio") ||
      norm.includes("0 a intermedio") ||
      norm.includes("principiante a intermedio") ||
      norm.includes("desde cero a intermedio")
    ) {
      return "Cero a Intermedio";
    }

    if (norm.includes("principiante") || norm.includes("beginner")) {
      return "Principiante";
    }

    if (norm.includes("intermedio") || norm.includes("intermediate")) {
      return "Intermedio";
    }

    if (norm.includes("avanzado") || norm.includes("advanced")) {
      return "Avanzado";
    }

    if (norm.includes("taller") || norm.includes("workshop")) {
      return "Taller";
    }
  }

  // Fallback label based on default course.level if present
  if (course.level === "advanced") return "Avanzado";
  if (course.level === "intermediate") return "Intermedio";
  
  return "Principiante";
}

export function getCourseLevelClasses(labelOrCourse: any): string {
  let label = "";
  if (typeof labelOrCourse === "string") {
    label = labelOrCourse;
  } else if (labelOrCourse && typeof labelOrCourse === "object") {
    label = getCourseLevelLabel(labelOrCourse);
  }

  const strictStyle = getCourseLevelStyle(label);
  const base = "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ";

  if (strictStyle) return base + strictStyle.badgeClassName;

  switch (label) {
    case "Cero a Intermedio":
      return base + "bg-gradient-to-r from-green-500/15 to-yellow-500/15 text-yellow-100 border-green-500/30";
    case "Taller":
      return base + "bg-sky-500/10 text-sky-300 border-sky-500/30";
    default:
      return base + "bg-white/5 text-neutral-300 border-stampa-border";
  }
}
