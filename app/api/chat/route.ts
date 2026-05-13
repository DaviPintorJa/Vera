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
    // Sanitização: garantir que message seja string
    const message = typeof body.message === 'string' ? body.message : String(body.message || '')
    const { chatId, profileId: requestedProfileId } = body
    if (!message.trim() || !chatId) {
      return Response.json({ error: 'message e chatId são obrigatórios' }, { status: 400 })
    }

    const service = createServiceClient()

    const { data: chat, error: chatError } = await service
      .from('chats')
      .select('id, user_id, profile_id')
      .eq('id', chatId)
      .eq('user_id', user.id)
      .single()

    if (chatError || !chat) {
      console.error('[ROUTE] Chat não encontrado ou não pertence ao usuário:', chatError?.message)
      return Response.json({ error: 'Chat não encontrado' }, { status: 404 })
    }

    const profileId = typeof requestedProfileId === 'string' && requestedProfileId.trim()
      ? requestedProfileId
      : chat.profile_id

    if (!profileId || chat.profile_id !== profileId) {
      return Response.json({ error: 'Perfil inválido para este chat' }, { status: 400 })
    }

    const { data: profile, error: profileError } = await service
      .from('profiles')
      .select('id, system_prompt')
      .eq('id', profileId)
      .eq('user_id', user.id)
      .single()

    if (profileError || !profile) {
      console.error('[ROUTE] Perfil não encontrado:', profileError?.message)
      return Response.json({ error: 'Perfil não encontrado' }, { status: 404 })
    }

    // 2. Salvar mensagem do usuário
    const { error: insertUserError } = await service.from('messages').insert({
      chat_id: chatId,
      user_id: user.id,
      profile_id: profileId,
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
      .order('created_at', { ascending: false }) // Buscar as MAIS RECENTES primeiro
      .limit(20)

    if (historyError) {
      console.error('[ROUTE] Erro ao buscar histórico:', historyError.message)
      return Response.json({ error: 'Erro ao buscar histórico do chat.' }, { status: 500 })
    }

    // Reverter, filtrar nulos/vazios e garantir que role seja aceito pela Groq
    const history = (historyData ?? [])
      .reverse()
      .filter(m => m.role && m.content && m.content.trim() !== '')
      .map(m => ({
        role:    m.role as Message['role'],
        content: m.content,
      }))

    // 4. Executar pipeline de LLM
    const { reply } = await runChatPipeline({
      userId: user.id,
      chatId,
      profileId,
      profileSystemPrompt: profile.system_prompt,
      message,
      history,
    })

    console.log('[ROUTE] Resposta recebida:', reply.slice(0, 80) + '...')

    // 5. Salvar resposta da IA
    const { error: insertAssistantError } = await service.from('messages').insert({
      chat_id: chatId,
      user_id: user.id,
      profile_id: profileId,
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
