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

export function isAbsenceValue(value: string):     boolean { return ABSENCE_PATTERNS.some(p     => p.test(value)) }
export function isFirstPersonValue(value: string): boolean { return FIRST_PERSON_PATTERNS.some(p => p.test(value.trim())) }
export function isNoiseValue(value: string):       boolean { return NOISE_PATTERNS.some(p        => p.test(value)) }

// ─── Normalização semântica ───────────────────────────────────────────────────
// Converte variações comuns para uma forma canônica antes de comparar com o BD.
// Isso reduz duplicatas do tipo "SP" vs "São Paulo" vs "Sampa".

const CITY_ALIASES: Record<string, string> = {
  'sp':             'São Paulo',
  'sampa':          'São Paulo',
  'sao paulo':      'São Paulo',
  'são paulo':      'São Paulo',
  'rj':             'Rio de Janeiro',
  'rio':            'Rio de Janeiro',
  'rio de janeiro': 'Rio de Janeiro',
  'bh':             'Belo Horizonte',
  'belo horizonte': 'Belo Horizonte',
  'poa':            'Porto Alegre',
  'porto alegre':   'Porto Alegre',
  'cwb':            'Curitiba',
  'curitiba':       'Curitiba',
  'bsb':            'Brasília',
  'brasilia':       'Brasília',
  'brasília':       'Brasília',
  'ssa':            'Salvador',
  'salvador':       'Salvador',
  'rec':            'Recife',
  'recife':         'Recife',
  'for':            'Fortaleza',
  'fortaleza':      'Fortaleza',
  'manaus':         'Manaus',
  'belem':          'Belém',
  'belém':          'Belém',
  'goiania':        'Goiânia',
  'goiânia':        'Goiânia',
}

const STATE_ALIASES: Record<string, string> = {
  'sp': 'São Paulo',
  'rj': 'Rio de Janeiro',
  'mg': 'Minas Gerais',
  'rs': 'Rio Grande do Sul',
  'pr': 'Paraná',
  'sc': 'Santa Catarina',
  'ba': 'Bahia',
  'pe': 'Pernambuco',
  'ce': 'Ceará',
  'go': 'Goiás',
  'df': 'Distrito Federal',
  'am': 'Amazonas',
  'pa': 'Pará',
  'mt': 'Mato Grosso',
  'ms': 'Mato Grosso do Sul',
  'es': 'Espírito Santo',
  'al': 'Alagoas',
  'se': 'Sergipe',
  'rn': 'Rio Grande do Norte',
  'pb': 'Paraíba',
  'pi': 'Piauí',
  'ma': 'Maranhão',
  'to': 'Tocantins',
  'ro': 'Rondônia',
  'ac': 'Acre',
  'rr': 'Roraima',
  'ap': 'Amapá',
}

/**
 * Normaliza um token isolado que seja sigla de cidade ou estado.
 * Preserva o restante da string intacto.
 */
function normalizeGeoToken(token: string): string {
  const lower = token.toLowerCase().trim()
  return CITY_ALIASES[lower] ?? STATE_ALIASES[lower] ?? token
}

/**
 * Percorre a string e substitui siglas/apelidos geográficos conhecidos
 * por suas formas canônicas. Opera por token (palavra separada por espaço
 * ou após "em ", "de ", "no ", "na ").
 */
function normalizeGeography(value: string): string {
  return value.replace(
    /\b([A-Za-zÀ-ú]{2,})\b/g,
    (match) => normalizeGeoToken(match)
  )
}

/**
 * Normalização central de um valor de memória.
 * Pipeline:  trim → lowercase interno → geo → capitalização de sentença.
 */
export function normalizeValue(raw: string): string {
  const trimmed = raw.trim()
  const geoNorm = normalizeGeography(trimmed)
  // Garante primeira letra maiúscula (preserva o restante da capitalização original)
  return geoNorm.charAt(0).toUpperCase() + geoNorm.slice(1)
}

// ─── Validação ────────────────────────────────────────────────────────────────

export function isValidMemory(item: unknown): item is ExtractedMemory {
  if (!item || typeof item !== 'object') return false
  const m = item as Record<string, unknown>

  if (!ALLOWED_TYPES.includes(m.type as MemoryType))                              return false
  if (typeof m.value !== 'string' || m.value.trim().length < 3)                   return false
  if (isAbsenceValue(m.value as string))                                           return false
  if (isFirstPersonValue(m.value as string))                                       return false
  if (isNoiseValue(m.value as string))                                             return false
  if (typeof m.granularity !== 'string' || m.granularity.trim().length === 0)     return false
  if (typeof m.confidence !== 'number' || m.confidence < 0.5 || m.confidence > 1) return false
  if (typeof m.needs_disambiguation !== 'boolean')                                 return false

  return true
}

export function isValidTask(item: unknown): item is ExtractedTask {
  if (!item || typeof item !== 'object') return false
  const t = item as Record<string, unknown>

  if (typeof t.title !== 'string' || t.title.trim().length < 2)                   return false
  if (!ALLOWED_TASK_STATUSES.includes(t.status as TaskStatus))                     return false
  if (typeof t.importance !== 'number' || t.importance < 1 || t.importance > 10)  return false

  return true
}

// ─── Normalização de objeto completo ─────────────────────────────────────────

export function normalizeMemory(m: ExtractedMemory): ExtractedMemory {
  return {
    type:                 m.type,
    value:                normalizeValue(m.value),
    granularity:          m.granularity.trim().toLowerCase(),
    confidence:           Math.round(m.confidence * 100) / 100,
    needs_disambiguation: m.needs_disambiguation,
    scope:                m.scope ?? TYPE_TO_SCOPE[m.type] ?? 'global',
    importance:           m.importance ?? TYPE_IMPORTANCE[m.type] ?? 5,
    source:               m.source ?? 'explicit',
    supersedes:           m.supersedes ? normalizeValue(m.supersedes) : undefined,
  }
}