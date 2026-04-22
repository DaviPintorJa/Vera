// lib/llm/pipeline.ts
// Responsabilidade única: orquestrar o fluxo de uma mensagem de chat —
// buscar contexto, montar o array de mensagens e chamar o LLM.
// O route.ts passa a ser só camada HTTP; toda lógica de negócio fica aqui.

import { askGroq, GROQ_MODELS } from './groq'
import { buildUserContext }     from './context'
import { extractAndSaveMemories } from './memory'
import type { Message }         from './types'

interface RunPipelineInput {
  userId:  string
  chatId:  string
  message: string
  history: Message[]   // histórico já buscado pelo route.ts (sem a msg atual)
}

interface RunPipelineOutput {
  reply: string
}

export async function runChatPipeline(
  input: RunPipelineInput
): Promise<RunPipelineOutput> {
  const { userId, chatId, message, history } = input

  // 1. Buscar contexto de memória
  const memoryContext = await buildUserContext(userId, chatId, message)

  // 2. Montar array de mensagens com deduplicação
  const lastMsg         = history[history.length - 1]
  const alreadyIncluded = lastMsg?.role === 'user' && lastMsg?.content === message

  const conversationMessages: Message[] = alreadyIncluded
    ? history
    : [...history, { role: 'user', content: message }]

  // 3. Injetar bloco de memória como mensagem de sistema adicional
  const messagesForLLM: Message[] = memoryContext
    ? [{ role: 'system', content: memoryContext }, ...conversationMessages]
    : conversationMessages

  console.log(
    `[PIPELINE] Enviando ao Groq — modelo: ${GROQ_MODELS.FAST}, ` +
    `mensagens: ${conversationMessages.length}, ` +
    `memórias injetadas: ${memoryContext ? 'sim' : 'não'}`
  )

  // 4. Chamar o LLM de conversa (modelo rápido)
  const reply = await askGroq(messagesForLLM, { model: GROQ_MODELS.FAST })

  // 5. Extração de memória em background — nunca bloqueia o retorno
  extractAndSaveMemories(userId, chatId, message, reply).catch(err =>
    console.error('[PIPELINE] Erro na pipeline de memória:', err)
  )

  return { reply }
}