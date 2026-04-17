// app/api/chat/route.ts

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { askGroq } from '@/lib/llm/groq'

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

    const service = await createServiceClient()

    // 2. Salvar mensagem do usuário no banco
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

    // 3. Buscar histórico ANTERIOR à mensagem atual (exclui a recém-inserida para evitar duplicata)
    const { data: history, error: historyError } = await service
      .from('messages')
      .select('role, content')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: true })
      .limit(20)

    if (historyError) {
      console.error('[ROUTE /api/chat] Erro ao buscar histórico:', historyError.message)
      return Response.json({ error: 'Erro ao buscar histórico do chat.' }, { status: 500 })
    }

    // 4. Montar array para o Groq:
    //    histórico do banco (pode ou não incluir a msg atual, dependendo da latência)
    //    + mensagem atual garantida no final
    //
    //    Para evitar duplicata caso o SELECT já tenha retornado a msg recém-inserida,
    //    removemos a última entrada se ela for idêntica à mensagem atual.
    const historyMessages = (history || []).map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }))

    const lastMsg = historyMessages[historyMessages.length - 1]
    const alreadyIncluded =
      lastMsg?.role === 'user' && lastMsg?.content === message

    const messagesForLLM = alreadyIncluded
      ? historyMessages
      : [...historyMessages, { role: 'user' as const, content: message }]

    console.log(
      `[ROUTE /api/chat] Enviando ${messagesForLLM.length} mensagem(ns) ao Groq.`,
      `(histórico: ${historyMessages.length}, deduplicado: ${alreadyIncluded})`
    )

    // 5. Enviar ao Groq com a mensagem atual garantida
    const reply = await askGroq(messagesForLLM)

    console.log('[ROUTE /api/chat] Resposta recebida do Groq:', reply.slice(0, 80) + '...')

    // 6. Salvar resposta da IA no banco
    const { error: insertAssistantError } = await service.from('messages').insert({
      chat_id: chatId,
      role: 'assistant',
      content: reply,
    })

    if (insertAssistantError) {
      console.error('[ROUTE /api/chat] Erro ao salvar resposta da IA:', insertAssistantError.message)
      // Não aborta — o usuário já recebeu a resposta; log é suficiente
    } else {
      console.log('[ROUTE /api/chat] Resposta da IA salva com sucesso.')
    }

    // 7. Atualizar título do chat na primeira troca
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