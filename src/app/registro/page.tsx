"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { resolveRegistrationCode } from "@/lib/codes/resolve-code";
import Link from "next/link";
import { Layers, Mail, Lock, User, Eye, EyeOff, Tag, Gift, AlertCircle } from "lucide-react";

function RegistroForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [name, setName] = useState("");
  const [referralCode, setReferralCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();
  const searchParams = useSearchParams();

  // Pre-populate from query params
  useEffect(() => {
    const ref = searchParams.get("ref");
    const invite = searchParams.get("invite");
    const codeToUse = ref || invite;
    if (codeToUse) setReferralCode(codeToUse.toUpperCase().trim());
  }, [searchParams]);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    // Validate single referral code
    if (referralCode.trim() !== "") {
      const resolution = await resolveRegistrationCode(referralCode, supabase);

      if (!resolution.isValid) {
        setError(resolution.errorMessage || "El código ingresado no es válido.");
        setIsLoading(false);
        return;
      }

      // If it's a promo code, save to localStorage for checkout
      if (resolution.type === 'promo') {
        try {
          localStorage.setItem("stampa_pending_promo_code", resolution.code);
        } catch {}
      }
    }

    // Persist code in localStorage as fallback for email-confirmation flow
    try {
      if (referralCode.trim()) localStorage.setItem("stampa_pending_referral_code", referralCode.trim().toUpperCase());
    } catch {}

    const { error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: name,
          referral_code_used: referralCode.trim().toUpperCase() || null,
        },
      },
    });

    if (signUpError) {
      setError(signUpError.message);
      setIsLoading(false);
      return;
    }

    router.refresh();
    router.push("/sin-acceso");
  };

  return (
    <div className="min-h-screen bg-[#050505] text-neutral-100 flex items-center justify-center relative overflow-hidden">
      <div className="absolute top-0 right-1/4 w-96 h-96 bg-orange-500/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 left-1/4 w-96 h-96 bg-orange-600/10 rounded-full blur-[120px] pointer-events-none" />

      <div className="relative z-10 w-full max-w-md px-6 py-12">
        <div className="space-y-8 bg-neutral-950/80 p-8 sm:p-10 rounded-2xl shadow-2xl border border-white/10 backdrop-blur-xl">
          <div className="flex flex-col items-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#ff6a00] text-white mb-4 shadow-lg shadow-orange-500/20">
              <Layers className="h-6 w-6" />
            </div>
            <h2 className="text-3xl font-bold tracking-tight text-white">Crear cuenta</h2>
            <p className="mt-2 text-sm text-gray-400">
              Unite a la Academia Stampa.
            </p>
          </div>

          <form className="space-y-6" onSubmit={handleRegister}>
            {error && (
              <div className="rounded-xl bg-red-500/10 border border-red-500/30 p-4 text-sm text-red-300 flex items-center gap-2">
                <AlertCircle size={15} className="shrink-0" />
                {error}
              </div>
            )}

            <div className="space-y-5">
              {/* Name */}
              <div>
                <label htmlFor="name" className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Nombre completo</label>
                <div className="relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                    <User className="h-5 w-5 text-neutral-500" />
                  </div>
                  <input
                    id="name" name="name" type="text" autoComplete="name" required
                    value={name} onChange={e => setName(e.target.value)}
                    className="block w-full rounded-xl border border-white/10 pl-10 focus:border-orange-500/60 focus:ring-orange-500/20 focus:ring-2 sm:text-sm py-3 text-neutral-100 placeholder-neutral-500 bg-white/5 outline-none transition-all"
                    placeholder="Juan Pérez"
                  />
                </div>
              </div>

              {/* Email */}
              <div>
                <label htmlFor="email-address" className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Email</label>
                <div className="relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                    <Mail className="h-5 w-5 text-neutral-500" />
                  </div>
                  <input
                    id="email-address" name="email" type="email" autoComplete="email" required
                    value={email} onChange={e => setEmail(e.target.value)}
                    className="block w-full rounded-xl border border-white/10 pl-10 focus:border-orange-500/60 focus:ring-orange-500/20 focus:ring-2 sm:text-sm py-3 text-neutral-100 placeholder-neutral-500 bg-white/5 outline-none transition-all"
                    placeholder="tu@email.com"
                  />
                </div>
              </div>

              {/* Password */}
              <div>
                <label htmlFor="password" className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Contraseña</label>
                <div className="relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                    <Lock className="h-5 w-5 text-neutral-500" />
                  </div>
                  <input
                    id="password" name="password" type={showPassword ? "text" : "password"} autoComplete="new-password" required
                    value={password} onChange={e => setPassword(e.target.value)}
                    className="block w-full rounded-xl border border-white/10 pl-10 pr-10 focus:border-orange-500/60 focus:ring-orange-500/20 focus:ring-2 sm:text-sm py-3 text-neutral-100 placeholder-neutral-500 bg-white/5 outline-none transition-all"
                    placeholder="••••••••"
                  />
                  <button type="button" onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 flex items-center pr-3 text-neutral-500 hover:text-neutral-300 focus:outline-none cursor-pointer">
                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
              </div>

              {/* Referral Code */}
              <div>
                <label htmlFor="ref-code" className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  Código de referido <span className="text-gray-600 font-normal normal-case">(opcional)</span>
                </label>
                <div className="relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                    <Tag className="h-5 w-5 text-neutral-500" />
                  </div>
                  <input
                    id="ref-code" name="ref-code" type="text"
                    value={referralCode} onChange={e => setReferralCode(e.target.value.toUpperCase().trim())}
                    className="block w-full rounded-xl border border-white/10 pl-10 focus:border-violet-500/60 focus:ring-violet-500/20 focus:ring-2 sm:text-sm py-3 text-neutral-100 placeholder-neutral-500 bg-white/5 outline-none transition-all font-mono tracking-widest"
                    placeholder="Ej: STAMPA123"
                    maxLength={20}
                  />
                </div>
                <p className="mt-1.5 text-xs text-gray-500">Si alguien te invitó a Academia Stampa, ingresá su código acá.</p>
              </div>
            </div>

            <button
              type="submit" disabled={isLoading}
              className="group relative flex w-full justify-center rounded-xl bg-orange-500 hover:bg-orange-400 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-orange-500/20 disabled:opacity-70 transition-all active:scale-[0.98]"
            >
              {isLoading ? (
                <span className="flex items-center gap-2 justify-center">
                  <svg className="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Registrando...
                </span>
              ) : "Crear cuenta"}
            </button>
          </form>

          <div className="text-center pt-2 border-t border-white/5">
            <p className="text-sm text-gray-400">
              ¿Ya tenés cuenta?{" "}
              <Link href="/login" className="font-medium text-orange-400 hover:text-orange-300 transition-colors">
                Iniciá sesión acá
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function RegistroPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#050505] flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-2 border-orange-500 border-t-transparent rounded-full" />
      </div>
    }>
      <RegistroForm />
    </Suspense>
  );
}
