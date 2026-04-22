// components/chat/Sidebar.tsx

export interface Chat {
  id:         string
  title:      string
  created_at: string
}

interface Props {
  chats:         Chat[]
  activeChatId:  string | null
  onNewChat:     () => void
  onSelectChat:  (id: string) => void
}

export default function Sidebar({ chats, activeChatId, onNewChat, onSelectChat }: Props) {
  return (
    <div style={{
      width: 240,
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'column',
      borderRight: '1px solid #111120',
      background: '#07070d',
    }}>
      {/* Logo */}
      <div style={{
        padding: '18px 16px 14px',
        borderBottom: '1px solid #111120',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}>
        <div style={{
          width: 28, height: 28,
          borderRadius: 7,
          background: 'linear-gradient(135deg,#6366f1,#8b5cf6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: "'Space Mono',monospace",
          fontWeight: 700, fontSize: 12, color: 'white',
          flexShrink: 0,
          boxShadow: '0 2px 8px rgba(99,102,241,0.4)',
        }}>V</div>
        <span style={{
          fontFamily: "'Space Mono',monospace",
          fontSize: 13, fontWeight: 700,
          letterSpacing: '0.1em', color: '#e2e2f0',
        }}>VERA</span>
      </div>

      {/* Novo Chat */}
      <div style={{ padding: '10px 10px 6px' }}>
        <button
          className="new-chat-btn"
          onClick={onNewChat}
          style={{
            width: '100%',
            padding: '9px 12px',
            background: 'rgba(99,102,241,0.08)',
            border: '1px dashed rgba(99,102,241,0.2)',
            borderRadius: 9,
            color: '#6366f1',
            fontSize: 12,
            fontFamily: "'DM Sans',system-ui",
            fontWeight: 500,
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 8,
            transition: 'background 0.15s ease',
            letterSpacing: '0.02em',
          }}
        >
          <span style={{ fontSize: 16, lineHeight: 1 }}>+</span>
          Novo projeto
        </button>
      </div>

      {/* Lista de chats */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 10px 10px' }}>
        <div style={{
          fontSize: 10, color: '#33334a', fontWeight: 500,
          letterSpacing: '0.1em', textTransform: 'uppercase',
          padding: '8px 4px 6px',
        }}>Conversas</div>

        {chats.map(chat => (
          <button
            key={chat.id}
            className={`chat-item ${chat.id === activeChatId ? 'active' : ''}`}
            onClick={() => onSelectChat(chat.id)}
            style={{
              width: '100%',
              padding: '8px 10px',
              background: 'transparent',
              border: '1px solid transparent',
              borderRadius: 8,
              color: chat.id === activeChatId ? '#a5b4fc' : '#888899',
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
  )
}