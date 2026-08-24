"use client";

import React, { useState } from "react";
import { ThumbsUp, ThumbsDown, Check, X } from "lucide-react";
import { submitStampyFeedbackAction } from "@/app/stampy/feedback-actions";
import { StampyFeedbackReason } from "@/lib/stampy/types";

interface Props {
  messageId?: string | null;
  conversationId?: string | null;
  source?: string;
}

export function StampyFeedback({ messageId, conversationId, source = "stampy" }: Props) {
  const [rating, setRating] = useState<"positive" | "negative" | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showNegativeForm, setShowNegativeForm] = useState(false);
  const [reason, setReason] = useState<StampyFeedbackReason | "">("");
  const [comment, setComment] = useState("");
  const [submitted, setSubmitted] = useState(false);

  if (!messageId || !conversationId) return null;

  const handleRate = async (newRating: "positive" | "negative") => {
    setRating(newRating);
    if (newRating === "positive") {
      setShowNegativeForm(false);
      setReason("helpful");
      await submitFeedback(newRating, "helpful");
    } else {
      setShowNegativeForm(true);
      setSubmitted(false);
    }
  };

  const submitFeedback = async (
    r: "positive" | "negative",
    rsn?: string,
    cmt?: string
  ) => {
    setIsSubmitting(true);
    try {
      await submitStampyFeedbackAction({
        messageId,
        conversationId,
        rating: r,
        reason: rsn as StampyFeedbackReason || null,
        comment: cmt || null,
        source,
      });
      setSubmitted(true);
      if (r === "negative") {
        setTimeout(() => {
          setShowNegativeForm(false);
        }, 2000);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleNegativeSubmit = async () => {
    if (!reason && !comment) return;
    await submitFeedback("negative", reason, comment);
  };

  return (
    <div className="mt-3 flex flex-col items-start gap-2">
      <div className="flex items-center gap-2">
        <button
          onClick={() => handleRate("positive")}
          disabled={isSubmitting}
          className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-colors ${
            rating === "positive"
              ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
              : "bg-white/5 text-gray-400 hover:bg-white/10 hover:text-gray-300 border border-transparent"
          }`}
        >
          <ThumbsUp size={14} className={rating === "positive" ? "fill-current" : ""} />
          Útil
        </button>
        <button
          onClick={() => handleRate("negative")}
          disabled={isSubmitting}
          className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-colors ${
            rating === "negative"
              ? "bg-red-500/20 text-red-400 border border-red-500/30"
              : "bg-white/5 text-gray-400 hover:bg-white/10 hover:text-gray-300 border border-transparent"
          }`}
        >
          <ThumbsDown size={14} className={rating === "negative" ? "fill-current" : ""} />
          No me sirvió
        </button>
      </div>

      {showNegativeForm && (
        <div className="bg-[#1a1a1a] border border-stampa-border rounded-xl p-4 mt-2 w-full max-w-sm relative shadow-xl">
          <button 
            onClick={() => setShowNegativeForm(false)}
            className="absolute top-2 right-2 text-gray-500 hover:text-gray-300 p-1"
          >
            <X size={14} />
          </button>
          
          {submitted ? (
            <div className="flex items-center gap-2 text-emerald-400 text-sm font-medium p-2">
              <Check size={16} /> ¡Gracias por el feedback!
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-sm font-semibold text-gray-300">¿Qué falló?</p>
              
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value as StampyFeedbackReason)}
                className="w-full bg-stampa-bg border border-stampa-border rounded-lg text-sm text-gray-300 px-3 py-2 focus:outline-none focus:ring-1 focus:ring-cyan-500"
              >
                <option value="" disabled>Seleccioná un motivo...</option>
                <option value="incorrect">Información incorrecta</option>
                <option value="too_generic">Respuesta muy genérica</option>
                <option value="did_not_understand">No entendió mi pregunta</option>
                <option value="did_not_use_context">No usó mi contexto/datos</option>
                <option value="bad_tool_recommendation">Recomendó mal la herramienta</option>
                <option value="other">Otro</option>
              </select>

              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Contanos más detalles (opcional)"
                className="w-full bg-stampa-bg border border-stampa-border rounded-lg text-sm text-gray-300 px-3 py-2 resize-none h-20 focus:outline-none focus:ring-1 focus:ring-cyan-500"
              />

              <button
                onClick={handleNegativeSubmit}
                disabled={isSubmitting || (!reason && !comment)}
                className="w-full bg-cyan-600 hover:bg-cyan-500 text-white font-medium text-sm py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? "Enviando..." : "Enviar feedback"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
