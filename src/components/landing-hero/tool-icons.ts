import { Bot, Briefcase, Calculator, Compass, GraduationCap, Shapes, Wrench, type LucideIcon } from "lucide-react";
import type { ToolIconName } from "./universe-tools";

/** Nombre de icono (dato) → componente. Mantiene `universe-tools.ts` libre de React. */
export const toolIcons: Record<ToolIconName, LucideIcon> = {
  calculator: Calculator,
  compass: Compass,
  shapes: Shapes,
  wrench: Wrench,
  briefcase: Briefcase,
  "graduation-cap": GraduationCap,
  bot: Bot,
};
