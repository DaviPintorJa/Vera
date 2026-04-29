/**
 * Cliente para comunicação com o microsserviço de NLP no Hugging Face
 */

interface Idea {
  title: string;
  sentence: string;
  keywords: string[];
  relevance: number;
}

interface Metadata {
  filename: string;
  size_bytes: number;
  processing_time_total_ms: number;
}

interface SummarizerResponse {
  success: boolean;
  metadata?: Metadata;
  summary_data?: {
    ideas: Idea[];
    detected_language: string;
  };
  error?: string;
}

export class HuggingFaceNLPClient {
  private baseUrl: string;

  constructor() {
    this.baseUrl = process.env.HUGGINGFACE_SPACE_URL || '';
  }

  async summarizeFile(file: File): Promise<SummarizerResponse | null> {
    if (!this.baseUrl) {
      console.error("[NLP Client] URL do Hugging Face não configurada.");
      return null;
    }

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(`${this.baseUrl}/summarize-file`, {
        method: 'POST',
        // O Content-Type multipart/form-data é definido automaticamente pelo browser/Node com FormData
        headers: {
          // 'Authorization': `Bearer ${process.env.HF_API_TOKEN}`
        },
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Erro no Summarizer: ${response.statusText}`);
      }

      const data = await response.json() as SummarizerResponse;
      
      if (!data.success) {
        console.error("[NLP Client] O extrator reportou erro:", data.error);
        return data; // Retorna o objeto com success: false para a Vera tratar
      }

      return data;
    } catch (error) {
      console.error("[NLP Client] Falha na conexão com Hugging Face:", error);
      return null;
    }
  }
}

export const nlpClient = new HuggingFaceNLPClient();