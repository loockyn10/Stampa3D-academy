"use client";

import React from "react";
import Link from "next/link";
import { AlertCircle, CalendarDays, Check, Copy, Gift, HelpCircle, Ticket, Trophy, UserPlus, X } from "lucide-react";
import { RaffleImage } from "@/components/raffles/raffle-image";
import { Dialog } from "@/components/ui/dialog";
import type { PublicRaffle } from "@/lib/raffles/public-raffles";
import { getRaffleTimeStatus, type FinishedRaffle } from "@/lib/raffles/status";

const PRIZE_POSITION_TONES = ["text-stampa-orange", "text-cyan-300", "text-violet-300"] as const;
const longDate = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "long", year: "numeric" });
const shortDate = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", year: "numeric" });

export interface RafflesViewProps {
  activeRaffles: PublicRaffle[];
  finishedRaffles: FinishedRaffle[];
  baseChances: number;
  bonusEntries: number;
  referralLink: string | null;
  copyState: "idle" | "copied" | "failed";
  onCopy: () => void;
  error: string | null;
  helpOpen: boolean;
  onHelpOpenChange: (open: boolean) => void;
}

/** Vista de Sorteos (sin acceso a datos). La página resuelve chances, sorteos y enlace. */
export function RafflesView({
  activeRaffles,
  finishedRaffles,
  baseChances,
  bonusEntries,
  referralLink,
  copyState,
  onCopy,
  error,
  helpOpen,
  onHelpOpenChange,
}: RafflesViewProps) {
  const totalChances = baseChances + bonusEntries;
  return (
    <div className="flex flex-col gap-5 pb-8 sm:gap-6 sm:pb-12">
      {/* 1. Encabezado + panel de chances */}
      <header className="relative overflow-hidden rounded-2xl border border-stampa-orange/15 bg-gradient-to-br from-stampa-orange/[0.08] via-stampa-surface to-violet-500/[0.06] p-4 sm:p-5">
        <div className="pointer-events-none absolute -right-16 -top-20 h-48 w-48 rounded-full bg-violet-500/10 blur-3xl" />
        <div className="relative grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-center">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-stampa-orange/25 bg-stampa-orange/10 text-stampa-orange" aria-hidden="true">
                <Gift size={20} />
              </span>
              <h1 className="text-2xl font-black tracking-tight text-white sm:text-3xl">Sorteos</h1>
            </div>
            <p className="mt-2 max-w-xl text-sm text-gray-400">
              Participá de los sorteos de Stampa con tu cuenta y sumá chances invitando amigos.
            </p>
            <button
              type="button"
              onClick={() => onHelpOpenChange(true)}
              className="mt-3 inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-stampa-border bg-white/5 px-3 text-xs font-semibold text-gray-200 transition-colors hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-stampa-orange"
            >
              <HelpCircle size={14} aria-hidden="true" /> ¿Cómo funcionan los sorteos?
            </button>
          </div>

          <section aria-labelledby="my-chances-title" className="rounded-xl border border-cyan-400/20 bg-stampa-bg/60 p-3.5 sm:p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 id="my-chances-title" className="text-xs font-bold uppercase tracking-wide text-gray-400">Tus chances</h2>
                <p className="mt-0.5 text-[11px] text-gray-500">
                  <span className="text-cyan-300/80">{baseChances} base</span>
                  <span className="mx-1.5 text-gray-600">·</span>
                  <span className="text-violet-300/80">{bonusEntries} por invitaciones</span>
                </p>
              </div>
              <p className="bg-gradient-to-br from-cyan-300 to-violet-400 bg-clip-text text-4xl font-black tabular-nums text-transparent" aria-label={`${totalChances} chances`}>
                {totalChances}
              </p>
            </div>
            <div className="mt-3 border-t border-white/5 pt-3">
              <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-gray-300">
                <UserPlus size={13} className="text-violet-300" aria-hidden="true" /> Tu enlace de invitación
              </p>
              <div className="flex min-w-0 items-stretch gap-2">
                <div className="flex min-w-0 flex-1 items-center overflow-hidden rounded-lg border border-stampa-border bg-stampa-bg-soft px-2.5 py-2">
                  {referralLink ? (
                    <span className="truncate font-mono text-xs font-bold text-violet-300" title={referralLink}>{referralLink}</span>
                  ) : (
                    <span className="truncate text-xs italic text-gray-500">Tu enlace se está preparando…</span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={onCopy}
                  disabled={!referralLink}
                  aria-label="Copiar enlace de invitación"
                  className="inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-stampa-orange px-3 text-xs font-bold text-neutral-950 transition hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-stampa-orange/50 disabled:opacity-50"
                >
                  {copyState === "copied" ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                  {copyState === "copied" ? "Copiado" : "Copiar"}
                </button>
              </div>
              <p className="mt-1.5 min-h-4 text-[11px] text-gray-500" role="status">
                {copyState === "failed" ? "No pudimos copiar automáticamente: seleccioná el enlace y copialo." : ""}
              </p>
            </div>
          </section>
        </div>
      </header>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {/* 2. Sorteos activos */}
      {!error && (activeRaffles.length > 0 ? (
        <section aria-labelledby="active-raffles-title">
          <h2 id="active-raffles-title" className="mb-3 text-base font-bold text-white">Sorteos activos</h2>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {activeRaffles.map((activeRaffle) => {
              const activePrizes = activeRaffle.raffle_prizes;
              const mainPrize = activePrizes[0];
              const coverImage = activeRaffle.cover_image_url || mainPrize?.image_url;
              const status = getRaffleTimeStatus(activeRaffle.draw_date);
              return (
                <article
                  key={activeRaffle.id}
                  className="group relative overflow-hidden rounded-2xl border border-stampa-orange/20 bg-gradient-to-br from-stampa-orange/[0.06] via-stampa-surface to-violet-500/[0.05] shadow-lg shadow-black/30 transition-colors hover:border-stampa-orange/35"
                >
                  <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-px bg-gradient-to-r from-transparent via-stampa-orange/60 to-transparent" />
                  <div className="flex gap-3 p-3 sm:gap-4 sm:p-4">
                    <div className="relative aspect-[4/3] w-28 shrink-0 self-start overflow-hidden rounded-xl border border-stampa-orange/15 bg-gradient-to-br from-stampa-orange/10 via-stampa-bg-soft to-violet-500/10 sm:w-44">
                      <RaffleImage
                        src={coverImage}
                        alt={activeRaffle.title}
                        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                        fallback={(
                          <div className="flex h-full items-center justify-center text-stampa-orange/70">
                            <Gift size={26} aria-hidden="true" />
                          </div>
                        )}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StatusPill kind={status.kind} label={status.kind === "open" ? "Activo" : status.label} />
                        {status.kind === "open" && <span className="text-[11px] font-semibold text-gray-400">{status.label}</span>}
                      </div>
                      <h3 className="mt-1.5 line-clamp-2 text-base font-black leading-tight text-white sm:text-lg">{activeRaffle.title}</h3>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] font-semibold">
                        <span className="inline-flex items-center gap-1 rounded-md border border-stampa-orange/25 bg-stampa-orange/10 px-2 py-1 text-stampa-orange">
                          <CalendarDays size={12} aria-hidden="true" />
                          {activeRaffle.draw_date ? shortDate.format(new Date(activeRaffle.draw_date)) : "Fecha a confirmar"}
                        </span>
                        <span className="inline-flex items-center gap-1 rounded-md border border-cyan-400/25 bg-cyan-500/10 px-2 py-1 text-cyan-200">
                          <Ticket size={12} aria-hidden="true" />
                          {totalChances} {totalChances === 1 ? "chance" : "chances"}
                        </span>
                      </div>
                    </div>
                  </div>

                  {activePrizes.length > 0 && (
                    <div className="border-t border-white/5 px-3 pb-3 pt-2.5 sm:px-4 sm:pb-4">
                      <h4 className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">
                        {activePrizes.length === 1 ? "Premio" : `${activePrizes.length} premios`}
                      </h4>
                      <ul className="space-y-1.5">
                        {activePrizes.map((prize, idx) => (
                          <li key={prize.id} className="flex min-w-0 items-center gap-2.5">
                            <RaffleImage
                              src={prize.image_url}
                              alt=""
                              className="h-8 w-8 shrink-0 rounded-md border border-white/10 bg-white/[0.03] object-contain"
                              fallback={(
                                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/[0.03] text-gray-500">
                                  <Gift size={14} aria-hidden="true" />
                                </span>
                              )}
                            />
                            <p className="min-w-0 flex-1 truncate text-sm font-semibold text-white">
                              <span className={`mr-1 ${PRIZE_POSITION_TONES[Math.min(idx, PRIZE_POSITION_TONES.length - 1)]}`}>{idx + 1}º</span>
                              {prize.name}
                              {prize.description && <span className="ml-1.5 text-xs font-normal text-gray-500">{prize.description}</span>}
                            </p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      ) : (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-stampa-border bg-stampa-surface px-5 py-8 text-center">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-stampa-border bg-stampa-bg-soft text-gray-500">
            <Ticket size={20} />
          </div>
          <h2 className="text-base font-bold text-white">Todavía no hay sorteos activos.</h2>
          <p className="mt-1 max-w-sm text-sm text-gray-400">Tus chances se mantienen para los próximos. Mientras tanto, compartí tu enlace de invitación.</p>
          <Link href="/canales" className="mt-4 rounded-xl border border-stampa-border bg-stampa-bg-soft px-5 py-2 text-sm font-bold text-white transition-colors hover:bg-white/5">
            Ir a la Comunidad
          </Link>
        </div>
      ))}

      {/* 3. Finalizados */}
      {finishedRaffles.length > 0 && (
        <section aria-labelledby="finished-raffles-title">
          <h2 id="finished-raffles-title" className="mb-3 text-base font-bold text-white">Sorteos finalizados</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {finishedRaffles.map((raffle) => (
              <article key={raffle.key} className="rounded-xl border border-stampa-border bg-stampa-surface p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="line-clamp-2 text-sm font-bold text-white">{raffle.title}</h3>
                  <StatusPill kind="finished" label="Finalizado" />
                </div>
                <p className="mt-0.5 text-[11px] text-gray-500">{raffle.date ? longDate.format(new Date(raffle.date)) : ""}</p>
                <ul className="mt-2.5 space-y-1.5">
                  {raffle.winners.map((winner) => (
                    <li key={winner.id} className="flex min-w-0 items-center gap-2 text-xs">
                      <Trophy size={13} className="shrink-0 text-stampa-orange" aria-hidden="true" />
                      <span className="min-w-0 truncate">
                        <strong className="text-gray-100">{winner.winner}</strong>
                        <span className="text-gray-500"> · {winner.prize}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>
      )}

      <RafflesHelpDialog open={helpOpen} onClose={() => onHelpOpenChange(false)} baseChances={baseChances} />
    </div>
  );
}

function StatusPill({ kind, label }: { kind: "open" | "no_date" | "awaiting_result" | "finished"; label: string }) {
  const tone = {
    open: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    no_date: "border-cyan-400/25 bg-cyan-500/10 text-cyan-200",
    awaiting_result: "border-yellow-500/30 bg-yellow-500/10 text-yellow-200",
    finished: "border-white/10 bg-white/5 text-gray-400",
  }[kind];
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${tone}`}>
      {label}
    </span>
  );
}

/**
 * Reglas confirmadas en el código (no se agregan condiciones):
 * - participa quien tiene acceso a la plataforma (`getRaffleParticipantChances` devuelve null sin acceso);
 * - chances base: 1, o 2 para nivel Gold/Elite (`getBaseRaffleChances`);
 * - chances adicionales: entradas activas acreditadas a la cuenta (`user_raffle_bonus_entries`);
 * - el enlace /registro?ref=CÓDIGO registra la invitación (queda pendiente) al crear la cuenta;
 * - los ganadores los registra el equipo de Stampa por premio y se publican en Finalizados.
 */
function RafflesHelpDialog({ open, onClose, baseChances }: { open: boolean; onClose: () => void; baseChances: number }) {
  const sections = [
    {
      title: "¿Cómo obtengo chances?",
      text: `Con tu cuenta activa en Universo Stampa ya participás. Todos los miembros tienen 1 chance base y los niveles Gold y Elite tienen 2. Hoy tu base es ${baseChances}.`,
    },
    {
      title: "¿Cómo funcionan las invitaciones?",
      text: "Compartí tu enlace personal. Cuando alguien crea su cuenta con ese enlace, la invitación queda registrada a tu nombre como pendiente.",
    },
    {
      title: "¿Qué son las chances adicionales?",
      text: "Son participaciones extra que se acreditan a tu cuenta, por ejemplo por invitaciones confirmadas. Se suman a tu base y las ves en \"Tus chances\" apenas se acreditan.",
    },
    {
      title: "¿Cómo se usan en los sorteos?",
      text: "Tus chances totales valen para cada sorteo activo: cuantas más tengas, más participaciones sumás. El equipo de Stampa realiza el sorteo en la fecha indicada y registra a los ganadores de cada premio, que aparecen en \"Sorteos finalizados\".",
    },
    {
      title: "¿Qué condiciones aplican?",
      text: "Para participar necesitás tener acceso activo a la plataforma al momento del sorteo. Si un sorteo muestra \"Fecha a confirmar\", la fecha todavía no fue publicada.",
    },
  ];
  return (
    <Dialog open={open} onClose={onClose} labelledBy="raffles-help-title" panelClassName="max-w-lg rounded-2xl border border-stampa-border bg-stampa-surface">
      <div className="flex items-start justify-between gap-3 border-b border-stampa-border px-4 py-3.5 sm:px-5">
        <h2 id="raffles-help-title" className="flex items-center gap-2 text-base font-bold text-white">
          <HelpCircle size={17} className="text-stampa-orange" aria-hidden="true" /> ¿Cómo funcionan los sorteos?
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-stampa-orange"
        >
          <X size={18} />
        </button>
      </div>
      <dl className="space-y-3.5 px-4 py-4 sm:px-5">
        {sections.map((section) => (
          <div key={section.title}>
            <dt className="text-sm font-semibold text-white">{section.title}</dt>
            <dd className="mt-0.5 text-sm leading-relaxed text-gray-400">{section.text}</dd>
          </div>
        ))}
      </dl>
      <div className="border-t border-stampa-border px-4 py-3 sm:px-5">
        <button
          type="button"
          onClick={onClose}
          className="min-h-10 w-full rounded-xl bg-stampa-orange text-sm font-bold text-neutral-950 transition hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-stampa-orange/50"
        >
          Entendido
        </button>
      </div>
    </Dialog>
  );
}
