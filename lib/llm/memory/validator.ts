// lib/llm/memory/validator.ts
// Responsabilidade única: validar e normalizar objetos extraídos pelo LLM.
// Não depende de Supabase, Groq ou do prompt.

import {
  ALLOWED_TYPES,
  ALLOWED_TASK_STATUSES,
  TYPE_IMPORTANCE,
  TYPE_TO_SCOPE,
  type ExtractedMemory,
  type ExtractedTask,
  type MemoryType,
  type TaskStatus,
} from '../types'

// ─── Padrões de ruído ─────────────────────────────────────────────────────────

const ABSENCE_PATTERNS = [
  /não (informou|forneceu|mencionou|disse|revelou|indicou)/i,
  /nenhum[ao]? (preferência|informação|dado|objetivo|detalhe|contexto)/i,
  /sem (informação|dados|preferência|contexto|detalhes)/i,
  /não (há|existe|foi|está) (informação|dado|contexto|disponível)/i,
  /usuário não/i,
  /ausência de/i,
  /não consta/i,
  /not (provided|mentioned|specified|given|stated)/i,
  /no (information|data|preference|context)/i,
]

const FIRST_PERSON_PATTERNS = [
  /^(eu |meu |minha |me |mim |nos |nossa |nosso )/i,
  /\b(eu sou|eu tenho|eu gosto|eu quero|eu moro|eu trabalho|meu nome é|minha esposa|meu pai|meu filho|minha filha|minha mãe)\b/i,
]

const NOISE_PATTERNS = [
  /compartilhando informaç/i,
  /vou te contar/i,
  /estou (te |lhe )?(dizendo|falando|contando)/i,
  /informaç(ão|ões) pessoai/i,
  /só pra (constar|saber|registrar)/i,
  /acabei de (dizer|falar|mencionar)/i,
]

export function isAbsenceValue(value: string):    boolean { return ABSENCE_PATTERNS.some(p    => p.test(value)) }
export function isFirstPersonValue(value: string): boolean { return FIRST_PERSON_PATTERNS.some(p => p.test(value.trim())) }
export function isNoiseValue(value: string):       boolean { return NOISE_PATTERNS.some(p       => p.test(value)) }

// ─── Validação ────────────────────────────────────────────────────────────────

export function isValidMemory(item: unknown): item is ExtractedMemory {
  if (!item || typeof item !== 'object') return false
  const m = item as Record<string, unknown>
  if (!ALLOWED_TYPES.includes(m.type as MemoryType))                          return false
  if (typeof m.value !== 'string' || m.value.trim().length < 3)               return false
  if (isAbsenceValue(m.value as string))                                       return false
  if (isFirstPersonValue(m.value as string))                                   return false
  if (isNoiseValue(m.value as string))                                         return false
  if (typeof m.granularity !== 'string' || m.granularity.trim().length === 0) return false
  if (typeof m.confidence !== 'number' || m.confidence < 0.5 || m.confidence > 1) return false
  if (typeof m.needs_disambiguation !== 'boolean')                             return false
  return true
}

export function isValidTask(item: unknown): item is ExtractedTask {
  if (!item || typeof item !== 'object') return false
  const t = item as Record<string, unknown>
  if (typeof t.title !== 'string' || t.title.trim().length < 2)               return false
  if (!ALLOWED_TASK_STATUSES.includes(t.status as TaskStatus))                 return false
  if (typeof t.importance !== 'number' || t.importance < 1 || t.importance > 10) return false
  return true
}

// ─── Normalização ─────────────────────────────────────────────────────────────

export function normalizeMemory(m: ExtractedMemory): ExtractedMemory {
  return {
    type:                 m.type,
    value:                m.value.trim(),
    granularity:          m.granularity.trim().toLowerCase(),
    confidence:           Math.round(m.confidence * 100) / 100,
    needs_disambiguation: m.needs_disambiguation,
    scope:                m.scope ?? TYPE_TO_SCOPE[m.type] ?? 'global',
    importance:           m.importance ?? TYPE_IMPORTANCE[m.type] ?? 5,
    source:               m.source ?? 'explicit',
    supersedes:           m.supersedes?.trim(),
  }
}