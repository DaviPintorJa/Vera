// lib/llm/groq/client.ts
// Responsabilidade única: fazer a chamada HTTP à API do Groq e retornar o texto.
// Não contém o system prompt nem lógica de negócio.

import { VERA_SYSTEM_PROMPT } from './prompt'
import type { Message } from '../types'

export async function callGroq(messages: Message[]): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY

  if (!apiKey) {
    console.error('[GROQ] ERRO CRÍTICO: GROQ_API_KEY não está definida.')
    throw new Error('GROQ_API_KEY ausente. Configure a variável de ambiente.')
  }

  console.log(`[GROQ] Iniciando chamada com ${messages.length} mensagem(ns).`)

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'llama-3.1-8b-instant',
      messages: [
        { role: 'system', content: VERA_SYSTEM_PROMPT },
        ...messages,
      ],
    }),
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

  console.log('[GROQ] Resposta recebida com sucesso.')
  return reply
}