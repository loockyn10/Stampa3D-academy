"use client";

import React, { useState, useRef, useEffect } from "react";
import { Bot, X, Send, Loader2, Sparkles } from "lucide-react";
import { askStampyAction, StampyContextPayload } from "@/app/stampy/actions";
import { Card } from "@/components/ui/card";

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
  const messagesEndRef = useRef<HTMLDivElement>(null);

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
      transcript: lesson.transcript
    };

    const conversationContext = newMessages.slice(-6);

    try {
      const response = await askStampyAction(userMsg.content, conversationContext, context);
      setMessages([...newMessages, { role: "assistant", content: response.answer || "Hubo un error al generar la respuesta." }]);
    } catch (err) {
      setMessages([...newMessages, { role: "assistant", content: "Hubo un error de conexión con mi servidor. Por favor, probá de nuevo." }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      {/* Botón Flotante */}
      <button
        onClick={() => setIsOpen(true)}
        className={`fixed bottom-6 right-6 z-40 flex items-center justify-center w-14 h-14 bg-orange-500 text-white rounded-full shadow-lg shadow-orange-500/20 hover:bg-orange-600 hover:scale-105 active:scale-95 transition-all duration-200 border border-orange-500/30 ${isOpen ? 'hidden' : ''}`}
        title="Preguntarle a Stampy"
      >
        <Bot size={28} className="animate-soft-pulse" />
      </button>

      {/* Panel Lateral */}
      <div 
        className={`fixed inset-0 md:inset-auto md:right-6 md:top-20 md:bottom-6 md:w-[420px] z-50 bg-neutral-950/95 border-l md:border border-white/10 md:border-orange-500/30 shadow-2xl md:shadow-orange-500/10 md:rounded-2xl backdrop-blur-xl flex flex-col transition-transform duration-300 ease-in-out transform ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {/* Cabecera */}
        <div className="flex items-center justify-between p-4 border-b border-white/10 bg-white/[0.03] shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-orange-500/20 text-orange-400 rounded-xl border border-orange-500/30">
              <Bot size={20} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                Stampy <span className="text-[10px] font-bold bg-orange-500/20 text-orange-400 px-1.5 py-0.5 rounded-md uppercase tracking-wider animate-soft-pulse">IA</span>
              </h3>
              <p className="text-xs text-gray-400 max-w-[200px] truncate">Contexto: {lesson.title}</p>
            </div>
          </div>
          <button onClick={() => setIsOpen(false)} className="text-gray-400 hover:text-white transition-colors p-2 bg-white/5 rounded-full hover:bg-white/10">
            <X size={18} />
          </button>
        </div>

        {/* Mensajes */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 overscroll-contain">
          {messages.map((m, idx) => (
            <div key={idx} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div 
                className={`max-w-[85%] rounded-2xl p-3 text-sm ${
                  m.role === 'user' 
                    ? 'bg-orange-500 text-white rounded-tr-sm shadow-sm' 
                    : 'bg-[#1a1a1a] border border-white/10 text-gray-200 rounded-tl-sm'
                }`}
              >
                {m.content}
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex justify-start animate-slide-up">
              <div className="bg-[#1a1a1a] border border-white/10 text-gray-400 rounded-2xl rounded-tl-sm p-3 text-sm flex items-center gap-2">
                <Loader2 size={14} className="animate-spin text-orange-500" />
                <span>Stampy está revisando la clase...</span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="p-4 bg-neutral-950/95 border-t border-white/10 shrink-0">
          <div className="relative flex items-center">
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSend()}
              placeholder="Preguntale algo sobre esta clase..."
              className="w-full bg-white/5 border border-white/10 text-neutral-100 text-sm rounded-xl py-3 pl-4 pr-12 focus:outline-none focus:border-orange-500/60 focus:ring-2 focus:ring-orange-500/20 transition-all duration-200 placeholder:text-neutral-500"
              disabled={isLoading}
            />
            <button
              onClick={handleSend}
              disabled={isLoading || !input.trim()}
              className="absolute right-2 p-2 bg-orange-500 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-orange-600 transition-colors"
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Overlay mobile */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/60 z-40 sm:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}
    </>
  );
}
