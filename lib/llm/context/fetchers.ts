// lib/llm/context/fetchers.ts
// Responsabilidade única: buscar dados de memória e tarefas no Supabase.
// Não contém lógica de formatação nem de montagem de strings.

import { createServiceClient } from '@/lib/llm/supabase/server'
import type { MemoryRow, TaskRow } from '../types'

export async function fetchProjectMemories(
  service: ReturnType<typeof createServiceClient>,
  userId: string,
  chatId: string
): Promise<MemoryRow[]> {
  const { data, error } = await service
    .from('memories')
    .select('type, value, scope, importance, confidence, source')
    .eq('user_id', userId)
    .eq('chat_id', chatId)
    .eq('scope', 'project')
    .eq('status', 'active')
    .order('importance', { ascending: false })
    .limit(8)

  if (error) console.warn('[FETCHERS] Erro memórias projeto:', error.message)
  return data ?? []
}

export async function fetchGlobalMemories(
  service: ReturnType<typeof createServiceClient>,
  userId: string
): Promise<MemoryRow[]> {
  const { data, error } = await service
    .from('memories')
    .select('type, value, scope, importance, confidence, source')
    .eq('user_id', userId)
    .eq('scope', 'global')
    .eq('status', 'active')
    .eq('needs_disambiguation', false)
    .gte('confidence', 0.5)
    .order('importance', { ascending: false })
    .order('confidence', { ascending: false })
    .limit(8)

  if (error) console.warn('[FETCHERS] Erro memórias globais:', error.message)
  return data ?? []
}

export async function fetchActiveTasks(
  service: ReturnType<typeof createServiceClient>,
  userId: string,
  chatId: string
): Promise<TaskRow[]> {
  const { data, error } = await service
    .from('tasks')
    .select('title, description, status, importance')
    .eq('user_id', userId)
    .eq('chat_id', chatId)
    .in('status', ['open', 'in_progress', 'blocked'])
    .order('importance', { ascending: false })
    .limit(6)

  if (error) console.warn('[FETCHERS] Erro tarefas:', error.message)
  return data ?? []
}