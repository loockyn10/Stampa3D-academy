import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/'
  // ref param may be forwarded by Supabase in the confirmation link
  const refFromUrl = searchParams.get('ref')

  if (code) {
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll()
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              )
            } catch {
              // The `setAll` method was called from a Server Component.
              // This can be ignored if you have middleware refreshing
              // user sessions.
            }
          },
        },
      }
    )

    const { data: sessionData, error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error && sessionData?.user) {
      const userId = sessionData.user.id

      // Resolve referral code: try URL param first, then user metadata
      const refCode =
        refFromUrl?.toUpperCase().trim() ||
        sessionData.user.user_metadata?.referral_code_used?.toUpperCase().trim() ||
        null

      if (refCode) {
        try {
          // Find the referrer by code
          const { data: referrerProfile } = await supabase
            .from('profiles')
            .select('id')
            .eq('referral_code', refCode)
            .single()

          if (referrerProfile && referrerProfile.id !== userId) {
            // Create referral record (ignore if already exists)
            await supabase.from('referrals').upsert(
              {
                referrer_user_id: referrerProfile.id,
                referred_user_id: userId,
                referral_code: refCode,
                status: 'pending',
              },
              { onConflict: 'referred_user_id', ignoreDuplicates: true }
            )

            // Update profile to record who referred them
            await supabase
              .from('profiles')
              .update({ referred_by_user_id: referrerProfile.id })
              .eq('id', userId)
              .is('referred_by_user_id', null)
          }
        } catch (referralErr) {
          // Referral processing is non-critical — don't block login
          console.error('Referral processing error:', referralErr)
        }
      }

      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  // return the user to an error page with instructions
  return NextResponse.redirect(`${origin}/login?error=auth-callback-failed`)
}
