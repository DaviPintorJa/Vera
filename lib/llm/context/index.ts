// lib/llm/context/index.ts
// Interface pública do módulo de contexto.
// Qualquer arquivo fora desta pasta deve importar APENAS daqui.

import { createServiceClient } from '@/lib/llm/supabase/server'
import { fetchProjectMemories, fetchGlobalMemories, fetchActiveTasks } from './fetchers'
import { buildContextBlock } from './builder'

export async function buildUserContext(
  userId: string,
  chatId: string,
  userMessage: string
): Promise<string> {
  if (!userId || !userMessage?.trim()) return ''

  try {
    const service = createServiceClient()

    const [projectMemories, globalMemories, tasks] = await Promise.all([
      fetchProjectMemories(service, userId, chatId),
      fetchGlobalMemories(service, userId),
      fetchActiveTasks(service, userId, chatId),
    ])

    const total = projectMemories.length + globalMemories.length + tasks.length
    console.log(
      `[CONTEXT] Recuperados: ${projectMemories.length} projeto, ` +
      `${globalMemories.length} global, ${tasks.length} tarefas`
    )

    if (total === 0) return ''

    return buildContextBlock(projectMemories, globalMemories, tasks)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[CONTEXT] Erro ao construir contexto:', msg)
    return ''
  }
}  