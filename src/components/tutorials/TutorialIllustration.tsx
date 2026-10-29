import React from "react";
import { ArrowDown, ArrowRight, Bot, Search } from "lucide-react";
import type { TutorialIconName, TutorialIllustration as Illustration, TutorialTone } from "@/lib/tutorials/types";
import { TUTORIAL_ICONS } from "./tutorial-icons";

// Ilustraciones de los tutoriales. Solo tokens del tema (bg-stampa-*, text-fg, bg-fg/N): se ven bien en claro y oscuro.
// El contenido son listas semánticas, así que un lector de pantalla recibe lo mismo que ve el resto.

const ACCENT_CARD = "border-stampa-orange/50 bg-stampa-orange/10";
const NEUTRAL_CARD = "border-stampa-border bg-stampa-surface";

function IconBadge({ name, accent = false }: { name: TutorialIconName; accent?: boolean }) {
  const Icon = TUTORIAL_ICONS[name];
  return (
    <span
      aria-hidden="true"
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
        accent ? "bg-stampa-orange text-neutral-950" : "bg-stampa-orange/10 text-stampa-accent"
      }`}
    >
      <Icon size={20} />
    </span>
  );
}

function Flow({ nodes }: { nodes: Extract<Illustration, { kind: "flow" }>["nodes"] }) {
  return (
    <ol className="flex flex-col items-stretch gap-1 sm:flex-row sm:items-stretch sm:justify-center">
      {nodes.map((node, index) => {
        const last = index === nodes.length - 1;
        return (
          <React.Fragment key={`${node.label}-${index}`}>
            <li className={`flex min-w-0 flex-1 items-center gap-3 rounded-2xl border p-3 sm:flex-col sm:justify-center sm:gap-2 sm:p-4 sm:text-center ${last && nodes.length > 1 ? ACCENT_CARD : NEUTRAL_CARD}`}>
              <IconBadge name={node.icon} accent={last && nodes.length > 1} />
              <span className="min-w-0">
                <span className="block text-sm font-bold leading-tight text-fg">{node.label}</span>
                {node.hint && <span className="mt-0.5 block text-xs text-gray-400">{node.hint}</span>}
              </span>
            </li>
            {!last && (
              <li aria-hidden="true" className="flex items-center justify-center self-center py-0.5 text-stampa-accent sm:px-1 sm:py-0">
                <ArrowDown size={18} className="sm:hidden" />
                <ArrowRight size={18} className="hidden sm:block" />
              </li>
            )}
          </React.Fragment>
        );
      })}
    </ol>
  );
}

function gridColumns(count: number): string {
  if (count <= 2 || count === 4) return "sm:grid-cols-2";
  return "sm:grid-cols-3";
}

function Cards({ items }: { items: Extract<Illustration, { kind: "cards" }>["items"] }) {
  return (
    <ul className={`grid grid-cols-1 gap-2.5 ${gridColumns(items.length)}`}>
      {items.map((item, index) => (
        <li
          key={`${item.title}-${index}`}
          className={`flex items-center gap-3 rounded-2xl border p-3 ${(item.tone as TutorialTone | undefined) === "accent" ? ACCENT_CARD : NEUTRAL_CARD}`}
        >
          <IconBadge name={item.icon} accent={item.tone === "accent"} />
          <span className="min-w-0">
            <span className="block text-sm font-bold leading-tight text-fg">{item.title}</span>
            {item.text && <span className="mt-0.5 block text-xs leading-snug text-gray-400">{item.text}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Barras de largo fijo en lugar de importes: muestra la estructura del cálculo sin inventar números. */
const BAR_WIDTHS = ["w-14", "w-20", "w-12", "w-16", "w-10"];

function Breakdown({ illustration }: { illustration: Extract<Illustration, { kind: "breakdown" }> }) {
  return (
    <div className="mx-auto w-full max-w-md rounded-2xl border border-stampa-border bg-stampa-surface p-4">
      <ul className="space-y-2.5">
        {illustration.rows.map((row, index) => (
          <li key={row} className="flex items-center justify-between gap-3 text-sm text-gray-400">
            <span>{row}</span>
            <span aria-hidden="true" className={`h-2 rounded-full bg-fg/15 ${BAR_WIDTHS[index % BAR_WIDTHS.length]}`} />
          </li>
        ))}
      </ul>
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-stampa-border pt-3">
        <span className="text-xs font-bold uppercase tracking-wider text-gray-400">{illustration.subtotal}</span>
        <span aria-hidden="true" className="h-2.5 w-16 rounded-full bg-fg/25" />
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-stampa-orange/50 bg-stampa-orange/10 px-3 py-2.5">
        <span className="text-xs font-bold uppercase tracking-wider text-stampa-accent">{illustration.result}</span>
        <span aria-hidden="true" className="h-3 w-20 rounded-full bg-stampa-orange/60" />
      </div>
      {illustration.note && (
        <p className="mt-2.5 flex items-center justify-between gap-3 text-xs text-gray-400">
          <span>{illustration.note}</span>
          <span aria-hidden="true" className="h-2 w-10 rounded-full bg-fg/15" />
        </p>
      )}
    </div>
  );
}

function Chat({ messages }: { messages: Extract<Illustration, { kind: "chat" }>["messages"] }) {
  return (
    <ul className="mx-auto flex w-full max-w-md flex-col gap-2.5">
      {messages.map((message, index) =>
        message.from === "user" ? (
          <li key={index} className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-stampa-orange px-3.5 py-2.5 text-sm font-medium text-neutral-950">
            {message.text}
          </li>
        ) : (
          <li key={index} className="mr-auto flex max-w-[85%] items-start gap-2">
            <span aria-hidden="true" className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-stampa-orange/10 text-stampa-accent">
              <Bot size={15} />
            </span>
            <span className="rounded-2xl rounded-bl-md border border-stampa-border bg-stampa-surface px-3.5 py-2.5 text-sm text-fg">
              <span className="mb-0.5 block text-[10px] font-bold uppercase tracking-wider text-stampa-accent">Stampy</span>
              {message.text}
            </span>
          </li>
        ),
      )}
    </ul>
  );
}

function Filters({ illustration }: { illustration: Extract<Illustration, { kind: "filters" }> }) {
  return (
    <div className="mx-auto w-full max-w-lg space-y-3">
      <div className="flex items-center gap-2.5 rounded-xl border border-stampa-border bg-stampa-surface px-3.5 py-3 text-sm text-gray-400">
        <Search size={17} aria-hidden="true" className="shrink-0 text-stampa-accent" />
        <span className="truncate">{illustration.search}</span>
      </div>
      {illustration.groups.map((group) => (
        <div key={group.label} className="flex flex-wrap items-center gap-2" role="group" aria-label={group.label}>
          <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-gray-500">{group.label}</span>
          {group.options.map((option) => {
            const active = option === group.active;
            return (
              <span
                key={option}
                className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                  active ? "border-stampa-orange bg-stampa-orange/15 text-stampa-accent" : "border-stampa-border bg-stampa-surface text-gray-400"
                }`}
              >
                {option}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function TutorialIllustration({ illustration }: { illustration: Illustration }) {
  switch (illustration.kind) {
    case "flow":
      return <Flow nodes={illustration.nodes} />;
    case "cards":
      return <Cards items={illustration.items} />;
    case "breakdown":
      return <Breakdown illustration={illustration} />;
    case "chat":
      return <Chat messages={illustration.messages} />;
    case "filters":
      return <Filters illustration={illustration} />;
  }
}
