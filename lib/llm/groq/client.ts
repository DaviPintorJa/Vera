// lib/llm/groq/client.ts
// Responsabilidade única: fazer a chamada HTTP à API do Groq e retornar o texto.
// Não contém o system prompt nem lógica de negócio.

import { VERA_SYSTEM_PROMPT } from './prompt'
import type { Message } from '../types'

// Modelos disponíveis no Groq
export const GROQ_MODELS = {
  FAST:    'llama-3.1-8b-instant',    // velocidade — conversa
  PRECISE: 'llama-3.3-70b-versatile', // precisão   — extração de memória
} as const

export type GroqModel = typeof GROQ_MODELS[keyof typeof GROQ_MODELS]

interface CallGroqOptions {
  /** Injeta um system prompt alternativo (usado pelo extractor). */
  systemPrompt?: string
  /** Temperatura da chamada. Default: sem parâmetro (Groq usa o default do modelo). */
  temperature?: number
  /** Max tokens. Default: sem parâmetro. */
  maxTokens?: number
  /** Modelo a usar. Default: GROQ_MODELS.FAST */
  model?: GroqModel
}

export async function callGroq(
  messages: Message[],
  options: CallGroqOptions = {}
): Promise<string> {
  const {
    systemPrompt,
    temperature,
    maxTokens,
    model = GROQ_MODELS.FAST,
  } = options

  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) {
    console.error('[GROQ] ERRO CRÍTICO: GROQ_API_KEY não está definida.')
    throw new Error('GROQ_API_KEY ausente. Configure a variável de ambiente.')
  }

  const systemContent = systemPrompt ?? VERA_SYSTEM_PROMPT

  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: systemContent },
      ...messages,
    ],
  }

  if (temperature !== undefined) body.temperature = temperature
  if (maxTokens    !== undefined) body.max_tokens  = maxTokens

  console.log(`[GROQ] Chamando modelo "${model}" com ${messages.length} mensagem(ns).`)

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error(`[GROQ] API retornou erro ${response.status}:`, errorText)
    throw new Error(`Groq API error: ${response.status} — ${errorText}`)
  }

  const data = await response.json()
  const reply = data.choices?.[0]?.message?.content

  if (!reply) {
    console.error('[GROQ] Resposta sem conteúdo:', JSON.stringify(data))
    throw new Error('Resposta da Groq API veio vazia ou malformada.')
  }

  console.log(`[GROQ] Resposta recebida (modelo: ${model}).`)
  return reply
}