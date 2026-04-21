// lib/llm/context/builder.ts
// Responsabilidade única: transformar arrays de MemoryRow e TaskRow
// em um bloco de texto estruturado para injeção no LLM.
// Não depende de Supabase nem de chamadas de rede.

import type { MemoryRow, TaskRow } from '../types'

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

export function buildContextBlock(
  projectMemories: MemoryRow[],
  globalMemories: MemoryRow[],
  tasks: TaskRow[]
): string {
  const sections: string[] = []

  if (projectMemories.length > 0) {
    const lines = projectMemories.map(m => {
      const label    = TYPE_LABELS[m.type] ?? m.type
      const inferred = m.source !== 'explicit' ? ' (inferido)' : ''
      return `• ${label}: ${m.value}${inferred}`
    })
    sections.push(`[Projeto atual]\n${lines.join('\n')}`)
  }

  if (tasks.length > 0) {
    const lines = tasks.map(t => {
      const st   = STATUS_LABELS[t.status] ?? t.status
      const desc = t.description ? ` — ${t.description}` : ''
      return `• [${st}] ${t.title}${desc}`
    })
    sections.push(`[Tarefas em aberto]\n${lines.join('\n')}`)
  }

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