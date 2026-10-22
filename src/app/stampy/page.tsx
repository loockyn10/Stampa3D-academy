"use client";

import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import {
  ArrowUp,
  Bot,
  Calculator,
  Archive,
  Package,
  Boxes,
  BookOpen,
  MessageCircle,
  Gift,
  FileText,
  ChevronRight,
  PenTool,
  Wrench,
  GraduationCap,
  Lightbulb,
  Plus,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { askStampyAction } from "./actions";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";

import { StampyFeedback } from "@/components/stampy/StampyFeedback";
import { ActionIntentCard } from "@/components/stampy/ActionIntentCard";
import { StampyMessageContent } from "@/components/stampy/StampyMessageContent";
import { createStampyMessageId, createStampyRequestId } from "@/lib/stampy/client-message-id";
import { useStampyScreenContext } from "@/components/stampy/StampyContextProvider";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  recommendations?: any[];
  relatedTools?: string[];
  knowledgeTools?: any[];
  assistantMessageId?: string | null;
  actionIntent?: any;
  actionRequestId?: string | null;
}

/** Sugerencias del estado inicial: cada tarjeta envía un mensaje real al mismo chat. */
const SUGGESTION_CARDS: { title: string; prompt: string; icon: LucideIcon }[] = [
  { title: "Solucionar un problema de impresión", prompt: "Ayudame a solucionar warping", icon: Wrench },
  { title: "Calcular el precio de un producto", prompt: "¿Cómo calculo el precio de una pieza impresa?", icon: Calculator },
  { title: "Consultar mi inventario", prompt: "¿Qué filamentos tengo cargados?", icon: Boxes },
  { title: "Aprender impresión 3D", prompt: "¿Por dónde empiezo a aprender impresión 3D?", icon: GraduationCap },
  { title: "Buscar ideas de productos", prompt: "Dame una idea de producto rentable", icon: Lightbulb },
];

/** Acciones del taller que Stampy prepara y vos confirmás. */
const QUICK_SUGGESTIONS = [
  "Descontame 20g de PLA",
  "Creame un filamento nuevo PLA rojo de 1kg",
  "Creame una impresora Bambu A1 Mini de 350W",
];

const MAIN_CONVERSATION_STORAGE_KEY = "stampy_main_conversation_id";
const LEGACY_CONVERSATION_STORAGE_KEY = "stampy_current_conversation_id";
const SLOW_RESPONSE_HINT_MS = 8_000;

const TOOL_MAP: Record<string, { label: string; href: string; icon: any }> = {
  "calculadora": { label: "Calculadora de precios", href: "/calculadora", icon: Calculator },
  "presupuestos": { label: "Presupuestos", href: "/presupuestos", icon: FileText },
  "stock": { label: "Stock de material", href: "/mi-taller/filamentos", icon: Archive },
  "productos": { label: "Productos", href: "/mi-taller/productos", icon: Package },
  "libreria-stl": { label: "Librería STL", href: "/libreria-stl", icon: Boxes },
  "cursos": { label: "Cursos", href: "/cursos", icon: BookOpen },
  "academia": { label: "Academia", href: "/academia", icon: BookOpen },
  "talleres": { label: "Talleres", href: "/talleres", icon: PenTool },
  "comunidad": { label: "Comunidad", href: "/canales", icon: MessageCircle },
  "sorteos": { label: "Sorteos", href: "/sorteos", icon: Gift }
};

export default function StampyPage() {
  const { getScreenContextSnapshot } = useStampyScreenContext();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [slowResponse, setSlowResponse] = useState(false);
  const [conversationResolved, setConversationResolved] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(() =>
    typeof window === "undefined"
      ? null
      : localStorage.getItem(MAIN_CONVERSATION_STORAGE_KEY)
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastUserMessageRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const pendingScrollRef = useRef<"bottom" | "lastUser" | null>(null);
  const requestInFlightRef = useRef(false);

  useEffect(() => {
    localStorage.removeItem(LEGACY_CONVERSATION_STORAGE_KEY);
    setConversationId(localStorage.getItem(MAIN_CONVERSATION_STORAGE_KEY));
    setConversationResolved(true);
  }, []);

  useEffect(() => {
    if (!loading) {
      setSlowResponse(false);
      return;
    }
    const timer = window.setTimeout(() => setSlowResponse(true), SLOW_RESPONSE_HINT_MS);
    return () => window.clearTimeout(timer);
  }, [loading]);

  // Scroll dentro del contenedor del chat (nunca de la ventana):
  // - al enviar, se baja para ver el mensaje y el indicador de carga;
  // - al llegar una respuesta, se muestra desde la pregunta para leer respuestas largas desde el principio.
  useLayoutEffect(() => {
    const container = scrollRef.current;
    const pending = pendingScrollRef.current;
    if (!container || !pending) return;
    pendingScrollRef.current = null;
    if (pending === "lastUser" && lastUserMessageRef.current) {
      const top = lastUserMessageRef.current.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop - 12;
      container.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    } else if (stickToBottomRef.current || pending === "bottom") {
      container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    }
  }, [messages, loading]);

  const handleScroll = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    stickToBottomRef.current = container.scrollHeight - container.scrollTop - container.clientHeight < 120;
  }, []);

  const handleSend = async (text: string) => {
    const safeText = text.trim();
    if (!safeText || loading || requestInFlightRef.current) return;
    requestInFlightRef.current = true;

    const requestId = createStampyRequestId();
    const userMsg: Message = {
      id: createStampyMessageId(requestId, "user"),
      role: "user",
      content: safeText,
    };
    stickToBottomRef.current = true;
    pendingScrollRef.current = "bottom";
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const screenContext = getScreenContextSnapshot();
      const res = await askStampyAction(safeText, conversationId, {
        source: "page",
        pathname: window.location.pathname + window.location.search,
        ...(screenContext ? { screenContext } : {}),
      });

      if (res.conversationId && res.conversationId !== conversationId) {
        setConversationId(res.conversationId);
        localStorage.setItem(MAIN_CONVERSATION_STORAGE_KEY, res.conversationId);
      }

      pendingScrollRef.current = "lastUser";
      if (res.error) {
        setMessages(prev => [...prev, {
          id: createStampyMessageId(requestId, "assistant"),
          role: "assistant",
          content: res.error || "Error al comunicarse con Stampy."
        }]);
      } else {
        setMessages(prev => [...prev, {
          id: createStampyMessageId(requestId, "assistant"),
          role: "assistant",
          content: res.answer || "",
          recommendations: res.recommendations,
          relatedTools: res.relatedTools,
          knowledgeTools: res.knowledgeTools,
          assistantMessageId: res.assistantMessageId,
          actionIntent: res.actionIntent,
          actionRequestId: res.actionRequestId
        }]);
      }
    } catch {
      pendingScrollRef.current = "lastUser";
      setMessages(prev => [...prev, {
        id: createStampyMessageId(requestId, "assistant"),
        role: "assistant",
        content: "Algo falló al procesarlo. No hice ningún cambio. Probá de nuevo."
      }]);
    } finally {
      requestInFlightRef.current = false;
      setLoading(false);
    }
  };

  const startNewConversation = () => {
    if (requestInFlightRef.current) return;
    setConversationId(null);
    localStorage.removeItem(MAIN_CONVERSATION_STORAGE_KEY);
    setInput("");
    setMessages([]);
  };

  const hasMessages = messages.length > 0;
  const lastUserIndex = messages.map((message) => message.role).lastIndexOf("user");

  return (
    <div className="stampy-page-shell mx-auto flex w-full max-w-5xl flex-col">
      <div className="flex shrink-0 items-center justify-between gap-3 pb-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-cyan-400/25 bg-gradient-to-br from-cyan-500/20 to-violet-500/20 text-cyan-300" aria-hidden="true">
            <Sparkles size={16} />
          </span>
          <p className="truncate text-sm font-bold">
            <span className="bg-gradient-to-r from-cyan-300 via-sky-300 to-violet-400 bg-clip-text text-transparent">Stampy</span>
            <span className="ml-2 hidden text-xs font-medium text-gray-500 sm:inline">Asistente de Universo Stampa</span>
          </p>
        </div>
        {(hasMessages || conversationId) && (
          <button
            type="button"
            onClick={startNewConversation}
            disabled={loading}
            className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg border border-stampa-border bg-stampa-surface px-3 text-xs font-semibold text-gray-300 transition-colors hover:bg-white/5 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:opacity-50"
          >
            <Plus size={14} aria-hidden="true" /> Nuevo chat
          </button>
        )}
      </div>

      {!hasMessages ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center py-4 sm:py-8">
            <div className="mb-5 text-center sm:mb-7">
              <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-cyan-400/25 bg-gradient-to-br from-cyan-500/15 to-violet-500/15 text-cyan-300" aria-hidden="true">
                <Bot size={24} />
              </span>
              <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">¿En qué puedo ayudarte hoy?</h1>
              <p className="mt-2 text-sm text-gray-400">Impresión 3D, costos, tu taller y tus cursos. Si preparo un cambio, vos lo confirmás.</p>
            </div>

            <StampyComposer
              value={input}
              onChange={setInput}
              onSubmit={() => void handleSend(input)}
              loading={loading}
              variant="hero"
            />

            {conversationResolved && conversationId && (
              <p className="mt-3 text-center text-xs text-gray-500">
                Seguís en tu conversación anterior: Stampy recuerda su contexto.{" "}
                <button type="button" onClick={startNewConversation} className="font-semibold text-cyan-300 hover:underline">
                  Empezar de cero
                </button>
              </p>
            )}

            <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3" role="list" aria-label="Sugerencias">
              {SUGGESTION_CARDS.map((card) => {
                const Icon = card.icon;
                return (
                  <button
                    key={card.title}
                    type="button"
                    role="listitem"
                    onClick={() => void handleSend(card.prompt)}
                    disabled={loading}
                    className="group flex min-h-14 items-center gap-3 rounded-xl border border-stampa-border bg-stampa-surface px-3 py-2.5 text-left transition-colors hover:border-cyan-400/35 hover:bg-cyan-500/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:opacity-50"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/5 text-cyan-300 group-hover:bg-cyan-500/10" aria-hidden="true">
                      <Icon size={16} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-gray-100">{card.title}</span>
                      <span className="block truncate text-xs text-gray-500">{card.prompt}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="mt-4">
              <p className="mb-2 text-center text-[11px] font-semibold uppercase tracking-wide text-gray-500">Acciones en tu taller</p>
              <div className="flex flex-wrap justify-center gap-2">
                {QUICK_SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => void handleSend(suggestion)}
                    disabled={loading}
                    className="min-h-9 rounded-full border border-stampa-border bg-stampa-bg-soft px-3 text-xs font-medium text-gray-300 transition-colors hover:border-cyan-400/35 hover:text-cyan-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:opacity-50"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-2xl border border-stampa-border bg-stampa-bg"
            aria-live="polite"
            aria-busy={loading}
          >
            <div className="mx-auto w-full max-w-3xl space-y-6 px-3 py-5 sm:px-6">
              {messages.map((msg, index) => (
                <div
                  key={msg.id}
                  ref={index === lastUserIndex ? lastUserMessageRef : undefined}
                  className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  {msg.role === "assistant" && (
                    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-cyan-500/25 bg-cyan-500/10 text-cyan-300" aria-hidden="true">
                      <Bot size={15} />
                    </div>
                  )}

                  <div className={msg.role === "user"
                    ? "max-w-[85%] rounded-2xl rounded-tr-sm bg-gradient-to-r from-cyan-500 to-violet-600 px-4 py-2.5 text-white shadow-md shadow-cyan-500/5"
                    : "min-w-0 flex-1 text-gray-100"}
                  >
                    <span className="sr-only">{msg.role === "user" ? "Vos:" : "Stampy:"}</span>
                    <StampyMessageContent content={msg.content} role={msg.role} />

                    {/* Recommendations */}
                    {msg.recommendations && msg.recommendations.length > 0 && (
                      <div className="mt-4 space-y-2">
                        {msg.recommendations.map((rec: any, idx: number) => {
                          const courseId = rec.course_modules?.courses?.slug || rec.course_modules?.courses?.id || "";
                          const courseHref = rec.href || (courseId ? `/cursos/${courseId}` : "/cursos");
                          return (
                            <div key={idx} className="group flex flex-col justify-between gap-3 rounded-xl border border-stampa-border bg-white/[0.03] p-3 sm:flex-row sm:items-center">
                              <div className="min-w-0">
                                <div className="mb-1 flex items-center gap-2">
                                  {rec.courseKind === "workshop" ? (
                                    <Badge className="border border-sky-500/30 bg-sky-500/10 text-sky-300">
                                      Taller
                                    </Badge>
                                  ) : (
                                    <Badge className="border-none bg-white/10 text-gray-300">
                                      {rec.ai_level === "advanced" ? "Avanzado" : rec.ai_level === "intermediate" ? "Intermedio" : "Principiante"}
                                    </Badge>
                                  )}
                                  <span className="truncate text-[10px] font-bold uppercase tracking-wider text-gray-500">{rec.course_modules?.courses?.title}</span>
                                </div>
                                <p className="text-sm font-semibold text-white transition-colors group-hover:text-stampa-orange">{rec.title}</p>
                                {rec.ai_summary && <p className="mt-1 line-clamp-2 text-xs text-gray-500">{rec.ai_summary}</p>}
                              </div>
                              <Link
                                href={courseHref}
                                className="flex min-h-9 shrink-0 items-center justify-center gap-1 rounded-lg border border-stampa-border bg-[#1a1a1a] px-3 text-xs font-semibold text-gray-300 shadow-sm transition-colors hover:border-[#ff6a00]/30 hover:text-stampa-orange"
                              >
                                Abrir curso <ChevronRight size={14} />
                              </Link>
                            </div>
                          )
                        })}
                      </div>
                    )}

                    {/* Action Intent Card */}
                    {msg.actionIntent && (
                      <ActionIntentCard
                        actionIntent={msg.actionIntent}
                        actionRequestId={msg.actionRequestId}
                      />
                    )}

                    {/* Knowledge Tools */}
                    {msg.knowledgeTools && msg.knowledgeTools.length > 0 && !msg.actionIntent && (
                      <div className="mt-4 space-y-2">
                        {msg.knowledgeTools.map((kt: any, idx: number) => (
                          <div key={idx} className="group flex flex-col justify-between gap-3 rounded-xl border border-indigo-500/20 bg-indigo-900/20 p-3 shadow-sm sm:flex-row sm:items-center">
                            <div className="min-w-0">
                              <p className="text-sm font-bold text-indigo-400 transition-colors group-hover:text-indigo-300">{kt.title}</p>
                              {kt.shortDescription && <p className="mt-1 line-clamp-2 text-xs text-indigo-300/80">{kt.shortDescription}</p>}
                            </div>
                            {kt.route && (
                              <Link
                                href={kt.route}
                                className="flex min-h-9 shrink-0 items-center justify-center gap-1 rounded-lg border border-indigo-500/30 bg-[#1a1a1a] px-3 text-xs font-bold text-indigo-400 shadow-sm transition-colors hover:bg-indigo-500/10 hover:text-indigo-300"
                              >
                                Abrir <ChevronRight size={14} />
                              </Link>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Related Tools */}
                    {(() => {
                      if (!msg.relatedTools || msg.relatedTools.length === 0) return null;
                      const filteredTools = msg.relatedTools.filter(t => {
                        const tool = TOOL_MAP[t];
                        if (!tool) return false;
                        if (msg.knowledgeTools?.some(kt => kt.route === tool.href)) return false;
                        return true;
                      });
                      if (filteredTools.length === 0) return null;
                      return (
                        <div className="mt-4 border-t border-stampa-border pt-3">
                          <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-gray-500">También te puede servir:</p>
                          <div className="flex flex-wrap gap-2">
                            {filteredTools.map((t: string) => {
                              const tool = TOOL_MAP[t];
                              const Icon = tool.icon;
                              return (
                                <Link key={t} href={tool.href} className="flex min-h-9 items-center gap-2 rounded-lg border border-stampa-border bg-[#1a1a1a] px-3 text-xs font-bold text-gray-300 shadow-sm transition-colors hover:bg-white/5 hover:text-white">
                                  <Icon size={14} />
                                  {tool.label}
                                </Link>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Feedback UI */}
                    {msg.role === "assistant" && msg.assistantMessageId && conversationId && (
                      <div className="mt-3">
                        <StampyFeedback
                          messageId={msg.assistantMessageId}
                          conversationId={conversationId}
                          source="stampy_page"
                        />
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {loading && (
                <div className="flex justify-start gap-3" role="status">
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-cyan-500/25 bg-cyan-500/10 text-cyan-300" aria-hidden="true">
                    <Bot size={15} />
                  </div>
                  <div className="min-w-0 pt-1">
                    <span className="flex items-center gap-1.5" aria-hidden="true">
                      <span className="h-2 w-2 animate-bounce rounded-full bg-cyan-300 [animation-delay:-0.3s]" />
                      <span className="h-2 w-2 animate-bounce rounded-full bg-cyan-300 [animation-delay:-0.15s]" />
                      <span className="h-2 w-2 animate-bounce rounded-full bg-cyan-300" />
                    </span>
                    <p className="mt-2 text-sm text-gray-400">
                      {slowResponse ? "Sigo armando la respuesta: las respuestas detalladas pueden tardar unos segundos." : "Stampy está pensando…"}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div data-stampy-composer className="mx-auto w-full max-w-3xl shrink-0 pt-3">
            <StampyComposer
              value={input}
              onChange={setInput}
              onSubmit={() => void handleSend(input)}
              loading={loading}
              variant="dock"
            />
            <p className="mt-1.5 text-center text-[10px] text-gray-500">Stampy es un asistente virtual experimental. Revisá los datos importantes.</p>
          </div>
        </>
      )}
    </div>
  );
}

function StampyComposer({
  value,
  onChange,
  onSubmit,
  loading,
  variant,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  loading: boolean;
  variant: "hero" | "dock";
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const maxHeight = variant === "hero" ? 220 : 180;

  // Altura automática según el contenido (sin barras de scroll hasta el máximo).
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
  }, [value, maxHeight]);

  const canSend = value.trim().length > 0 && !loading;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (canSend) onSubmit();
      }}
      className={`relative rounded-2xl border border-stampa-border bg-stampa-surface shadow-lg shadow-black/30 transition-colors focus-within:border-cyan-400/50 focus-within:ring-2 focus-within:ring-cyan-400/15 ${
        variant === "hero" ? "p-3" : "p-2"
      }`}
    >
      <label htmlFor={`stampy-input-${variant}`} className="sr-only">Mensaje para Stampy</label>
      <textarea
        id={`stampy-input-${variant}`}
        ref={textareaRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            if (canSend) onSubmit();
          }
        }}
        placeholder={variant === "hero" ? "Contale a Stampy qué necesitás…" : "Escribí tu mensaje…"}
        rows={variant === "hero" ? 3 : 1}
        autoFocus={variant === "hero"}
        className="block w-full resize-none bg-transparent px-2 py-1.5 pr-12 text-[15px] leading-6 text-white placeholder:text-gray-500 focus:outline-none"
        style={{ maxHeight }}
      />
      <div className="flex items-center justify-between gap-2 pl-2">
        <p className="hidden text-[11px] text-gray-500 sm:block">Enter para enviar · Shift + Enter para nueva línea</p>
        <button
          type="submit"
          disabled={!canSend}
          aria-label="Enviar mensaje"
          className="ml-auto flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-r from-cyan-500 to-violet-600 text-white shadow-sm transition hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ArrowUp size={18} aria-hidden="true" />
        </button>
      </div>
    </form>
  );
}
