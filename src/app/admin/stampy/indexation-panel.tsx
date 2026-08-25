"use client";

import React, { useState } from "react";
import { runStampyIndexation } from "./actions";
import { Loader2, Database } from "lucide-react";

export function IndexationPanel({ stats }: { stats: any[] }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  const handleIndex = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await runStampyIndexation();
      setResult(res);
    } catch (err: any) {
      setResult({ error: err.message || "Error desconocido." });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-[#1a1a1a] border border-stampa-border rounded-xl p-5 shadow-sm mt-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          <Database className="text-cyan-400" size={20} />
          Índice de Conocimiento Stampy
        </h2>
        <button
          onClick={handleIndex}
          disabled={loading}
          className="flex items-center gap-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white px-3 py-1.5 rounded text-sm font-medium transition-colors"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Database size={16} />}
          Reindexar
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        {stats.length > 0 ? stats.map((s, i) => (
          <div key={i} className="bg-white/5 p-3 rounded-lg border border-white/10">
            <div className="text-xs text-gray-400 uppercase tracking-wider">{s.source_type}</div>
            <div className="text-xl font-bold text-white mt-1">{s.count}</div>
          </div>
        )) : (
          <p className="text-sm text-gray-500">No hay chunks indexados todavía.</p>
        )}
      </div>

      {result && (
        <div className={`p-3 rounded text-sm ${result.success ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
          {result.error ? (
            <p>Error: {result.error}</p>
          ) : (
             <div>
               <p className="font-bold">Indexación completada en {result.result?.durationMs}ms</p>
               <ul className="mt-2 space-y-1 text-xs">
                 <li>Creados: {result.result?.chunksCreated}</li>
                 <li>Actualizados: {result.result?.chunksUpdated}</li>
                 <li>Errores: {result.result?.errors}</li>
               </ul>
             </div>
          )}
        </div>
      )}
    </div>
  );
}
