// app/api/chat/route.ts

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { askGroq } from '@/lib/llm/groq'
import { extractAndSaveMemories } from '@/lib/llm/memory'
import { buildUserContext } from '@/lib/llm/context'

export async function POST(req: Request) {
  try {
    if (!process.env.GROQ_API_KEY) {
      console.error('[ROUTE /api/chat] GROQ_API_KEY não está definida. Abortando.')
      return Response.json(
        { error: 'Serviço de IA indisponível: chave de API ausente.' },
        { status: 503 }
      )
    }

    // 1. Verificar autenticação
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return Response.json({ error: 'Não autorizado' }, { status: 401 })
    }

    const body = await req.json()
    const { message, chatId } = body

    if (!message || !chatId) {
      return Response.json({ error: 'message e chatId são obrigatórios' }, { status: 400 })
    }

    const service = createServiceClient()

    // 2. Salvar mensagem do usuário
    const { error: insertUserError } = await service.from('messages').insert({
      chat_id: chatId,
      role: 'user',
      content: message,
    })

    if (insertUserError) {
      console.error('[ROUTE /api/chat] Erro ao salvar mensagem do usuário:', insertUserError.message)
      return Response.json({ error: 'Erro ao salvar mensagem no banco.' }, { status: 500 })
    }

    console.log('[ROUTE /api/chat] Mensagem do usuário salva com sucesso.')

    // 3. Buscar histórico + memórias em paralelo
    const [historyResult, memoryContext] = await Promise.all([
  service
    .from('messages')
    .select('role, content')
    .eq('chat_id', chatId)
    .order('created_at', { ascending: true })
    .limit(20),
  buildUserContext(user.id, chatId, message),   // ← chatId adicionado
])

    if (historyResult.error) {
      console.error('[ROUTE /api/chat] Erro ao buscar histórico:', historyResult.error.message)
      return Response.json({ error: 'Erro ao buscar histórico do chat.' }, { status: 500 })
    }

    // 4. Montar array de mensagens com deduplicação
    const historyMessages = (historyResult.data || []).map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }))

    const lastMsg = historyMessages[historyMessages.length - 1]
    const alreadyIncluded = lastMsg?.role === 'user' && lastMsg?.content === message

    const conversationMessages = alreadyIncluded
      ? historyMessages
      : [...historyMessages, { role: 'user' as const, content: message }]

    // 5. Injetar memórias no contexto
    //    Se houver memórias: inserir como mensagem de sistema adicional
    //    logo antes do histórico, para não misturar com a identidade da VERA
    //    O system prompt da VERA já está em askGroq() — aqui só adicionamos
    //    o bloco de memória como contexto extra.
    const messagesForLLM = memoryContext
      ? [
          { role: 'system' as const, content: memoryContext },
          ...conversationMessages,
        ]
      : conversationMessages

    console.log(
      `[ROUTE /api/chat] Enviando ao Groq — mensagens: ${conversationMessages.length}, memórias injetadas: ${memoryContext ? 'sim' : 'não'}`
    )

    // 6. Chamar o LLM
    const reply = await askGroq(messagesForLLM)

    console.log('[ROUTE /api/chat] Resposta recebida do Groq:', reply.slice(0, 80) + '...')

    // 7. Salvar resposta da IA
    const { error: insertAssistantError } = await service.from('messages').insert({
      chat_id: chatId,
      role: 'assistant',
      content: reply,
    })

    if (insertAssistantError) {
      console.error('[ROUTE /api/chat] Erro ao salvar resposta da IA:', insertAssistantError.message)
    } else {
      console.log('[ROUTE /api/chat] Resposta da IA salva com sucesso.')
    }

    // 8. Extração de memória em background — nunca bloqueia o retorno
    extractAndSaveMemories(user.id, chatId, message, reply).catch((err) => {
  console.error('[ROUTE /api/chat] Erro na pipeline de memória:', err)
  })

    // 9. Atualizar título do chat na primeira troca
    const { count } = await service
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('chat_id', chatId)

    if (count && count <= 2) {
      const title = message.slice(0, 60) + (message.length > 60 ? '...' : '')
      await service.from('chats').update({ title }).eq('id', chatId)
    }

    return Response.json({ reply })

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[ROUTE /api/chat] Erro:', message)
    return Response.json({ error: 'Erro interno do servidor', detail: message }, { status: 500 })
  }
}