export default function AppLoading() {
  return (
    <div className="space-y-6" aria-label="Cargando contenido" aria-live="polite">
      <div className="h-32 animate-pulse rounded-2xl border border-stampa-border bg-stampa-surface" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <div
            key={index}
            className="h-40 animate-pulse rounded-2xl border border-stampa-border bg-white/5"
          />
        ))}
      </div>
      <span className="sr-only">Cargando…</span>
    </div>
  );
}
