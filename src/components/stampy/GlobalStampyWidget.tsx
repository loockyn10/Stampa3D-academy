"use client";

import React, { useState, useRef, useEffect, Suspense } from "react";
import { Bot, X, Send, Loader2 } from "lucide-react";
import { createPortal } from "react-dom";
import { usePathname, useSearchParams } from "next/navigation";
import { askStampyAction, StampyContextPayload } from "@/app/stampy/actions";
import { getStaticStampyPageContext } from "@/lib/stampy/static-page-contexts";
import { StampyPageContext } from "@/lib/stampy/page-context";
import { useStampyContext } from "@/components/stampy/StampyContextProvider";
import { StampyFeedback } from "@/components/stampy/StampyFeedback";
import { ActionIntentCard } from "@/components/stampy/ActionIntentCard";
import { createStampyMessageId, createStampyRequestId } from "@/lib/stampy/client-message-id";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  assistantMessageId?: string | null;
  actionIntent?: any;
  actionRequestId?: string | null;
};

const WIDGET_CONVERSATION_STORAGE_KEY = "stampy_widget_conversation_id";

const WIDGET_WELCOME_MESSAGE: Message = {
  id: "global-welcome:assistant",
  role: "assistant",
  content: "Hola, soy Stampy. Te ayudo con impresión 3D, costos y esta pantalla. ¿Qué querés resolver?",
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
];

function shouldHide(pathname: string): boolean {
  return HIDDEN_ON.some((p) => pathname.startsWith(p));
}

function StampyWidgetContent() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const fullPathname = pathname + (searchParams?.toString() ? `?${searchParams.toString()}` : "");

  const { stampyContext } = useStampyContext();

  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([WIDGET_WELCOME_MESSAGE]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(() =>
    typeof window === "undefined"
      ? null
      : localStorage.getItem(WIDGET_CONVERSATION_STORAGE_KEY)
  );
  const [pageCtx, setPageCtx] = useState<StampyPageContext | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const requestInFlightRef = useRef(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (pathname && !shouldHide(pathname)) {
      const staticCtx = getStaticStampyPageContext(pathname);
      if (staticCtx) {
        setPageCtx({
          source: "page",
          pathname: fullPathname,
          pageTitle: staticCtx.title,
          pageDescription: staticCtx.context,
          suggestedQuestions: staticCtx.suggestedQuestions || []
        });
      } else {
        setPageCtx(null);
      }
    }
  }, [pathname, fullPathname]);

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
    pathname: fullPathname || "",
    pageTitle: "Academia",
    suggestedQuestions: [
      "¿Qué puedo hacer en esta pantalla?",
      "¿Qué filamentos tengo cargados?",
      "Ayudame a solucionar warping",
      "Dame una idea de producto rentable",
    ],
  };
  
  const currentCtx = pageCtx || defaultCtx;
  const effectiveContext = stampyContext ?? currentCtx;
  const quickSuggestions =
    "suggestedQuestions" in effectiveContext &&
    Array.isArray(effectiveContext.suggestedQuestions)
      ? effectiveContext.suggestedQuestions.slice(0, 4)
      : [];

  const handleSend = async (forcedInput?: string) => {
    const text = (forcedInput || input).trim();
    if (!text || isLoading || requestInFlightRef.current) return;
    requestInFlightRef.current = true;

    const requestId = createStampyRequestId();
    const userMsg: Message = {
      id: createStampyMessageId(requestId, "user"),
      role: "user",
      content: text,
    };
    setMessages((current) => [...current, userMsg]);
    setInput("");
    setIsLoading(true);
    const removeUndefined = (obj: any) => {
      return Object.fromEntries(Object.entries(obj).filter(([_, v]) => v !== undefined));
    };

    try {
      const response = await askStampyAction(
        userMsg.content,
        conversationId,
        removeUndefined(effectiveContext) as StampyContextPayload
      );
      if (response.conversationId && response.conversationId !== conversationId) {
        setConversationId(response.conversationId);
        localStorage.setItem(WIDGET_CONVERSATION_STORAGE_KEY, response.conversationId);
      }
      setMessages((current) => [...current, {
        id: createStampyMessageId(requestId, "assistant"),
        role: "assistant", 
        content: response.answer || "No pude responder esta vez. Probá de nuevo.",
        assistantMessageId: response.assistantMessageId,
        actionIntent: response.actionIntent,
        actionRequestId: response.actionRequestId
      }]);
    } catch {
      setMessages((current) => [...current,
        {
          id: createStampyMessageId(requestId, "assistant"),
          role: "assistant",
          content: "Algo falló al procesarlo. No hice ningún cambio. Probá de nuevo.",
        },
      ]);
    } finally {
      requestInFlightRef.current = false;
      setIsLoading(false);
    }
  };

  const startNewConversation = () => {
    if (requestInFlightRef.current) return;
    setConversationId(null);
    localStorage.removeItem(WIDGET_CONVERSATION_STORAGE_KEY);
    setMessages([WIDGET_WELCOME_MESSAGE]);
    setInput("");
  };

  return createPortal(
    <>
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

      {isOpen && (
        <aside className="fixed inset-x-3 bottom-3 z-[100] h-[82dvh] max-h-[82dvh] overflow-hidden rounded-2xl border border-cyan-400/30 bg-stampa-bg/95 shadow-2xl shadow-cyan-500/15 backdrop-blur-xl md:inset-auto md:bottom-6 md:right-6 md:h-[80dvh] md:max-h-[760px] md:w-[420px] md:max-w-[calc(100vw-3rem)] animate-in fade-in zoom-in-95 slide-in-from-bottom-2">
          <div className="flex h-full min-h-0 flex-col">
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
                      : `Pantalla: ${currentCtx.pageTitle || "Academia"}`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={startNewConversation}
                  disabled={isLoading}
                  className="rounded-lg border border-stampa-border bg-white/5 px-2.5 py-1.5 text-[11px] font-semibold text-gray-300 transition-colors hover:bg-white/10 disabled:opacity-50"
                >
                  Nueva conversación
                </button>
                <button
                  onClick={() => setIsOpen(false)}
                  className="text-gray-400 hover:text-white transition-colors p-2 bg-white/5 border border-stampa-border rounded-full hover:bg-white/10 hover:border-cyan-400/40"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-4 overscroll-contain">
              {messages.map((m) => (
                <div
                  key={m.id}
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
                    <div className="whitespace-pre-wrap">{m.content}</div>

                    {m.actionIntent && (
                      <div className="mt-3">
                        <ActionIntentCard 
                          actionIntent={m.actionIntent} 
                          actionRequestId={m.actionRequestId} 
                        />
                      </div>
                    )}

                    {m.role === 'assistant' && m.assistantMessageId && conversationId && (
                      <div className="mt-2 pt-2 border-t border-stampa-border/50">
                        <StampyFeedback 
                          messageId={m.assistantMessageId} 
                          conversationId={conversationId} 
                          source="global_widget" 
                        />
                      </div>
                    )}
                  </div>
                </div>
              ))}
              
              {!isLoading && messages.length === 1 && quickSuggestions.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-2 pl-9">
                  {quickSuggestions.map((sq, idx) => (
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

export function GlobalStampyWidget() {
  return (
    <Suspense fallback={null}>
      <StampyWidgetContent />
    </Suspense>
  );
}
