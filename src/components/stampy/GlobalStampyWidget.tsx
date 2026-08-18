"use client";

import React, { useState, useRef, useEffect } from "react";
import { Bot, X, Send, Loader2, Minimize2 } from "lucide-react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { askStampyAction, StampyContextPayload } from "@/app/stampy/actions";
import { getStaticStampyPageContext } from "@/lib/stampy/static-page-contexts";
import { StampyPageContext } from "@/lib/stampy/page-context";
import { useStampyContext } from "@/components/stampy/StampyContextProvider";

type Message = {
  role: "user" | "assistant";
  content: string;
};

// Routes where GlobalStampyWidget must NOT appear
const HIDDEN_ON: string[] = [
  "/login",
  "/registro",
  "/landing",
  "/verificar-email",
  "/recuperar-password",
  "/actualizar-password",
  "/auth",
  "/sin-acceso",
  "/pago/estado",
  "/salir",
  // /cursos/[id] is hidden so StampyLessonChat can be used instead
  // We detect this via /cursos/ prefix below
];

function shouldHide(pathname: string): boolean {
  return HIDDEN_ON.some((p) => pathname.startsWith(p));
}

export function GlobalStampyWidget() {
  const pathname = usePathname();
  const { stampyContext } = useStampyContext();

  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: "Hola, soy Stampy. Contame qué problema tenés con tu impresión, tus costos o tu taller, y te ayudo a encontrar por dónde seguir.",
    },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [pageCtx, setPageCtx] = useState<StampyPageContext | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (pathname && !shouldHide(pathname)) {
      const staticCtx = getStaticStampyPageContext(pathname);
      if (staticCtx) {
        setPageCtx({
          source: "page",
          pathname,
          pageTitle: staticCtx.title,
          pageDescription: staticCtx.context,
          suggestedQuestions: staticCtx.suggestedQuestions || []
        });
      } else {
        setPageCtx(null);
      }
    }
  }, [pathname]);

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isOpen]);

  if (!mounted) return null;
  if (shouldHide(pathname || "")) return null;

  // On /cursos/[id], use StampyLessonChat which has full lesson context — hide global widget
  const isCourseDetail = /^\/cursos\/[^/]+/.test(pathname || "");
  if (isCourseDetail) return null;

  const defaultCtx: StampyContextPayload = {
    source: "page",
    pathname: pathname || ""
  };
  
  const currentCtx = pageCtx || defaultCtx;
  const effectiveContext = stampyContext ?? currentCtx;

  const handleSend = async (forcedInput?: string) => {
    const text = forcedInput || input.trim();
    if (!text || isLoading) return;

    const userMsg: Message = { role: "user", content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setIsLoading(true);

    const conversationContext = newMessages.slice(-6).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    const removeUndefined = (obj: any) => {
      return Object.fromEntries(Object.entries(obj).filter(([_, v]) => v !== undefined));
    };

    try {
      const response = await askStampyAction(
        userMsg.content,
        conversationContext,
        removeUndefined(effectiveContext) as StampyContextPayload
      );
      setMessages([
        ...newMessages,
        {
          role: "assistant",
          content: response.answer || "Hubo un error al generar la respuesta.",
        },
      ]);
    } catch {
      setMessages([
        ...newMessages,
        {
          role: "assistant",
          content: "Hubo un error de conexión. Por favor, probá de nuevo.",
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return createPortal(
    <>
      {/* Botón Flotante */}
      {!isOpen && (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 z-[100] flex h-14 w-14 items-center justify-center rounded-full border border-cyan-300/40 bg-gradient-to-r from-cyan-400 to-violet-500 text-white shadow-2xl shadow-cyan-500/25 transition hover:brightness-110 hover:scale-105 active:scale-95"
          title="Preguntarle a Stampy"
        >
          <Bot size={28} className="animate-soft-pulse" />
        </button>
      )}

      {/* Panel */}
      {isOpen && (
        <aside className="fixed inset-x-3 bottom-3 z-[100] h-[82dvh] max-h-[82dvh] overflow-hidden rounded-2xl border border-cyan-400/30 bg-stampa-bg/95 shadow-2xl shadow-cyan-500/15 backdrop-blur-xl md:inset-auto md:bottom-6 md:right-6 md:h-[80dvh] md:max-h-[760px] md:w-[420px] md:max-w-[calc(100vw-3rem)] animate-in fade-in zoom-in-95 slide-in-from-bottom-2">
          <div className="flex h-full min-h-0 flex-col">

            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-stampa-border bg-white/[0.03] shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-cyan-500/10 text-cyan-400 rounded-xl border border-cyan-400/25">
                  <Bot size={20} />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-white flex items-center gap-2">
                    Stampy{" "}
                    <span className="text-[10px] font-bold bg-gradient-to-r from-cyan-500/20 to-violet-500/20 text-cyan-300 px-1.5 py-0.5 rounded-md uppercase tracking-wider border border-cyan-400/20 animate-soft-pulse">
                      IA
                    </span>
                  </h2>
                  <p className="text-[11px] text-gray-500 truncate max-w-[200px]">
                    {effectiveContext.source === "lesson"
                      ? `Clase: ${(effectiveContext as any).lessonTitle || ""}`
                      : `Pantalla: ${currentCtx.pageTitle}`}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="text-gray-400 hover:text-white transition-colors p-2 bg-white/5 border border-stampa-border rounded-full hover:bg-white/10 hover:border-cyan-400/40"
              >
                <X size={18} />
              </button>
            </div>

            {/* Messages */}
            <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-4 overscroll-contain">
              {messages.map((m, idx) => (
                <div
                  key={idx}
                  className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  {m.role === "assistant" && (
                    <div className="w-7 h-7 shrink-0 rounded-full bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 mt-0.5 mr-2">
                      <Bot size={14} />
                    </div>
                  )}
                  <div
                    className={`max-w-[80%] rounded-2xl p-3 text-sm ${
                      m.role === "user"
                        ? "bg-gradient-to-r from-cyan-500 to-violet-600 text-white rounded-tr-sm shadow-sm"
                        : "bg-[#1a1a1a] border border-stampa-border text-gray-200 rounded-tl-sm"
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              ))}
              
              {/* Suggested Questions */}
              {!isLoading && messages.length === 1 && currentCtx.suggestedQuestions && currentCtx.suggestedQuestions.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-2 pl-9">
                  {currentCtx.suggestedQuestions.map((sq, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleSend(sq)}
                      className="px-3 py-1.5 text-xs font-medium text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 rounded-full transition-colors text-left"
                    >
                      {sq}
                    </button>
                  ))}
                </div>
              )}

              {isLoading && (
                <div className="flex justify-start">
                  <div className="w-7 h-7 shrink-0 rounded-full bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 mt-0.5 mr-2">
                    <Bot size={14} />
                  </div>
                  <div className="bg-[#1a1a1a] border border-stampa-border text-gray-400 rounded-2xl rounded-tl-sm p-3 text-sm flex items-center gap-2">
                    <Loader2 size={14} className="animate-spin text-cyan-400" />
                    <span>Pensando...</span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="p-4 bg-stampa-bg/95 border-t border-stampa-border shrink-0">
              <div className="relative flex items-center">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSend()}
                  placeholder="Preguntale algo a Stampy..."
                  className="w-full bg-white/5 border border-stampa-border text-neutral-100 text-sm rounded-xl py-3 pl-4 pr-12 focus:outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20 transition-all duration-200 placeholder:text-gray-500"
                  disabled={isLoading}
                />
                <button
                  onClick={() => handleSend()}
                  disabled={isLoading || !input.trim()}
                  className="absolute right-2 p-2 bg-gradient-to-r from-cyan-500 to-violet-600 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:brightness-110 transition-colors"
                >
                  <Send size={16} />
                </button>
              </div>
            </div>
          </div>
        </aside>
      )}

      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-stampa-bg/60 z-[99] sm:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}
    </>,
    document.body
  );
}
