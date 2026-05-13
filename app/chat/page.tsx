// app/chat/page.tsx
'use client'

import { useEffect, useState, useCallback, createContext, useContext } from 'react'
import { createClient } from '@/lib/llm/supabase/client'

import Sidebar,      { type Chat, type Profile } from '@/components/chat/Sidebar'
import ChatHeader                     from '@/components/chat/ChatHeader'
import ChatWindow,   { type Message } from '@/components/chat/ChatWindow'
import MessageInput                   from '@/components/chat/MessageInput'
import TasksPanel                     from '@/components/chat/TasksPanel'
import ChatUpload                     from '@/components/chat/ChatUpload'
import type { Task }                  from '@/components/chat/TaskItem'

// Contexto para compartilhar o chatId e o profileId com componentes filhos
const ChatContext = createContext<{ chatId: string | null; profileId: string | null }>({
  chatId: null,
  profileId: null,
});
export const useChat = () => useContext(ChatContext);
export default function ChatPage() {
  const [messages,    setMessages]    = useState<Message[]>([])
  const [input,       setInput]       = useState('')
  const [loading,     setLoading]     = useState(false)
  const [chatId,      setChatId]      = useState<string | null>(null)
  const [profileId,   setProfileId]   = useState<string | null>(null)
  const [profiles,    setProfiles]    = useState<Profile[]>([])
  const [chats,       setChats]       = useState<Chat[]>([])
  const [tasks,       setTasks]       = useState<Task[]>([])
  const [userId,      setUserId]      = useState<string | null>(null)
  const [ready,       setReady]       = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [tasksOpen,   setTasksOpen]   = useState(false)

  const supabase = createClient()

  // ── Data fetchers ──────────────────────────────────────────────────────────

  const loadChats = useCallback(async (uid: string, pid: string) => {
    const { data } = await supabase
      .from('chats')
      .select('id, title, created_at, profile_id')
      .eq('user_id', uid)
      .eq('profile_id', pid)
      .order('created_at', { ascending: false })
      .limit(30)
    if (data) setChats(data as Chat[])
  }, [supabase])

  const loadTasks = useCallback(async (uid: string, cid: string) => {
    void uid
    void cid
    setTasks([])
  }, [])

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

      const { data: profileRows } = await supabase
        .from('profiles')
        .select('id, name, slug, description, system_prompt, is_default')
        .eq('user_id', user.id)
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: true })

      const loadedProfiles = (profileRows ?? []) as Profile[]
      setProfiles(loadedProfiles)

      const currentProfile = loadedProfiles.find(profile => profile.is_default) ?? loadedProfiles[0]
      if (!currentProfile) {
        console.error('Nenhum perfil encontrado para este usuário')
        return
      }

      setProfileId(currentProfile.id)

      const { data: existingChats } = await supabase
        .from('chats')
        .select('id, title, created_at, profile_id')
        .eq('user_id', user.id)
        .eq('profile_id', currentProfile.id)
        .order('created_at', { ascending: false })
        .limit(30)

      let currentChatId: string

      if (existingChats && existingChats.length > 0) {
        setChats(existingChats as Chat[])
        currentChatId = existingChats[0].id
      } else {
        const { data: newChat } = await supabase
          .from('chats')
          .insert({ user_id: user.id, profile_id: currentProfile.id, title: 'Nova conversa' })
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
    if (!userId || !profileId) return
    const { data: newChat } = await supabase
      .from('chats')
      .insert({ user_id: userId, profile_id: profileId, title: 'Nova conversa' })
      .select()
      .single()
    if (!newChat) return
    setChatId(newChat.id)
    setMessages([])
    setTasks([])
    await loadChats(userId, profileId)
  }

  async function selectProfile(pid: string) {
    if (!userId || !pid || pid === profileId) return
    setProfileId(pid)
    setMessages([])
    setTasks([])
    setChats([])

    const { data: profileChats } = await supabase
      .from('chats')
      .select('id, title, created_at, profile_id')
      .eq('user_id', userId)
      .eq('profile_id', pid)
      .order('created_at', { ascending: false })
      .limit(30)

    let nextChatId: string
    if (profileChats && profileChats.length > 0) {
      setChats(profileChats as Chat[])
      nextChatId = profileChats[0].id
    } else {
      const { data: newChat } = await supabase
        .from('chats')
        .insert({ user_id: userId, profile_id: pid, title: 'Nova conversa' })
        .select()
        .single()
      if (!newChat) return
      setChats([newChat as Chat])
      nextChatId = newChat.id
    }

    setChatId(nextChatId)
    await loadMessages(nextChatId)
    await loadTasks(userId, nextChatId)
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
        body:    JSON.stringify({ message: userText, chatId, profileId }),
      })
      const data = await res.json()

      if (res.ok) {
        setMessages(prev => [
          ...prev,
          { id: (Date.now() + 1).toString(), role: 'assistant', content: data.reply },
        ])
        if (userId) {
          setTimeout(() => loadTasks(userId, chatId), 2000)
          if (profileId) loadChats(userId, profileId)
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

  // ── Supabase Realtime para novas mensagens ──────────────────────────────────
  useEffect(() => {
    if (!chatId) return;

    const channel = supabase
      .channel(`chat_${chatId}_messages`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `chat_id=eq.${chatId}`,
        },
        (payload) => {
          const newMessage = payload.new as Message;
          setMessages((prevMessages) => {
            // Evita duplicatas se a mensagem já foi adicionada
            if (prevMessages.some(msg => msg.id === newMessage.id)) return prevMessages;
            return [...prevMessages, newMessage];
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [chatId, supabase]);

  // ── Loading screen ─────────────────────────────────────────────────────────

  if (!ready) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-[#07070d] text-[#555570] font-sans gap-4">
        <div className="relative">
          <div className="w-12 h-12 border-2 border-indigo-500/20 rounded-full animate-ping absolute" />
          <div className="w-12 h-12 border-2 border-indigo-500 rounded-full flex items-center justify-center">
            <div className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse" />
          </div>
        </div>
        <div className="flex flex-col items-center">
          <span className="text-sm font-medium tracking-[0.2em] uppercase text-indigo-400/80">
            Sincronizando
          </span>
          <span className="text-xs opacity-50">VERA NLP Interface</span>
        </div>
        <style jsx global>{`
          @keyframes pulse { 0%, 100% { opacity: 0.3; } 50% { opacity: 1; } }
          body { background-color: #07070d; margin: 0; }
        `}</style>
      </div>
    )
  }

  const activeTasks   = tasks.filter(t => t.status !== 'done' && t.status !== 'cancelled')
  const currentChat   = chats.find(c => c.id === chatId)

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen bg-[#07070d] text-[#e2e2f0] font-sans overflow-hidden">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=DM+Sans:wght@300;400;500&display=swap');
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #1a1a2e; border-radius: 4px; }
        textarea { font-family: 'DM Sans', system-ui, sans-serif; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        .msg-bubble   { animation: fadeIn 0.2s ease forwards; }
        .chat-item:hover  { background: rgba(99,102,241,0.06) !important; }
        .chat-item.active { background: rgba(99,102,241,0.1) !important; border-color: rgba(99,102,241,0.2) !important; }
        .icon-btn:hover   { background: rgba(99,102,241,0.12) !important; }
        .new-chat-btn:hover { background: rgba(99,102,241,0.18) !important; }
        .footer-blur { background: rgba(7, 7, 13, 0.8); backdrop-filter: blur(12px); }
      `}</style>
      <ChatContext.Provider value={{ chatId, profileId }}>
      {sidebarOpen && (
        <Sidebar
          chats={chats}
          profiles={profiles}
          activeChatId={chatId}
          activeProfileId={profileId}
          onNewChat={createNewChat}
          onSelectChat={switchChat}
          onSelectProfile={selectProfile}
        />
      )}

      <div className="flex-1 flex flex-col min-w-0 relative">
        <ChatHeader
          title={currentChat?.title ?? 'Nova conversa'}
          sidebarOpen={sidebarOpen}
          tasksOpen={tasksOpen}
          activeTasks={activeTasks}
          onToggleSidebar={() => setSidebarOpen(s => !s)}
          onToggleTasks={()   => setTasksOpen(t  => !t)}
        />

        <div className="flex-1 flex min-h-0 px-4 md:px-12 lg:px-24">
          <ChatWindow messages={messages} loading={loading} />
          {tasksOpen && <TasksPanel tasks={tasks} />}
        </div>

        {/* Footer com Toolbar Unificada */}
        <div className="footer-blur px-4 md:px-8 pb-8 pt-2 flex justify-center">
          <div className="w-full max-w-3xl flex items-center gap-2 px-4 bg-[#1a1a28]/60 rounded-2xl border border-white/5 focus-within:border-indigo-500/30 transition-all shadow-2xl backdrop-blur-sm">
            <ChatUpload /> {/* onDocumentProcessed não é mais necessário aqui */}
            <MessageInput
              value={input}
              loading={loading}
              onChange={setInput}
              onSend={sendMessage}
            />
          </div>
        </div>
      </div>
      </ChatContext.Provider>
    </div>
  )
}
