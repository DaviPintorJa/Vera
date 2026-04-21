// lib/llm/memory/index.ts
// Interface pública do módulo de memória.
// Qualquer arquivo fora desta pasta deve importar APENAS daqui.

export { runExtractionPipeline as extractAndSaveMemories } from './extractor'