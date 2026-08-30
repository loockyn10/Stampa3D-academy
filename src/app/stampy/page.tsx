"use client";

import React, { useState, useRef, useEffect } from "react";
import { Sparkles, Send, Bot, User, Calculator, Archive, Package, Boxes, BookOpen, MessageCircle, Gift, FileText, ChevronRight, Loader2, PenTool } from "lucide-react";
import { askStampyAction } from "./actions";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";

import { StampyFeedback } from "@/components/stampy/StampyFeedback";
import { ActionIntentCard } from "@/components/stampy/ActionIntentCard";
import { createStampyMessageId, createStampyRequestId } from "@/lib/stampy/client-message-id";

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

const QUICK_SUGGESTIONS = [
  "¿Qué filamentos tengo cargados?",
  "Descontame 20g de PLA",
  "Creame un filamento nuevo PLA rojo de 1kg",
  "Creame una impresora Bambu A1 Mini de 350W",
  "Ayudame a solucionar warping",
  "Dame una idea de producto rentable",
];
const MOBILE_QUICK_SUGGESTIONS = QUICK_SUGGESTIONS.slice(0, 3);

const MAIN_CONVERSATION_STORAGE_KEY = "stampy_main_conversation_id";
const LEGACY_CONVERSATION_STORAGE_KEY = "stampy_current_conversation_id";

const TOOL_MAP: Record<string, { label: string; href: string; icon: any }> = {
  "calculadora": { label: "Calculadora de precios", href: "/calculadora", icon: Calculator },
  "presupuestos": { label: "Presupuestos", href: "/presupuestos", icon: FileText },
  "stock": { label: "Stock de material", href: "/stock", icon: Archive },
  "productos": { label: "Productos", href: "/productos", icon: Package },
  "libreria-stl": { label: "Librería STL", href: "/libreria-stl", icon: Boxes },
  "cursos": { label: "Cursos", href: "/cursos", icon: BookOpen },
  "academia": { label: "Academia", href: "/academia", icon: BookOpen },
  "talleres": { label: "Talleres", href: "/talleres", icon: PenTool },
  "comunidad": { label: "Comunidad", href: "/canales", icon: MessageCircle },
  "sorteos": { label: "Sorteos", href: "/sorteos", icon: Gift }
};

export default function StampyPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      role: "assistant",
      content: "Hola, soy Stampy. Te ayudo con impresión 3D, costos y tu taller. ¿Qué querés resolver?"
    }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [conversationResolved, setConversationResolved] = useState(false);
  const [mobileSuggestionsDismissed, setMobileSuggestionsDismissed] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(() =>
    typeof window === "undefined"
      ? null
      : localStorage.getItem(MAIN_CONVERSATION_STORAGE_KEY)
  );
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const requestInFlightRef = useRef(false);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    localStorage.removeItem(LEGACY_CONVERSATION_STORAGE_KEY);
    setConversationId(localStorage.getItem(MAIN_CONVERSATION_STORAGE_KEY));
    setConversationResolved(true);
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  const handleSend = async (text: string) => {
    const safeText = text.trim();
    if (!safeText || loading || requestInFlightRef.current) return;
    requestInFlightRef.current = true;
    setMobileSuggestionsDismissed(true);

    const requestId = createStampyRequestId();
    const userMsg: Message = {
      id: createStampyMessageId(requestId, "user"),
      role: "user",
      content: safeText,
    };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const res = await askStampyAction(safeText, conversationId, {
        source: "page",
        pathname: window.location.pathname + window.location.search
      });
      
      if (res.conversationId && res.conversationId !== conversationId) {
        setConversationId(res.conversationId);
        localStorage.setItem(MAIN_CONVERSATION_STORAGE_KEY, res.conversationId);
      }

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
    setMobileSuggestionsDismissed(false);
    setMessages([{
      id: "new-conversation:assistant",
      role: "assistant",
      content: "Hola de nuevo. ¿En qué te ayudo ahora?"
    }]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend(input);
    }
  };

  const hasUserMessages = messages.some((message) => message.role === "user");
  const showMobileEmptyState =
    conversationResolved &&
    !conversationId &&
    !hasUserMessages &&
    !mobileSuggestionsDismissed &&
    !loading;

  return (
    <div className="stampy-page-shell mx-auto flex max-w-6xl flex-col gap-4 p-4 md:gap-6 md:p-6">
      <div className="flex flex-col mb-1 shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-r from-cyan-500/20 to-violet-500/20 text-cyan-400 border border-cyan-400/20 rounded-xl">
            <Sparkles size={24} />
          </div>
          <div className="flex-1">
            <div className="flex w-full items-center justify-between gap-2">
              <h1 className="min-w-0 text-xl font-bold sm:text-2xl">
                <span className="bg-gradient-to-r from-cyan-300 via-sky-300 to-violet-400 bg-clip-text text-transparent">Stampy</span>
              </h1>
              <button
                onClick={startNewConversation}
                disabled={loading}
                className="shrink-0 rounded-lg border border-stampa-border bg-stampa-surface px-2.5 py-1.5 text-[11px] font-semibold text-gray-300 transition-colors hover:bg-white/5 sm:px-3 sm:text-xs"
              >
                + Nuevo chat
              </button>
            </div>
            <p className="text-xs md:text-sm text-gray-500 mt-1">Contale qué problema tenés y te guía hacia la clase o herramienta correcta.</p>
          </div>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-4 md:gap-6 flex-1 min-h-0">
        
        {/* Chat Area */}
        <div className="flex-1 flex flex-col bg-stampa-bg border border-stampa-border rounded-2xl overflow-hidden shadow-2xl">
          <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
            {showMobileEmptyState && (
              <div className="flex min-h-full items-center justify-center py-2 lg:hidden">
                <div className="flex w-full max-w-xs flex-col items-center text-center">
                  <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full border border-cyan-500/25 bg-cyan-500/10 text-cyan-400">
                    <Bot size={20} />
                  </div>
                  <h2 className="text-sm font-bold text-white">Stampy</h2>
                  <p className="mt-1 text-xs text-gray-400">¿Qué necesitás resolver?</p>
                  <div className="mt-4 grid w-full gap-2">
                    {MOBILE_QUICK_SUGGESTIONS.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => handleSend(suggestion)}
                        disabled={loading}
                        className="min-h-11 rounded-xl border border-stampa-border bg-stampa-surface px-3 py-2 text-left text-xs font-medium text-gray-300 transition-colors hover:border-cyan-400/35 hover:bg-cyan-500/5 hover:text-cyan-200 disabled:opacity-50"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`${showMobileEmptyState ? "hidden lg:flex" : "flex"} gap-4 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                
                {msg.role === "assistant" && (
                  <div className="w-8 h-8 shrink-0 rounded-full bg-cyan-500/10 flex items-center justify-center text-cyan-400 mt-1 shadow-sm border border-cyan-500/20">
                    <Bot size={18} />
                  </div>
                )}
                
                <div className={`max-w-[85%] ${msg.role === "user" ? "bg-gradient-to-r from-cyan-500 to-violet-600 text-white rounded-2xl rounded-tr-sm px-4 py-3 shadow-md shadow-cyan-500/5" : "bg-stampa-surface border border-stampa-border shadow-sm rounded-2xl rounded-tl-sm px-5 py-4"}`}>
                  <p className={`text-sm ${msg.role === "user" ? "text-white" : "text-gray-300"} whitespace-pre-wrap`}>
                    {msg.content}
                  </p>

                  {/* Recommendations */}
                  {msg.recommendations && msg.recommendations.length > 0 && (
                    <div className="mt-4 space-y-3">
                      {msg.recommendations.map((rec: any, idx: number) => {
                        const courseId = rec.course_modules?.courses?.slug || rec.course_modules?.courses?.id || "";
                        const courseHref = rec.href || (courseId ? `/cursos/${courseId}` : "/cursos");
                        return (
                          <div key={idx} className="bg-white/5 border border-stampa-border rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 group">
                            <div>
                              <div className="flex items-center gap-2 mb-1">
                                {rec.courseKind === "workshop" ? (
                                  <Badge className="bg-sky-500/10 border border-sky-500/30 text-sky-300">
                                    Taller
                                  </Badge>
                                ) : (
                                  <Badge className="bg-white/10 border-none text-gray-300">
                                    {rec.ai_level === "advanced" ? "Avanzado" : rec.ai_level === "intermediate" ? "Intermedio" : "Principiante"}
                                  </Badge>
                                )}
                                <span className="text-[10px] text-gray-500 font-bold tracking-wider truncate uppercase">{rec.course_modules?.courses?.title}</span>
                              </div>
                              <p className="text-sm font-semibold text-white group-hover:text-stampa-orange transition-colors">{rec.title}</p>
                              {rec.ai_summary && <p className="text-xs text-gray-500 mt-1 line-clamp-2">{rec.ai_summary}</p>}
                            </div>
                            <Link 
                              href={courseHref}
                              className="shrink-0 flex items-center justify-center gap-1 bg-[#1a1a1a] border border-stampa-border text-gray-300 hover:text-stampa-orange hover:border-[#ff6a00]/30 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors shadow-sm"
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
                    <div className="mt-4 space-y-3">
                      {msg.knowledgeTools.map((kt: any, idx: number) => (
                        <div key={idx} className="bg-indigo-900/20 border border-indigo-500/20 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 group shadow-sm">
                          <div>
                            <p className="text-sm font-bold text-indigo-400 group-hover:text-indigo-300 transition-colors">{kt.title}</p>
                            {kt.shortDescription && <p className="text-xs text-indigo-300/80 mt-1 line-clamp-2">{kt.shortDescription}</p>}
                          </div>
                          {kt.route && (
                            <Link 
                              href={kt.route} 
                              className="shrink-0 flex items-center justify-center gap-1 bg-[#1a1a1a] border border-indigo-500/30 text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors shadow-sm"
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
                      <div className="mt-4 pt-4 border-t border-stampa-border">
                        <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-3">También te puede servir:</p>
                        <div className="flex flex-wrap gap-2">
                          {filteredTools.map((t: string) => {
                            const tool = TOOL_MAP[t];
                            const Icon = tool.icon;
                            return (
                              <Link key={t} href={tool.href} className="flex items-center gap-2 bg-[#1a1a1a] border border-stampa-border text-gray-300 hover:bg-white/5 hover:text-white px-3 py-2 rounded-lg text-xs font-bold transition-colors shadow-sm">
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
                    <div className="mt-4 pt-4 border-t border-stampa-border">
                      <StampyFeedback 
                        messageId={msg.assistantMessageId} 
                        conversationId={conversationId} 
                        source="stampy_page" 
                      />
                    </div>
                  )}
                </div>

                {msg.role === "user" && (
                  <div className="w-8 h-8 shrink-0 rounded-full bg-white/10 flex items-center justify-center text-gray-400 mt-1 shadow-sm">
                    <User size={18} />
                  </div>
                )}
              </div>
            ))}
            
            {loading && (
              <div className="flex gap-4 justify-start">
                <div className="w-8 h-8 shrink-0 rounded-full bg-cyan-500/10 flex items-center justify-center text-cyan-400 mt-1 shadow-sm border border-cyan-500/20">
                  <Bot size={18} />
                </div>
                <div className="bg-stampa-surface border border-stampa-border shadow-sm rounded-2xl rounded-tl-sm px-5 py-4 flex items-center gap-3">
                  <Loader2 size={16} className="animate-spin text-cyan-400" />
                  <p className="text-sm text-gray-400 italic">Stampy está buscando por dónde conviene arrancar...</p>
                </div>
              </div>
            )}
            
            <div ref={messagesEndRef} />
          </div>
          
          <div data-stampy-composer className="p-4 bg-stampa-bg-soft border-t border-stampa-border shrink-0">
            <div className="relative flex items-end">
              <textarea
                value={input}
                onChange={(e) => {
                  const nextInput = e.target.value;
                  setInput(nextInput);
                  if (nextInput.trim()) setMobileSuggestionsDismissed(true);
                }}
                onKeyDown={handleKeyDown}
                placeholder="Preguntale algo a Stampy..."
                className="w-full bg-stampa-surface border border-stampa-border rounded-xl py-3 pl-4 pr-12 text-sm text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-cyan-400/20 focus:border-cyan-400/60 resize-none overflow-y-auto"
                rows={1}
                disabled={loading}
                style={{ minHeight: '52px', maxHeight: '120px' }}
              />
              <button
                onClick={() => handleSend(input)}
                disabled={!input.trim() || loading}
                className="absolute right-2 bottom-2 p-2 bg-gradient-to-r from-cyan-500 to-violet-600 text-white rounded-lg hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
              >
                <Send size={16} />
              </button>
            </div>
            <p className="text-[10px] text-gray-400 mt-2 text-center font-medium">Stampy es un asistente virtual experimental.</p>
          </div>
        </div>

        {/* Quick Suggestions Sidebar */}
        <div className="hidden w-72 shrink-0 lg:block">
          <div className="bg-stampa-surface border border-stampa-border rounded-2xl p-5 shadow-sm">
            <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
              Sugerencias rápidas
            </h3>
            <div className="flex flex-wrap lg:flex-col gap-2">
              {QUICK_SUGGESTIONS.map((sug, i) => (
                <button
                  key={i}
                  onClick={() => handleSend(sug)}
                  disabled={loading}
                  className="text-left text-xs font-medium bg-stampa-bg-soft border border-stampa-border hover:bg-orange-50 hover:border-orange-200 hover:text-orange-700 text-gray-400 px-3 py-2.5 rounded-xl transition-colors"
                >
                  "{sug}"
                </button>
              ))}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
