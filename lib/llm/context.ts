// lib/llm/context.ts
import { createServiceClient } from '@/lib/supabase/server'

interface MemoryRow {
  type: string
  value: string
  scope: string
  importance: number
  confidence: number
  source: string
}

interface TaskRow {
  title: string
  description: string | null
  status: string
  importance: number
}

// ─── Recuperação em camadas ───────────────────────────────────────────────────

async function fetchProjectMemories(
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

  if (error) console.warn('[CONTEXT] Erro memórias projeto:', error.message)
  return data ?? []
}

async function fetchGlobalMemories(
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

  if (error) console.warn('[CONTEXT] Erro memórias globais:', error.message)
  return data ?? []
}

async function fetchActiveTasks(
  service: ReturnType<typeof createServiceClient>,
  userId: string,
  chatId: string
): Promise<TaskRow[]> {
  const { data, error } = await service
    .from('tasks')
    .select('title, description, status, importance')
    .eq('user_id', userId)
    .in('status', ['open', 'in_progress', 'blocked'])
    .order('importance', { ascending: false })
    .limit(6)

  if (error) console.warn('[CONTEXT] Erro tarefas:', error.message)
  return data ?? []
}

// ─── Montagem do contexto estruturado ────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  identity:             'Identidade',
  location:             'Localização',
  goal:                 'Objetivo pessoal',
  preference:           'Preferência',
  context:              'Contexto',
  project_goal:         'Objetivo do projeto',
  project_decision:     'Decisão',
  project_constraint:   'Restrição',
  project_scope:        'Escopo',
  project_state:        'Estado atual',
}

const STATUS_LABELS: Record<string, string> = {
  open:        'aberta',
  in_progress: 'em andamento',
  blocked:     'bloqueada',
}

function buildContextBlock(
  projectMemories: MemoryRow[],
  globalMemories: MemoryRow[],
  tasks: TaskRow[]
): string {
  const sections: string[] = []

  // Bloco 1: Projeto
  if (projectMemories.length > 0) {
    const lines = projectMemories.map(m => {
      const label = TYPE_LABELS[m.type] ?? m.type
      const inferred = m.source !== 'explicit' ? ' (inferido)' : ''
      return `• ${label}: ${m.value}${inferred}`
    })
    sections.push(`[Projeto atual]\n${lines.join('\n')}`)
  }

  // Bloco 2: Tarefas abertas
  if (tasks.length > 0) {
    const lines = tasks.map(t => {
      const st = STATUS_LABELS[t.status] ?? t.status
      const desc = t.description ? ` — ${t.description}` : ''
      return `• [${st}] ${t.title}${desc}`
    })
    sections.push(`[Tarefas em aberto]\n${lines.join('\n')}`)
  }

  // Bloco 3: Perfil global
  if (globalMemories.length > 0) {
    const lines = globalMemories.map(m => {
      const label = TYPE_LABELS[m.type] ?? m.type
      return `• ${label}: ${m.value}`
    })
    sections.push(`[Perfil do usuário]\n${lines.join('\n')}`)
  }

  if (sections.length === 0) return ''

  return `Contexto do usuário (recuperado da memória):\n\n${sections.join('\n\n')}`
}

// ─── Função principal ─────────────────────────────────────────────────────────

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
    console.log(`[CONTEXT] Recuperados: ${projectMemories.length} projeto, ${globalMemories.length} global, ${tasks.length} tarefas`)

    if (total === 0) return ''

    return buildContextBlock(projectMemories, globalMemories, tasks)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[CONTEXT] Erro ao construir contexto:', msg)
    return ''
  }
}