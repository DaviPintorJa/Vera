// lib/llm/memory.ts

import { createServiceClient } from '@/lib/supabase/server'

// ─── Tipos ────────────────────────────────────────────────────────────────────

const ALLOWED_TYPES = ['identity', 'location', 'goal', 'preference', 'context',
  'project_goal', 'project_decision', 'project_constraint',
  'project_scope', 'project_state'] as const

const ALLOWED_SCOPES = ['global', 'project', 'task', 'session'] as const
const ALLOWED_SOURCES = ['explicit', 'inference', 'pattern'] as const
const ALLOWED_TASK_STATUSES = ['open', 'in_progress', 'done', 'blocked', 'cancelled'] as const

type MemoryType = typeof ALLOWED_TYPES[number]
type MemoryScope = typeof ALLOWED_SCOPES[number]
type MemorySource = typeof ALLOWED_SOURCES[number]
type TaskStatus = typeof ALLOWED_TASK_STATUSES[number]

interface ExtractedMemory {
  type: MemoryType
  value: string
  granularity: string
  confidence: number
  needs_disambiguation: boolean
  scope: MemoryScope
  importance: number
  source: MemorySource
  supersedes?: string
}

interface ExtractedTask {
  title: string
  description?: string
  status: TaskStatus
  importance: number
}

interface ExtractionResult {
  memories: ExtractedMemory[]
  tasks: ExtractedTask[]
}

// ─── Mapa de importância e escopo por tipo ────────────────────────────────────

const TYPE_IMPORTANCE: Record<MemoryType, number> = {
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

const TYPE_TO_SCOPE: Record<MemoryType, MemoryScope> = {
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

// ─── Padrões de ausência e ruído — bloqueados antes do INSERT ─────────────────

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

// Detecta valores em primeira pessoa que escaparam da filtragem do prompt
const FIRST_PERSON_PATTERNS = [
  /^(eu |meu |minha |me |mim |nos |nossa |nosso )/i,
  /\b(eu sou|eu tenho|eu gosto|eu quero|eu moro|eu trabalho|meu nome é|minha esposa|meu pai|meu filho|minha filha|minha mãe)\b/i,
]

// Metalinguagem e ruído conversacional
const NOISE_PATTERNS = [
  /compartilhando informaç/i,
  /vou te contar/i,
  /estou (te |lhe )?(dizendo|falando|contando)/i,
  /informaç(ão|ões) pessoai/i,
  /só pra (constar|saber|registrar)/i,
  /acabei de (dizer|falar|mencionar)/i,
]

function isAbsenceValue(value: string): boolean {
  return ABSENCE_PATTERNS.some(p => p.test(value))
}

function isFirstPersonValue(value: string): boolean {
  return FIRST_PERSON_PATTERNS.some(p => p.test(value.trim()))
}

function isNoiseValue(value: string): boolean {
  return NOISE_PATTERNS.some(p => p.test(value))
}

// ─── Validação ────────────────────────────────────────────────────────────────

function isValidMemory(item: unknown): item is ExtractedMemory {
  if (!item || typeof item !== 'object') return false
  const m = item as Record<string, unknown>
  if (!ALLOWED_TYPES.includes(m.type as MemoryType)) return false
  if (typeof m.value !== 'string' || m.value.trim().length < 3) return false
  if (isAbsenceValue(m.value as string)) return false
  if (isFirstPersonValue(m.value as string)) return false
  if (isNoiseValue(m.value as string)) return false
  if (typeof m.granularity !== 'string' || m.granularity.trim().length === 0) return false
  if (typeof m.confidence !== 'number' || m.confidence < 0.5 || m.confidence > 1) return false
  if (typeof m.needs_disambiguation !== 'boolean') return false
  return true
}

function isValidTask(item: unknown): item is ExtractedTask {
  if (!item || typeof item !== 'object') return false
  const t = item as Record<string, unknown>
  if (typeof t.title !== 'string' || t.title.trim().length < 2) return false
  if (!ALLOWED_TASK_STATUSES.includes(t.status as TaskStatus)) return false
  if (typeof t.importance !== 'number' || t.importance < 1 || t.importance > 10) return false
  return true
}

// ─── Normalização ─────────────────────────────────────────────────────────────

function normalizeMemory(m: ExtractedMemory): ExtractedMemory {
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

// ─── Deduplicação ─────────────────────────────────────────────────────────────

async function alreadyExists(
  service: ReturnType<typeof createServiceClient>,
  userId: string,
  type: string,
  value: string
): Promise<boolean> {
  const { data, error } = await service
    .from('memories')
    .select('id')
    .eq('user_id', userId)
    .eq('type', type)
    .eq('status', 'active')
    .ilike('value', value.trim())
    .limit(1)

  if (error) { console.warn('[MEMORY] Erro ao verificar duplicação:', error.message); return false }
  return (data?.length ?? 0) > 0
}

// ─── Versionamento ────────────────────────────────────────────────────────────

async function supersede(
  service: ReturnType<typeof createServiceClient>,
  userId: string,
  type: string,
  oldValue: string
): Promise<void> {
  const { error } = await service
    .from('memories')
    .update({ status: 'superseded', valid_to: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('type', type)
    .eq('status', 'active')
    .ilike('value', oldValue.trim())

  if (error) console.warn('[MEMORY] Erro ao superseder:', error.message)
  else console.log(`[MEMORY] Supersedida: [${type}] "${oldValue}"`)
}

// ─── Prompt de extração (corrigido com few-shot e regras rígidas) ─────────────

function buildExtractionPrompt(userMessage: string, assistantReply: string): string {
  return `You are a strict memory extraction system for a personal AI assistant called VERA.
Your job is to extract durable, factual memories and actionable tasks from the conversation.

Return a JSON object with exactly two keys: "memories" and "tasks".

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CRITICAL RULES FOR THE "value" FIELD
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

RULE 1 — THIRD PERSON ONLY (most important rule):
The "value" field MUST always be written in the third person, describing the user objectively.
NEVER use first-person pronouns: eu, meu, minha, me, mim, nosso, nossa.

  ✗ WRONG:  "Meu nome é Davi"
  ✓ CORRECT: "O nome do usuário é Davi"

  ✗ WRONG:  "Minha esposa se chama Miriã"
  ✓ CORRECT: "A esposa do usuário se chama Miriã"

  ✗ WRONG:  "Meu pai se chama Pedro"
  ✓ CORRECT: "O pai do usuário se chama Pedro"

RULE 2 — CLEAN FACTS ONLY. Remove conversational artifacts and titles:
  ✗ WRONG:  "senhor Davi" (has conversational title)
  ✓ CORRECT: "O nome do usuário é Davi"

RULE 3 — NO NOISE OR META-CONVERSATION. These are NOT memories:
  - "Estou compartilhando informações pessoais"
  - "Vou te contar algo"
  - "Só pra constar"
  - "Acabei de mencionar"
  - Any sentence describing the act of sharing, not the fact itself
  → If you detect noise: return [] for memories

RULE 4 — DURABLE FACTS ONLY. Do not extract temporary states:
  ✗ "O usuário está com dor de cabeça hoje" (temporary)
  ✓ "O usuário tem alergia a amendoim" (durable)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TYPE CHEAT SHEET
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

identity       → Facts about the user themselves: name, age, gender, nationality
               → "O nome do usuário é Davi" | "O usuário tem 34 anos"

location       → Where the user lives or works
               → "O usuário mora em São Paulo" | "O usuário trabalha no Rio de Janeiro"

goal           → Personal long-term objectives, ambitions, plans
               → "O usuário quer lançar um produto de IA em 2025"

preference     → Durable likes, dislikes, habits, hobbies
               → "O usuário prefere respostas técnicas e diretas"

context        → Family, profession, tools, life situation of the user
               → "A esposa do usuário se chama Miriã"
               → "O pai do usuário se chama Pedro"
               → "O usuário trabalha como engenheiro de software"

project_goal        → The main goal of the active project
project_decision    → A technical or strategic decision made in this project
project_constraint  → A hard constraint or limitation for this project
project_scope       → The current scope or focus of the project
project_state       → The current status or progress of the project

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FEW-SHOT EXAMPLES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Example 1:
User: "Meu nome é Davi e minha esposa se chama Miriã."
Output:
{
  "memories": [
    {"type": "identity",  "value": "O nome do usuário é Davi",              "granularity": "first_name", "confidence": 1.0, "needs_disambiguation": false, "scope": "global",  "importance": 6, "source": "explicit"},
    {"type": "context",   "value": "A esposa do usuário se chama Miriã",    "granularity": "personal",   "confidence": 1.0, "needs_disambiguation": false, "scope": "global",  "importance": 5, "source": "explicit"}
  ],
  "tasks": []
}

Example 2:
User: "Estou compartilhando informações pessoais com você agora."
Output:
{
  "memories": [],
  "tasks": []
}

Example 3:
User: "Meu pai se chama Pedro e minha mãe se chama Ana."
Output:
{
  "memories": [
    {"type": "context", "value": "O pai do usuário se chama Pedro", "granularity": "personal", "confidence": 1.0, "needs_disambiguation": false, "scope": "global", "importance": 4, "source": "explicit"},
    {"type": "context", "value": "A mãe do usuário se chama Ana",  "granularity": "personal", "confidence": 1.0, "needs_disambiguation": false, "scope": "global", "importance": 4, "source": "explicit"}
  ],
  "tasks": []
}

Example 4:
User: "Vamos usar o Supabase como banco de dados do projeto. Não quero embeddings por enquanto."
Output:
{
  "memories": [
    {"type": "project_decision",   "value": "O projeto usa Supabase como banco de dados",      "granularity": "other", "confidence": 1.0, "needs_disambiguation": false, "scope": "project", "importance": 8, "source": "explicit"},
    {"type": "project_constraint", "value": "O projeto não usa embeddings por enquanto",        "granularity": "other", "confidence": 0.9, "needs_disambiguation": false, "scope": "project", "importance": 7, "source": "explicit"}
  ],
  "tasks": []
}

Example 5:
User: "Preciso implementar autenticação e depois cuidar da parte de memória."
Output:
{
  "memories": [],
  "tasks": [
    {"title": "Implementar autenticação",  "description": null,                            "status": "open", "importance": 7},
    {"title": "Implementar sistema de memória", "description": null,                       "status": "open", "importance": 6}
  ]
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MEMORY SCHEMA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Each memory object:
{
  "type": one of the types listed above,
  "value": "fact in third person, in Portuguese (pt-BR)",
  "granularity": "full_name"|"first_name"|"country"|"state"|"city"|"profession"|"hobby"|"personal"|"other",
  "confidence": number 0.5–1.0,
  "needs_disambiguation": boolean,
  "scope": "global" for personal facts | "project" for project facts,
  "importance": integer 1–10 (use cheat sheet guidance),
  "source": "explicit"|"inference"|"pattern",
  "supersedes": "exact old value this replaces (only when user explicitly corrects a fact)"
}

FINAL RULES:
- Return ONLY valid JSON. No markdown, no explanation, no code fences.
- If nothing to extract: {"memories": [], "tasks": []}
- NEVER extract absence of information.
- "supersedes" only when the user explicitly updates or corrects a previous fact.

Conversation to analyze:
User: ${userMessage}
Assistant: ${assistantReply}

JSON:`
}

// ─── Função principal ─────────────────────────────────────────────────────────

export async function extractAndSaveMemories(
  userId: string,
  chatId: string,
  userMessage: string,
  assistantReply: string
): Promise<void> {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) { console.error('[MEMORY] GROQ_API_KEY ausente. Extração abortada.'); return }

  try {
    console.log('[MEMORY] Iniciando extração para user:', userId)

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [
          {
            role: 'system',
            content: 'You are a strict memory extraction system. Respond ONLY with valid JSON. No markdown, no explanation, no code fences.',
          },
          { role: 'user', content: buildExtractionPrompt(userMessage, assistantReply) },
        ],
        temperature: 0.0,   // zero: máximo determinismo para seguir as regras
        max_tokens: 1200,
      }),
    })

    if (!response.ok) {
      console.error(`[MEMORY] Groq erro ${response.status}:`, await response.text())
      return
    }

    const data = await response.json()
    let raw: string = data.choices?.[0]?.message?.content?.trim() ?? ''
    if (!raw) { console.warn('[MEMORY] Resposta vazia.'); return }

    // Limpar markdown residual
    raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()

    let result: ExtractionResult
    try {
      const parsed = JSON.parse(raw)
      result = {
        memories: Array.isArray(parsed.memories) ? parsed.memories : [],
        tasks:    Array.isArray(parsed.tasks)    ? parsed.tasks    : [],
      }
    } catch (err) {
      console.error('[MEMORY] Falha ao parsear JSON:', raw.slice(0, 200), err)
      return
    }

    const service = createServiceClient()
    let savedMemories = 0, savedTasks = 0, skipped = 0, rejected = 0

    // ── Processar memórias ────────────────────────────────────────────────────
    for (const [i, item] of result.memories.entries()) {
      if (!isValidMemory(item)) {
        console.warn(`[MEMORY] Memória ${i} rejeitada (validação):`, JSON.stringify(item).slice(0, 120))
        rejected++
        continue
      }
      const mem = normalizeMemory(item)

      if (mem.supersedes) await supersede(service, userId, mem.type, mem.supersedes)

      const dup = await alreadyExists(service, userId, mem.type, mem.value)
      if (dup) { skipped++; continue }

      const { error } = await service.from('memories').insert({
        user_id:              userId,
        chat_id:              TYPE_TO_SCOPE[mem.type] === 'project' ? chatId : null,
        type:                 mem.type,
        value:                mem.value,
        granularity:          mem.granularity,
        confidence:           mem.confidence,
        needs_disambiguation: mem.needs_disambiguation,
        content:              mem.value,
        scope:                mem.scope,
        importance:           mem.importance,
        status:               'active',
        source:               mem.source,
        valid_from:           new Date().toISOString(),
      })

      if (error) {
        console.error(`[MEMORY] Erro ao inserir [${mem.type}] "${mem.value}":`, error.message)
      } else {
        console.log(`[MEMORY] ✅ [${mem.scope}/${mem.type}] "${mem.value}" (imp:${mem.importance}, src:${mem.source})`)
        savedMemories++
      }
    }

    // ── Processar tarefas ─────────────────────────────────────────────────────
    for (const [i, item] of result.tasks.entries()) {
      if (!isValidTask(item)) {
        console.warn(`[MEMORY] Tarefa ${i} rejeitada:`, JSON.stringify(item).slice(0, 120))
        rejected++
        continue
      }

      const { data: existing } = await service
        .from('tasks')
        .select('id, status')
        .eq('user_id', userId)
        .ilike('title', item.title.trim())
        .not('status', 'in', '("done","cancelled")')
        .limit(1)

      if (existing && existing.length > 0) {
        if (existing[0].status !== item.status) {
          await service.from('tasks').update({
            status:       item.status,
            updated_at:   new Date().toISOString(),
            completed_at: item.status === 'done' ? new Date().toISOString() : null,
          }).eq('id', existing[0].id)
          console.log(`[MEMORY] 🔄 Tarefa atualizada: "${item.title}" → ${item.status}`)
        }
        continue
      }

      const { error } = await service.from('tasks').insert({
        user_id:     userId,
        chat_id:     chatId,
        title:       item.title.trim(),
        description: item.description?.trim() ?? null,
        status:      item.status,
        importance:  item.importance,
      })

      if (error) {
        console.error(`[MEMORY] Erro ao inserir tarefa "${item.title}":`, error.message)
      } else {
        console.log(`[MEMORY] 📋 Tarefa: "${item.title}" (${item.status}, imp:${item.importance})`)
        savedTasks++
      }
    }

    console.log(`[MEMORY] Resumo — memórias: +${savedMemories}, tarefas: +${savedTasks}, duplicadas: ${skipped}, rejeitadas: ${rejected}`)

  } catch (err) {
    console.error('[MEMORY] Erro inesperado:', err instanceof Error ? err.message : String(err))
  }
}