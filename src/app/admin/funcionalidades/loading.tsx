export default function Loading() {
  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-12" aria-busy="true" aria-label="Cargando funcionalidades">
      <div className="h-16 animate-pulse rounded-2xl bg-stampa-surface" />
      <div className="h-8 w-64 animate-pulse rounded-lg bg-stampa-surface" />
      <div className="divide-y divide-stampa-border overflow-hidden rounded-2xl border border-stampa-border bg-stampa-surface">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="flex items-center gap-4 p-4">
            <div className="flex-1 space-y-2">
              <div className="h-4 w-40 animate-pulse rounded bg-fg/10" />
              <div className="h-3 w-64 max-w-full animate-pulse rounded bg-fg/5" />
            </div>
            <div className="h-7 w-12 animate-pulse rounded-full bg-fg/10" />
          </div>
        ))}
      </div>
    </div>
  );
}
