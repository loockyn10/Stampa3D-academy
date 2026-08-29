import React from "react";
import { createClient } from "@/utils/supabase/server";
import { MessageSquare, AlertCircle, BarChart3, Bot, ThumbsUp, ThumbsDown, Activity } from "lucide-react";
import Link from "next/link";
import { IndexationPanel } from "./indexation-panel";

export const dynamic = "force-dynamic";

export default async function AdminStampyDashboardPage() {
  const supabase = await createClient();

  // Basic Stats (Last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const isoThirtyDays = thirtyDaysAgo.toISOString();

  const oneDayAgo = new Date();
  oneDayAgo.setDate(oneDayAgo.getDate() - 1);
  const isoOneDay = oneDayAgo.toISOString();

  const [
    messagesResult,
    conversationsResult,
    errorsResult,
    feedbackResult,
    recentConversationsResult,
    recentFeedbackResult,
    actionsResult,
    recentActionsResult,
    chunksResult,
  ] = await Promise.all([
    supabase
      .from("stampy_messages")
      .select("id", { count: "exact", head: true })
      .gte("created_at", isoThirtyDays),
    supabase
      .from("stampy_conversations")
      .select("id", { count: "exact", head: true })
      .gte("created_at", isoThirtyDays),
    supabase
      .from("stampy_usage_logs")
      .select("id", { count: "exact", head: true })
      .in("status", ["error", "blocked"])
      .gte("created_at", isoThirtyDays),
    supabase
      .from("stampy_message_feedback")
      .select("rating")
      .gte("created_at", isoOneDay),
    supabase
      .from("stampy_conversations")
      .select("id, title, last_message_at, profiles ( email )")
      .order("last_message_at", { ascending: false })
      .limit(15),
    supabase
      .from("stampy_message_feedback")
      .select("id, rating, reason, comment, source, conversation_id, created_at, profiles ( email )")
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("stampy_action_requests")
      .select("status")
      .gte("created_at", isoOneDay),
    supabase
      .from("stampy_action_requests")
      .select("id, action_type, status, tool_label, created_at, conversation_id, profiles ( email )")
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("stampy_knowledge_chunks")
      .select("source_type")
      .eq("is_active", true),
  ]);

  const { count: msgsCount } = messagesResult;
  const { count: convsCount } = conversationsResult;
  const { count: errsCount } = errorsResult;
  const { data: feedback24h } = feedbackResult;
  const { data: recentConvs } = recentConversationsResult;
  const { data: recentFeedback } = recentFeedbackResult;
  const { data: actions24h } = actionsResult;
  const { data: recentActions } = recentActionsResult;
  const { data: rawChunks } = chunksResult;

  const pos24h = feedback24h?.filter((f) => f.rating === "positive").length || 0;
  const neg24h = feedback24h?.filter((f) => f.rating === "negative").length || 0;
  const total24h = pos24h + neg24h;
  const ratio24h = total24h > 0 ? Math.round((pos24h / total24h) * 100) : 0;

  const actionsCount = actions24h?.length || 0;
  const openedCount = actions24h?.filter(a => a.status === "opened_tool").length || 0;
  const cancelledCount = actions24h?.filter(a => a.status === "cancelled").length || 0;

  const chunkStats = Object.entries(
    (rawChunks || []).reduce((acc: any, curr: any) => {
      acc[curr.source_type] = (acc[curr.source_type] || 0) + 1;
      return acc;
    }, {})
  ).map(([source_type, count]) => ({ source_type, count }));


  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Link href="/admin" className="text-sm font-medium text-blue-400 hover:text-blue-500">
            Admin
          </Link>
          <span className="text-gray-400">/</span>
          <span className="text-sm text-gray-500">Stampy</span>
        </div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Bot className="text-cyan-400" />
          Observabilidad Stampy
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Métricas, conversaciones y logs de uso de las últimas semanas.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-[#1a1a1a] border border-stampa-border rounded-xl p-4 flex flex-col gap-2">
          <div className="flex items-center gap-2 text-gray-400">
            <MessageSquare size={16} />
            <span className="text-sm font-medium">Mensajes (30d)</span>
          </div>
          <span className="text-2xl font-bold text-white">{msgsCount || 0}</span>
        </div>
        <div className="bg-[#1a1a1a] border border-stampa-border rounded-xl p-4 flex flex-col gap-2">
          <div className="flex items-center gap-2 text-gray-400">
            <BarChart3 size={16} />
            <span className="text-sm font-medium">Conversaciones (30d)</span>
          </div>
          <span className="text-2xl font-bold text-white">{convsCount || 0}</span>
        </div>
        <div className="bg-[#1a1a1a] border border-stampa-border rounded-xl p-4 flex flex-col gap-2">
          <div className="flex items-center gap-2 text-red-400">
            <AlertCircle size={16} />
            <span className="text-sm font-medium">Errores/Bloqueos (30d)</span>
          </div>
          <span className="text-2xl font-bold text-white">{errsCount || 0}</span>
        </div>
        <div className="bg-[#1a1a1a] border border-stampa-border rounded-xl p-4 flex flex-col gap-2">
          <div className="flex items-center gap-2 text-emerald-400">
            <ThumbsUp size={16} />
            <span className="text-sm font-medium">Ratio Feedback (24h)</span>
          </div>
          <span className="text-2xl font-bold text-white">{ratio24h}% <span className="text-xs text-gray-500 font-normal">({pos24h} 👍 / {neg24h} 👎)</span></span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-[#1a1a1a] border border-stampa-border rounded-xl p-4 flex flex-col gap-2">
          <div className="flex items-center gap-2 text-stampa-orange">
            <Activity size={16} />
            <span className="text-sm font-medium">Acciones (24h)</span>
          </div>
          <span className="text-2xl font-bold text-white">{actionsCount}</span>
        </div>
        <div className="bg-[#1a1a1a] border border-stampa-border rounded-xl p-4 flex flex-col gap-2">
          <div className="flex items-center gap-2 text-blue-400">
            <Activity size={16} />
            <span className="text-sm font-medium">Tools Abiertos (24h)</span>
          </div>
          <span className="text-2xl font-bold text-white">{openedCount}</span>
        </div>
        <div className="bg-[#1a1a1a] border border-stampa-border rounded-xl p-4 flex flex-col gap-2">
          <div className="flex items-center gap-2 text-red-400">
            <AlertCircle size={16} />
            <span className="text-sm font-medium">Canceladas (24h)</span>
          </div>
          <span className="text-2xl font-bold text-white">{cancelledCount}</span>
        </div>
      </div>

      <IndexationPanel stats={chunkStats} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
        <div className="bg-[#1a1a1a] border border-stampa-border rounded-xl p-5 shadow-sm">
          <h2 className="text-lg font-bold text-white mb-4">Conversaciones Recientes</h2>
          <div className="space-y-3">
            {recentConvs && recentConvs.length > 0 ? (
              recentConvs.map((conv: any) => (
                <div key={conv.id} className="flex flex-col gap-1 p-3 bg-white/5 border border-stampa-border rounded-lg">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-gray-200 truncate">{conv.title || "Conversación sin título"}</span>
                    <span className="text-xs text-gray-500">{new Date(conv.last_message_at).toLocaleString('es-AR')}</span>
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-xs text-gray-400 truncate max-w-[200px]">{(conv.profiles as any)?.email || "Usuario desconocido"}</span>
                    <Link 
                      href={`/admin/stampy/conversaciones/${conv.id}`}
                      className="text-xs font-bold text-cyan-400 hover:text-cyan-300"
                    >
                      Ver detalle &rarr;
                    </Link>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-gray-500 text-center py-4">No hay conversaciones recientes.</p>
            )}
          </div>
        </div>

        <div className="bg-[#1a1a1a] border border-stampa-border rounded-xl p-5 shadow-sm">
          <h2 className="text-lg font-bold text-white mb-4">Feedback Reciente</h2>
          <div className="space-y-3">
            {recentFeedback && recentFeedback.length > 0 ? (
              recentFeedback.map((fb: any) => (
                <div key={fb.id} className="flex flex-col gap-2 p-3 bg-white/5 border border-stampa-border rounded-lg">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {fb.rating === "positive" ? (
                        <span className="flex items-center gap-1 text-xs font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                          <ThumbsUp size={12} /> Útil
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-xs font-bold text-red-400 bg-red-500/10 px-2 py-0.5 rounded-full">
                          <ThumbsDown size={12} /> No me sirvió
                        </span>
                      )}
                      <span className="text-xs text-gray-500">{new Date(fb.created_at).toLocaleString('es-AR')}</span>
                    </div>
                    <Link 
                      href={`/admin/stampy/conversaciones/${fb.conversation_id}`}
                      className="text-xs text-cyan-400 hover:text-cyan-300"
                    >
                      Ver chat
                    </Link>
                  </div>
                  <div className="text-xs text-gray-400">
                    <span className="font-semibold text-gray-300">Usuario:</span> {(fb.profiles as any)?.email || "Desconocido"}
                  </div>
                  {fb.rating === "negative" && (
                    <div className="text-xs bg-black/20 p-2 rounded border border-white/5">
                      {fb.reason && <div className="font-semibold text-red-300 mb-1">Motivo: {fb.reason}</div>}
                      {fb.comment && <div className="text-gray-300 italic">"{fb.comment}"</div>}
                    </div>
                  )}
                  <div className="text-[10px] text-gray-500 uppercase">Origen: {fb.source}</div>
                </div>
              ))
            ) : (
              <p className="text-sm text-gray-500 text-center py-4">No hay feedback reciente.</p>
            )}
          </div>
        </div>

        <div className="bg-[#1a1a1a] border border-stampa-border rounded-xl p-5 shadow-sm lg:col-span-2">
          <h2 className="text-lg font-bold text-white mb-4">Solicitudes de Acción Recientes</h2>
          <div className="space-y-3">
            {recentActions && recentActions.length > 0 ? (
              recentActions.map((action: any) => (
                <div key={action.id} className="flex flex-col gap-2 p-3 bg-white/5 border border-stampa-border rounded-lg">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-white">{action.action_type}</span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${
                        action.status === 'opened_tool' ? 'bg-blue-500/20 text-blue-400' :
                        action.status === 'cancelled' ? 'bg-red-500/20 text-red-400' :
                        action.status === 'suggested' ? 'bg-yellow-500/20 text-yellow-400' :
                        'bg-gray-500/20 text-gray-400'
                      }`}>
                        {action.status}
                      </span>
                    </div>
                    <span className="text-xs text-gray-500">{new Date(action.created_at).toLocaleString('es-AR')}</span>
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <div className="text-xs text-gray-400">
                      <span className="font-semibold text-gray-300">Usuario:</span> {(action.profiles as any)?.email || "Desconocido"}
                    </div>
                    {action.conversation_id && (
                      <Link 
                        href={`/admin/stampy/conversaciones/${action.conversation_id}`}
                        className="text-xs text-cyan-400 hover:text-cyan-300"
                      >
                        Ver chat
                      </Link>
                    )}
                  </div>
                  {action.tool_label && (
                    <div className="text-xs text-gray-500 mt-1">
                      Tool: <span className="text-gray-300">{action.tool_label}</span>
                    </div>
                  )}
                </div>
              ))
            ) : (
              <p className="text-sm text-gray-500 text-center py-4">No hay solicitudes de acción recientes.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
