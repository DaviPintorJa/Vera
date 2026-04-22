// app/chat/page.tsx
'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/llm/supabase/client'

import Sidebar,      { type Chat }    from '@/components/chat/Sidebar'
import ChatHeader                     from '@/components/chat/ChatHeader'
import ChatWindow,   { type Message } from '@/components/chat/ChatWindow'
import MessageInput                   from '@/components/chat/MessageInput'
import TasksPanel                     from '@/components/chat/TasksPanel'
import type { Task }                  from '@/components/chat/TaskItem'

export default function ChatPage() {
  const [messages,    setMessages]    = useState<Message[]>([])
  const [input,       setInput]       = useState('')
  const [loading,     setLoading]     = useState(false)
  const [chatId,      setChatId]      = useState<string | null>(null)
  const [chats,       setChats]       = useState<Chat[]>([])
  const [tasks,       setTasks]       = useState<Task[]>([])
  const [userId,      setUserId]      = useState<string | null>(null)
  const [ready,       setReady]       = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [tasksOpen,   setTasksOpen]   = useState(false)

  const supabase = createClient()

  // ── Data fetchers ──────────────────────────────────────────────────────────

  const loadChats = useCallback(async (uid: string) => {
    const { data } = await supabase
      .from('chats')
      .select('id, title, created_at')
      .eq('user_id', uid)
      .order('created_at', { ascending: false })
      .limit(30)
    if (data) setChats(data as Chat[])
  }, [supabase])

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

  const loadMessages = useCallback(async (cid: string) => {
    const { data } = await supabase
      .from('messages')
      .select('id, role, content')
      .eq('chat_id', cid)
      .order('created_at', { ascending: true })
    if (data) setMessages(data as Message[])
  }, [supabase])

  // ── Inicialização ──────────────────────────────────────────────────────────

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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Ações ──────────────────────────────────────────────────────────────────

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

  async function switchChat(cid: string) {
    if (cid === chatId) return
    setChatId(cid)
    setMessages([])
    setTasks([])
    await loadMessages(cid)
    if (userId) await loadTasks(userId, cid)
  }

  async function sendMessage() {
    if (!input.trim() || loading || !chatId) return
    const userText = input.trim()
    setInput('')
    setLoading(true)

    setMessages(prev => [...prev, { id: Date.now().toString(), role: 'user', content: userText }])

    try {
      const res  = await fetch('/api/chat', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ message: userText, chatId }),
      })
      const data = await res.json()

      if (res.ok) {
        setMessages(prev => [
          ...prev,
          { id: (Date.now() + 1).toString(), role: 'assistant', content: data.reply },
        ])
        if (userId) {
          setTimeout(() => loadTasks(userId, chatId), 2000)
          loadChats(userId)
        }
      } else {
        setMessages(prev => [
          ...prev,
          { id: (Date.now() + 1).toString(), role: 'assistant', content: '⚠️ Erro ao processar sua mensagem. Tente novamente.' },
        ])
      }
    } catch {
      setMessages(prev => [
        ...prev,
        { id: (Date.now() + 1).toString(), role: 'assistant', content: '⚠️ Erro de conexão. Verifique sua internet.' },
      ])
    } finally {
      setLoading(false)
    }
  }

  // ── Loading screen ─────────────────────────────────────────────────────────

  if (!ready) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', background: '#07070d', color: '#555570',
        fontFamily: 'system-ui', gap: 10,
      }}>
        <div style={{
          width: 8, height: 8, borderRadius: '50%',
          background: '#6366f1', animation: 'pulse 1.2s ease-in-out infinite',
        }} />
        <span style={{ fontSize: 14, letterSpacing: '0.05em' }}>Carregando VERA...</span>
        <style>{`@keyframes pulse { 0%,100%{opacity:.3} 50%{opacity:1} }`}</style>
      </div>
    )
  }

  const activeTasks   = tasks.filter(t => t.status !== 'done' && t.status !== 'cancelled')
  const currentChat   = chats.find(c => c.id === chatId)

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{
      display: 'flex', height: '100vh',
      background: '#07070d', color: '#e2e2f0',
      fontFamily: "'DM Sans', system-ui, sans-serif",
      overflow: 'hidden',
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=DM+Sans:wght@300;400;500&display=swap');
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #1e1e2e; border-radius: 4px; }
        textarea { font-family: 'DM Sans', system-ui, sans-serif; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pulse  { 0%,100%{opacity:.3} 50%{opacity:1} }
        .msg-bubble   { animation: fadeIn 0.2s ease forwards; }
        .chat-item:hover  { background: rgba(99,102,241,0.06) !important; }
        .chat-item.active { background: rgba(99,102,241,0.1) !important; border-color: rgba(99,102,241,0.2) !important; }
        .icon-btn:hover   { background: rgba(99,102,241,0.12) !important; }
        .new-chat-btn:hover { background: rgba(99,102,241,0.18) !important; }
      `}</style>

      {sidebarOpen && (
        <Sidebar
          chats={chats}
          activeChatId={chatId}
          onNewChat={createNewChat}
          onSelectChat={switchChat}
        />
      )}

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <ChatHeader
          title={currentChat?.title ?? 'Nova conversa'}
          sidebarOpen={sidebarOpen}
          tasksOpen={tasksOpen}
          activeTasks={activeTasks}
          onToggleSidebar={() => setSidebarOpen(s => !s)}
          onToggleTasks={()   => setTasksOpen(t  => !t)}
        />

        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          <ChatWindow messages={messages} loading={loading} />

          {tasksOpen && <TasksPanel tasks={tasks} />}
        </div>

        <MessageInput
          value={input}
          loading={loading}
          onChange={setInput}
          onSend={sendMessage}
        />
      </div>
    </div>
  )
}