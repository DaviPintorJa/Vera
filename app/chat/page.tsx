// app/chat/page.tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [chatId, setChatId] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const supabase = createClient()

  // Inicializar: verificar sessão, criar ou recuperar chat
  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()

      if (!user) {
        window.location.href = '/auth/login'
        return
      }

      // Buscar o chat mais recente do usuário
      const { data: existingChats } = await supabase
        .from('chats')
        .select('id')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)

      let currentChatId: string

      if (existingChats && existingChats.length > 0) {
        // Usar o chat mais recente
        currentChatId = existingChats[0].id
      } else {
        // Criar novo chat
        const { data: newChat } = await supabase
          .from('chats')
          .insert({ user_id: user.id, title: 'Nova conversa' })
          .select()
          .single()

        if (!newChat) {
          console.error('Erro ao criar chat')
          return
        }
        currentChatId = newChat.id
      }

      setChatId(currentChatId)

      // Carregar histórico de mensagens
      const { data: history } = await supabase
        .from('messages')
        .select('id, role, content')
        .eq('chat_id', currentChatId)
        .order('created_at', { ascending: true })

      if (history) {
        setMessages(history as Message[])
      }

      setReady(true)
    }

    init()
  }, [])

  // Scroll automático para a última mensagem
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function sendMessage() {
    if (!input.trim() || loading || !chatId) return

    const userText = input.trim()
    setInput('')
    setLoading(true)

    // Adicionar mensagem do usuário na tela imediatamente
    const tempId = Date.now().toString()
    setMessages(prev => [...prev, {
      id: tempId,
      role: 'user',
      content: userText,
    }])

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userText, chatId }),
      })

      const data = await res.json()

      if (res.ok) {
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          role: 'assistant',
          content: data.reply,
        }])
      } else {
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          role: 'assistant',
          content: '⚠️ Erro ao processar sua mensagem. Tente novamente.',
        }])
      }
    } catch {
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'assistant',
        content: '⚠️ Erro de conexão. Verifique sua internet.',
      }])
    } finally {
      setLoading(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  if (!ready) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: '#0a0a0f',
        color: '#8888aa',
        fontFamily: 'system-ui',
      }}>
        Carregando VERA...
      </div>
    )
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      background: '#0a0a0f',
      color: '#e2e2f0',
      fontFamily: 'system-ui, sans-serif',
    }}>

      {/* Header */}
      <div style={{
        padding: '16px 24px',
        borderBottom: '1px solid #1e1e2e',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}>
        <div style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          background: '#6366f120',
          border: '1px solid #6366f140',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 'bold',
          color: '#6366f1',
        }}>
          V
        </div>
        <span style={{ fontWeight: 600, letterSpacing: '0.05em' }}>VERA</span>
      </div>

      {/* Área de mensagens */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '24px',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        maxWidth: 760,
        width: '100%',
        margin: '0 auto',
        boxSizing: 'border-box',
      }}>
        {messages.length === 0 && (
          <div style={{
            textAlign: 'center',
            color: '#8888aa',
            marginTop: 80,
          }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>👋</div>
            <p style={{ fontSize: 16, marginBottom: 8 }}>Olá! Eu sou a VERA.</p>
            <p style={{ fontSize: 14 }}>Como posso te ajudar hoje?</p>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            style={{
              display: 'flex',
              justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
            }}
          >
            <div style={{
              maxWidth: '80%',
              padding: '12px 16px',
              borderRadius: msg.role === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
              background: msg.role === 'user' ? '#6366f1' : '#111118',
              border: msg.role === 'user' ? 'none' : '1px solid #1e1e2e',
              fontSize: 14,
              lineHeight: 1.6,
              whiteSpace: 'pre-wrap',
            }}>
              {msg.content}
            </div>
          </div>
        ))}

        {loading && (
          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            <div style={{
              padding: '12px 16px',
              borderRadius: '18px 18px 18px 4px',
              background: '#111118',
              border: '1px solid #1e1e2e',
              color: '#8888aa',
              fontSize: 14,
            }}>
              VERA está pensando...
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{
        padding: '16px 24px',
        borderTop: '1px solid #1e1e2e',
        background: '#0a0a0f',
      }}>
        <div style={{
          maxWidth: 760,
          margin: '0 auto',
          display: 'flex',
          gap: 12,
          alignItems: 'flex-end',
        }}>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
            placeholder="Mensagem para VERA... (Enter para enviar)"
            rows={1}
            style={{
              flex: 1,
              background: '#111118',
              border: '1px solid #1e1e2e',
              borderRadius: 12,
              padding: '12px 16px',
              color: '#e2e2f0',
              fontSize: 14,
              resize: 'none',
              outline: 'none',
              fontFamily: 'system-ui, sans-serif',
              lineHeight: 1.5,
            }}
          />
          <button
            onClick={sendMessage}
            disabled={loading || !input.trim()}
            style={{
              background: '#6366f1',
              border: 'none',
              borderRadius: 10,
              width: 44,
              height: 44,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: loading || !input.trim() ? 0.4 : 1,
              flexShrink: 0,
            }}
          >
            <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="white" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}