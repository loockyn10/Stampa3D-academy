"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import Link from "next/link";
import { Layers, Mail, Lock, Eye, EyeOff } from "lucide-react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message);
      setIsLoading(false);
      return;
    }

    router.refresh();
    router.push("/");
  };

  return (
    <div className="min-h-screen bg-[#050505] text-neutral-100 flex items-center justify-center relative overflow-hidden">
      {/* Glow effects */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-orange-500/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-orange-600/10 rounded-full blur-[120px] pointer-events-none" />

      <div className="mx-auto grid min-h-screen max-w-6xl grid-cols-1 items-center gap-10 px-6 py-12 lg:grid-cols-2 relative z-10 w-full">
        {/* Left column - branding */}
        <div className="hidden lg:flex flex-col justify-center space-y-6">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#ff6a00] text-white shadow-lg shadow-orange-500/20">
              <Layers className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white leading-none">Stampa</h1>
              <p className="text-xs text-orange-500 mt-1 font-semibold tracking-wider uppercase">Academia 3D</p>
            </div>
          </div>

          <div className="space-y-4">
            <h2 className="text-4xl font-extrabold tracking-tight text-white leading-tight">
              Entrá a tu taller digital de impresión 3D.
            </h2>
            <p className="text-lg text-gray-400">
              Cursos, herramientas, stock, presupuestos, STL y Stampy en un solo lugar.
            </p>
          </div>

          <ul className="space-y-3.5 text-gray-300">
            <li className="flex items-center gap-3">
              <div className="h-2 w-2 rounded-full bg-[#ff6a00]" />
              <span>Aprendé con rutas y talleres prácticos.</span>
            </li>
            <li className="flex items-center gap-3">
              <div className="h-2 w-2 rounded-full bg-[#ff6a00]" />
              <span>Calculá precios y armá presupuestos.</span>
            </li>
            <li className="flex items-center gap-3">
              <div className="h-2 w-2 rounded-full bg-[#ff6a00]" />
              <span>Gestioná productos, stock y recursos.</span>
            </li>
          </ul>
        </div>

        {/* Right column - card */}
        <div className="flex justify-center w-full">
          <div className="w-full max-w-md space-y-8 bg-neutral-950/80 p-8 sm:p-10 rounded-2xl shadow-2xl border border-white/10 backdrop-blur-xl">
            {/* Header for mobile view */}
            <div className="flex flex-col items-center lg:items-start">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#ff6a00] text-white mb-4 lg:hidden shadow-lg shadow-orange-500/20">
                <Layers className="h-6 w-6" />
              </div>
              <h2 className="text-3xl font-bold tracking-tight text-white">
                Iniciar sesión
              </h2>
              <p className="mt-2 text-sm text-gray-400">
                Accedé a tu cuenta de Academia Stampa.
              </p>
            </div>

            <form className="space-y-6" onSubmit={handleLogin}>
              {error && (
                <div className="rounded-xl bg-red-500/10 border border-red-500/30 p-4 text-sm text-red-300">
                  {error}
                </div>
              )}
              <div className="space-y-5">
                <div>
                  <label htmlFor="email-address" className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                    Email
                  </label>
                  <div className="relative rounded-md shadow-sm">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                      <Mail className="h-5 w-5 text-neutral-500" aria-hidden="true" />
                    </div>
                    <input
                      id="email-address"
                      name="email"
                      type="email"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="block w-full rounded-xl border border-white/10 pl-10 focus:border-orange-500/60 focus:ring-orange-500/20 focus:ring-2 sm:text-sm py-3 text-neutral-100 placeholder-neutral-500 bg-white/5 outline-none transition-all"
                      placeholder="tu@email.com"
                    />
                  </div>
                </div>
                <div>
                  <label htmlFor="password" className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                    Contraseña
                  </label>
                  <div className="relative rounded-md shadow-sm">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                      <Lock className="h-5 w-5 text-neutral-500" aria-hidden="true" />
                    </div>
                    <input
                      id="password"
                      name="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="block w-full rounded-xl border border-white/10 pl-10 pr-10 focus:border-orange-500/60 focus:ring-orange-500/20 focus:ring-2 sm:text-sm py-3 text-neutral-100 placeholder-neutral-500 bg-white/5 outline-none transition-all"
                      placeholder="••••••••"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute inset-y-0 right-0 flex items-center pr-3 text-neutral-500 hover:text-neutral-300 focus:outline-none cursor-pointer"
                      aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                    >
                      {showPassword ? (
                        <EyeOff className="h-5 w-5" aria-hidden="true" />
                      ) : (
                        <Eye className="h-5 w-5" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <button
                  type="submit"
                  disabled={isLoading}
                  className="group relative flex w-full justify-center rounded-xl bg-orange-500 hover:bg-orange-400 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-orange-500/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500 disabled:opacity-70 transition-all active:scale-[0.98]"
                >
                  {isLoading ? (
                    <span className="flex items-center gap-2 justify-center">
                      <svg className="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Iniciando...
                    </span>
                  ) : "Entrar"}
                </button>
              </div>
            </form>

            <div className="text-center space-y-3 pt-2 border-t border-white/5">
              <p className="text-sm">
                <Link
                  href="/recuperar-password"
                  className="font-medium text-orange-400 hover:text-orange-300 transition-colors"
                >
                  ¿Olvidaste tu contraseña?
                </Link>
              </p>
              <p className="text-sm text-gray-400">
                ¿No tenés cuenta?{" "}
                <Link
                  href="/registro"
                  className="font-medium text-orange-400 hover:text-orange-300 transition-colors"
                >
                  Registrate acá
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
