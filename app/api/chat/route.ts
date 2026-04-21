// app/api/chat/route.ts
// Responsabilidade única: camada HTTP — autenticação, persistência de mensagens,
// atualização de título e delegação ao pipeline de LLM.
// Nenhuma lógica de IA ou contexto deve viver aqui.

import { createClient, createServiceClient } from '@/lib/llm/supabase/server'
import { runChatPipeline } from '@/lib/llm/pipeline'
import type { Message } from '@/lib/llm/types'

export async function POST(req: Request) {
  try {
    if (!process.env.GROQ_API_KEY) {
      console.error('[ROUTE] GROQ_API_KEY não definida.')
      return Response.json(
        { error: 'Serviço de IA indisponível: chave de API ausente.' },
        { status: 503 }
      )
    }

    // 1. Autenticação
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Não autorizado' }, { status: 401 })

    const body = await req.json()
    const { message, chatId } = body
    if (!message || !chatId) {
      return Response.json({ error: 'message e chatId são obrigatórios' }, { status: 400 })
    }

    const service = createServiceClient()

    // 2. Salvar mensagem do usuário
    const { error: insertUserError } = await service.from('messages').insert({
      chat_id: chatId,
      role:    'user',
      content: message,
    })
    if (insertUserError) {
      console.error('[ROUTE] Erro ao salvar mensagem do usuário:', insertUserError.message)
      return Response.json({ error: 'Erro ao salvar mensagem no banco.' }, { status: 500 })
    }

    // 3. Buscar histórico
    const { data: historyData, error: historyError } = await service
      .from('messages')
      .select('role, content')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: true })
      .limit(20)

    if (historyError) {
      console.error('[ROUTE] Erro ao buscar histórico:', historyError.message)
      return Response.json({ error: 'Erro ao buscar histórico do chat.' }, { status: 500 })
    }

    const history = (historyData ?? []).map(m => ({
      role:    m.role as Message['role'],
      content: m.content,
    }))

    // 4. Executar pipeline de LLM
    const { reply } = await runChatPipeline({
      userId: user.id,
      chatId,
      message,
      history,
    })

    console.log('[ROUTE] Resposta recebida:', reply.slice(0, 80) + '...')

    // 5. Salvar resposta da IA
    const { error: insertAssistantError } = await service.from('messages').insert({
      chat_id: chatId,
      role:    'assistant',
      content: reply,
    })
    if (insertAssistantError) {
      console.error('[ROUTE] Erro ao salvar resposta da IA:', insertAssistantError.message)
    }

    // 6. Atualizar título do chat na primeira troca
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
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[ROUTE] Erro:', msg)
    return Response.json({ error: 'Erro interno do servidor', detail: msg }, { status: 500 })
  }
}