"use client";

import React, { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowRight, Check, Loader2 } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { AuthBrand } from "@/components/auth/AuthBrand";
import { sanitizeReturnTo } from "@/lib/auth/return-to";
import { EXPERIENCE_LEVEL_OPTIONS, MAIN_GOAL_OPTIONS, PRINTER_BRAND_OPTIONS } from "@/lib/profile-options";
import { buildOnboardingUpdate, type OnboardingAnswers } from "@/lib/onboarding/profile-update";
import { usePublishStampyScreenContext } from "@/components/stampy/StampyContextProvider";
import type { StampyScreenContext } from "@/lib/stampy/screen-context";

interface ChoiceGroupProps {
  label: string;
  hint?: string;
  options: readonly { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}

/** Large tappable options (mobile friendly) instead of native selects. Clicking the selected one clears it. */
function ChoiceGroup({ label, hint, options, value, onChange }: ChoiceGroupProps) {
  const groupId = React.useId();
  return (
    <fieldset className="space-y-2">
      <legend id={groupId} className="text-sm font-semibold text-fg">
        {label} <span className="font-normal text-stampa-text-muted">(opcional)</span>
      </legend>
      {hint && <p className="text-xs text-stampa-text-muted">{hint}</p>}
      <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-labelledby={groupId}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(selected ? "" : option.value)}
              className={`flex min-h-11 items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors ${
                selected
                  ? "border-stampa-orange-border bg-stampa-orange-muted font-semibold text-fg"
                  : "border-stampa-border bg-stampa-bg-soft text-stampa-text-soft hover:border-stampa-orange-border"
              }`}
            >
              {option.label}
              {selected && <Check className="h-4 w-4 shrink-0 text-stampa-accent" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function OnboardingContent() {
  const searchParams = useSearchParams();
  const returnTo = sanitizeReturnTo(searchParams.get("returnTo"));
  const [supabase] = useState(() => createClient());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<"save" | "skip" | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [answers, setAnswers] = useState<OnboardingAnswers>({
    displayName: "",
    printerBrand: "",
    printerModel: "",
    experienceLevel: "",
    mainGoal: "",
  });
  const set = (field: keyof OnboardingAnswers) => (value: string) => setAnswers((current) => ({ ...current, [field]: value }));

  useEffect(() => {
    let active = true;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        window.location.replace("/login?returnTo=%2Fonboarding");
        return;
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, display_name, main_printer_brand, main_printer_model, experience_level, main_goal, onboarding_completed")
        .eq("id", user.id)
        .maybeSingle();
      if (!active) return;
      if (profile?.onboarding_completed) {
        window.location.replace(returnTo);
        return;
      }
      setAnswers({
        displayName: profile?.display_name || (profile?.full_name ? String(profile.full_name).split(" ")[0] : ""),
        printerBrand: profile?.main_printer_brand || "",
        printerModel: profile?.main_printer_model || "",
        experienceLevel: profile?.experience_level || "",
        mainGoal: profile?.main_goal || "",
      });
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [supabase, returnTo]);

  const save = async (mode: "save" | "skip") => {
    setSaving(mode);
    setErrorMsg(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("no_session");
      // Only the own row, only non-privileged columns (profiles guard), never an INSERT: the profile is created at
      // sign-up by the database.
      const { data, error } = await supabase
        .from("profiles")
        .update(buildOnboardingUpdate(mode === "skip" ? null : answers, new Date()))
        .eq("id", user.id)
        .select("id");
      if (error || !data || data.length === 0) throw new Error("not_saved");
      window.location.replace(returnTo);
    } catch {
      setErrorMsg("No pudimos guardar tus datos. Revisá tu conexión y probá de nuevo.");
      setSaving(null);
    }
  };

  const stampyScreenContext = useMemo<StampyScreenContext>(() => ({
    page: { section: "onboarding", route: "/onboarding", title: "Configuración inicial" },
    mode: saving ? "saving" : "edit",
    formState: {
      kind: "formDraft",
      formType: "Preferencias iniciales sin guardar",
      fields: [
        { label: "Marca de impresora declarada en este formulario", value: answers.printerBrand || "Sin completar" },
        { label: "Nivel de experiencia declarado", value: answers.experienceLevel || "Sin completar" },
        { label: "Objetivo principal declarado", value: answers.mainGoal || "Sin completar" },
      ],
    },
    pageData: {
      kind: "pageFacts",
      facts: [{ label: "Formulario visible", value: "Configuración inicial de la experiencia" }],
    },
    uiState: { loading: loading || Boolean(saving) },
  }), [answers.experienceLevel, answers.mainGoal, answers.printerBrand, loading, saving]);

  usePublishStampyScreenContext(stampyScreenContext);

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-stampa-bg" role="status" aria-label="Cargando">
        <Loader2 className="h-8 w-8 animate-spin text-stampa-accent" aria-hidden="true" />
      </div>
    );
  }

  const hasPrinter = answers.printerBrand !== "" && answers.printerBrand !== "none_yet";

  return (
    <div className="min-h-dvh bg-stampa-bg px-4 py-8 text-stampa-text sm:py-12">
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <AuthBrand />
        <header className="text-center">
          <h1 className="text-2xl font-bold tracking-tight text-fg sm:text-3xl">Te damos la bienvenida a Universo Stampa</h1>
          <p className="mx-auto mt-2 max-w-lg text-sm text-stampa-text-muted">
            Contanos un poco de vos para sugerirte por dónde empezar. Es opcional y lo podés cambiar después en tu Perfil.
          </p>
        </header>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save("save");
          }}
          className="space-y-6 rounded-2xl border border-stampa-border bg-stampa-surface p-5 sm:p-6"
        >
          <div>
            <label htmlFor="onboarding-name" className="text-sm font-semibold text-fg">
              ¿Cómo querés que te llamemos? <span className="font-normal text-stampa-text-muted">(opcional)</span>
            </label>
            <input
              id="onboarding-name"
              type="text"
              autoComplete="nickname"
              maxLength={60}
              value={answers.displayName}
              onChange={(event) => set("displayName")(event.target.value)}
              className="mt-2 block w-full rounded-xl border border-stampa-border bg-fg/5 px-3 py-3 text-sm text-fg outline-none transition-all placeholder:text-neutral-500 focus:border-stampa-orange/60 focus:ring-2 focus:ring-stampa-orange/20"
              placeholder="Tu nombre o apodo"
            />
          </div>

          <ChoiceGroup label="Tu impresora principal" options={PRINTER_BRAND_OPTIONS} value={answers.printerBrand} onChange={set("printerBrand")} />
          {hasPrinter && (
            <div>
              <label htmlFor="onboarding-model" className="text-sm font-semibold text-fg">
                Modelo <span className="font-normal text-stampa-text-muted">(opcional)</span>
              </label>
              <input
                id="onboarding-model"
                type="text"
                maxLength={80}
                value={answers.printerModel}
                onChange={(event) => set("printerModel")(event.target.value)}
                className="mt-2 block w-full rounded-xl border border-stampa-border bg-fg/5 px-3 py-3 text-sm text-fg outline-none transition-all placeholder:text-neutral-500 focus:border-stampa-orange/60 focus:ring-2 focus:ring-stampa-orange/20"
                placeholder="Ej.: A1 Mini, Ender 3 V3"
              />
            </div>
          )}

          <ChoiceGroup label="Tu experiencia con impresión 3D" options={EXPERIENCE_LEVEL_OPTIONS} value={answers.experienceLevel} onChange={set("experienceLevel")} />
          <ChoiceGroup label="¿Qué querés lograr primero?" options={MAIN_GOAL_OPTIONS} value={answers.mainGoal} onChange={set("mainGoal")} />

          {errorMsg && (
            <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-500">{errorMsg}</p>
          )}

          <div className="flex flex-col-reverse gap-3 border-t border-stampa-border pt-5 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => void save("skip")}
              disabled={saving !== null}
              className="rounded-xl border border-stampa-border px-4 py-3 text-sm font-semibold text-stampa-text-soft transition-colors hover:bg-stampa-surface-soft disabled:opacity-60"
            >
              {saving === "skip" ? "Entrando…" : "Completar más tarde"}
            </button>
            <button
              type="submit"
              disabled={saving !== null}
              className="flex items-center justify-center gap-2 rounded-xl bg-stampa-orange px-5 py-3 text-sm font-semibold text-neutral-950 transition-colors hover:bg-stampa-orange-hover disabled:opacity-60"
            >
              {saving === "save" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ArrowRight className="h-4 w-4" aria-hidden="true" />}
              {saving === "save" ? "Guardando…" : "Guardar y entrar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-stampa-bg" />}>
      <OnboardingContent />
    </Suspense>
  );
}
