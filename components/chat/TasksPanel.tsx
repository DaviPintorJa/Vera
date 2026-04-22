// components/chat/TasksPanel.tsx

import TaskItem, { type Task } from './TaskItem'

interface Props {
  tasks: Task[]
}

export default function TasksPanel({ tasks }: Props) {
  const active = tasks.filter(t => t.status !== 'done' && t.status !== 'cancelled')

  return (
    <div style={{
      width: 240,
      flexShrink: 0,
      borderLeft: '1px solid #111120',
      display: 'flex',
      flexDirection: 'column',
      background: '#07070d',
      overflowY: 'auto',
    }}>
      <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid #111120' }}>
        <div style={{
          fontSize: 11,
          color: '#555570',
          fontWeight: 500,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
        }}>
          Tarefas do projeto
        </div>
      </div>

      <div style={{ padding: '10px 12px', flex: 1 }}>
        {active.length === 0 ? (
          <div style={{ fontSize: 12, color: '#33334a', textAlign: 'center', marginTop: 24, lineHeight: 1.6 }}>
            Nenhuma tarefa aberta.<br />Converse com a VERA para criar tarefas.
          </div>
        ) : (
          active.map(task => <TaskItem key={task.id} task={task} />)
        )}
      </div>
    </div>
  )
}