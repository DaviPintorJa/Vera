// components/chat/TaskItem.tsx

export interface Task {
  id:          string
  title:       string
  description: string | null
  status:      'open' | 'in_progress' | 'done' | 'blocked' | 'cancelled'
  importance:  number
}

export const STATUS_LABEL: Record<Task['status'], string> = {
  open:        'Aberta',
  in_progress: 'Em andamento',
  done:        'Concluída',
  blocked:     'Bloqueada',
  cancelled:   'Cancelada',
}

export const STATUS_COLOR: Record<Task['status'], string> = {
  open:        '#6366f1',
  in_progress: '#f59e0b',
  done:        '#22c55e',
  blocked:     '#ef4444',
  cancelled:   '#555570',
}

interface Props { task: Task }

export default function TaskItem({ task }: Props) {
  return (
    <div style={{
      marginBottom: 8,
      padding: '9px 11px',
      background: '#0e0e18',
      border: '1px solid #111120',
      borderRadius: 9,
      borderLeft: `2px solid ${STATUS_COLOR[task.status]}`,
    }}>
      <div style={{ fontSize: 12, color: '#d4d4e8', fontWeight: 500, lineHeight: 1.4, marginBottom: 4 }}>
        {task.title}
      </div>
      {task.description && (
        <div style={{ fontSize: 11, color: '#555570', lineHeight: 1.4, marginBottom: 4 }}>
          {task.description}
        </div>
      )}
      <div style={{
        fontSize: 10,
        color: STATUS_COLOR[task.status],
        fontWeight: 500,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
      }}>
        {STATUS_LABEL[task.status]}
      </div>
    </div>
  )
}