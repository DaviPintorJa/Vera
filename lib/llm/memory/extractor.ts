// lib/llm/memory/extractor.ts
// Responsabilidade única: chamar o Groq, parsear o JSON retornado
// e persistir memórias e tarefas no Supabase.
// Não contém lógica de prompt nem regras de validação.

import { createServiceClient } from '@/lib/llm/supabase/server'
import { TYPE_TO_SCOPE, type ExtractionResult } from '../types'
import { buildExtractionPrompt } from './prompt'
import { isValidMemory, isValidTask, normalizeMemory } from './validator'

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

  if (error) { console.warn('[EXTRACTOR] Erro ao verificar duplicação:', error.message); return false }
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

  if (error) console.warn('[EXTRACTOR] Erro ao superseder:', error.message)
  else console.log(`[EXTRACTOR] Supersedida: [${type}] "${oldValue}"`)
}

// ─── Chamada ao Groq ──────────────────────────────────────────────────────────

async function callGroqForExtraction(
  apiKey: string,
  userMessage: string,
  assistantReply: string
): Promise<ExtractionResult | null> {
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
      temperature: 0.0,
      max_tokens: 1200,
    }),
  })

  if (!response.ok) {
    console.error(`[EXTRACTOR] Groq erro ${response.status}:`, await response.text())
    return null
  }

  const data = await response.json()
  let raw: string = data.choices?.[0]?.message?.content?.trim() ?? ''
  if (!raw) { console.warn('[EXTRACTOR] Resposta vazia.'); return null }

  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()

  try {
    const parsed = JSON.parse(raw)
    return {
      memories: Array.isArray(parsed.memories) ? parsed.memories : [],
      tasks:    Array.isArray(parsed.tasks)    ? parsed.tasks    : [],
    }
  } catch (err) {
    console.error('[EXTRACTOR] Falha ao parsear JSON:', raw.slice(0, 200), err)
    return null
  }
}

// ─── Persistência ─────────────────────────────────────────────────────────────

async function persistMemories(
  service: ReturnType<typeof createServiceClient>,
  userId: string,
  chatId: string,
  result: ExtractionResult
): Promise<{ savedMemories: number; savedTasks: number; skipped: number; rejected: number }> {
  let savedMemories = 0, savedTasks = 0, skipped = 0, rejected = 0

  for (const [i, item] of result.memories.entries()) {
    if (!isValidMemory(item)) {
      console.warn(`[EXTRACTOR] Memória ${i} rejeitada:`, JSON.stringify(item).slice(0, 120))
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
      console.error(`[EXTRACTOR] Erro ao inserir [${mem.type}] "${mem.value}":`, error.message)
    } else {
      console.log(`[EXTRACTOR] ✅ [${mem.scope}/${mem.type}] "${mem.value}" (imp:${mem.importance})`)
      savedMemories++
    }
  }

  for (const [i, item] of result.tasks.entries()) {
    if (!isValidTask(item)) {
      console.warn(`[EXTRACTOR] Tarefa ${i} rejeitada:`, JSON.stringify(item).slice(0, 120))
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
        console.log(`[EXTRACTOR] 🔄 Tarefa atualizada: "${item.title}" → ${item.status}`)
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
      console.error(`[EXTRACTOR] Erro ao inserir tarefa "${item.title}":`, error.message)
    } else {
      console.log(`[EXTRACTOR] 📋 Tarefa: "${item.title}" (${item.status})`)
      savedTasks++
    }
  }

  return { savedMemories, savedTasks, skipped, rejected }
}

// ─── Função principal exportada ───────────────────────────────────────────────

export async function runExtractionPipeline(
  userId: string,
  chatId: string,
  userMessage: string,
  assistantReply: string
): Promise<void> {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) { console.error('[EXTRACTOR] GROQ_API_KEY ausente.'); return }

  try {
    const result = await callGroqForExtraction(apiKey, userMessage, assistantReply)
    if (!result) return

    const service = createServiceClient()
    const stats = await persistMemories(service, userId, chatId, result)

    console.log(
      `[EXTRACTOR] Resumo — memórias: +${stats.savedMemories}, tarefas: +${stats.savedTasks}, ` +
      `duplicadas: ${stats.skipped}, rejeitadas: ${stats.rejected}`
    )
  } catch (err) {
    console.error('[EXTRACTOR] Erro inesperado:', err instanceof Error ? err.message : String(err))
  }
}