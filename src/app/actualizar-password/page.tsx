"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import Link from "next/link";
import { Building2, Lock, ArrowLeft } from "lucide-react";

export default function ActualizarPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password.length < 6) {
      setError("La contraseña debe tener al menos 6 caracteres");
      return;
    }

    if (password !== confirmPassword) {
      setError("La contraseña no coincide");
      return;
    }

    setIsLoading(true);
    setError(null);
    setSuccessMsg(null);

    const { error: updateError } = await supabase.auth.updateUser({
      password: password,
    });

    if (updateError) {
      setError(updateError.message);
      setIsLoading(false);
      return;
    }

    setSuccessMsg("Contraseña actualizada correctamente. Redirigiendo...");
    setIsLoading(false);

    // Redirect to login after 3 seconds
    setTimeout(() => {
      router.push("/login");
    }, 3000);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F7F7F9] px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8 bg-white p-8 rounded-2xl shadow-sm border border-gray-100">
        <div className="flex flex-col items-center justify-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-orange-500 mb-4 shadow-sm">
            <Building2 className="h-6 w-6 text-white" />
          </div>
          <h2 className="text-center text-3xl font-bold tracking-tight text-gray-900">
            Actualizar contraseña
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Ingresá tu nueva contraseña a continuación
          </p>
        </div>

        {successMsg ? (
          <div className="space-y-4">
            <div className="rounded-lg bg-green-50 border border-green-100 p-4 text-sm text-green-800">
              {successMsg}
            </div>
            <div className="text-center">
              <Link
                href="/login"
                className="inline-flex items-center gap-2 text-sm font-medium text-orange-600 hover:text-orange-500 transition-colors"
              >
                Ir al inicio de sesión ahora
              </Link>
            </div>
          </div>
        ) : (
          <form className="mt-8 space-y-6" onSubmit={handleUpdatePassword}>
            {error && (
              <div className="rounded-lg bg-red-50 border border-red-100 p-4 text-sm text-red-600">
                {error}
              </div>
            )}
            <div className="space-y-4">
              <div>
                <label
                  htmlFor="password"
                  className="block text-sm font-medium text-gray-700"
                >
                  Nueva contraseña
                </label>
                <div className="relative mt-1 rounded-md shadow-sm">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                    <Lock className="h-5 w-5 text-gray-400" aria-hidden="true" />
                  </div>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="block w-full rounded-lg border-gray-300 pl-10 focus:border-orange-500 focus:ring-orange-500 sm:text-sm py-3 text-gray-900 placeholder-gray-500 bg-white"
                    placeholder="••••••••"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="confirmPassword"
                  className="block text-sm font-medium text-gray-700"
                >
                  Repetir nueva contraseña
                </label>
                <div className="relative mt-1 rounded-md shadow-sm">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                    <Lock className="h-5 w-5 text-gray-400" aria-hidden="true" />
                  </div>
                  <input
                    id="confirmPassword"
                    name="confirmPassword"
                    type="password"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="block w-full rounded-lg border-gray-300 pl-10 focus:border-orange-500 focus:ring-orange-500 sm:text-sm py-3 text-gray-900 placeholder-gray-500 bg-white"
                    placeholder="••••••••"
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
                {isLoading ? "Actualizando..." : "Actualizar contraseña"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
