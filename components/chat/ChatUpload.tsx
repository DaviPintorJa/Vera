'use client';
import { useState } from 'react';
import FileUpload from '@/components/FileUpload';
import { useChat } from '@/app/chat/page'; // Importa o hook useChat do ChatContext

export default function ChatUpload() {
  const [uploading, setUploading] = useState(false);
  const { chatId } = useChat(); // Obtém o chatId do contexto

  const handleFileAction = async (file: File) => {
    if (uploading) return;
    if (!chatId) {
      alert('Nenhum chat ativo para processar o documento.');
      return;
    }

    setUploading(true);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('chatId', chatId); // Envia o chatId para a rota Next.js

    // Envia o arquivo para a rota Next.js, que por sua vez envia para o Hugging Face
    try {
      const response = await fetch('/api/process-document', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();
      
      if (response.ok && data.success) {
        // Feedback visual de que o "agente" recebeu o trabalho
        console.log('Análise iniciada via Vera Brain.');
      } else {
        alert(`Erro VERA: ${data.error}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      console.error('Erro detalhado no upload:', error);
      alert(`Erro de conexão com a VERA: ${errorMessage}`);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <FileUpload onFileSelect={handleFileAction} isLoading={uploading} />
      
      {uploading ? (
        <div className="flex items-center gap-1.5 ml-1">
          <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-ping" />
          <span className="text-[10px] uppercase tracking-tighter text-indigo-400 font-bold">
            Reading...
          </span>
        </div>
      ) : null}
    </div>
  );
}