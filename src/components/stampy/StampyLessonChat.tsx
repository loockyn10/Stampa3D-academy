"use client";

import React, { useState, useRef, useEffect } from "react";
import { Bot, X, Send, Loader2 } from "lucide-react";
import { askStampyAction, StampyContextPayload } from "@/app/stampy/actions";
import { createPortal } from "react-dom";

interface StampyLessonChatProps {
  courseTitle: string;
  moduleTitle: string;
  lesson: {
    id: string;
    title: string;
    description?: string;
    ai_summary?: string;
    ai_topics?: string[];
    ai_problems?: string[];
    ai_level?: string;
    ai_related_tool?: string;
    transcript?: string; // Pendiente
  };
}

type Message = {
  role: "user" | "assistant";
  content: string;
};

export function StampyLessonChat({ courseTitle, moduleTitle, lesson }: StampyLessonChatProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: "Estoy viendo esta clase con vos. Preguntame lo que no se entienda y te lo bajo a tierra."
    }
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
    }
  }, [messages, isOpen]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMsg: Message = { role: "user", content: input.trim() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setIsLoading(true);

    const context: StampyContextPayload = {
      source: "lesson",
      courseTitle,
      moduleTitle,
      lessonId: lesson.id,
      lessonTitle: lesson.title,
      lessonDescription: lesson.description,
      lessonSummary: lesson.ai_summary,
      lessonTopics: lesson.ai_topics,
      lessonProblems: lesson.ai_problems,
      lessonLevel: lesson.ai_level,
      relatedTool: lesson.ai_related_tool,
      transcript: lesson.transcript,
      pathname: window.location.pathname + window.location.search
    };

    const removeUndefined = (obj: any) => {
      return Object.fromEntries(Object.entries(obj).filter(([_, v]) => v !== undefined));
    };

    try {
      const response = await askStampyAction(userMsg.content, conversationId, removeUndefined(context) as StampyContextPayload);
      if (response.conversationId && response.conversationId !== conversationId) {
        setConversationId(response.conversationId);
      }
      setMessages([...newMessages, { role: "assistant", content: response.answer || "Hubo un error al generar la respuesta." }]);
    } catch (err) {
      setMessages([...newMessages, { role: "assistant", content: "Hubo un error de conexión con mi servidor. Por favor, probá de nuevo." }]);
    } finally {
      setIsLoading(false);
    }
  };

  if (!mounted) return null;

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

      {/* Panel Lateral */}
      {isOpen && (
        <aside 
          className="fixed inset-x-3 bottom-3 z-[100] h-[82dvh] max-h-[82dvh] overflow-hidden rounded-2xl border border-cyan-400/30 bg-stampa-bg/95 shadow-2xl shadow-cyan-500/15 backdrop-blur-xl md:inset-auto md:bottom-6 md:right-6 md:h-[80dvh] md:max-h-[760px] md:w-[420px] md:max-w-[calc(100vw-3rem)] animate-in fade-in zoom-in-95 slide-in-from-bottom-2"
        >
          <div className="flex h-full min-h-0 flex-col">
            {/* Cabecera */}
            <div className="flex items-center justify-between p-4 border-b border-stampa-border bg-white/[0.03] shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-cyan-500/10 text-cyan-400 rounded-xl border border-cyan-400/25">
                  <Bot size={20} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    Stampy <span className="text-[10px] font-bold bg-gradient-to-r from-cyan-500/20 to-violet-500/20 text-cyan-300 px-1.5 py-0.5 rounded-md uppercase tracking-wider border border-cyan-400/20 animate-soft-pulse">IA</span>
                  </h3>
                  <p className="text-xs text-gray-400 max-w-[200px] truncate">Contexto: {lesson.title}</p>
                </div>
              </div>
              <button 
                onClick={() => setIsOpen(false)} 
                className="text-gray-400 hover:text-white transition-colors p-2 bg-white/5 border border-stampa-border rounded-full hover:bg-white/10 hover:border-cyan-400/40"
              >
                <X size={18} />
              </button>
            </div>

            {/* Mensajes */}
            <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-4 overscroll-contain">
              {messages.map((m, idx) => (
                <div key={idx} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div 
                    className={`max-w-[85%] rounded-2xl p-3 text-sm ${
                      m.role === 'user' 
                        ? 'bg-gradient-to-r from-cyan-500 to-violet-600 text-white rounded-tr-sm shadow-sm' 
                        : 'bg-[#1a1a1a] border border-stampa-border text-gray-200 rounded-tl-sm'
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="flex justify-start animate-slide-up">
                  <div className="bg-[#1a1a1a] border border-stampa-border text-gray-400 rounded-2xl rounded-tl-sm p-3 text-sm flex items-center gap-2">
                    <Loader2 size={14} className="animate-spin text-cyan-400" />
                    <span>Stampy está revisando la clase...</span>
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
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSend()}
                  placeholder="Preguntale algo sobre esta clase..."
                  className="w-full bg-white/5 border border-stampa-border text-neutral-100 text-sm rounded-xl py-3 pl-4 pr-12 focus:outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20 transition-all duration-200 placeholder:text-gray-500"
                  disabled={isLoading}
                />
                <button
                  onClick={handleSend}
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

      {/* Overlay mobile */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-stampa-bg/60 z-40 sm:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}
    </>,
    document.body
  );
}
