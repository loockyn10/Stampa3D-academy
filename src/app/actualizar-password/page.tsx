"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import Link from "next/link";
import { Lock, Eye, EyeOff } from "lucide-react";
import { AuthBrand } from "@/components/auth/AuthBrand";
import { friendlyAuthError } from "@/lib/auth/auth-errors";

export default function ActualizarPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  // The recovery link no longer gives a session (expired, used, or opened in another browser).
  const [linkExpired, setLinkExpired] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password.length < 6) {
      setError("La contraseña debe tener al menos 6 caracteres.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    setIsLoading(true);
    setError(null);
    setSuccessMsg(null);

    const { error: updateError } = await supabase.auth.updateUser({
      password: password,
    });

    if (updateError) {
      const friendly = friendlyAuthError(updateError, "update_password");
      setLinkExpired(Boolean(friendly.linkExpired));
      setError(friendly.message);
      setIsLoading(false);
      return;
    }

    // Signup does not verify the e-mail (launch setting), so someone else could have created this account with the
    // address before its owner recovered it. Once the mailbox owner sets a new password, every OTHER session is revoked
    // (this one stays). A failure here does not undo the password change.
    try {
      const { error: revokeError } = await supabase.auth.signOut({ scope: "others" });
      if (revokeError) console.error("[actualizar-password] revoke other sessions failed", revokeError.code ?? "unknown");
    } catch (caught) {
      console.error("[actualizar-password] revoke other sessions failed", caught instanceof Error ? caught.name : "unknown_error");
    }

    setSuccessMsg("Contraseña actualizada. Te llevamos a Universo Stampa…");
    setIsLoading(false);

    // The recovery link already opened a session: continue into the app (the proxy picks the right screen).
    setTimeout(() => {
      router.push("/");
    }, 2000);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-stampa-bg px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8 bg-stampa-surface p-8 rounded-2xl shadow-sm border border-stampa-border">
        <div className="flex flex-col items-center justify-center">
          <AuthBrand />
          <h1 className="mt-6 text-center text-3xl font-bold tracking-tight text-fg">
            Actualizar contraseña
          </h1>
          <p className="mt-2 text-center text-sm text-gray-400">
            Ingresá tu nueva contraseña a continuación
          </p>
        </div>

        {successMsg ? (
          <div className="space-y-4">
            <div role="status" className="rounded-xl border border-green-500/30 bg-green-500/10 p-4 text-sm text-green-500">
              {successMsg}
            </div>
            <div className="text-center">
              <Link
                href="/"
                className="inline-flex items-center gap-2 text-sm font-medium text-stampa-accent hover:text-stampa-accent transition-colors"
              >
                Entrar ahora
              </Link>
            </div>
          </div>
        ) : (
          <form className="mt-8 space-y-6" onSubmit={handleUpdatePassword}>
            {error && (
              <div role="alert" className="space-y-2 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-500">
                <p>{error}</p>
                {linkExpired && (
                  <Link href="/recuperar-password" className="inline-block font-semibold text-stampa-accent hover:underline">
                    Pedir un enlace nuevo
                  </Link>
                )}
              </div>
            )}
            <div className="space-y-4">
              <div>
                <label
                  htmlFor="password"
                  className="block text-sm font-medium text-gray-300"
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
                    type={showPassword ? "text" : "password"}
                    required
                    autoComplete="new-password"
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="block w-full rounded-xl border border-stampa-border bg-fg/5 py-3 pl-10 pr-10 text-base text-fg outline-none transition-all placeholder:text-neutral-500 focus:border-stampa-orange/60 focus:ring-2 focus:ring-stampa-orange/20 sm:text-sm"
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-400 focus:outline-none cursor-pointer"
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

              <div>
                <label
                  htmlFor="confirmPassword"
                  className="block text-sm font-medium text-gray-300"
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
                    type={showConfirmPassword ? "text" : "password"}
                    required
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="block w-full rounded-xl border border-stampa-border bg-fg/5 py-3 pl-10 pr-10 text-base text-fg outline-none transition-all placeholder:text-neutral-500 focus:border-stampa-orange/60 focus:ring-2 focus:ring-stampa-orange/20 sm:text-sm"
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-400 focus:outline-none cursor-pointer"
                    aria-label={showConfirmPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                  >
                    {showConfirmPassword ? (
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
                className="group relative flex w-full justify-center rounded-xl bg-stampa-orange px-3 py-3 text-sm font-semibold text-neutral-950 hover:bg-stampa-orange-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500 disabled:opacity-70 transition-colors cursor-pointer"
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
