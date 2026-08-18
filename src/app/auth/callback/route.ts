import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { resolveRegistrationCode, normalizeRegistrationCode } from '@/lib/codes/resolve-code'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/'
  const refFromUrl = searchParams.get('ref')
  const inviteFromUrl = searchParams.get('invite')

  if (code) {
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll() },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
            } catch {}
          },
        },
      }
    )

    const { data: sessionData, error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error && sessionData?.user) {
      const userId = sessionData.user.id
      const meta = sessionData.user.user_metadata || {}

      const rawCode = searchParams.get('ref') || searchParams.get('invite') || meta.referral_code_used || '';
      const submittedCode = normalizeRegistrationCode(rawCode) || null;

      // Use admin client for writes that bypass RLS
      const supabaseAdmin = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      )

      if (submittedCode) {
        try {
          const now = new Date().toISOString()
          const resolution = await resolveRegistrationCode(submittedCode, supabaseAdmin)

          if (resolution.isValid) {
            // ── 1. Resolve as beta access (beta_tester or manual_free_access) ─────────────────────
            if (resolution.type === 'beta_tester' || resolution.type === 'manual_free_access') {
              const invite = resolution.data
              
              // Check user hasn't redeemed this code before
              const { data: existingRedemption } = await supabaseAdmin
                .from('invite_code_redemptions')
                .select('id')
                .eq('invite_code_id', invite.id)
                .eq('user_id', userId)
                .single()

              if (!existingRedemption) {
                await supabaseAdmin.from('invite_code_redemptions').insert({
                  invite_code_id: invite.id,
                  user_id: userId,
                  redeemed_at: now,
                })

                await supabaseAdmin
                  .from('invite_codes')
                  .update({ used_count: invite.used_count + 1 })
                  .eq('id', invite.id)

                await supabaseAdmin.from('user_access_grants').insert({
                  user_id: userId,
                  grant_type: resolution.type,
                  status: 'active',
                  expires_at: invite.access_expires_at || null,
                  notes: `Acceso gratuito por código ${submittedCode}`,
                })
              }
            }
            
            // ── 2. Resolve as referral code ──────────
            else if (resolution.type === 'referral') {
              const referrerProfile = resolution.data
              if (referrerProfile && referrerProfile.id !== userId) {
                await supabaseAdmin.from('referrals').upsert(
                  {
                    referrer_user_id: referrerProfile.id,
                    referred_user_id: userId,
                    referral_code: submittedCode,
                    status: 'pending',
                  },
                  { onConflict: 'referred_user_id', ignoreDuplicates: true }
                )

                await supabaseAdmin
                  .from('profiles')
                  .update({ referred_by_user_id: referrerProfile.id })
                  .eq('id', userId)
                  .is('referred_by_user_id', null)
              }
            }

            // ── 3. Resolve as promo ──────────
            // For 'promo' we don't do anything here, it will be consumed in the checkout process.
          }
        } catch (err: any) {
          console.error('[auth/callback] Code processing error:', err.message)
        }
      }

      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth-callback-failed`)
}
