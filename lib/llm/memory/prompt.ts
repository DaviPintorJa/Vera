// lib/llm/memory/prompt.ts
// Responsabilidade única: montar o prompt de extração de memória.
// Não depende de Supabase, Groq ou validação.

export function buildExtractionPrompt(
  userMessage: string,
  assistantReply: string
): string {
  return `You are a strict memory extraction system for a personal AI assistant called VERA.
Your job is to extract durable, factual memories and actionable tasks from the conversation.

Return a JSON object with exactly two keys: "memories" and "tasks".

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CRITICAL RULES FOR THE "value" FIELD
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

RULE 1 — THIRD PERSON ONLY (most important rule):
The "value" field MUST always be written in the third person, describing the user objectively.
NEVER use first-person pronouns: eu, meu, minha, me, mim, nosso, nossa.

  ✗ WRONG:  "Meu nome é Davi"
  ✓ CORRECT: "O nome do usuário é Davi"

  ✗ WRONG:  "Minha esposa se chama Miriã"
  ✓ CORRECT: "A esposa do usuário se chama Miriã"

RULE 2 — CLEAN FACTS ONLY. Remove conversational artifacts and titles:
  ✗ WRONG:  "senhor Davi" (has conversational title)
  ✓ CORRECT: "O nome do usuário é Davi"

RULE 3 — NO NOISE OR META-CONVERSATION. These are NOT memories:
  - "Estou compartilhando informações pessoais"
  - "Vou te contar algo"
  - "Só pra constar"
  → If you detect noise: return [] for memories

RULE 4 — DURABLE FACTS ONLY. Do not extract temporary states:
  ✗ "O usuário está com dor de cabeça hoje" (temporary)
  ✓ "O usuário tem alergia a amendoim" (durable)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TYPE CHEAT SHEET
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

identity       → Facts about the user themselves: name, age, gender, nationality
location       → Where the user lives or works
goal           → Personal long-term objectives, ambitions, plans
preference     → Durable likes, dislikes, habits, hobbies
context        → Family, profession, tools, life situation of the user
project_goal        → The main goal of the active project
project_decision    → A technical or strategic decision made in this project
project_constraint  → A hard constraint or limitation for this project
project_scope       → The current scope or focus of the project
project_state       → The current status or progress of the project

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FEW-SHOT EXAMPLES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Example 1:
User: "Meu nome é Davi e minha esposa se chama Miriã."
Output:
{
  "memories": [
    {"type": "identity",  "value": "O nome do usuário é Davi",           "granularity": "first_name", "confidence": 1.0, "needs_disambiguation": false, "scope": "global",  "importance": 6, "source": "explicit"},
    {"type": "context",   "value": "A esposa do usuário se chama Miriã", "granularity": "personal",   "confidence": 1.0, "needs_disambiguation": false, "scope": "global",  "importance": 5, "source": "explicit"}
  ],
  "tasks": []
}

Example 2:
User: "Estou compartilhando informações pessoais com você agora."
Output:
{"memories": [], "tasks": []}

Example 3:
User: "Vamos usar o Supabase como banco de dados do projeto. Não quero embeddings por enquanto."
Output:
{
  "memories": [
    {"type": "project_decision",   "value": "O projeto usa Supabase como banco de dados", "granularity": "other", "confidence": 1.0, "needs_disambiguation": false, "scope": "project", "importance": 8, "source": "explicit"},
    {"type": "project_constraint", "value": "O projeto não usa embeddings por enquanto",  "granularity": "other", "confidence": 0.9, "needs_disambiguation": false, "scope": "project", "importance": 7, "source": "explicit"}
  ],
  "tasks": []
}

Example 4:
User: "Preciso implementar autenticação e depois cuidar da parte de memória."
Output:
{
  "memories": [],
  "tasks": [
    {"title": "Implementar autenticação",       "description": null, "status": "open", "importance": 7},
    {"title": "Implementar sistema de memória", "description": null, "status": "open", "importance": 6}
  ]
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MEMORY SCHEMA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Each memory object:
{
  "type": one of the types listed above,
  "value": "fact in third person, in Portuguese (pt-BR)",
  "granularity": "full_name"|"first_name"|"country"|"state"|"city"|"profession"|"hobby"|"personal"|"other",
  "confidence": number 0.5–1.0,
  "needs_disambiguation": boolean,
  "scope": "global" for personal facts | "project" for project facts,
  "importance": integer 1–10,
  "source": "explicit"|"inference"|"pattern",
  "supersedes": "exact old value this replaces (only when user explicitly corrects a fact)"
}

FINAL RULES:
- Return ONLY valid JSON. No markdown, no explanation, no code fences.
- If nothing to extract: {"memories": [], "tasks": []}
- NEVER extract absence of information.
- "supersedes" only when the user explicitly updates or corrects a previous fact.

Conversation to analyze:
User: ${userMessage}
Assistant: ${assistantReply}

JSON:`
}