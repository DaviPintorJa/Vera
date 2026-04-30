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
    <div className="flex-1 flex items-center gap-3">
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={loading}
        placeholder="Mensagem para VERA..."
        rows={1}
        className="flex-1 bg-transparent border-none text-[#e2e2f0] text-sm resize-none outline-none py-3 placeholder-gray-600 max-h-32 overflow-y-auto"
      />
      
      <button
        onClick={onSend}
        disabled={loading || !value.trim()}
        style={{
          background: 'linear-gradient(135deg,#6366f1,#7c3aed)',
          border: 'none', 
          borderRadius: '12px',
          width: 36, 
          height: 36,
          cursor: 'pointer',
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center',
          opacity: loading || !value.trim() ? 0.2 : 1,
          flexShrink: 0,
          transition: 'all 0.2s ease',
          boxShadow: '0 0 15px rgba(99,102,241,0.2)',
        }}
      >
        <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="white" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M12 5l7 7-7 7" />
        </svg>
      </button>
    </div>
  )
}