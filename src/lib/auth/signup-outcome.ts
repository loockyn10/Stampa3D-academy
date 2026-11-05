/**
 * Next screen after `supabase.auth.signUp`, from Supabase's REAL answer (no assumption about the project settings):
 * - with a session  → email confirmation is off: enter (the proxy then picks onboarding / Free area / Premium);
 * - without session → confirmation is required, or the address already had an account (Supabase answers the same on
 *   purpose so it cannot be used to probe emails): the neutral "check your email" screen.
 */
export function nextStepAfterSignup(input: { hasSession: boolean; returnTo: string }):
  | { kind: "enter"; to: string }
  | { kind: "verify_email"; to: string } {
  if (input.hasSession) return { kind: "enter", to: input.returnTo };
  return {
    kind: "verify_email",
    to: input.returnTo === "/" ? "/verificar-email" : `/verificar-email?returnTo=${encodeURIComponent(input.returnTo)}`,
  };
}
