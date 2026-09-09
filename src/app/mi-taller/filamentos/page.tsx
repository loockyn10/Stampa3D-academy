import { Suspense } from "react";
import { StockPageContent } from "@/app/stock/page";
import { StockPageSkeleton } from "@/components/ui/page-skeletons";

export default function WorkshopFilamentsPage() {
  return (
    <Suspense fallback={<StockPageSkeleton />}>
      <StockPageContent workshopSection="filaments" />
    </Suspense>
  );
}
