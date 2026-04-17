// lib/supabase/server.ts
// Usado em Server Components e API Routes

import { createServerClient } from '@supabase/ssr'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

// Cliente normal — respeita RLS com o usuário logado
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
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
            // Server Component — erro de set é ignorado
          }
        },
      },
    }
  )
}

// Cliente admin — ignora RLS, acesso total ao banco
// Usa @supabase/supabase-js puro (sem cookies/sessão)
export function createServiceClient() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY não está definida.')
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    throw new Error('SUPABASE_URL não está definida.')
  }

  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  )
}