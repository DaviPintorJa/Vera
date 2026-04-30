import re
import logging

logger = logging.getLogger(__name__)

class TextSummarizer:
    """Motor de extração de conceitos para a VERA AI"""
    
    def process(self, text: str):
        logger.info(f"SUMMARIZER: Iniciando processamento de texto (tamanho: {len(text)}).")
        # Limpeza básica
        text = text.replace('\n', ' ').strip()
        
        # Identifica sentenças importantes (ex: que começam com letra maiúscula e terminam em ponto)
        sentences = re.split(r'(?<=[.!?]) +', text)
        
        # Extração de "Idéias" (Conceitos)
        # Aqui usamos uma lógica de ranking simples baseada em palavras-chave ou posição.
        # Para este MVP, pegamos as 5 primeiras sentenças que tenham mais de 20 caracteres.
        concepts = []
        
        logger.info(f"SUMMARIZER: Total de sentenças identificadas: {len(sentences)}")

        for i, sentence in enumerate(sentences[:5]):
            if len(sentence) > 20:
                concepts.append({
                    "title": f"Conceito {i+1}",
                    "sentence": sentence.strip(),
                    "relevance": round(1.0 - (i * 0.1), 2)
                })
            else:
                logger.debug(f"SUMMARIZER: Sentença ignorada por ser muito curta (<=20 chars): '{sentence.strip()}'")

        
        # Detecta idioma
        language = "pt" if " o " in text or " a " in text else "en"
        
        return {
            "ideas": concepts,
            "detected_language": language,
            "stats": {
                "char_count": len(text),
                "sentence_count": len(sentences)
            }
        }
        logger.info(f"SUMMARIZER: Processamento concluído. Conceitos extraídos: {len(concepts)}")
        return { "ideas": concepts, "detected_language": language, "stats": { "char_count": len(text), "sentence_count": len(sentences) } }