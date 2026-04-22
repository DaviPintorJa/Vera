// lib/llm/memory/extractor.ts
//
// Extrator unificado: domínio pessoal + domínio de projeto.
// Arquitetura dual-layer: quick patterns (regex) + LLM (70b via cliente unificado).
// Este módulo NÃO decide nem salva diretamente — orquestra candidatos e persiste.

import { callGroq, GROQ_MODELS }      from '@/lib/llm/groq/client'
import { createServiceClient }         from '@/lib/llm/supabase/server'
import type { ExtractionResult as PipelineExtractionResult } from '../types'
import { buildExtractionPrompt }       from './prompt'
import { isValidTask }                 from './validator'

// ─── System prompt minimalista para extração ──────────────────────────────────

const EXTRACTION_SYSTEM_PROMPT =
  'You are a strict memory extraction system. ' +
  'Respond ONLY with valid JSON. No markdown, no explanation, no code fences.'

// ═══════════════════════════════════════════════════════════════════════════════
// PARTE 1 — TIPOS E DOMÍNIOS
// ═══════════════════════════════════════════════════════════════════════════════

export const PERSONAL_TYPES = [
  'identity', 'location', 'relationship', 'goal',
  'preference', 'profession', 'context',
] as const

export const PROJECT_TYPES = [
  'project_goal', 'project_decision', 'project_constraint',
  'project_scope', 'project_state',
] as const

export type PersonalType  = typeof PERSONAL_TYPES[number]
export type ProjectType   = typeof PROJECT_TYPES[number]
export type CandidateType = PersonalType | ProjectType

export type EntityDomain = 'human' | 'pet' | 'location' | 'object' | 'other'

export interface MemoryCandidate {
  type:                 CandidateType
  value:                string
  granularity:          string
  confidence:           number
  needs_disambiguation: boolean
  source:               'quick' | 'llm'
  domain:               EntityDomain
  supersedes?:          string
}

export type ExplicitCommand =
  | { kind: 'remember'; raw: string }
  | { kind: 'forget';   raw: string }
  | { kind: 'correct';  raw: string }

export interface CandidateExtractionResult {
  candidates: MemoryCandidate[]
  command:    ExplicitCommand | null
}

// ═══════════════════════════════════════════════════════════════════════════════
// PARTE 2 — DETECÇÃO DE COMANDOS EXPLÍCITOS
// ═══════════════════════════════════════════════════════════════════════════════

const REMEMBER_PATTERNS = [
  /vera[,:]?\s+lembra(?:\s+disso)?[:\-]?\s*(.+)/i,
  /vera[,:]?\s+guarda\s+(?:isso|que)[:\-]?\s*(.+)/i,
  /vera[,:]?\s+anota\s+(?:isso|que)[:\-]?\s*(.+)/i,
  /vera[,:]?\s+salva\s+(?:isso|que)[:\-]?\s*(.+)/i,
]
const FORGET_PATTERNS = [
  /vera[,:]?\s+esquece?\s+(?:isso|que|o?a?s?)[:\-]?\s*(.+)/i,
  /vera[,:]?\s+apaga\s+(?:isso|que)[:\-]?\s*(.+)/i,
  /vera[,:]?\s+deleta\s+(?:isso|que)[:\-]?\s*(.+)/i,
  /vera[,:]?\s+remove\s+(?:isso|que)[:\-]?\s*(.+)/i,
]
const CORRECT_PATTERNS = [
  /vera[,:]?\s+(?:isso está errado|está errado)[,.]?\s*(?:na verdade[,:]?)?\s*(.+)/i,
  /vera[,:]?\s+corrige?[:\-]?\s*(.+)/i,
  /vera[,:]?\s+na verdade[,:]?\s*(.+)/i,
  /(?:está|tá) errado[,.]?\s+na verdade[,:]?\s*(.+)/i,
]

function detectExplicitCommand(message: string): ExplicitCommand | null {
  for (const p of REMEMBER_PATTERNS) { const m = message.match(p); if (m) return { kind: 'remember', raw: m[1].trim() } }
  for (const p of FORGET_PATTERNS)   { const m = message.match(p); if (m) return { kind: 'forget',   raw: m[1].trim() } }
  for (const p of CORRECT_PATTERNS)  { const m = message.match(p); if (m) return { kind: 'correct',  raw: m[1].trim() } }
  return null
}

// ═══════════════════════════════════════════════════════════════════════════════
// PARTE 3 — UTILITÁRIOS
// ═══════════════════════════════════════════════════════════════════════════════

const HEDGING_RE = /\b(acho que|acho|talvez|provavelmente|não tenho certeza|pode ser|quem sabe|meio que|mais ou menos)\b/i
const THIRD_PARTY_RE = [
  /^(minha|meu)\s+(esposa?|marido|namorada?|parceira?|filha?|filho|mãe|pai|irmã|irmão|amiga?|colega)\s+(gosta|não gosta|odeia|ama|prefere|detesta|quer|precisa|tem|é|está|trabalha|mora|estuda)/i,
  /^(ela|ele)\s+(gosta|não gosta|odeia|ama|prefere|detesta|quer|precisa|tem|é|está|trabalha|mora|estuda)/i,
]

function detectHedging(msg: string):         boolean { return HEDGING_RE.test(msg) }
function isThirdPartyStatement(msg: string): boolean { return THIRD_PARTY_RE.some(p => p.test(msg.trim())) }

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

export function normalizeValue(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function isAbsenceValue(value: string): boolean {
  return [
    /não (informou|forneceu|mencionou|disse|revelou|indicou)/i,
    /nenhum[ao]? (preferência|informação|dado|objetivo|detalhe|contexto)/i,
    /sem (informação|dados|preferência|contexto|detalhes)/i,
    /usuário não/i,
    /not (provided|mentioned|specified|given|stated)/i,
  ].some(p => p.test(value))
}

// ─── Pet helpers ──────────────────────────────────────────────────────────────

const PET_WORDS_RE = /\b(gato|cachorro|cão|cadela|papagaio|calopsita|peixe|hamster|coelho|tartaruga|cobra|pássaro|ave|pet|animal|gata|filhote|bicho)\b/i
const PET_NAME_PATTERNS = [
  /\b(?:gato|cachorro|cão|cadela|peixe|hamster|coelho|pássaro|ave|pet|bicho)\s+(?:chamad[oa]|de nome|se chama)\s+([A-ZÀ-Ú][a-zà-ú]+)/i,
  /\btenho\s+(?:um|uma)\s+(?:gato|cachorra?|cão|peixe|hamster|coelho|pássaro|pet)\s+(?:chamad[oa]|que se chama)?\s*([A-ZÀ-Ú][a-zà-ú]+)/i,
  /\b(?:meu|minha)\s+(?:gato|cachorra?|cão|peixe|hamster|coelho|pássaro|pet)\s+(?:se chama|é|chamad[oa])\s+([A-ZÀ-Ú][a-zà-ú]+)/i,
]

function hasPetContext(msg: string):  boolean      { return PET_WORDS_RE.test(msg) }
function extractPetName(msg: string): string | null {
  for (const p of PET_NAME_PATTERNS) { const m = msg.match(p); if (m) return m[m.length - 1].trim() }
  return null
}

// ─── Geo helpers ──────────────────────────────────────────────────────────────

const BR_STATES = new Set([
  'acre','alagoas','amapa','amazonas','bahia','ceara','distrito federal','espirito santo',
  'goias','maranhao','mato grosso','mato grosso do sul','minas gerais','para','paraiba','parana',
  'pernambuco','piaui','rio de janeiro','rio grande do norte','rio grande do sul','rondonia',
  'roraima','santa catarina','sao paulo','sergipe','tocantins',
])
const KNOWN_COUNTRIES = new Set([
  'brasil','estados unidos','eua','canada','mexico','argentina','chile','portugal','espanha',
  'franca','alemanha','italia','reino unido','japao','china','india','australia',
])

// ─── Sanitização de entidade ──────────────────────────────────────────────────

const EMPHATIC_WORDS = [
  'mesmo','né','né não','certo','ok','assim','também','ainda','aliás','afinal',
  'enfim','então','ué','pois é','tá','tá bom','sim','não','tipo','sabe','entende','é isso','isso',
]
const EMPHATIC_SUFFIX_RE = new RegExp(
  `\\s+(${EMPHATIC_WORDS.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\s*$`, 'i'
)

function sanitizeEntityValue(value: string): string | null {
  let v = value.trim(), prev = ''
  while (v !== prev) { prev = v; v = v.replace(EMPHATIC_SUFFIX_RE, '').trim() }
  if (/[^a-zA-Z\u00C0-\u024F\u1E00-\u1EFF\s\-'\.:0-9]/.test(v)) return null
  if (v.length < 2) return null
  return v
}

// ─── Classificação de domínio ─────────────────────────────────────────────────

function classifyDomain(type: CandidateType, granularity: string, value: string, message: string): EntityDomain {
  const norm = normalizeValue(value)
  if (BR_STATES.has(norm) || KNOWN_COUNTRIES.has(stripAccents(norm))) return 'location'
  if (type === 'location') return 'location'
  if (PROJECT_TYPES.includes(type as ProjectType)) return 'other'
  if (type === 'relationship') return granularity === 'pet' ? 'pet' : 'human'
  if (type === 'identity' && (granularity === 'firstname' || granularity === 'fullname')) {
    const petName = extractPetName(message)
    if ((petName && petName.toLowerCase() === value.toLowerCase()) || hasPetContext(message)) return 'pet'
    return 'human'
  }
  return 'other'
}

// ─── Inferência de granularidade ──────────────────────────────────────────────

function inferGranularity(type: CandidateType, value: string): string {
  const v = stripAccents(normalizeValue(value))
  const words = value.trim().split(/\s+/)
  switch (type) {
    case 'identity': {
      if (/^\d{1,2}\s*anos?$/.test(v))                              return 'age'
      if (/^(masculino|feminino|nao.binario|outro)$/.test(v))        return 'gender'
      if (/^(brasileiro|brasileira|americano|portuguesa?)$/.test(v)) return 'nationality'
      return words.length >= 2 ? 'fullname' : 'firstname'
    }
    case 'location': {
      if (KNOWN_COUNTRIES.has(stripAccents(v))) return 'country'
      if (BR_STATES.has(v))                     return 'state'
      return 'city'
    }
    case 'profession': {
      if (/\b(ltda|s\.?a\.?|inc\.?|eireli|me\b|epp\b)\b/i.test(v)) return 'company'
      if (words.length > 1 && words.every(w => /^[A-ZÀ-Ú]/.test(w))) return 'company'
      return 'title'
    }
    case 'relationship': {
      if (/\b(esposa|esposo|namorada|namorado|parceira|parceiro|marido|mulher)\b/i.test(value)) return 'spouse'
      if (/\b(pai|padrasto)\b/i.test(value))                                                     return 'parent'
      if (/\b(mãe|mae|madrasta)\b/i.test(value))                                                 return 'parent'
      if (/\b(filho|filha)\b/i.test(value))                                                       return 'child'
      if (/\b(irmão|irmao|irmã|irma)\b/i.test(value))                                            return 'sibling'
      if (/\b(cachorro|cão|cao|cadela|gato|gata|peixe|hamster|coelho|pássaro|pet|animal|bicho)\b/i.test(value)) return 'pet'
      return 'family'
    }
    case 'goal':
      if (/\b(aprender|estudar|dominar|entender)\b/i.test(v)) return 'learning'
      if (/\b(trabalhar|carreira|emprego|cargo)\b/i.test(v))  return 'career'
      return 'personal'
    case 'preference':
      return (/^nao (gosta|gosto|curto)/i.test(v) || /\b(detesta|odeia)\b/i.test(v)) ? 'dislike' : 'hobby'
    case 'context':
      return /^(casado|casada|solteiro|solteira|divorciado|divorciada|viuvo|viuva)/.test(v) ? 'marital_status' : 'other'
    case 'project_goal':        return 'project_goal'
    case 'project_decision':    return 'project_decision'
    case 'project_constraint':  return 'project_constraint'
    case 'project_scope':       return 'project_scope'
    case 'project_state':       return 'project_state'
    default:                    return 'other'
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PARTE 4 — QUICK PATTERNS (regex determinístico, zero tokens)
// ═══════════════════════════════════════════════════════════════════════════════

interface QuickPattern {
  regex: RegExp; type: CandidateType; granularity: string
  confidence: number; extract: (m: RegExpMatchArray) => string
}

const QUICK_PATTERNS: QuickPattern[] = [
  // Identidade
  { regex: /\bmeu nome é ([A-ZÀ-Ú][a-zà-ú]+(?:\s[A-ZÀ-Ú][a-zà-ú]+)+)/i, type: 'identity', granularity: 'fullname',  confidence: 0.95, extract: m => m[1].trim() },
  { regex: /\bmeu nome é ([A-ZÀ-Ú][a-zà-ú]+)/i,                            type: 'identity', granularity: 'firstname', confidence: 0.93, extract: m => m[1].trim() },
  { regex: /\bme chamo ([A-ZÀ-Ú][a-zà-ú]+)/i,                              type: 'identity', granularity: 'firstname', confidence: 0.95, extract: m => m[1].trim() },
  { regex: /\btenho ([0-9]{1,2}) anos/i,                                     type: 'identity', granularity: 'age',       confidence: 0.90, extract: m => m[1].trim() },
  { regex: /\bsou (casado|casada|solteiro|solteira|divorciado|divorciada|viuvo|viuva)/i, type: 'context', granularity: 'marital_status', confidence: 0.85, extract: m => m[1].trim() },
  // Relacionamentos
  { regex: /\bminha\s+(esposa|namorada|parceira|mulher)\s+(?:se chama|é|chamada)?\s*([A-ZÀ-Ú][a-zà-ú]+)/i, type: 'relationship', granularity: 'spouse',  confidence: 0.94, extract: m => m[2].trim() },
  { regex: /\bmeu\s+(esposo|namorado|parceiro|marido)\s+(?:se chama|é|chamado)?\s*([A-ZÀ-Ú][a-zà-ú]+)/i,  type: 'relationship', granularity: 'spouse',  confidence: 0.94, extract: m => m[2].trim() },
  { regex: /\bmeu\s+pai\s+(?:se chama|é|chamado)?\s*([A-ZÀ-Ú][a-zà-ú]+)/i,                                type: 'relationship', granularity: 'parent',  confidence: 0.93, extract: m => m[1].trim() },
  { regex: /\bminha\s+mãe\s+(?:se chama|é|chamada)?\s*([A-ZÀ-Ú][a-zà-ú]+)/i,                             type: 'relationship', granularity: 'parent',  confidence: 0.93, extract: m => m[1].trim() },
  { regex: /\bmeu\s+(filho|filha)\s+(?:se chama|é|chamado|chamada)?\s*([A-ZÀ-Ú][a-zà-ú]+)/i,              type: 'relationship', granularity: 'child',   confidence: 0.93, extract: m => m[2].trim() },
  { regex: /\bminha?\s+(irmã|irmão)\s+(?:se chama|é|chamada|chamado)?\s*([A-ZÀ-Ú][a-zà-ú]+)/i,            type: 'relationship', granularity: 'sibling', confidence: 0.92, extract: m => m[2].trim() },
  { regex: /\bmeu\s+(cachorro|cão|pet)\s+(?:se chama|é|chamado)?\s*([A-ZÀ-Ú][a-zà-ú]+)/i,                 type: 'relationship', granularity: 'pet',     confidence: 0.95, extract: m => m[2].trim() },
  { regex: /\bminha\s+(cadela|gata|pet)\s+(?:se chama|é|chamada)?\s*([A-ZÀ-Ú][a-zà-ú]+)/i,               type: 'relationship', granularity: 'pet',     confidence: 0.95, extract: m => m[2].trim() },
  { regex: /\bmeu\s+gato\s+(?:se chama|é|chamado)?\s*([A-ZÀ-Ú][a-zà-ú]+)/i,                              type: 'relationship', granularity: 'pet',     confidence: 0.95, extract: m => m[1].trim() },
  // Localização
  { regex: /\bmoro em ([A-ZÀ-Ú][a-zà-ú]+(?:\s[A-ZÀ-Ú][a-zà-ú]+)*)/i, type: 'location', granularity: 'city', confidence: 0.90, extract: m => m[1].trim() },
  { regex: /\bsou de ([A-ZÀ-Ú][a-zà-ú]+(?:\s[A-ZÀ-Ú][a-zà-ú]+)*)/i,  type: 'location', granularity: 'city', confidence: 0.90, extract: m => m[1].trim() },
  // Profissão
  { regex: /\btrabalho como ([a-zà-ú]+(?:\s[a-zà-ú]+)*)/i,                  type: 'profession', granularity: 'title',   confidence: 0.85, extract: m => m[1].trim() },
  { regex: /\btrabalho na ([A-ZÀ-Ú][a-zà-ú]+(?:\s[A-ZÀ-Ú][a-zà-ú]+)*)/i,  type: 'profession', granularity: 'company', confidence: 0.85, extract: m => m[1].trim() },
  // Preferências e objetivos
  { regex: /\bgosto de ([a-zà-ú]+(?:\s[a-zà-ú]+)*)/i,        type: 'preference', granularity: 'hobby',    confidence: 0.80, extract: m => m[1].trim() },
  { regex: /\bnão gosto de ([a-zà-ú]+(?:\s[a-zà-ú]+)*)/i,    type: 'preference', granularity: 'dislike',  confidence: 0.80, extract: m => m[1].trim() },
  { regex: /\bmeu objetivo é ([a-zà-ú]+(?:\s[a-zà-ú]+)*)/i,  type: 'goal',       granularity: 'personal', confidence: 0.80, extract: m => m[1].trim() },
  { regex: /\bquero aprender ([a-zà-ú]+(?:\s[a-zà-ú]+)*)/i,  type: 'goal',       granularity: 'learning', confidence: 0.80, extract: m => m[1].trim() },
  // Projeto — decisões explícitas
  { regex: /\bvamos usar ([a-zà-ú0-9\s\-\.]+) como banco de dados/i,  type: 'project_decision',   granularity: 'project_decision',   confidence: 0.92, extract: m => `O projeto usa ${m[1].trim()} como banco de dados` },
  { regex: /\bvou usar ([a-zà-ú0-9\s\-\.]+) como banco de dados/i,    type: 'project_decision',   granularity: 'project_decision',   confidence: 0.90, extract: m => `O projeto usa ${m[1].trim()} como banco de dados` },
  { regex: /\bnão (?:vou|quero) usar ([a-zà-ú0-9\s\-\.]+)/i,          type: 'project_constraint', granularity: 'project_constraint', confidence: 0.85, extract: m => `O projeto não usa ${m[1].trim()}` },
  { regex: /\bo objetivo do projeto é ([a-zà-ú0-9\s\-\.,]+)/i,        type: 'project_goal',       granularity: 'project_goal',       confidence: 0.90, extract: m => m[1].trim() },
  { regex: /\bquero construir ([a-zà-ú0-9\s\-\.,]+)/i,                 type: 'project_goal',       granularity: 'project_goal',       confidence: 0.82, extract: m => m[1].trim() },
]

function runQuickPatterns(message: string): MemoryCandidate[] {
  const candidates: MemoryCandidate[] = []
  for (const p of QUICK_PATTERNS) {
    const m = message.match(p.regex)
    if (!m) continue
    const value = p.extract(m)
    if (!value || isAbsenceValue(value)) continue
    candidates.push({
      type: p.type, value, granularity: p.granularity,
      confidence: p.confidence, needs_disambiguation: false,
      source: 'quick',
      domain: classifyDomain(p.type, p.granularity, value, message),
    })
  }
  return candidates
}

// ═══════════════════════════════════════════════════════════════════════════════
// PARTE 5 — EXTRAÇÃO VIA LLM (70b — precisão máxima)
// ═══════════════════════════════════════════════════════════════════════════════

interface LLMItem {
  type: CandidateType; value: string
  confidence: number; needs_disambiguation: boolean; supersedes?: string
}

function isValidLLMItem(item: unknown): item is LLMItem {
  if (!item || typeof item !== 'object') return false
  const i = item as Record<string, unknown>
  const allTypes = [...PERSONAL_TYPES, ...PROJECT_TYPES]
  return (
    allTypes.includes(i.type as CandidateType) &&
    typeof i.value === 'string' && typeof i.confidence === 'number' &&
    i.confidence >= 0 && i.confidence <= 1 &&
    typeof i.needs_disambiguation === 'boolean'
  )
}

function buildLLMPrompt(userMessage: string, assistantReply: string, hasHedging: boolean, hasPet: boolean, petName: string | null): string {
  return `You are a memory extraction system for VERA (personal AI assistant).
Extract TWO categories from the conversation:

━━━ CATEGORY A — PERSONAL MEMORIES ━━━
Analyze ONLY what the USER said about THEMSELVES.
Types: identity | location | relationship | goal | preference | profession | context
- identity: user's own name, age, gender, nationality ONLY. NEVER family/pet names.
- relationship: name of people/pets with relational role. value = pure name.
- STRIP emphatic particles: mesmo, né, certo, ok, assim, também, tipo, sabe.

━━━ CATEGORY B — PROJECT MEMORIES ━━━
Analyze project decisions, constraints and goals.
Types: project_goal | project_decision | project_constraint | project_scope | project_state
- value = complete third-person sentence in pt-BR (max 20 words).
  E.g. "O projeto usa Supabase como banco de dados"

OUTPUT: JSON array, each item:
{"type":"...","value":"...","confidence":0.6-1.0,"needs_disambiguation":bool,"supersedes":"old value if correction"}

RULES:
1. Return ONLY valid JSON array.
2. NEVER invent or infer — only explicitly stated facts.
3. If nothing to extract → return [].
4. NEVER extract absence of information.
${hasPet ? `5. Pet detected${petName ? ` ("${petName}")` : ''}. Pet names → relationship, NEVER identity.` : ''}
${hasHedging ? '6. Hedging detected. confidence < 0.72, needs_disambiguation: true.' : ''}

User: "${userMessage}"
Assistant: "${assistantReply}"
JSON array:`
}

async function runLLMExtraction(userMessage: string, assistantReply: string): Promise<MemoryCandidate[]> {
  if (isThirdPartyStatement(userMessage)) return []

  const hasHedging = detectHedging(userMessage)
  const hasPet     = hasPetContext(userMessage)
  const petName    = extractPetName(userMessage)

  let raw: string
  try {
    raw = await callGroq(
      [{ role: 'user', content: buildLLMPrompt(userMessage, assistantReply, hasHedging, hasPet, petName) }],
      { model: GROQ_MODELS.PRECISE, systemPrompt: EXTRACTION_SYSTEM_PROMPT, temperature: 0.0, maxTokens: 600 }
    )
  } catch (err) {
    console.error('[EXTRACTOR][LLM] Erro:', err instanceof Error ? err.message : err)
    return []
  }

  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  let parsed: unknown[]
  try { const p = JSON.parse(cleaned); parsed = Array.isArray(p) ? p : [] }
  catch { console.error('[EXTRACTOR][LLM] Parse falhou:', cleaned.slice(0, 200)); return [] }

  const results: MemoryCandidate[] = []

  for (const item of parsed) {
    if (!isValidLLMItem(item)) continue

    const isPersonal = PERSONAL_TYPES.includes(item.type as PersonalType)
    const value      = isPersonal ? sanitizeEntityValue(item.value) : item.value.trim()
    if (!value || isAbsenceValue(value)) continue

    if (item.type === 'identity' && hasPet && petName && normalizeValue(value) === normalizeValue(petName)) continue

    const granularity = inferGranularity(item.type, value)
    const domain      = classifyDomain(item.type, granularity, value, userMessage)
    const confidence  = hasHedging
      ? Math.max(0.5, Math.round((item.confidence - 0.1) * 100) / 100)
      : Math.round(item.confidence * 100) / 100

    if (confidence < 0.65) continue

    results.push({
      type: item.type, value, granularity, confidence, domain,
      needs_disambiguation: item.needs_disambiguation || hasHedging,
      source: 'llm',
      supersedes: item.supersedes?.trim() || undefined,
    })
  }

  return results
}

// ═══════════════════════════════════════════════════════════════════════════════
// PARTE 6 — MERGE, DEDUP E EXPORT DE CANDIDATOS
// ═══════════════════════════════════════════════════════════════════════════════

function deduplicateCandidates(candidates: MemoryCandidate[]): MemoryCandidate[] {
  const seen = new Map<string, MemoryCandidate>()
  for (const c of candidates) {
    const key = `${c.type}:${c.granularity}:${normalizeValue(c.value)}`
    if (!seen.has(key) || seen.get(key)!.confidence < c.confidence) seen.set(key, c)
  }
  return Array.from(seen.values())
}

export async function extractCandidates(
  userMessage: string, assistantReply: string
): Promise<CandidateExtractionResult> {
  const command         = detectExplicitCommand(userMessage)
  const quickCandidates = runQuickPatterns(userMessage)
  const llmCandidates   = await runLLMExtraction(userMessage, assistantReply)

  const processed = new Set<string>()
  const merged: MemoryCandidate[] = []

  for (const c of quickCandidates) {
    const key = `${c.type}:${c.granularity}`
    if (processed.has(key)) continue
    processed.add(key); merged.push(c)
  }
  for (const c of llmCandidates) {
    const key = `${c.type}:${c.granularity}`
    if (processed.has(key)) continue
    processed.add(key); merged.push(c)
  }

  const candidates = deduplicateCandidates(merged)
  console.log(`[EXTRACTOR] Quick: ${quickCandidates.length} | LLM: ${llmCandidates.length} | Merged: ${candidates.length} | Cmd: ${command?.kind ?? 'none'}`)
  return { candidates, command }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PARTE 7 — PERSISTÊNCIA
// ═══════════════════════════════════════════════════════════════════════════════

const CANDIDATE_SCOPE: Record<CandidateType, 'global' | 'project'> = {
  identity: 'global', location: 'global', relationship: 'global',
  goal: 'global', preference: 'global', profession: 'global', context: 'global',
  project_goal: 'project', project_decision: 'project', project_constraint: 'project',
  project_scope: 'project', project_state: 'project',
}

const CANDIDATE_IMPORTANCE: Record<CandidateType, number> = {
  project_goal: 9, project_decision: 8, project_constraint: 8,
  project_scope: 7, project_state: 7, goal: 7, identity: 6,
  profession: 6, context: 6, relationship: 5, preference: 5, location: 4,
}

async function alreadyExists(service: ReturnType<typeof createServiceClient>, userId: string, type: string, value: string): Promise<boolean> {
  const { data, error } = await service.from('memories').select('id').eq('user_id', userId).eq('type', type).eq('status', 'active').ilike('value', value.trim()).limit(1)
  if (error) { console.warn('[EXTRACTOR] Erro dedup:', error.message); return false }
  return (data?.length ?? 0) > 0
}

async function supersedeMemory(service: ReturnType<typeof createServiceClient>, userId: string, type: string, oldValue: string): Promise<void> {
  const { error } = await service.from('memories').update({ status: 'superseded', valid_to: new Date().toISOString() }).eq('user_id', userId).eq('type', type).eq('status', 'active').ilike('value', oldValue.trim())
  if (error) console.warn('[EXTRACTOR] Erro supersede:', error.message)
  else console.log(`[EXTRACTOR] Supersedida: [${type}] "${oldValue}"`)
}

async function persistCandidates(
  service: ReturnType<typeof createServiceClient>,
  userId: string, chatId: string, candidates: MemoryCandidate[]
): Promise<{ saved: number; skipped: number }> {
  let saved = 0, skipped = 0

  for (const c of candidates) {
    if (c.supersedes) await supersedeMemory(service, userId, c.type, c.supersedes)

    const dup = await alreadyExists(service, userId, c.type, c.value)
    if (dup) { skipped++; continue }

    const scope = CANDIDATE_SCOPE[c.type] ?? 'global'
    const { error } = await service.from('memories').insert({
      user_id: userId,
      chat_id: scope === 'project' ? chatId : null,
      type: c.type, value: c.value, granularity: c.granularity,
      confidence: c.confidence, needs_disambiguation: c.needs_disambiguation,
      content: c.value, scope,
      importance: CANDIDATE_IMPORTANCE[c.type] ?? 5,
      status: 'active',
      source: c.source === 'quick' ? 'explicit' : 'inference',
      valid_from: new Date().toISOString(),
    })

    if (error) console.error(`[EXTRACTOR] Erro ao inserir [${c.type}] "${c.value}":`, error.message)
    else { console.log(`[EXTRACTOR] ✅ [${scope}/${c.type}] "${c.value}" (conf:${c.confidence})`); saved++ }
  }
  return { saved, skipped }
}

async function persistTasks(
  service: ReturnType<typeof createServiceClient>,
  userId: string, chatId: string, result: PipelineExtractionResult
): Promise<{ savedTasks: number }> {
  let savedTasks = 0

  for (const [i, item] of result.tasks.entries()) {
    if (!isValidTask(item)) { console.warn(`[EXTRACTOR] Tarefa ${i} rejeitada`); continue }

    const { data: existing } = await service.from('tasks').select('id, status').eq('user_id', userId).ilike('title', item.title.trim()).not('status', 'in', '("done","cancelled")').limit(1)

    if (existing && existing.length > 0) {
      if (existing[0].status !== item.status) {
        await service.from('tasks').update({ status: item.status, updated_at: new Date().toISOString(), completed_at: item.status === 'done' ? new Date().toISOString() : null }).eq('id', existing[0].id)
        console.log(`[EXTRACTOR] 🔄 Tarefa: "${item.title}" → ${item.status}`)
      }
      continue
    }

    const { error } = await service.from('tasks').insert({ user_id: userId, chat_id: chatId, title: item.title.trim(), description: item.description?.trim() ?? null, status: item.status, importance: item.importance })
    if (error) console.error(`[EXTRACTOR] Erro tarefa "${item.title}":`, error.message)
    else { console.log(`[EXTRACTOR] 📋 Tarefa: "${item.title}" (${item.status})`); savedTasks++ }
  }
  return { savedTasks }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PARTE 8 — PONTO DE ENTRADA PÚBLICO (compatível com pipeline.ts e memory/index.ts)
// ═══════════════════════════════════════════════════════════════════════════════

export async function runExtractionPipeline(
  userId: string, chatId: string, userMessage: string, assistantReply: string
): Promise<void> {
  if (!process.env.GROQ_API_KEY) { console.error('[EXTRACTOR] GROQ_API_KEY ausente.'); return }

  try {
    // Memórias e tarefas em paralelo — nenhuma bloqueia a outra
    const [{ candidates }, taskRaw] = await Promise.all([
      extractCandidates(userMessage, assistantReply),
      callGroq(
        [{ role: 'user', content: buildExtractionPrompt(userMessage, assistantReply) }],
        { model: GROQ_MODELS.PRECISE, systemPrompt: EXTRACTION_SYSTEM_PROMPT, temperature: 0.0, maxTokens: 800 }
      ).then(raw => {
        const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
        try { const p = JSON.parse(cleaned); return { memories: [], tasks: Array.isArray(p.tasks) ? p.tasks : [] } as PipelineExtractionResult }
        catch { return null }
      }).catch(() => null),
    ])

    const service = createServiceClient()
    const { saved, skipped } = await persistCandidates(service, userId, chatId, candidates)
    const { savedTasks }     = taskRaw ? await persistTasks(service, userId, chatId, taskRaw) : { savedTasks: 0 }

    console.log(`[EXTRACTOR] Resumo — memórias: +${saved}, duplicadas: ${skipped}, tarefas: +${savedTasks}`)
  } catch (err) {
    console.error('[EXTRACTOR] Erro inesperado:', err instanceof Error ? err.message : String(err))
  }
}