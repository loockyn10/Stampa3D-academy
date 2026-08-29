import { GridSkeleton, PageHeaderSkeleton } from "@/components/ui/page-skeletons";

export default function AppLoading() {
  return (
    <div className="space-y-6 pb-10" aria-label="Cargando contenido" aria-live="polite">
      <PageHeaderSkeleton />
      <GridSkeleton />
      <span className="sr-only">Cargando…</span>
    </div>
  );
}
