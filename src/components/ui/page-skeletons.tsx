import type { ReactNode } from "react";

function SkeletonPage({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-6 pb-10" aria-busy="true" aria-label="Cargando contenido">
      {children}
      <span className="sr-only">Cargando…</span>
    </div>
  );
}

export function SkeletonBlock({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-xl bg-white/[0.06] motion-reduce:animate-none ${className}`}
    />
  );
}

export function PageHeaderSkeleton({ action = false }: { action?: boolean }) {
  return (
    <div className="flex min-h-28 flex-col justify-between gap-5 rounded-2xl border border-stampa-border bg-stampa-surface p-6 sm:flex-row sm:items-center">
      <div className="space-y-3">
        <SkeletonBlock className="h-3 w-24" />
        <SkeletonBlock className="h-8 w-56 max-w-[70vw]" />
        <SkeletonBlock className="h-4 w-80 max-w-[75vw]" />
      </div>
      {action && <SkeletonBlock className="h-10 w-36 shrink-0" />}
    </div>
  );
}

export function CardSkeleton({ media = false }: { media?: boolean }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-stampa-border bg-stampa-surface">
      {media && <SkeletonBlock className="h-40 w-full rounded-none" />}
      <div className="space-y-3 p-5">
        <SkeletonBlock className="h-5 w-2/3" />
        <SkeletonBlock className="h-3 w-full" />
        <SkeletonBlock className="h-3 w-4/5" />
      </div>
    </div>
  );
}

export function GridSkeleton({ count = 6, media = false }: { count?: number; media?: boolean }) {
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }, (_, index) => <CardSkeleton key={index} media={media} />)}
    </div>
  );
}

export function TableSkeleton({ rows = 6, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-stampa-border bg-stampa-surface">
      <div className="grid gap-4 border-b border-stampa-border bg-white/[0.025] px-5 py-4" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {Array.from({ length: columns }, (_, index) => <SkeletonBlock key={index} className="h-3" />)}
      </div>
      <div className="divide-y divide-white/5">
        {Array.from({ length: rows }, (_, row) => (
          <div key={row} className="grid gap-4 px-5 py-4" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
            {Array.from({ length: columns }, (_, column) => (
              <SkeletonBlock key={column} className={`h-4 ${column === 0 ? "w-4/5" : "w-2/3"}`} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function FormSkeleton({ fields = 6 }: { fields?: number }) {
  return (
    <div className="rounded-2xl border border-stampa-border bg-stampa-surface p-5 sm:p-6">
      <div className="mb-6 space-y-2">
        <SkeletonBlock className="h-5 w-44" />
        <SkeletonBlock className="h-3 w-64 max-w-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: fields }, (_, index) => (
          <div key={index} className="space-y-2">
            <SkeletonBlock className="h-3 w-24" />
            <SkeletonBlock className="h-11 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function ChatSkeleton() {
  return (
    <SkeletonPage>
      <PageHeaderSkeleton />
      <div className="grid min-h-[560px] gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div className="hidden space-y-3 rounded-2xl border border-stampa-border bg-stampa-surface p-4 lg:block">
          <SkeletonBlock className="h-5 w-32" />
          {Array.from({ length: 5 }, (_, index) => <SkeletonBlock key={index} className="h-12 w-full" />)}
        </div>
        <div className="flex flex-col rounded-2xl border border-stampa-border bg-stampa-surface p-5">
          <div className="flex-1 space-y-5">
            <SkeletonBlock className="h-16 w-3/4" />
            <SkeletonBlock className="ml-auto h-12 w-1/2" />
            <SkeletonBlock className="h-20 w-4/5" />
          </div>
          <SkeletonBlock className="h-12 w-full" />
        </div>
      </div>
    </SkeletonPage>
  );
}

export function AdminListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <SkeletonPage>
      <PageHeaderSkeleton action />
      <TableSkeleton rows={rows} columns={5} />
    </SkeletonPage>
  );
}

export function StockPageSkeleton() {
  return (
    <SkeletonPage>
      <PageHeaderSkeleton action />
      <div className="flex gap-3"><SkeletonBlock className="h-10 w-28" /><SkeletonBlock className="h-10 w-28" /></div>
      <SkeletonBlock className="h-11 w-full" />
      <TableSkeleton rows={7} columns={5} />
    </SkeletonPage>
  );
}

export function CalculatorPageSkeleton() {
  return (
    <SkeletonPage>
      <PageHeaderSkeleton />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(300px,0.6fr)]">
        <FormSkeleton fields={8} />
        <div className="space-y-5 rounded-2xl border border-stampa-border bg-stampa-surface p-6">
          <SkeletonBlock className="h-6 w-44" />
          {Array.from({ length: 6 }, (_, index) => <SkeletonBlock key={index} className="h-5 w-full" />)}
          <SkeletonBlock className="h-14 w-full" />
        </div>
      </div>
    </SkeletonPage>
  );
}

export function ProductsPageSkeleton() {
  return (
    <SkeletonPage>
      <PageHeaderSkeleton action />
      <div className="flex gap-3"><SkeletonBlock className="h-11 flex-1" /><SkeletonBlock className="h-11 w-36" /></div>
      <GridSkeleton count={6} />
    </SkeletonPage>
  );
}

export function LearningPageSkeleton({ overview = false }: { overview?: boolean }) {
  return (
    <SkeletonPage>
      <PageHeaderSkeleton />
      {overview && <div className="grid gap-5 md:grid-cols-2"><CardSkeleton /><CardSkeleton /></div>}
      <GridSkeleton count={6} media />
    </SkeletonPage>
  );
}

export function RafflesPageSkeleton() {
  return (
    <SkeletonPage>
      <PageHeaderSkeleton />
      <div className="grid min-h-72 overflow-hidden rounded-2xl border border-stampa-border bg-stampa-surface md:grid-cols-5">
        <SkeletonBlock className="min-h-52 rounded-none md:col-span-2" />
        <div className="space-y-4 p-7 md:col-span-3">
          <SkeletonBlock className="h-5 w-24" /><SkeletonBlock className="h-8 w-2/3" />
          <SkeletonBlock className="h-4 w-44" /><SkeletonBlock className="h-20 w-full" />
        </div>
      </div>
      <GridSkeleton count={3} />
    </SkeletonPage>
  );
}

export function SettingsPageSkeleton() {
  return (
    <SkeletonPage>
      <PageHeaderSkeleton />
      <div className="flex gap-5 overflow-hidden border-b border-stampa-border pb-3">
        {Array.from({ length: 5 }, (_, index) => <SkeletonBlock key={index} className="h-7 w-24 shrink-0" />)}
      </div>
      <FormSkeleton fields={6} />
    </SkeletonPage>
  );
}

export function AdminDashboardSkeleton() {
  return (
    <SkeletonPage>
      <PageHeaderSkeleton />
      <GridSkeleton count={9} />
    </SkeletonPage>
  );
}

export function AdminStampySkeleton() {
  return (
    <SkeletonPage>
      <PageHeaderSkeleton />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => <CardSkeleton key={index} />)}
      </div>
      <div className="grid gap-5 lg:grid-cols-2"><TableSkeleton rows={5} columns={2} /><TableSkeleton rows={5} columns={2} /></div>
    </SkeletonPage>
  );
}

export function KnowledgeDocumentsSkeleton() {
  return (
    <SkeletonPage>
      <PageHeaderSkeleton action />
      <FormSkeleton fields={3} />
      <TableSkeleton rows={5} columns={4} />
    </SkeletonPage>
  );
}
