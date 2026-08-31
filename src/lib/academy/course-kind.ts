export type CourseKind = "course" | "workshop";

export function normalizeCourseKind(value: unknown): CourseKind {
  return value === "workshop" ? "workshop" : "course";
}

export function getCourseKindUi(value: unknown) {
  const kind = normalizeCourseKind(value);
  const isWorkshop = kind === "workshop";

  return {
    kind,
    isWorkshop,
    singular: isWorkshop ? "taller" : "curso",
    singularTitle: isWorkshop ? "Taller" : "Curso",
    plural: isWorkshop ? "talleres" : "cursos",
    publicListHref: isWorkshop ? "/talleres" : "/cursos",
  } as const;
}
