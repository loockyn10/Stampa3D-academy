import React from "react";
import { createClient } from "@/utils/supabase/server";
import { Bot, User, ArrowLeft, ThumbsUp, ThumbsDown, AlertCircle } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AdminStampyConversationPage({ params }: { params: Promise<{ conversationId: string }> }) {
  const { conversationId } = await params;
  const supabase = await createClient();

  // Get Conversation
  const { data: conversation } = await supabase
    .from("stampy_conversations")
    .select(`
      id,
      title,
      created_at,
      profiles ( email, id )
    `)
    .eq("id", conversationId)
    .single();

  if (!conversation) {
    return notFound();
  }

  // Get Messages
  const { data: messages } = await supabase
    .from("stampy_messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  // Get Feedback
  const { data: feedbackList } = await supabase
    .from("stampy_message_feedback")
    .select("*")
    .eq("conversation_id", conversationId);

  const feedbackByMessageId = feedbackList?.reduce((acc: any, f: any) => {
    acc[f.message_id] = f;
    return acc;
  }, {}) || {};

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Link href="/admin/stampy" className="flex items-center gap-1 text-sm font-medium text-cyan-400 hover:text-cyan-300">
            <ArrowLeft size={14} /> Volver a Stampy Admin
          </Link>
        </div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          Conversación
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Usuario: <span className="text-gray-300 font-medium">{(conversation.profiles as any)?.email || "Desconocido"}</span>
        </p>
        <p className="text-xs text-gray-500 mt-1">
          Iniciada el: {new Date(conversation.created_at).toLocaleString('es-AR')}
        </p>
      </div>

      <div className="bg-[#1a1a1a] border border-stampa-border rounded-xl flex flex-col shadow-xl">
        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
          {messages?.map((msg) => {
            const feedback = feedbackByMessageId[msg.id];
            
            return (
              <div key={msg.id} className={`flex gap-4 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                
                {msg.role === "assistant" && (
                  <div className="w-8 h-8 shrink-0 rounded-full bg-cyan-500/10 flex items-center justify-center text-cyan-400 mt-1 shadow-sm border border-cyan-500/20">
                    <Bot size={18} />
                  </div>
                )}
                
                <div className={`max-w-[85%] ${msg.role === "user" ? "bg-gradient-to-r from-cyan-500 to-violet-600 text-white rounded-2xl rounded-tr-sm px-4 py-3 shadow-md shadow-cyan-500/5" : "bg-stampa-bg border border-stampa-border shadow-sm rounded-2xl rounded-tl-sm px-5 py-4"}`}>
                  <div className={`text-sm ${msg.role === "user" ? "text-white" : "text-gray-300"} whitespace-pre-wrap`}>
                    {msg.content}
                  </div>
                  
                  {msg.role === "assistant" && feedback && (
                    <div className="mt-4 pt-3 border-t border-stampa-border/50">
                      <div className="flex items-start gap-2">
                        {feedback.rating === "positive" ? (
                          <div className="flex flex-col gap-1">
                            <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md border border-emerald-500/20 w-fit">
                              <ThumbsUp size={12} /> Útil
                            </span>
                          </div>
                        ) : (
                          <div className="flex flex-col gap-1.5 w-full">
                            <span className="flex items-center gap-1 text-[11px] font-bold text-red-400 bg-red-500/10 px-2 py-0.5 rounded-md border border-red-500/20 w-fit">
                              <ThumbsDown size={12} /> No me sirvió
                            </span>
                            {(feedback.reason || feedback.comment) && (
                              <div className="bg-black/20 rounded p-2 text-xs border border-white/5 w-full">
                                {feedback.reason && <div className="text-red-300/80 mb-1 font-medium">Motivo: {feedback.reason}</div>}
                                {feedback.comment && <div className="text-gray-400 italic">"{feedback.comment}"</div>}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  
                  {msg.role === "assistant" && msg.metadata?.actionIntent && (
                    <div className="mt-4 pt-3 border-t border-stampa-border/50">
                      <div className="flex items-start gap-2">
                        <div className="flex flex-col gap-2 w-full">
                          <span className="flex items-center gap-1 text-[11px] font-bold text-stampa-orange bg-stampa-orange/10 px-2 py-0.5 rounded-md border border-stampa-orange/20 w-fit">
                            <AlertCircle size={12} /> Acción detectada
                          </span>
                          <div className="bg-black/20 rounded p-2 text-xs border border-white/5 w-full">
                            <div className="text-gray-300 mb-1 font-medium">Type: {msg.metadata.actionIntent.type}</div>
                            {msg.metadata.actionIntent.toolHref && (
                              <div className="text-gray-400">Tool: {msg.metadata.actionIntent.toolHref}</div>
                            )}
                            <div className="text-gray-400 mt-1">Can Execute: false</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {msg.role === "user" && (
                  <div className="w-8 h-8 shrink-0 rounded-full bg-white/10 flex items-center justify-center text-gray-400 mt-1 shadow-sm">
                    <User size={18} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
