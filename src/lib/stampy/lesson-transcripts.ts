import { SupabaseClient } from "@supabase/supabase-js";
import { LessonTranscript, LessonTranscriptSegment } from "./types";

function cleanText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, "")
    .trim();
}

const STOP_WORDS = new Set([
  "que", "qué", "como", "cómo", "porque", "por", "tengo", "quiero",
  "necesito", "clase", "video", "explicame", "decime", "esto", "eso",
  "el", "la", "los", "las", "de", "del", "en", "un", "una", "con", "para", "y", "o", "a", "los"
]);

export async function getLessonTranscriptContext({
  supabase,
  lessonId,
  message,
}: {
  supabase: SupabaseClient;
  lessonId: string | null | undefined;
  message: string;
}) {
  if (!lessonId) {
    return {
      text: "",
      transcriptFound: false,
      segmentsUsed: 0,
      transcriptChars: 0,
    };
  }

  try {
    const { data: transcript, error } = await supabase
      .from("lesson_transcripts")
      .select("id, lesson_id, transcript_text, status, language, duration_seconds, segments_count")
      .eq("lesson_id", lessonId)
      .eq("status", "ready")
      .maybeSingle();

    if (error) {
      console.error("[Stampy] Error fetching transcript:", error);
      return { text: "", transcriptFound: false, segmentsUsed: 0, transcriptChars: 0 };
    }

    if (!transcript) {
      return { text: "", transcriptFound: false, segmentsUsed: 0, transcriptChars: 0 };
    }

    const { data: segments } = await supabase
      .from("lesson_transcript_segments")
      .select("position, start_seconds, end_seconds, text")
      .eq("transcript_id", transcript.id)
      .order("position", { ascending: true })
      .limit(80);

    let blocksText = "";
    let segmentsUsed = 0;

    if (segments && segments.length > 0) {
      // Normalizar mensaje y obtener tokens relevantes
      const messageWords = cleanText(message).split(/\s+/);
      const queryTokens = messageWords.filter((w) => w.length > 2 && !STOP_WORDS.has(w));

      let scoredSegments = segments.map((seg) => {
        let score = 0;
        if (queryTokens.length > 0) {
          const segText = cleanText(seg.text);
          for (const token of queryTokens) {
            if (segText.includes(token)) {
              score += 1;
            }
          }
        }
        return { ...seg, score };
      });

      let selectedSegments = [];
      const hasMatches = scoredSegments.some((s) => s.score > 0);

      if (hasMatches) {
        // Ordenar por score desc, tomar hasta 12
        scoredSegments.sort((a, b) => b.score - a.score);
        selectedSegments = scoredSegments.filter(s => s.score > 0).slice(0, 12);
        // Reordenar por posicion original
        selectedSegments.sort((a, b) => a.position - b.position);
      } else {
        // Fallback si no hay matches o no hay tokens: tomar los primeros hasta llegar al limite de caracteres
        let currentCharCount = 0;
        for (const seg of scoredSegments) {
          if (currentCharCount + seg.text.length < 7500) {
            selectedSegments.push(seg);
            currentCharCount += seg.text.length;
          } else {
            break;
          }
        }
      }

      segmentsUsed = selectedSegments.length;
      
      const formatTime = (seconds: number) => {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `[${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}]`;
      };

      const segmentsText = selectedSegments
        .map((seg) => `${formatTime(seg.start_seconds)} ${seg.text}`)
        .join("\n");

      blocksText = `TRANSCRIPCIÓN DE LA CLASE ACTUAL:\nEsta transcripción pertenece solamente a la clase actual que el usuario está viendo.\n\nFragmentos:\n${segmentsText}`;
    } else if (transcript.transcript_text) {
      // Usar transcript_text truncado
      const rawText = transcript.transcript_text;
      if (rawText.length > 8000) {
        blocksText = `TRANSCRIPCIÓN DE LA CLASE ACTUAL:\nEsta transcripción pertenece solamente a la clase actual que el usuario está viendo.\n\n${rawText.slice(0, 8000)}\n\n[Transcripción truncada por tamaño]`;
      } else {
        blocksText = `TRANSCRIPCIÓN DE LA CLASE ACTUAL:\nEsta transcripción pertenece solamente a la clase actual que el usuario está viendo.\n\n${rawText}`;
      }
    } else {
      return { text: "", transcriptFound: false, segmentsUsed: 0, transcriptChars: 0 };
    }

    // Asegurar limite global de 8000
    if (blocksText.length > 8000) {
      blocksText = blocksText.slice(0, 8000) + "\n\n[Transcripción truncada por tamaño]";
    }

    return {
      text: blocksText,
      transcriptFound: true,
      transcriptId: transcript.id,
      segmentsUsed,
      transcriptChars: blocksText.length,
    };
  } catch (error) {
    console.error("[Stampy] Error inesperado fetching transcript:", error);
    return { text: "", transcriptFound: false, segmentsUsed: 0, transcriptChars: 0 };
  }
}
