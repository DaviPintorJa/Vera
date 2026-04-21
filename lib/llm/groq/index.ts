// lib/llm/groq/index.ts
// Interface pública do módulo Groq.
// Qualquer arquivo fora desta pasta deve importar APENAS daqui.

export { callGroq as askGroq } from '@/lib/llm/groq/client'
export { VERA_SYSTEM_PROMPT } from '@/lib/llm/groq/prompt'