import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') || '';

    // --- CENÁRIO A: RECEBENDO UPLOAD DO FRONTEND ---
    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const file = formData.get('file') as File;
      const chatId = formData.get('chatId') as string;

      if (!file || !chatId) {
        return NextResponse.json({ success: false, error: 'Arquivo ou ChatID ausentes' }, { status: 400 });
      }

      // URL do backend Python no Hugging Face ou local. 
      // Removi o fallback silencioso para localhost para evitar confusão se o .env falhar.
      const VERA_BRAIN_URL = process.env.VERA_BRAIN_URL;
      
      if (!VERA_BRAIN_URL) {
        console.error('[VERA_BRAIN] Erro: VERA_BRAIN_URL não definida nas variáveis de ambiente.');
        return NextResponse.json({ success: false, error: 'Configuração de URL do VERA Brain ausente.' }, { status: 500 });
      }

      // A URL que o Python deve chamar de volta
      const CALLBACK_URL = `${process.env.NEXT_PUBLIC_APP_URL || 'https://' + process.env.VERCEL_URL}/api/process-document`;

      const backendFormData = new FormData();
      backendFormData.append('file', file);
      backendFormData.append('chat_id', chatId);
      backendFormData.append('callback_url', CALLBACK_URL);

      console.log(`[VERA_BRAIN] Triggering HF: ${VERA_BRAIN_URL} | Callback: ${CALLBACK_URL}`);

      // Dispara o processamento no Vera Brain (FastAPI)
      // Agora aguardamos o fetch inicial para capturar erros de rede imediatos (como ECONNREFUSED)
      const triggerResponse = await fetch(VERA_BRAIN_URL, {
        method: 'POST',
        headers: { 'x-api-key': process.env.SUMMARIZER_API_KEY || '' },
        body: backendFormData,
      });

      if (!triggerResponse.ok) {
        const errorDetail = await triggerResponse.text().catch(() => 'Sem detalhes');
        console.error(`[VERA_BRAIN_TRIGGER_ERROR] Status: ${triggerResponse.status}. Resposta: ${errorDetail}`);
        return NextResponse.json({ success: false, error: `VERA Brain indisponível (${triggerResponse.status})` }, { status: 502 });
      }

      return NextResponse.json({ 
        success: true, 
        message: 'Documento enviado para análise atômica.' 
      });
    }

    // --- CENÁRIO B: RECEBENDO CALLBACK DO VERA BRAIN (PYTHON) ---
    const payload = await req.json();
    const { chat_id, summary_data, metadata, success, error } = payload;

    if (!success || !chat_id) {
      console.error('[CALLBACK_ERROR] Callback do Hugging Face falhou ou está incompleto:', error || 'Dados ausentes');
      return NextResponse.json({ ok: false, error: error || 'Dados ausentes no callback' });
    }

    // Formatação baseada nos "Átomos" de conhecimento do AtomicOrchestrator
    const summaryText = `Analisei o documento **${metadata?.filename || 'desconhecido'}** em nível atômico. Aqui estão as descobertas:\n\n` + 
      (summary_data?.ideas || summary_data?.atoms || []).map((c: any) => 
        `• **${c.title || c.concept}**: ${c.description || c.sentence}\n  > *Evidência: "${c.evidence || 'N/A'}"*`
      ).join('\n\n');

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    await supabase.from('messages').insert({
      chat_id: chat_id,
      role: 'assistant',
      content: summaryText
    });

    console.log(`[CALLBACK_SUCCESS] Chat ${chat_id} atualizado com os resultados da VERA.`);
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('[CALLBACK_ERROR]:', error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}