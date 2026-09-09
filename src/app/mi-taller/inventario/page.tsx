import { Suspense } from "react";
import { StockPageContent } from "@/app/stock/page";
import { StockPageSkeleton } from "@/components/ui/page-skeletons";

export default function WorkshopInventoryPage() {
  return (
    <Suspense fallback={<StockPageSkeleton />}>
      <StockPageContent workshopSection="inventory" />
    </Suspense>
  );
}
