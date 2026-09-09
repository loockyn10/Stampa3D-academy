import type { ReactNode } from "react";
import { WorkshopNavigation } from "@/components/workshop/workshop-navigation";

export default function WorkshopLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-w-0">
      <WorkshopNavigation />
      {children}
    </div>
  );
}
