// lib/llm/context.ts
import { createServiceClient } from '@/lib/supabase/server'

type MemoryType = 'identity' | 'location' | 'goal' | 'preference' | 'context'

interface MemoryRow {
  type: MemoryType
  value: string
  granularity: string
  confidence: number
}

// ─── Mapeamento expandido e mais inteligente ────────────────────────────────
const TYPE_KEYWORDS: Record<MemoryType, string[]> = {
  identity: [
    'quem sou', 'meu nome', 'minha idade', 'quantos anos', 'me chamo', 'sou eu',
    'minha identidade', 'me apresente', 'quem é o usuário', 'eu sou', 'meu perfil',
    'sobre mim', 'minha história', 'nascido em', 'data de nascimento',
  ],
  location: [
    'onde moro', 'minha cidade', 'meu país', 'meu estado', 'onde fico', 'clima',
    'temperatura', 'onde estou', 'localização', 'onde vivo', 'meu endereço',
    'moro em', 'estou em', 'cidade atual', 'país atual',
  ],
  goal: [
    'meu objetivo', 'quero aprender', 'minha meta', 'meu plano', 'o que quero',
    'minha ambição', 'estou tentando', 'pretendo', 'quero alcançar', 'sonho',
    'aspiracao', 'próximo passo', 'futuro',
  ],
  preference: [
    'meu gosto', 'prefiro', 'gosto de', 'não gosto', 'favorito', 'preferência',
    'curto', 'detesto', 'amo', 'odeio', 'prefiro evitar', 'me incomoda',
    'adoro', 'não suporto', 'melhor para mim',
  ],
  context: [
    'minha profissão', 'meu trabalho', 'minha família', 'minha situação',
    'meu contexto', 'trabalho com', 'trabalho em', 'sou profissional',
    'estudo', 'faculdade', 'carreira', 'rotina', 'dia a dia',
  ],
}

// Palavras que indicam "pergunta sobre mim" mesmo sem tipo específico
const GENERAL_INDICATORS = [
  'eu', 'meu', 'minha', 'mim', 'sobre mim', 'fale de mim', 'me conte',
  'lembra', 'sabe que eu', 'você sabe',
]

const TYPE_LABELS: Record<MemoryType, string> = {
  identity: 'Identidade',
  location: 'Localização',
  goal: 'Objetivo',
  preference: 'Preferência',
  context: 'Contexto',
}

// ─── Detecção aprimorada (keyword + score) ───────────────────────────────────
function detectMemoryType(message: string): MemoryType | null {
  const lower = message.toLowerCase().trim()

  // Verifica se é uma pergunta sobre o usuário
  const isAboutUser = GENERAL_INDICATORS.some(ind => lower.includes(ind))

  let bestType: MemoryType | null = null
  let bestScore = 0

  for (const [type, keywords] of Object.entries(TYPE_KEYWORDS) as [MemoryType, string[]][]) {
    const matches = keywords.filter(kw => lower.includes(kw)).length
    const score = matches * (type === 'identity' || type === 'preference' ? 1.3 : 1) // leve bias para tipos mais pessoais

    if (score > bestScore) {
      bestScore = score
      bestType = type
    }
  }

  // Se encontrou algo razoável ou é claramente sobre o usuário → retorna
  if (bestScore >= 1 || (isAboutUser && bestScore > 0)) {
    return bestType
  }

  return null
}

// ─── Busca de memórias (melhor balanceamento) ───────────────────────────────
async function fetchMemories(
  userId: string,
  priorityType: MemoryType | null
): Promise<MemoryRow[]> {
  const supabase = createServiceClient()

  const baseQuery = supabase
    .from('memories')
    .select('type, value, granularity, confidence')
    .eq('user_id', userId)
    .eq('needs_disambiguation', false)
    .gte('confidence', 0.5)

  if (priorityType) {
    // Prioridade: até 7 do tipo específico + 5 gerais
    const [priorityRes, generalRes] = await Promise.all([
      baseQuery
        .eq('type', priorityType)
        .order('confidence', { ascending: false })
        .order('granularity', { ascending: false }) // granularidade mais fina primeiro
        .limit(7),
      baseQuery
        .neq('type', priorityType)
        .order('confidence', { ascending: false })
        .limit(5),
    ])

    if (priorityRes.error) console.warn('[CONTEXT] Erro prioridade:', priorityRes.error.message)
    if (generalRes.error) console.warn('[CONTEXT] Erro geral:', generalRes.error.message)

    return [...(priorityRes.data ?? []), ...(generalRes.data ?? [])]
  }

  // Sem prioridade: top 10 mais confiáveis
  const { data, error } = await baseQuery
    .order('confidence', { ascending: false })
    .limit(10)

  if (error) {
    console.warn('[CONTEXT] Erro busca geral:', error.message)
    return []
  }

  return data ?? []
}

// ─── Construção do bloco (mais natural e limpo) ─────────────────────────────
function buildMemoryBlock(memories: MemoryRow[]): string {
  if (memories.length === 0) return ''

  // Deduplicação forte + ordenação final
  const seen = new Set<string>()
  const unique = memories
    .filter(m => {
      const key = `${m.type}:${m.value.toLowerCase().trim()}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => b.confidence - a.confidence) // mais confiável primeiro

  const lines = unique.map(m => {
    const label = TYPE_LABELS[m.type] ?? m.type
    return `• ${label}: ${m.value}`
  })

  return `Memórias relevantes sobre o usuário:\n${lines.join('\n')}`
}

// ─── Função principal (mais limpa e resiliente) ─────────────────────────────
export async function buildUserContext(
  userId: string,
  userMessage: string
): Promise<string> {
  if (!userId || !userMessage?.trim()) return ''

  try {
    const priorityType = detectMemoryType(userMessage)

    console.log(`[CONTEXT] Mensagem: "${userMessage.slice(0, 80)}${userMessage.length > 80 ? '...' : ''}"`)
    console.log(`[CONTEXT] Tipo priorizado: ${priorityType ?? 'geral'}`)

    const memories = await fetchMemories(userId, priorityType)

    console.log(`[CONTEXT] ${memories.length} memórias recuperadas (únicas: ${new Set(memories.map(m => m.type)).size} tipos)`)

    const contextBlock = buildMemoryBlock(memories)

    if (contextBlock) {
      console.log(`[CONTEXT] Bloco de contexto gerado com ${memories.length} itens`)
    }

    return contextBlock
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[CONTEXT] Erro ao construir contexto:', msg)
    return '' // Nunca quebra o fluxo do chat
  }
}