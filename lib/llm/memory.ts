// lib/llm/memory.ts

import { createServiceClient } from '@/lib/supabase/server'

// ─── Tipos ────────────────────────────────────────────────────────────────────

const ALLOWED_TYPES = ['identity', 'location', 'goal', 'preference', 'context'] as const
const ALLOWED_GRANULARITIES = ['full_name', 'first_name', 'country', 'state', 'city', 'neighborhood', 'profession', 'hobby', 'personal', 'other'] as const

type MemoryType = typeof ALLOWED_TYPES[number]
type Granularity = typeof ALLOWED_GRANULARITIES[number]

interface ExtractedMemory {
  type: MemoryType
  value: string
  granularity: Granularity | string  // string para granularidades não previstas
  confidence: number
  needs_disambiguation: boolean
}

// ─── Padrões de ausência — bloqueados antes do INSERT ─────────────────────────

const ABSENCE_PATTERNS = [
  /não (informou|forneceu|mencionou|disse|revelou|indicou)/i,
  /nenhum[ao]? (preferência|informação|dado|objetivo|detalhe|contexto)/i,
  /sem (informação|dados|preferência|contexto|detalhes)/i,
  /não (há|existe|foi|está) (informação|dado|contexto|disponível)/i,
  /usuário não/i,
  /não (foi|está) (disponível|presente|claro|informado)/i,
  /ausência de/i,
  /não consta/i,
  /not (provided|mentioned|specified|given|stated)/i,
  /no (information|data|preference|context)/i,
]

function isAbsenceValue(value: string): boolean {
  return ABSENCE_PATTERNS.some(p => p.test(value))
}

// ─── Validação estrutural completa ────────────────────────────────────────────

function isValidMemory(item: unknown): item is ExtractedMemory {
  if (!item || typeof item !== 'object') return false
  const m = item as Record<string, unknown>

  if (!ALLOWED_TYPES.includes(m.type as MemoryType)) {
    return false
  }

  if (typeof m.value !== 'string' || m.value.trim().length < 2) {
    return false
  }

  if (isAbsenceValue(m.value as string)) {
    return false
  }

  if (typeof m.granularity !== 'string' || m.granularity.trim().length === 0) {
    return false
  }

  if (typeof m.confidence !== 'number' || m.confidence < 0.5 || m.confidence > 1) {
    return false
  }

  if (typeof m.needs_disambiguation !== 'boolean') {
    return false
  }

  return true
}

// ─── Normalização ─────────────────────────────────────────────────────────────

function normalizeMemory(m: ExtractedMemory): ExtractedMemory {
  return {
    type: m.type,
    value: m.value.trim(),
    granularity: m.granularity.trim().toLowerCase(),
    confidence: Math.round(m.confidence * 100) / 100, // 2 casas decimais
    needs_disambiguation: m.needs_disambiguation,
  }
}

// ─── Deduplicação via Supabase ────────────────────────────────────────────────

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
    .ilike('value', value.trim()) // case-insensitive
    .limit(1)

  if (error) {
    console.warn('[MEMORY] Erro ao verificar duplicação:', error.message)
    return false // em caso de erro, deixa passar para não perder dados
  }

  return (data?.length ?? 0) > 0
}

// ─── Função principal ─────────────────────────────────────────────────────────

export async function extractAndSaveMemories(
  userId: string,
  userMessage: string,
  assistantReply: string
): Promise<void> {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) {
    console.error('[MEMORY] GROQ_API_KEY ausente. Extração abortada.')
    return
  }

  const extractionPrompt = `You are a memory extraction system for a personal AI assistant.

Analyze the conversation and extract ONLY concrete, positive facts explicitly stated or strongly implied by the user.

Return a JSON array where each item follows this exact structure:
{
  "type": "identity" | "location" | "goal" | "preference" | "context",
  "value": "the concrete fact in Portuguese (pt-BR)",
  "granularity": "full_name" | "first_name" | "country" | "state" | "city" | "neighborhood" | "profession" | "hobby" | "personal" | "other",
  "confidence": number between 0.5 and 1.0,
  "needs_disambiguation": true or false
}

Type definitions:
- identity: name, age, gender, nationality
- location: country, state, city, neighborhood
- goal: objectives, plans, ambitions, desires
- preference: likes, dislikes, habits, hobbies, favorite things
- context: profession, job, family situation, life context

Strict rules:
1. Return ONLY a valid JSON array — no markdown, no explanation, no code blocks
2. Each item must represent exactly ONE fact (atomic)
3. "value" must be the fact written clearly in Portuguese
4. confidence must be between 0.5 and 1.0 — exclude anything below 0.5
5. If the fact is ambiguous, set needs_disambiguation: true and lower confidence
6. If multiple facts exist, create multiple items — one per fact
7. If there are NO concrete personal facts: return exactly []
8. NEVER extract absence of information — if user did not say something, do not mention it
9. NEVER create entries like "user did not say X" or "no preference mentioned"

Conversation:
User: ${userMessage}
Assistant: ${assistantReply}

JSON array:`

  try {
    console.log('[MEMORY] Iniciando extração estruturada para user:', userId)

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [
          {
            role: 'system',
            content: 'You are a memory extraction system. Respond ONLY with a valid JSON array. No markdown, no explanation, no code blocks.',
          },
          {
            role: 'user',
            content: extractionPrompt,
          },
        ],
        temperature: 0.1,
        max_tokens: 800,
      }),
    })

    if (!response.ok) {
      const errText = await response.text()
      console.error(`[MEMORY] Groq retornou erro ${response.status}:`, errText)
      return
    }

    const data = await response.json()
    let raw: string = data.choices?.[0]?.message?.content?.trim() ?? ''

    console.log('[MEMORY] Resposta bruta do extrator:', raw)

    if (!raw) {
      console.warn('[MEMORY] Resposta vazia. Nenhuma memória salva.')
      return
    }

    // Limpar markdown caso o modelo desobedeça
    raw = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim()

    // Parse JSON
    let parsed: unknown[]
    try {
      const result = JSON.parse(raw)
      if (!Array.isArray(result)) {
        console.error('[MEMORY] Resposta não é um array:', result)
        return
      }
      parsed = result
    } catch (err) {
      console.error('[MEMORY] Falha ao parsear JSON:', raw, err)
      return
    }

    if (parsed.length === 0) {
      console.log('[MEMORY] Nenhuma memória extraída nesta troca.')
      return
    }

    // Validar cada item
    const validMemories: ExtractedMemory[] = []
    for (const [index, item] of parsed.entries()) {
      if (isValidMemory(item)) {
        validMemories.push(normalizeMemory(item))
      } else {
        console.warn(`[MEMORY] Item ${index} rejeitado:`, JSON.stringify(item))
      }
    }

    if (validMemories.length === 0) {
      console.log('[MEMORY] Todos os itens foram rejeitados na validação.')
      return
    }

    const service = createServiceClient()

    // Deduplicação e inserção item a item
    let savedCount = 0
    let skippedCount = 0

    for (const memory of validMemories) {
      const duplicate = await alreadyExists(service, userId, memory.type, memory.value)

      if (duplicate) {
        console.log(`[MEMORY] Duplicação detectada, ignorando: [${memory.type}] "${memory.value}"`)
        skippedCount++
        continue
      }

      const row = {
        user_id: userId,
        type: memory.type,
        value: memory.value,
        granularity: memory.granularity,
        confidence: memory.confidence,
        needs_disambiguation: memory.needs_disambiguation,
        content: memory.value, // compatibilidade com campo legado
      }

      const { error } = await service.from('memories').insert(row)

      if (error) {
        console.error(`[MEMORY] Erro ao inserir [${memory.type}] "${memory.value}":`, error.message)
      } else {
        console.log(`[MEMORY] ✅ Salvo: [${memory.type}] "${memory.value}" (confidence: ${memory.confidence})`)
        savedCount++
      }
    }

    console.log(`[MEMORY] Resultado final — salvas: ${savedCount}, ignoradas (duplicação): ${skippedCount}, rejeitadas (validação): ${parsed.length - validMemories.length}`)

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[MEMORY] Erro inesperado na extração:', msg)
  }
}