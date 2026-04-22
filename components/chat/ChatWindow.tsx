// components/chat/ChatWindow.tsx

import { useEffect, useRef } from 'react'

export interface Message {
  id:      string
  role:    'user' | 'assistant'
  content: string
}

interface Props {
  messages: Message[]
  loading:  boolean
}

export default function ChatWindow({ messages, loading }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  return (
    <div style={{
      flex: 1, overflowY: 'auto',
      padding: '28px 24px',
      display: 'flex', flexDirection: 'column', gap: 14,
    }}>
      <div style={{
        maxWidth: 720, width: '100%',
        margin: '0 auto',
        display: 'flex', flexDirection: 'column', gap: 14,
      }}>

        {/* Estado vazio */}
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', color: '#33334a', marginTop: 80 }}>
            <div style={{
              width: 48, height: 48, borderRadius: 12,
              background: 'linear-gradient(135deg,#6366f1,#8b5cf6)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: "'Space Mono',monospace", fontWeight: 700,
              fontSize: 18, color: 'white',
              margin: '0 auto 18px',
              boxShadow: '0 4px 20px rgba(99,102,241,0.3)',
            }}>V</div>
            <p style={{ fontSize: 16, color: '#888899', marginBottom: 8, fontWeight: 500 }}>
              Olá, eu sou a VERA.
            </p>
            <p style={{ fontSize: 13, color: '#444455', lineHeight: 1.6 }}>
              Assistente contínua de projetos. Como posso ajudar o senhor hoje?
            </p>
          </div>
        )}

        {/* Mensagens */}
        {messages.map(msg => (
          <div
            key={msg.id}
            className="msg-bubble"
            style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}
          >
            <div style={{
              maxWidth: '82%',
              padding: '11px 16px',
              borderRadius: msg.role === 'user'
                ? '16px 16px 4px 16px'
                : '16px 16px 16px 4px',
              background: msg.role === 'user'
                ? 'linear-gradient(135deg,#6366f1,#7c3aed)'
                : '#0e0e18',
              border: msg.role === 'user' ? 'none' : '1px solid #111120',
              fontSize: 14, lineHeight: 1.65,
              whiteSpace: 'pre-wrap',
              color: msg.role === 'user' ? 'white' : '#d4d4e8',
              boxShadow: msg.role === 'user' ? '0 2px 12px rgba(99,102,241,0.25)' : 'none',
              wordBreak: 'break-word',
            }}>
              {msg.content}
            </div>
          </div>
        ))}

        {/* Indicador de loading */}
        {loading && (
          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            <div style={{
              padding: '11px 16px',
              borderRadius: '16px 16px 16px 4px',
              background: '#0e0e18', border: '1px solid #111120',
              display: 'flex', gap: 5, alignItems: 'center',
            }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: '#6366f1', opacity: 0.5,
                  animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
                }} />
              ))}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  )
}