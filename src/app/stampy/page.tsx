"use client";

import React, { useState, useRef, useEffect } from "react";
import { Sparkles, Send, Bot, User, Calculator, Archive, Package, Boxes, BookOpen, MessageCircle, Gift, FileText, ChevronRight, Loader2 } from "lucide-react";
import { askStampyAction } from "./actions";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";

interface Message {
  id: string;
  role: "user" | "stampy";
  content: string;
  recommendations?: any[];
  relatedTools?: string[];
}

const QUICK_SUGGESTIONS = [
  "Se me levantan las esquinas",
  "No sé cuánto cobrar",
  "La primera capa no pega",
  "Quiero hacer un presupuesto",
  "No sé qué filamento usar",
  "Tengo problemas con el slicer",
  "Quiero organizar mi stock"
];

const TOOL_MAP: Record<string, { label: string; href: string; icon: any }> = {
  "calculadora": { label: "Calculadora de precios", href: "/calculadora", icon: Calculator },
  "presupuestos": { label: "Presupuestos", href: "/presupuestos", icon: FileText },
  "stock": { label: "Stock de material", href: "/stock", icon: Archive },
  "productos": { label: "Productos", href: "/productos", icon: Package },
  "libreria-stl": { label: "Librería STL", href: "/libreria-stl", icon: Boxes },
  "cursos": { label: "Cursos", href: "/cursos", icon: BookOpen },
  "comunidad": { label: "Comunidad", href: "/telegram", icon: MessageCircle },
  "sorteos": { label: "Sorteos", href: "/sorteos", icon: Gift }
};

export default function StampyPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      role: "stampy",
      content: "Hola, soy Stampy. Contame qué estás intentando imprimir, qué problema te apareció o qué querés mejorar, y te voy a recomendar por dónde seguir dentro de la academia."
    }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  const handleSend = async (text: string) => {
    if (!text.trim() || loading) return;

    const userMsg: Message = { id: Date.now().toString(), role: "user", content: text };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const res = await askStampyAction(text);
      if (res.error) {
        setMessages(prev => [...prev, { id: Date.now().toString(), role: "stampy", content: res.error || "Error al comunicarse con Stampy." }]);
      } else {
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          role: "stampy",
          content: res.answer || "",
          recommendations: res.recommendations,
          relatedTools: res.relatedTools
        }]);
      }
    } catch (e) {
      setMessages(prev => [...prev, { id: Date.now().toString(), role: "stampy", content: "No pude buscar recomendaciones en este momento. Probá de nuevo." }]);
    }
    setLoading(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend(input);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-theme(spacing.20))] md:h-[calc(100vh-theme(spacing.10))] max-w-6xl mx-auto p-4 md:p-6 gap-6">
      <div className="flex flex-col mb-2 shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-orange-100 text-orange-600 rounded-xl">
            <Sparkles size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
              Stampy
              <span className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold bg-purple-50 text-purple-700 border-purple-200">Asistente de la academia</span>
            </h1>
            <p className="text-sm text-gray-500 mt-1">Contale qué problema tenés y te va a orientar hacia la clase o herramienta correcta.</p>
          </div>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6 flex-1 min-h-0">
        
        {/* Chat Area */}
        <div className="flex-1 flex flex-col bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6 bg-gray-50/50">
            {messages.map((msg) => (
              <div key={msg.id} className={`flex gap-4 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                
                {msg.role === "stampy" && (
                  <div className="w-8 h-8 shrink-0 rounded-full bg-orange-100 flex items-center justify-center text-orange-600 mt-1 shadow-sm">
                    <Bot size={18} />
                  </div>
                )}
                
                <div className={`max-w-[85%] ${msg.role === "user" ? "bg-orange-600 text-white rounded-2xl rounded-tr-sm px-4 py-3 shadow-md" : "bg-white border border-gray-100 shadow-sm rounded-2xl rounded-tl-sm px-5 py-4"}`}>
                  <p className={`text-sm ${msg.role === "user" ? "text-white" : "text-gray-700"} whitespace-pre-wrap`}>
                    {msg.content}
                  </p>

                  {/* Recommendations */}
                  {msg.recommendations && msg.recommendations.length > 0 && (
                    <div className="mt-4 space-y-3">
                      {msg.recommendations.map((rec: any, idx: number) => {
                        const courseId = rec.course_modules?.courses?.slug || rec.course_modules?.courses?.id || "";
                        return (
                          <div key={idx} className="bg-gray-50 border border-gray-200 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 group">
                            <div>
                              <div className="flex items-center gap-2 mb-1">
                                <Badge tone={rec.ai_level === "advanced" ? "dark" : rec.ai_level === "intermediate" ? "orange" : "gray"}>
                                  {rec.ai_level === "advanced" ? "Avanzado" : rec.ai_level === "intermediate" ? "Intermedio" : "Principiante"}
                                </Badge>
                                <span className="text-[10px] text-gray-400 font-bold tracking-wider truncate uppercase">{rec.course_modules?.courses?.title}</span>
                              </div>
                              <p className="text-sm font-semibold text-gray-900 group-hover:text-orange-600 transition-colors">{rec.title}</p>
                              {rec.ai_summary && <p className="text-xs text-gray-500 mt-1 line-clamp-2">{rec.ai_summary}</p>}
                            </div>
                            <Link 
                              href={courseId ? `/cursos/${courseId}` : "/cursos"} 
                              className="shrink-0 flex items-center justify-center gap-1 bg-white border border-gray-200 text-gray-700 hover:text-orange-600 hover:border-orange-200 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors shadow-sm"
                            >
                              Ver clase <ChevronRight size={14} />
                            </Link>
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {/* Related Tools */}
                  {msg.relatedTools && msg.relatedTools.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-gray-100">
                      <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-3">También te puede servir:</p>
                      <div className="flex flex-wrap gap-2">
                        {msg.relatedTools.map((t: string) => {
                          const tool = TOOL_MAP[t];
                          if (!tool) return null;
                          const Icon = tool.icon;
                          return (
                            <Link key={t} href={tool.href} className="flex items-center gap-2 bg-orange-50 border border-orange-100 text-orange-700 hover:bg-orange-100 px-3 py-2 rounded-lg text-xs font-bold transition-colors shadow-sm">
                              <Icon size={14} />
                              Ir a {tool.label}
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {msg.role === "user" && (
                  <div className="w-8 h-8 shrink-0 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 mt-1 shadow-sm">
                    <User size={18} />
                  </div>
                )}
              </div>
            ))}
            
            {loading && (
              <div className="flex gap-4 justify-start">
                <div className="w-8 h-8 shrink-0 rounded-full bg-orange-100 flex items-center justify-center text-orange-600 mt-1 shadow-sm">
                  <Bot size={18} />
                </div>
                <div className="bg-white border border-gray-100 shadow-sm rounded-2xl rounded-tl-sm px-5 py-4 flex items-center gap-3">
                  <Loader2 size={16} className="animate-spin text-orange-500" />
                  <p className="text-sm text-gray-500 italic">Stampy está buscando la mejor clase para vos...</p>
                </div>
              </div>
            )}
            
            <div ref={messagesEndRef} />
          </div>
          
          <div className="p-4 bg-white border-t border-gray-200 shrink-0">
            <div className="relative flex items-end">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Preguntale algo a Stampy..."
                className="w-full bg-gray-50 border border-gray-200 rounded-xl py-3 pl-4 pr-12 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent resize-none overflow-y-auto"
                rows={1}
                disabled={loading}
                style={{ minHeight: '52px', maxHeight: '120px' }}
              />
              <button
                onClick={() => handleSend(input)}
                disabled={!input.trim() || loading}
                className="absolute right-2 bottom-2 p-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
              >
                <Send size={16} />
              </button>
            </div>
            <p className="text-[10px] text-gray-400 mt-2 text-center font-medium">Stampy es un asistente virtual. No utiliza un modelo avanzado por ahora, solo cruza palabras clave.</p>
          </div>
        </div>

        {/* Quick Suggestions Sidebar */}
        <div className="w-full lg:w-72 shrink-0">
          <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
            <h3 className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-2">
              Sugerencias rápidas
            </h3>
            <div className="flex flex-wrap lg:flex-col gap-2">
              {QUICK_SUGGESTIONS.map((sug, i) => (
                <button
                  key={i}
                  onClick={() => setInput(sug)}
                  disabled={loading}
                  className="text-left text-xs font-medium bg-gray-50 border border-gray-100 hover:bg-orange-50 hover:border-orange-200 hover:text-orange-700 text-gray-600 px-3 py-2.5 rounded-xl transition-colors"
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
