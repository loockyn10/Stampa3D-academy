"use client";

import { useState } from "react";
import { createClient } from "@/utils/supabase/client";
import Link from "next/link";
import { Building2, Mail, ArrowLeft } from "lucide-react";

export default function RecuperarPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const supabase = createClient();

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setError("Por favor ingresá tu correo electrónico.");
      return;
    }

    setIsLoading(true);
    setError(null);
    setSuccessMsg(null);

    const redirectToUrl = `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback?next=/actualizar-password`;

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: redirectToUrl,
    });

    if (resetError) {
      if (
        resetError.message.includes("rate limit") ||
        resetError.message.includes("rate_limit") ||
        resetError.message.includes("limit exceeded") ||
        resetError.message.includes("60 seconds")
      ) {
        setError(
          "Se alcanzó el límite de envío de emails. Probá de nuevo más tarde o contactá soporte. Esto se soluciona configurando el servicio de emails de la plataforma."
        );
      } else {
        setError(resetError.message);
      }
      setIsLoading(false);
      return;
    }

    setSuccessMsg("Te enviamos un correo para restablecer tu contraseña. Revisá tu bandeja de entrada y spam.");
    setIsLoading(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F7F7F9] px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8 bg-white p-8 rounded-2xl shadow-sm border border-gray-100">
        <div className="flex flex-col items-center justify-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-orange-500 mb-4 shadow-sm">
            <Building2 className="h-6 w-6 text-white" />
          </div>
          <h2 className="text-center text-3xl font-bold tracking-tight text-gray-900">
            Recuperar contraseña
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Ingresá tu correo para recibir las instrucciones de restablecimiento
          </p>
        </div>

        {successMsg ? (
          <div className="space-y-6">
            <div className="rounded-lg bg-green-50 border border-green-100 p-4 text-sm text-green-800">
              {successMsg}
            </div>
            <div className="text-center">
              <Link
                href="/login"
                className="inline-flex items-center gap-2 text-sm font-medium text-orange-600 hover:text-orange-500 transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
                Volver al inicio de sesión
              </Link>
            </div>
          </div>
        ) : (
          <form className="mt-8 space-y-6" onSubmit={handleResetPassword}>
            {error && (
              <div className="rounded-lg bg-red-50 border border-red-100 p-4 text-sm text-red-600">
                {error}
              </div>
            )}
            <div className="space-y-4">
              <div>
                <label
                  htmlFor="email-address"
                  className="block text-sm font-medium text-gray-700"
                >
                  Email
                </label>
                <div className="relative mt-1 rounded-md shadow-sm">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                    <Mail className="h-5 w-5 text-gray-400" aria-hidden="true" />
                  </div>
                  <input
                    id="email-address"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="block w-full rounded-lg border-gray-300 pl-10 focus:border-orange-500 focus:ring-orange-500 sm:text-sm py-3 text-gray-900 placeholder-gray-500 bg-white"
                    placeholder="tu@email.com"
                  />
                </div>
              </div>
            </div>

            <div>
              <button
                type="submit"
                disabled={isLoading}
                className="group relative flex w-full justify-center rounded-lg bg-orange-500 px-3 py-3 text-sm font-semibold text-white hover:bg-orange-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500 disabled:opacity-70 transition-colors cursor-pointer"
              >
                {isLoading ? "Enviando..." : "Enviar instrucciones"}
              </button>
            </div>

            <div className="text-center">
              <Link
                href="/login"
                className="inline-flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
                Volver al inicio de sesión
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
