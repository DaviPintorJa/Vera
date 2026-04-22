// components/chat/ChatHeader.tsx

import type { Task } from './TaskItem'

interface Props {
  title:          string
  sidebarOpen:    boolean
  tasksOpen:      boolean
  activeTasks:    Task[]
  onToggleSidebar: () => void
  onToggleTasks:   () => void
}

export default function ChatHeader({
  title,
  sidebarOpen,
  tasksOpen,
  activeTasks,
  onToggleSidebar,
  onToggleTasks,
}: Props) {
  return (
    <div style={{
      padding: '12px 20px',
      borderBottom: '1px solid #111120',
      display: 'flex', alignItems: 'center', gap: 12,
      flexShrink: 0,
      background: '#07070d',
    }}>
      {/* Toggle sidebar */}
      <button
        className="icon-btn"
        onClick={onToggleSidebar}
        style={{
          width: 32, height: 32,
          border: 'none', background: 'transparent',
          borderRadius: 7, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#555570', transition: 'background 0.15s ease', flexShrink: 0,
        }}
        title={sidebarOpen ? 'Fechar sidebar' : 'Abrir sidebar'}
      >
        <svg width="15" height="12" fill="none" viewBox="0 0 15 12"
          stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
          <line x1="0" y1="1"  x2="15" y2="1"  />
          <line x1="0" y1="6"  x2="15" y2="6"  />
          <line x1="0" y1="11" x2="15" y2="11" />
        </svg>
      </button>

      {/* Título do chat */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 500, color: '#e2e2f0',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {title}
        </div>
      </div>

      {/* Toggle tarefas */}
      <button
        className="icon-btn"
        onClick={onToggleTasks}
        title="Tarefas do projeto"
        style={{
          position: 'relative', width: 32, height: 32,
          border: 'none',
          background: tasksOpen ? 'rgba(99,102,241,0.15)' : 'transparent',
          borderRadius: 7, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: tasksOpen ? '#a5b4fc' : '#555570',
          transition: 'all 0.15s ease', flexShrink: 0,
        }}
      >
        <svg width="16" height="16" fill="none" viewBox="0 0 24 24"
          stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2
               M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
        {activeTasks.length > 0 && (
          <span style={{
            position: 'absolute', top: 4, right: 4,
            width: 7, height: 7, borderRadius: '50%',
            background: '#6366f1', border: '1.5px solid #07070d',
          }} />
        )}
      </button>
    </div>
  )
}