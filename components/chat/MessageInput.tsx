// components/chat/MessageInput.tsx

interface Props {
  value:    string
  loading:  boolean
  onChange: (v: string) => void
  onSend:   () => void
}

export default function MessageInput({ value, loading, onChange, onSend }: Props) {
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend() }
  }

  return (
    <div style={{
      padding: '14px 24px 18px',
      borderTop: '1px solid #111120',
      background: '#07070d', flexShrink: 0,
    }}>
      <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', gap: 10, alignItems: 'flex-end' }}>
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
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
          onFocus={e  => { e.currentTarget.style.borderColor = 'rgba(99,102,241,0.35)' }}
          onBlur={e   => { e.currentTarget.style.borderColor = '#1a1a28' }}
        />
        <button
          onClick={onSend}
          disabled={loading || !value.trim()}
          style={{
            background: 'linear-gradient(135deg,#6366f1,#7c3aed)',
            border: 'none', borderRadius: 10,
            width: 42, height: 42,
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            opacity: loading || !value.trim() ? 0.35 : 1,
            flexShrink: 0,
            transition: 'opacity 0.15s ease, transform 0.1s ease',
            boxShadow: '0 2px 10px rgba(99,102,241,0.3)',
          }}
          onMouseEnter={e => { if (!loading && value.trim()) e.currentTarget.style.transform = 'scale(1.06)' }}
          onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)' }}
        >
          <svg width="17" height="17" fill="none" viewBox="0 0 24 24"
            stroke="white" strokeWidth={2.2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  )
}