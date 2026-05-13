// lib/llm/pipeline.ts
// Responsabilidade única: orquestrar o fluxo de uma mensagem de chat —
// buscar contexto, montar o array de mensagens e chamar o LLM.
// O route.ts passa a ser só camada HTTP; toda lógica de negócio fica aqui.

import { askGroq, GROQ_MODELS } from './groq'
import { buildUserContext }     from './context'
import { extractAndSaveMemories } from './memory'
import { createClient }         from '@supabase/supabase-js' // Assumindo disponibilidade do pacote
import type { Message }         from './types'

interface RunPipelineInput {
  userId:               string
  chatId:               string
  profileId:            string
  profileSystemPrompt?: string
  message:              string
  history:              Message[] // histórico já buscado pelo route.ts (sem a msg atual)
}

interface RunPipelineOutput {
  reply: string
}

export async function runChatPipeline(
  input: RunPipelineInput
): Promise<RunPipelineOutput> {
  const { userId, chatId, profileId, profileSystemPrompt, message, history } = input

  // 1. Buscar contexto de memória
  let memoryContext = ''
  try {
    memoryContext = await buildUserContext(userId, chatId, profileId, message)
  } catch (err) {
    console.warn('[PIPELINE] Falha ao recuperar contexto de memória. Prosseguindo sem ele.', err)
  }

  // 2. Montar array de mensagens com deduplicação
  const lastMsg         = history[history.length - 1]
  const alreadyIncluded = lastMsg?.role === 'user' && lastMsg?.content === message
  const conversationMessages: Message[] = alreadyIncluded
    ? history
    : [...history, { role: 'user', content: message }]

  // 3. Consolidar prompts de sistema (Perfil + Memórias)
  const systemMessages: Message[] = []
  
  if (profileSystemPrompt?.trim()) {
    systemMessages.push({ role: 'system', content: profileSystemPrompt })
  }

  const validContext = typeof memoryContext === 'string' && memoryContext.trim().length > 0
  if (validContext) {
    systemMessages.push({ role: 'system', content: `CONTEXTO DE MEMÓRIA:\n${memoryContext}` })
  }

  const messagesForLLM: Message[] = validContext
    ? [...systemMessages, ...conversationMessages]
    : (systemMessages.length > 0 ? [...systemMessages, ...conversationMessages] : conversationMessages)

  console.log(
    `[PIPELINE] Modelo: "${GROQ_MODELS.FAST}", ` +
    `mensagens: ${conversationMessages.length}, ` +
    `memórias: ${validContext ? 'sim' : 'não'}, ` +
    `prompt perfil: ${profileSystemPrompt ? 'sim' : 'não'}`
  )

  // 4. Chamar o LLM de conversa
  let reply: string
  try {
    if (!GROQ_MODELS.FAST) throw new Error("Configuração GROQ_MODELS.FAST ausente.")
    reply = await askGroq(messagesForLLM, { model: GROQ_MODELS.FAST })
  } catch (err) {
    console.error('[PIPELINE] Erro na chamada do LLM:', err)
    throw new Error('Falha ao gerar resposta da IA. Por favor, tente novamente.')
  }

  // 5. Extração de memória — Agora aguardamos a conclusão para garantir que
  // as memórias estejam disponíveis na próxima interação, resolvendo a race condition.
  try {
    await extractAndSaveMemories(userId, chatId, profileId, message, reply)
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    console.error('[PIPELINE] Erro na extração de memória:', errorMessage)

    // Gravação persistente da falha para auditoria
    try {
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      )
      await supabase.from('ingestion_jobs').insert({
        chat_id: chatId,
        status: 'failed',
        error_message: `Memory extraction failed: ${errorMessage}`,
        filename: 'LLM_EXTRACTION_TASK'
      })
    } catch (dbErr) {
      console.error('[PIPELINE] Falha ao gravar log de erro no Supabase:', dbErr)
    }
  }

  return { reply }
}