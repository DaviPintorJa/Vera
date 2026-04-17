// lib/llm/groq.ts

export interface Message {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export async function askGroq(messages: Message[]): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY

  if (!apiKey) {
    console.error('[GROQ] ERRO CRÍTICO: GROQ_API_KEY não está definida no ambiente.')
    throw new Error('GROQ_API_KEY ausente. Configure a variável de ambiente.')
  }

  console.log(`[GROQ] Iniciando chamada com ${messages.length} mensagem(ns) no histórico.`)

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant', // ← atualizado
        messages: [
          {
            role: 'system',
            content: `Você é a VERA (Veracidade, Estratégia, Repertório e Avaliação).
Um assistente pessoal privado, direto e inteligente.
Responda sempre em português do Brasil.
Seja franco, objetivo e útil.`,
          },
          ...messages,
        ],
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`[GROQ] API retornou erro ${response.status}:`, errorText)
      throw new Error(`Groq API error: ${response.status} — ${errorText}`)
    }

    const data = await response.json()
    const reply = data.choices?.[0]?.message?.content

    if (!reply) {
      console.error('[GROQ] Resposta recebida mas sem conteúdo:', JSON.stringify(data))
      throw new Error('Resposta da Groq API veio vazia ou malformada.')
    }

    console.log('[GROQ] Resposta recebida com sucesso.')
    return reply

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[GROQ] Falha na chamada à API:', message)
    throw err
  }
}