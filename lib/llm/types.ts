// lib/llm/types.ts
// Contratos públicos compartilhados entre todos os módulos LLM da VERA.
// Nenhum módulo deve redefinir esses tipos localmente.

// ─── LLM ──────────────────────────────────────────────────────────────────────

export interface Message {
  role: 'user' | 'assistant' | 'system'
  content: string
}

// ─── Memória ──────────────────────────────────────────────────────────────────

export const ALLOWED_TYPES = [
  'identity', 'location', 'goal', 'preference', 'context',
  'project_goal', 'project_decision', 'project_constraint',
  'project_scope', 'project_state',
] as const

export const ALLOWED_SCOPES   = ['global', 'project', 'task', 'session'] as const
export const ALLOWED_SOURCES  = ['explicit', 'inference', 'pattern']     as const
export const ALLOWED_TASK_STATUSES = [
  'open', 'in_progress', 'done', 'blocked', 'cancelled',
] as const

export type MemoryType   = typeof ALLOWED_TYPES[number]
export type MemoryScope  = typeof ALLOWED_SCOPES[number]
export type MemorySource = typeof ALLOWED_SOURCES[number]
export type TaskStatus   = typeof ALLOWED_TASK_STATUSES[number]

export interface ExtractedMemory {
  type:                 MemoryType
  value:                string
  granularity:          string
  confidence:           number
  needs_disambiguation: boolean
  scope:                MemoryScope
  importance:           number
  source:               MemorySource
  supersedes?:          string
}

export interface ExtractedTask {
  title:        string
  description?: string
  status:       TaskStatus
  importance:   number
}

export interface ExtractionResult {
  memories: ExtractedMemory[]
  tasks:    ExtractedTask[]
}

// ─── Contexto ─────────────────────────────────────────────────────────────────

export interface MemoryRow {
  type:       string
  value:      string
  scope:      string
  importance: number
  confidence: number
  source:     string
}

export interface TaskRow {
  title:       string
  description: string | null
  status:      string
  importance:  number
}

// ─── Mapas de domínio (reutilizados em context e memory) ──────────────────────

export const TYPE_IMPORTANCE: Record<MemoryType, number> = {
  project_goal:        9,
  project_decision:    8,
  project_constraint:  8,
  project_scope:       7,
  project_state:       7,
  goal:                7,
  identity:            6,
  context:             6,
  preference:          5,
  location:            4,
}

export const TYPE_TO_SCOPE: Record<MemoryType, MemoryScope> = {
  project_goal:        'project',
  project_decision:    'project',
  project_constraint:  'project',
  project_scope:       'project',
  project_state:       'project',
  goal:                'global',
  identity:            'global',
  context:             'global',
  preference:          'global',
  location:            'global',
}