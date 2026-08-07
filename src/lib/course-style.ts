const normalize = (text: string | null | undefined) => {
  if (!text) return "";
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
};

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

  const base = "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ";

  switch (label) {
    case "Cero a Intermedio":
      return base + "bg-gradient-to-r from-green-500/15 to-yellow-500/15 text-yellow-100 border-green-500/30";
    case "Principiante":
      return base + "bg-green-500/10 text-green-300 border-green-500/30";
    case "Intermedio":
      return base + "bg-yellow-500/10 text-yellow-300 border-yellow-500/30";
    case "Avanzado":
      return base + "bg-red-500/10 text-red-300 border-red-500/30";
    case "Taller":
      return base + "bg-sky-500/10 text-sky-300 border-sky-500/30";
    default:
      return base + "bg-white/5 text-neutral-300 border-white/10";
  }
}
