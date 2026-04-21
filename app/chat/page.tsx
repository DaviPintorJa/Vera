// app/chat/page.tsx
'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { createClient } from '@/lib/llm/supabase/client'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
}

interface Chat {
  id: string
  title: string
  created_at: string
}

interface Task {
  id: string
  title: string
  description: string | null
  status: 'open' | 'in_progress' | 'done' | 'blocked' | 'cancelled'
  importance: number
}

const STATUS_LABEL: Record<Task['status'], string> = {
  open: 'Aberta',
  in_progress: 'Em andamento',
  done: 'Concluída',
  blocked: 'Bloqueada',
  cancelled: 'Cancelada',
}

const STATUS_COLOR: Record<Task['status'], string> = {
  open: '#6366f1',
  in_progress: '#f59e0b',
  done: '#22c55e',
  blocked: '#ef4444',
  cancelled: '#555570',
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [chatId, setChatId] = useState<string | null>(null)
  const [chats, setChats] = useState<Chat[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [userId, setUserId] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [tasksOpen, setTasksOpen] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const supabase = createClient()

  // ── Carregar chats do usuário ────────────────────────────────────────────────
  const loadChats = useCallback(async (uid: string) => {
    const { data } = await supabase
      .from('chats')
      .select('id, title, created_at')
      .eq('user_id', uid)
      .order('created_at', { ascending: false })
      .limit(30)
    if (data) setChats(data as Chat[])
  }, [supabase])

  // ── Carregar tarefas do chat ativo ───────────────────────────────────────────
  const loadTasks = useCallback(async (uid: string, cid: string) => {
    const { data } = await supabase
      .from('tasks')
      .select('id, title, description, status, importance')
      .eq('user_id', uid)
      .eq('chat_id', cid)
      .not('status', 'in', '("done","cancelled")')
      .order('importance', { ascending: false })
      .limit(10)
    if (data) setTasks(data as Task[])
  }, [supabase])

  // ── Carregar mensagens de um chat ────────────────────────────────────────────
  const loadMessages = useCallback(async (cid: string) => {
    const { data } = await supabase
      .from('messages')
      .select('id, role, content')
      .eq('chat_id', cid)
      .order('created_at', { ascending: true })
    if (data) setMessages(data as Message[])
  }, [supabase])

  // ── Inicialização ────────────────────────────────────────────────────────────
  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { window.location.href = '/auth/login'; return }
      setUserId(user.id)

      const { data: existingChats } = await supabase
        .from('chats')
        .select('id, title, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(30)

      let currentChatId: string

      if (existingChats && existingChats.length > 0) {
        setChats(existingChats as Chat[])
        currentChatId = existingChats[0].id
      } else {
        const { data: newChat } = await supabase
          .from('chats')
          .insert({ user_id: user.id, title: 'Nova conversa' })
          .select()
          .single()
        if (!newChat) { console.error('Erro ao criar chat'); return }
        currentChatId = newChat.id
        setChats([newChat as Chat])
      }

      setChatId(currentChatId)
      await loadMessages(currentChatId)
      await loadTasks(user.id, currentChatId)
      setReady(true)
    }
    init()
  }, [])

  // ── Scroll automático ────────────────────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // ── Novo chat ────────────────────────────────────────────────────────────────
  async function createNewChat() {
    if (!userId) return
    const { data: newChat } = await supabase
      .from('chats')
      .insert({ user_id: userId, title: 'Nova conversa' })
      .select()
      .single()
    if (!newChat) return
    setChatId(newChat.id)
    setMessages([])
    setTasks([])
    await loadChats(userId)
  }

  // ── Trocar de chat ───────────────────────────────────────────────────────────
  async function switchChat(cid: string) {
    if (cid === chatId) return
    setChatId(cid)
    setMessages([])
    setTasks([])
    await loadMessages(cid)
    if (userId) await loadTasks(userId, cid)
  }

  // ── Enviar mensagem ──────────────────────────────────────────────────────────
  async function sendMessage() {
    if (!input.trim() || loading || !chatId) return
    const userText = input.trim()
    setInput('')
    setLoading(true)

    setMessages(prev => [...prev, { id: Date.now().toString(), role: 'user', content: userText }])

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userText, chatId }),
      })
      const data = await res.json()

      if (res.ok) {
        setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), role: 'assistant', content: data.reply }])
        // Recarregar tarefas após resposta (podem ter sido criadas)
        if (userId) {
          setTimeout(() => loadTasks(userId, chatId), 2000)
          // Atualizar título na sidebar
          loadChats(userId)
        }
      } else {
        setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), role: 'assistant', content: '⚠️ Erro ao processar sua mensagem. Tente novamente.' }])
      }
    } catch {
      setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), role: 'assistant', content: '⚠️ Erro de conexão. Verifique sua internet.' }])
    } finally {
      setLoading(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  }

  if (!ready) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#07070d', color: '#555570', fontFamily: 'system-ui', gap: 10 }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#6366f1', animation: 'pulse 1.2s ease-in-out infinite' }} />
        <span style={{ fontSize: 14, letterSpacing: '0.05em' }}>Carregando VERA...</span>
        <style>{`@keyframes pulse { 0%,100%{opacity:.3} 50%{opacity:1} }`}</style>
      </div>
    )
  }

  const activeTasks = tasks.filter(t => t.status !== 'done' && t.status !== 'cancelled')
  const currentChat = chats.find(c => c.id === chatId)

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#07070d', color: '#e2e2f0', fontFamily: "'DM Sans', system-ui, sans-serif", overflow: 'hidden' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=DM+Sans:wght@300;400;500&display=swap');
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #1e1e2e; border-radius: 4px; }
        textarea { font-family: 'DM Sans', system-ui, sans-serif; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        .msg-bubble { animation: fadeIn 0.2s ease forwards; }
        .chat-item:hover { background: rgba(99,102,241,0.06) !important; }
        .chat-item.active { background: rgba(99,102,241,0.1) !important; border-color: rgba(99,102,241,0.2) !important; }
        .icon-btn:hover { background: rgba(99,102,241,0.12) !important; }
        .new-chat-btn:hover { background: rgba(99,102,241,0.18) !important; }
      `}</style>

      {/* ── SIDEBAR ─────────────────────────────────────────────────────────── */}
      {sidebarOpen && (
        <div style={{
          width: 240,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          borderRight: '1px solid #111120',
          background: '#07070d',
        }}>
          {/* Logo */}
          <div style={{ padding: '18px 16px 14px', borderBottom: '1px solid #111120', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 28, height: 28, borderRadius: 7, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Space Mono',monospace", fontWeight: 700, fontSize: 12, color: 'white', flexShrink: 0, boxShadow: '0 2px 8px rgba(99,102,241,0.4)' }}>V</div>
            <span style={{ fontFamily: "'Space Mono',monospace", fontSize: 13, fontWeight: 700, letterSpacing: '0.1em', color: '#e2e2f0' }}>VERA</span>
          </div>

          {/* Novo Chat */}
          <div style={{ padding: '10px 10px 6px' }}>
            <button
              className="new-chat-btn"
              onClick={createNewChat}
              style={{ width: '100%', padding: '9px 12px', background: 'rgba(99,102,241,0.08)', border: '1px dashed rgba(99,102,241,0.2)', borderRadius: 9, color: '#6366f1', fontSize: 12, fontFamily: "'DM Sans',system-ui", fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, transition: 'background 0.15s ease', letterSpacing: '0.02em' }}
            >
              <span style={{ fontSize: 16, lineHeight: 1 }}>+</span>
              Novo projeto
            </button>
          </div>

          {/* Lista de chats */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '4px 10px 10px' }}>
            <div style={{ fontSize: 10, color: '#33334a', fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', padding: '8px 4px 6px' }}>Conversas</div>
            {chats.map(chat => (
              <button
                key={chat.id}
                className={`chat-item ${chat.id === chatId ? 'active' : ''}`}
                onClick={() => switchChat(chat.id)}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  background: 'transparent',
                  border: '1px solid transparent',
                  borderRadius: 8,
                  color: chat.id === chatId ? '#a5b4fc' : '#888899',
                  fontSize: 12,
                  fontFamily: "'DM Sans',system-ui",
                  textAlign: 'left',
                  cursor: 'pointer',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  transition: 'all 0.15s ease',
                  display: 'block',
                  marginBottom: 2,
                  lineHeight: 1.4,
                }}
              >
                {chat.title}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── ÁREA PRINCIPAL ──────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>

        {/* Header */}
        <div style={{ padding: '12px 20px', borderBottom: '1px solid #111120', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0, background: '#07070d' }}>
          <button
            className="icon-btn"
            onClick={() => setSidebarOpen(s => !s)}
            style={{ width: 32, height: 32, border: 'none', background: 'transparent', borderRadius: 7, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555570', transition: 'background 0.15s ease', flexShrink: 0 }}
            title={sidebarOpen ? 'Fechar sidebar' : 'Abrir sidebar'}
          >
            <svg width="15" height="12" fill="none" viewBox="0 0 15 12" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
              <line x1="0" y1="1" x2="15" y2="1" /><line x1="0" y1="6" x2="15" y2="6" /><line x1="0" y1="11" x2="15" y2="11" />
            </svg>
          </button>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: '#e2e2f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {currentChat?.title ?? 'Nova conversa'}
            </div>
          </div>

          {/* Botão tarefas */}
          <button
            className="icon-btn"
            onClick={() => setTasksOpen(t => !t)}
            title="Tarefas do projeto"
            style={{ position: 'relative', width: 32, height: 32, border: 'none', background: tasksOpen ? 'rgba(99,102,241,0.15)' : 'transparent', borderRadius: 7, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: tasksOpen ? '#a5b4fc' : '#555570', transition: 'all 0.15s ease', flexShrink: 0 }}
          >
            <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            {activeTasks.length > 0 && (
              <span style={{ position: 'absolute', top: 4, right: 4, width: 7, height: 7, borderRadius: '50%', background: '#6366f1', border: '1.5px solid #07070d' }} />
            )}
          </button>
        </div>

        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          {/* Mensagens */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '28px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ maxWidth: 720, width: '100%', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>

              {messages.length === 0 && (
                <div style={{ textAlign: 'center', color: '#33334a', marginTop: 80 }}>
                  <div style={{ width: 48, height: 48, borderRadius: 12, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Space Mono',monospace", fontWeight: 700, fontSize: 18, color: 'white', margin: '0 auto 18px', boxShadow: '0 4px 20px rgba(99,102,241,0.3)' }}>V</div>
                  <p style={{ fontSize: 16, color: '#888899', marginBottom: 8, fontWeight: 500 }}>Olá, eu sou a VERA.</p>
                  <p style={{ fontSize: 13, color: '#444455', lineHeight: 1.6 }}>Assistente contínua de projetos. Como posso ajudar o senhor hoje?</p>
                </div>
              )}

              {messages.map(msg => (
                <div key={msg.id} className="msg-bubble" style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                  <div style={{
                    maxWidth: '82%',
                    padding: '11px 16px',
                    borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                    background: msg.role === 'user' ? 'linear-gradient(135deg,#6366f1,#7c3aed)' : '#0e0e18',
                    border: msg.role === 'user' ? 'none' : '1px solid #111120',
                    fontSize: 14,
                    lineHeight: 1.65,
                    whiteSpace: 'pre-wrap',
                    color: msg.role === 'user' ? 'white' : '#d4d4e8',
                    boxShadow: msg.role === 'user' ? '0 2px 12px rgba(99,102,241,0.25)' : 'none',
                    wordBreak: 'break-word',
                  }}>
                    {msg.content}
                  </div>
                </div>
              ))}

              {loading && (
                <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                  <div style={{ padding: '11px 16px', borderRadius: '16px 16px 16px 4px', background: '#0e0e18', border: '1px solid #111120', display: 'flex', gap: 5, alignItems: 'center' }}>
                    {[0, 1, 2].map(i => (
                      <div key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: '#6366f1', opacity: 0.5, animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite` }} />
                    ))}
                  </div>
                </div>
              )}

              <div ref={bottomRef} />
            </div>
          </div>

          {/* ── PAINEL DE TAREFAS ────────────────────────────────────────── */}
          {tasksOpen && (
            <div style={{ width: 240, flexShrink: 0, borderLeft: '1px solid #111120', display: 'flex', flexDirection: 'column', background: '#07070d', overflowY: 'auto' }}>
              <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid #111120' }}>
                <div style={{ fontSize: 11, color: '#555570', fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Tarefas do projeto</div>
              </div>

              <div style={{ padding: '10px 12px', flex: 1 }}>
                {activeTasks.length === 0 ? (
                  <div style={{ fontSize: 12, color: '#33334a', textAlign: 'center', marginTop: 24, lineHeight: 1.6 }}>
                    Nenhuma tarefa aberta.<br />Converse com a VERA para criar tarefas.
                  </div>
                ) : (
                  activeTasks.map(task => (
                    <div key={task.id} style={{ marginBottom: 8, padding: '9px 11px', background: '#0e0e18', border: '1px solid #111120', borderRadius: 9, borderLeft: `2px solid ${STATUS_COLOR[task.status]}` }}>
                      <div style={{ fontSize: 12, color: '#d4d4e8', fontWeight: 500, lineHeight: 1.4, marginBottom: 4 }}>{task.title}</div>
                      {task.description && (
                        <div style={{ fontSize: 11, color: '#555570', lineHeight: 1.4, marginBottom: 4 }}>{task.description}</div>
                      )}
                      <div style={{ fontSize: 10, color: STATUS_COLOR[task.status], fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        {STATUS_LABEL[task.status]}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── INPUT ─────────────────────────────────────────────────────────── */}
        <div style={{ padding: '14px 24px 18px', borderTop: '1px solid #111120', background: '#07070d', flexShrink: 0 }}>
          <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', gap: 10, alignItems: 'flex-end' }}>
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={loading}
              placeholder="Mensagem para VERA... (Enter para enviar)"
              rows={1}
              style={{
                flex: 1,
                background: '#0e0e18',
                border: '1px solid #1a1a28',
                borderRadius: 12,
                padding: '12px 16px',
                color: '#e2e2f0',
                fontSize: 14,
                resize: 'none',
                outline: 'none',
                lineHeight: 1.55,
                transition: 'border-color 0.15s ease',
                maxHeight: 140,
                overflowY: 'auto',
              }}
              onFocus={e => { e.currentTarget.style.borderColor = 'rgba(99,102,241,0.35)' }}
              onBlur={e => { e.currentTarget.style.borderColor = '#1a1a28' }}
            />
            <button
              onClick={sendMessage}
              disabled={loading || !input.trim()}
              style={{
                background: 'linear-gradient(135deg,#6366f1,#7c3aed)',
                border: 'none',
                borderRadius: 10,
                width: 42,
                height: 42,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: loading || !input.trim() ? 0.35 : 1,
                flexShrink: 0,
                transition: 'opacity 0.15s ease, transform 0.1s ease',
                boxShadow: '0 2px 10px rgba(99,102,241,0.3)',
              }}
              onMouseEnter={e => { if (!loading && input.trim()) e.currentTarget.style.transform = 'scale(1.06)' }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)' }}
            >
              <svg width="17" height="17" fill="none" viewBox="0 0 24 24" stroke="white" strokeWidth={2.2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}