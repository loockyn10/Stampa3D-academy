"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { upsertLessonTranscript, saveLessonTranscriptSegments, deleteLessonTranscript } from "../actions";
import { ArrowLeft, Save, Trash2, Wand2, Plus, Clock, FileText, CheckCircle2 } from "lucide-react";
import Link from "next/link";

interface TranscriptEditorProps {
  lessonId: string;
  lessonTitle: string;
  moduleTitle?: string;
  courseTitle?: string;
  initialTranscript: any;
  initialSegments: any[];
}

export function TranscriptEditor({
  lessonId,
  lessonTitle,
  moduleTitle,
  courseTitle,
  initialTranscript,
  initialSegments
}: TranscriptEditorProps) {
  const router = useRouter();
  
  const [status, setStatus] = useState(initialTranscript?.status || "draft");
  const [sourceType, setSourceType] = useState(initialTranscript?.source_type || "manual");
  const [language, setLanguage] = useState(initialTranscript?.language || "es");
  const [transcriptText, setTranscriptText] = useState(initialTranscript?.transcript_text || "");
  const [segments, setSegments] = useState<any[]>(initialSegments || []);
  
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const formatSeconds = (sec: number | null) => {
    if (sec === null || sec === undefined) return "";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const handleSave = async (forceStatus?: string) => {
    setError(null);
    setSuccessMsg(null);
    const newStatus = forceStatus || status;
    
    if (newStatus === "ready" && !transcriptText.trim() && segments.length === 0) {
      setError("No se puede marcar como Ready sin contenido (texto o segmentos).");
      return;
    }

    setIsSaving(true);
    try {
      // 1. Save transcript
      const tRes = await upsertLessonTranscript(lessonId, {
        status: newStatus,
        source_type: sourceType,
        language,
        transcript_text: transcriptText
      });
      
      if (tRes.error || !tRes.transcriptId) {
        throw new Error(tRes.error || "Error al guardar transcripción");
      }
      
      // 2. Save segments
      const sRes = await saveLessonTranscriptSegments(tRes.transcriptId, lessonId, segments.map((s, i) => ({
        position: i + 1,
        start_seconds: s.start_seconds || null,
        end_seconds: s.end_seconds || null,
        text: s.text
      })));
      
      if (sRes.error) {
        throw new Error(sRes.error);
      }
      
      setStatus(newStatus);
      setSuccessMsg("Guardado correctamente");
      setTimeout(() => setSuccessMsg(null), 3000);
      router.refresh();
      
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!initialTranscript?.id) return;
    if (!confirm("¿Seguro que querés eliminar esta transcripción y sus segmentos?")) return;
    
    setIsDeleting(true);
    try {
      const res = await deleteLessonTranscript(initialTranscript.id);
      if (res.error) throw new Error(res.error);
      router.push("/admin/transcripciones");
    } catch (err: any) {
      setError(err.message);
      setIsDeleting(false);
    }
  };

  const parseSegmentsFromText = () => {
    if (!transcriptText.trim()) return;
    if (segments.length > 0) {
      if (!confirm("Esto reemplazará los segmentos actuales. ¿Continuar?")) return;
    }

    const newSegments: any[] = [];
    const lines = transcriptText.split('\n');
    
    // Regex para [00:00], 00:00 -, 00:00:00
    const timeRegex = /\[?(\d{1,2}):(\d{2})(?::(\d{2}))?\]?\s*(?:-|>|->|-->)?\s*(.*)/;
    
    let currentSegment: any = null;
    
    for (const line of lines) {
      const match = line.match(timeRegex);
      if (match) {
        if (currentSegment) {
          newSegments.push(currentSegment);
        }
        
        let h = 0, m = 0, s = 0;
        if (match[3]) {
          h = parseInt(match[1]);
          m = parseInt(match[2]);
          s = parseInt(match[3]);
        } else {
          m = parseInt(match[1]);
          s = parseInt(match[2]);
        }
        
        const totalSeconds = (h * 3600) + (m * 60) + s;
        
        currentSegment = {
          start_seconds: totalSeconds,
          end_seconds: null, // Will calculate next
          text: match[4].trim()
        };
      } else if (currentSegment && line.trim()) {
        currentSegment.text += " " + line.trim();
      } else if (!currentSegment && line.trim()) {
        // Line without timestamp before any timestamp found
        currentSegment = {
          start_seconds: null,
          end_seconds: null,
          text: line.trim()
        };
      }
    }
    
    if (currentSegment) {
      newSegments.push(currentSegment);
    }

    // Assign positions and end_seconds
    newSegments.forEach((seg, i) => {
      seg.position = i + 1;
      if (i < newSegments.length - 1 && seg.start_seconds !== null) {
        seg.end_seconds = newSegments[i+1].start_seconds;
      }
    });

    // Fallback automatic splitting if no timestamps found
    if (newSegments.length === 1 && newSegments[0].start_seconds === null) {
      const autoSegments: any[] = [];
      const parts = transcriptText.split(/(?<=\.)\s+/);
      let currentText = "";
      for (const part of parts) {
        currentText += (currentText ? " " : "") + part;
        if (currentText.length > 700) {
          autoSegments.push({ start_seconds: null, end_seconds: null, text: currentText.trim() });
          currentText = "";
        }
      }
      if (currentText) {
        autoSegments.push({ start_seconds: null, end_seconds: null, text: currentText.trim() });
      }
      autoSegments.forEach((seg, i) => { seg.position = i + 1; });
      setSegments(autoSegments);
    } else {
      setSegments(newSegments);
    }
  };

  const addEmptySegment = () => {
    setSegments([...segments, { position: segments.length + 1, start_seconds: null, end_seconds: null, text: "" }]);
  };

  const updateSegment = (index: number, field: string, value: any) => {
    const newSegs = [...segments];
    newSegs[index] = { ...newSegs[index], [field]: value };
    setSegments(newSegs);
  };

  const removeSegment = (index: number) => {
    const newSegs = [...segments];
    newSegs.splice(index, 1);
    setSegments(newSegs);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between bg-stampa-surface border border-stampa-border p-6 rounded-2xl">
        <div className="flex items-start gap-4">
          <Link href="/admin/transcripciones" className="mt-1 p-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-colors">
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-white flex items-center gap-3">
              {lessonTitle}
              <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                status === 'ready' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 
                status === 'draft' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 
                'bg-gray-500/10 text-gray-400 border border-gray-500/20'
              }`}>
                {status.toUpperCase()}
              </span>
            </h1>
            <p className="text-sm text-gray-400 mt-1">
              {courseTitle} <span className="mx-2 opacity-50">•</span> {moduleTitle}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {initialTranscript?.id && (
            <button 
              onClick={handleDelete}
              disabled={isDeleting}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 font-medium text-sm transition-colors"
            >
              <Trash2 size={16} />
              Eliminar
            </button>
          )}
          <button 
            onClick={() => handleSave("draft")}
            disabled={isSaving}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 text-gray-300 border border-stampa-border hover:bg-white/10 font-medium text-sm transition-colors"
          >
            Guardar Borrador
          </button>
          <button 
            onClick={() => handleSave("ready")}
            disabled={isSaving}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/20 font-medium text-sm transition-colors"
          >
            <CheckCircle2 size={16} />
            Marcar como Ready
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
          {error}
        </div>
      )}
      {successMsg && (
        <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400 text-sm">
          {successMsg}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Form & Transcript */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-stampa-surface border border-stampa-border rounded-2xl p-6">
            <h2 className="text-lg font-bold text-white mb-4">Metadatos</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Source Type</label>
                <select 
                  value={sourceType}
                  onChange={e => setSourceType(e.target.value)}
                  className="w-full bg-black/20 border border-stampa-border text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-cyan-500/50"
                >
                  <option value="manual">Manual</option>
                  <option value="bunny">Bunny AI</option>
                  <option value="openai">OpenAI Whisper</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Language</label>
                <input 
                  type="text"
                  value={language}
                  onChange={e => setLanguage(e.target.value)}
                  className="w-full bg-black/20 border border-stampa-border text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-cyan-500/50"
                />
              </div>
            </div>
          </div>

          <div className="bg-stampa-surface border border-stampa-border rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <FileText size={18} className="text-cyan-400" />
                Texto Completo
              </h2>
              <button 
                onClick={parseSegmentsFromText}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 text-xs font-medium transition-colors"
              >
                <Wand2 size={14} />
                Generar Segmentos
              </button>
            </div>
            
            <textarea
              value={transcriptText}
              onChange={e => setTranscriptText(e.target.value)}
              placeholder="Pegá acá la transcripción completa de la clase..."
              className="w-full h-[400px] bg-black/20 border border-stampa-border rounded-xl p-4 text-sm text-gray-300 focus:outline-none focus:border-cyan-500/50 font-mono resize-y"
            />
            <div className="flex justify-end mt-2">
              <span className="text-xs text-gray-500">{transcriptText.length} caracteres</span>
            </div>
          </div>

          <div className="bg-stampa-surface border border-stampa-border rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Clock size={18} className="text-purple-400" />
                Segmentos ({segments.length})
              </h2>
              <button 
                onClick={addEmptySegment}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-medium transition-colors border border-stampa-border"
              >
                <Plus size={14} />
                Agregar Manual
              </button>
            </div>

            {segments.length === 0 ? (
              <div className="text-center p-8 border border-dashed border-stampa-border rounded-xl text-gray-500 text-sm">
                No hay segmentos. Usá el botón "Generar Segmentos" arriba si tenés timestamps.
              </div>
            ) : (
              <div className="space-y-3">
                {segments.map((seg, i) => (
                  <div key={i} className="flex items-start gap-3 p-3 bg-black/10 border border-stampa-border rounded-xl group relative">
                    <div className="flex flex-col gap-2 w-24 shrink-0">
                      <div>
                        <label className="text-[10px] text-gray-500 font-medium">Inicio (s)</label>
                        <input 
                          type="number"
                          value={seg.start_seconds !== null ? seg.start_seconds : ""}
                          onChange={e => updateSegment(i, "start_seconds", e.target.value ? parseInt(e.target.value) : null)}
                          className="w-full bg-white/5 border border-stampa-border rounded md p-1.5 text-xs text-white"
                        />
                        <div className="text-[10px] text-cyan-400 mt-1">{formatSeconds(seg.start_seconds)}</div>
                      </div>
                    </div>
                    
                    <div className="flex-1">
                       <label className="text-[10px] text-gray-500 font-medium">Texto del segmento</label>
                       <textarea 
                         value={seg.text}
                         onChange={e => updateSegment(i, "text", e.target.value)}
                         className="w-full bg-white/5 border border-stampa-border rounded md p-2 text-sm text-gray-300 min-h-[60px]"
                       />
                    </div>

                    <button 
                      onClick={() => removeSegment(i)}
                      className="absolute top-2 right-2 p-1.5 text-gray-500 hover:text-red-400 bg-white/5 hover:bg-red-500/10 rounded-md opacity-0 group-hover:opacity-100 transition-all"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Preview */}
        <div className="space-y-6">
          <div className="bg-stampa-surface border border-stampa-border rounded-2xl p-6 sticky top-6">
            <h2 className="text-lg font-bold text-white mb-4">Preview Stampy</h2>
            <p className="text-xs text-gray-400 mb-4">
              Así es como Stampy leerá esta transcripción para responder preguntas.
            </p>
            <div className="bg-black/30 border border-stampa-border rounded-xl p-4 overflow-y-auto max-h-[600px] text-xs text-gray-300 font-mono whitespace-pre-wrap">
              {segments.length > 0 ? (
                <>
                  TRANSCRIPCIÓN DE LA CLASE ACTUAL:<br/>
                  Esta transcripción pertenece solamente a la clase actual que el usuario está viendo.<br/><br/>
                  Fragmentos:<br/>
                  {segments.slice(0, 15).map(s => `[${formatSeconds(s.start_seconds || 0)}] ${s.text}`).join("\n")}
                  {segments.length > 15 && "\n\n... (se filtran los mejores para enviar a Stampy)"}
                </>
              ) : transcriptText ? (
                <>
                  TRANSCRIPCIÓN DE LA CLASE ACTUAL:<br/>
                  Esta transcripción pertenece solamente a la clase actual que el usuario está viendo.<br/><br/>
                  {transcriptText.slice(0, 500)}...<br/><br/>
                  [Preview truncado]
                </>
              ) : (
                <span className="text-gray-600 italic">No hay contenido para mostrar.</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
