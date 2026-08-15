import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

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

      const refCode = (refFromUrl || meta.referral_code_used || '').toUpperCase().trim() || null
      const inviteCode = (inviteFromUrl || meta.invite_code_used || '').toUpperCase().trim() || null

      // Use admin client for writes that bypass RLS
      const supabaseAdmin = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      )

      // ── 1. Resolve invite code (beta access) ─────────────────────
      if (inviteCode) {
        try {
          const now = new Date().toISOString()

          // Fetch and validate invite code
          const { data: invite } = await supabaseAdmin
            .from('invite_codes')
            .select('id, status, expires_at, max_uses, used_count, access_expires_at')
            .eq('code', inviteCode)
            .single()

          const isValid =
            invite &&
            invite.status === 'active' &&
            (!invite.expires_at || new Date(invite.expires_at) > new Date()) &&
            (invite.max_uses === null || invite.used_count < invite.max_uses)

          if (isValid) {
            // Check user hasn't redeemed this code before
            const { data: existingRedemption } = await supabaseAdmin
              .from('invite_code_redemptions')
              .select('id')
              .eq('invite_code_id', invite.id)
              .eq('user_id', userId)
              .single()

            if (!existingRedemption) {
              // Insert redemption
              await supabaseAdmin.from('invite_code_redemptions').insert({
                invite_code_id: invite.id,
                user_id: userId,
                redeemed_at: now,
              })

              // Increment used_count
              await supabaseAdmin
                .from('invite_codes')
                .update({ used_count: invite.used_count + 1 })
                .eq('id', invite.id)

              // Create beta access grant
              await supabaseAdmin.from('user_access_grants').insert({
                user_id: userId,
                grant_type: 'beta_tester',
                status: 'active',
                expires_at: invite.access_expires_at || null,
                notes: `Acceso beta por código ${inviteCode}`,
              })
            }
          }
        } catch (err: any) {
          console.error('[auth/callback] Invite code processing error:', err.message)
        }
      }

      // ── 2. Resolve referral code ──────────────────────────────────
      if (refCode) {
        try {
          const { data: referrerProfile } = await supabaseAdmin
            .from('profiles')
            .select('id')
            .eq('referral_code', refCode)
            .single()

          if (referrerProfile && referrerProfile.id !== userId) {
            await supabaseAdmin.from('referrals').upsert(
              {
                referrer_user_id: referrerProfile.id,
                referred_user_id: userId,
                referral_code: refCode,
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
        } catch (err: any) {
          console.error('[auth/callback] Referral code processing error:', err.message)
        }
      }

      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth-callback-failed`)
}
