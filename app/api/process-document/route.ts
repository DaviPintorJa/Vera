import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/llm/supabase/server';

type VeraBrainIdea = {
  title?: string;
  concept?: string;
  description?: string;
  sentence?: string;
  evidence?: string;
};

type VeraBrainPayload = {
  chat_id?: string;
  ingestion_job_id?: string;
  summary_data?: {
    ideas?: VeraBrainIdea[];
    atoms?: VeraBrainIdea[];
    total_sentences?: number;
  };
  metadata?: {
    filename?: string;
    file_size_bytes?: number;
    language?: string;
    processing_time_ms?: number;
    mode?: string;
  };
  success?: boolean;
  error?: string;
};

type IngestionJob = {
  id: string;
  chat_id: string;
  filename: string;
  user_id: string | null;
  profile_id: string | null;
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

// Supabase client para operações de serviço (com chave de role)
export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') || '';

    // --- CENÁRIO A: RECEBENDO UPLOAD DO FRONTEND ---
    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const file = formData.get('file') as File;
      const chatId = formData.get('chatId') as string;
      const requestedProfileId = formData.get('profileId') as string | null;

      console.log('[DEBUG] CENÁRIO A: Recebendo upload do frontend.');
      const supabase = await createClient();
      const service = createServiceClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        return NextResponse.json({ success: false, error: 'Não autorizado' }, { status: 401 });
      }

      if (!file || !chatId) {
        return NextResponse.json({ success: false, error: 'Arquivo ou ChatID ausentes' }, { status: 400 });
      }
      console.log(`[DEBUG] Arquivo: ${file.name}, ChatID: ${chatId}`);

      const { data: chat, error: chatError } = await service
        .from('chats')
        .select('id, user_id, profile_id')
        .eq('id', chatId)
        .eq('user_id', user.id)
        .single();

      if (chatError || !chat) {
        console.error('[SUPABASE_ERROR] Chat não encontrado ou não pertence ao usuário:', chatError?.message);
        return NextResponse.json({ success: false, error: 'Chat não encontrado' }, { status: 404 });
      }

      const profileId = requestedProfileId?.trim() || chat.profile_id;
      if (!profileId || chat.profile_id !== profileId) {
        return NextResponse.json({ success: false, error: 'Perfil inválido para este chat' }, { status: 400 });
      }

      // URL do backend Python no Hugging Face ou local. 
      // Removi o fallback silencioso para localhost para evitar confusão se o .env falhar.
      const VERA_BRAIN_URL = process.env.VERA_BRAIN_URL;
      
      if (!VERA_BRAIN_URL) {
        console.error('[VERA_BRAIN_CONFIG_ERROR] VERA_BRAIN_URL não definida nas variáveis de ambiente.');
        return NextResponse.json({ success: false, error: 'Configuração de URL do VERA Brain ausente.' }, { status: 500 });
      }
      console.log(`[DEBUG] VERA_BRAIN_URL: ${VERA_BRAIN_URL}`);
      const SUMMARIZER_API_KEY_PRESENT = !!process.env.SUMMARIZER_API_KEY;
      console.log(`[DEBUG] SUMMARIZER_API_KEY presente: ${SUMMARIZER_API_KEY_PRESENT}`);

      // 1. Criar um registro em 'ingestion_jobs' com status 'pending'
      const { data: jobData, error: jobError } = await service
        .from('ingestion_jobs')
        .insert({ chat_id: chatId, user_id: user.id, profile_id: profileId, filename: file.name, status: 'pending' })
        .select('id')
        .single();

      if (jobError || !jobData) {
        console.error('[SUPABASE_ERROR] Erro ao criar job de ingestão:', jobError);
        return NextResponse.json({ success: false, error: 'Erro ao iniciar o processamento do documento.' }, { status: 500 });
      }
      console.log(`[DEBUG] Ingestion Job criado com ID: ${jobData.id}`);

      const ingestionJobId = jobData.id;

      // A URL que o Python deve chamar de volta
      const CALLBACK_URL = `${process.env.NEXT_PUBLIC_APP_URL || 'https://' + process.env.VERCEL_URL}/api/process-document`;
      console.log(`[DEBUG] CALLBACK_URL: ${CALLBACK_URL}`);

      const backendFormData = new FormData();
      backendFormData.append('file', file);
      backendFormData.append('chat_id', chatId);
      backendFormData.append('callback_url', CALLBACK_URL);
      backendFormData.append('ingestion_job_id', ingestionJobId); // Envia o ID do job para o HF

      console.log(`[DEBUG] Enviando requisição para Hugging Face: ${VERA_BRAIN_URL}`);

      let triggerResponse;
      try {
        triggerResponse = await fetch(VERA_BRAIN_URL, {
          method: 'POST',
          headers: { 'x-api-key': process.env.SUMMARIZER_API_KEY || '' },
          body: backendFormData,
        });
      } catch (networkError: unknown) {
        const errorMessage = getErrorMessage(networkError);
        console.error(`[VERA_BRAIN_NETWORK_ERROR] Erro de rede ao conectar com Hugging Face: ${errorMessage}`);
        await service.from('ingestion_jobs').update({ status: 'failed', error_message: `Network error: ${errorMessage}`, completed_at: new Date().toISOString() }).eq('id', ingestionJobId);
        return NextResponse.json({ success: false, error: `Erro de rede ao conectar com o VERA Brain: ${errorMessage}` }, { status: 503 }); // 503 Service Unavailable
      }

      // Dispara o processamento no Vera Brain (FastAPI)
      // Agora aguardamos o fetch inicial para capturar erros de rede imediatos (como ECONNREFUSED)
      console.log(`[DEBUG] Resposta inicial do Hugging Face recebida. Status: ${triggerResponse.status}`);

      if (!triggerResponse.ok) {
        const errorDetail = await triggerResponse.text().catch(() => 'Sem detalhes');
        console.error(`[VERA_BRAIN_TRIGGER_ERROR] Status: ${triggerResponse.status}. Resposta: ${errorDetail}`);
        // Atualizar status do job para 'failed' se o trigger falhar (agora temos o supabase client)
        await service.from('ingestion_jobs').update({ status: 'failed', error_message: `Trigger failed: ${errorDetail}`, completed_at: new Date().toISOString() }).eq('id', ingestionJobId);
        return NextResponse.json({ success: false, error: `VERA Brain indisponível (${triggerResponse.status})` }, { status: 502 });
      }

      console.log(`[VERA_BRAIN_TRIGGER_SUCCESS] Arquivo enviado com sucesso para Hugging Face para job ${ingestionJobId}.`);
      return NextResponse.json({ 
        success: true, 
        message: 'Documento enviado para análise atômica.',
        ingestion_job_id: ingestionJobId // Retorna o ID do job para o frontend
      });
    }

    // --- CENÁRIO B: RECEBENDO CALLBACK DO VERA BRAIN (PYTHON) ---
    const payload = await req.json() as VeraBrainPayload;
    console.log('[DEBUG] CENÁRIO B: Recebendo callback do Vera Brain.');
    console.log('[DEBUG] Payload do Vera Brain:', JSON.stringify(payload, null, 2)); // Loga o payload completo e formatado
    const { chat_id, ingestion_job_id, summary_data, metadata, success, error } = payload; // Recebe ingestion_job_id

    const supabase = createServiceClient();

    if (!success || !chat_id || !ingestion_job_id) {
      console.error('[CALLBACK_ERROR] Callback do Hugging Face falhou ou está incompleto:', error || 'Dados ausentes (chat_id, ingestion_job_id ou success).');
      // Atualizar status do job para 'failed' se o callback for inválido
      if (ingestion_job_id) {
        await supabase.from('ingestion_jobs').update({ status: 'failed', error_message: error || 'Dados ausentes no callback', completed_at: new Date().toISOString() }).eq('id', ingestion_job_id);
      }
      return NextResponse.json({ ok: false, error: error || 'Dados ausentes no callback' });
    }

    const { data: job, error: jobFetchError } = await supabase
      .from('ingestion_jobs')
      .select('id, chat_id, filename, user_id, profile_id')
      .eq('id', ingestion_job_id)
      .single<IngestionJob>();

    if (jobFetchError || !job) {
      console.error('[CALLBACK_ERROR] Job de ingestão não encontrado:', jobFetchError?.message);
      return NextResponse.json({ ok: false, error: 'Job de ingestão não encontrado' }, { status: 404 });
    }

    if (job.chat_id !== chat_id) {
      console.error('[CALLBACK_ERROR] chat_id do callback não corresponde ao job.');
      await supabase.from('ingestion_jobs').update({ status: 'failed', error_message: 'Callback chat_id mismatch', completed_at: new Date().toISOString() }).eq('id', ingestion_job_id);
      return NextResponse.json({ ok: false, error: 'Callback inválido para este job' }, { status: 400 });
    }

    const ownerUserId = job.user_id;
    const ownerProfileId = job.profile_id;
    if (!ownerUserId) {
      console.error('[CALLBACK_ERROR] Job sem user_id; não é possível vincular ao perfil do usuário.');
      await supabase.from('ingestion_jobs').update({ status: 'failed', error_message: 'Job sem user_id', completed_at: new Date().toISOString() }).eq('id', ingestion_job_id);
      return NextResponse.json({ ok: false, error: 'Job sem usuário vinculado' }, { status: 400 });
    }
    if (!ownerProfileId) {
      console.error('[CALLBACK_ERROR] Job sem profile_id; não é possível vincular ao perfil correto.');
      await supabase.from('ingestion_jobs').update({ status: 'failed', error_message: 'Job sem profile_id', completed_at: new Date().toISOString() }).eq('id', ingestion_job_id);
      return NextResponse.json({ ok: false, error: 'Job sem perfil vinculado' }, { status: 400 });
    }

    console.log(`[DEBUG] Callback válido para ChatID: ${chat_id}, JobID: ${ingestion_job_id}`);

    // Formatação baseada nos "Átomos" de conhecimento do AtomicOrchestrator
    const ideas = summary_data?.ideas || summary_data?.atoms || [];
    const summaryText = `Analisei o documento **${metadata?.filename || 'desconhecido'}** em nível atômico. Aqui estão as descobertas:\n\n` + 
      ideas.map((c) => 
        `• **${c.title || c.concept}**: ${c.description || c.sentence}\n  > *Evidência: "${c.evidence || 'N/A'}"*`
      ).join('\n\n');
    
    console.log('[DEBUG] Formatando summaryText e preparando ideias para inserção.');
    // 2. Inserir cada "ideia atômica" na tabela 'extracted_ideas'
    const ideasToInsert = ideas.map((c) => ({
      chat_id: chat_id,
      user_id: ownerUserId,
      profile_id: ownerProfileId,
      ingestion_job_id: ingestion_job_id,
      concept: c.title || c.concept,
      description: c.description || c.sentence,
      evidence: c.evidence || null,
    }));

    if (ideasToInsert.length > 0) {
      const { error: ideasError } = await supabase.from('extracted_ideas').insert(ideasToInsert);
      if (ideasError) {
        console.error('[SUPABASE_ERROR] Erro ao inserir ideias atômicas:', ideasError);
        // Opcional: Atualizar status do job para 'failed' se a inserção de ideias falhar
        await supabase.from('ingestion_jobs').update({ status: 'failed', error_message: `Erro ao salvar ideias: ${ideasError.message}`, completed_at: new Date().toISOString() }).eq('id', ingestion_job_id);
        return NextResponse.json({ ok: false, error: 'Erro ao salvar ideias extraídas.' }, { status: 500 });
      }
      console.log(`[DEBUG] ${ideasToInsert.length} ideias inseridas em 'extracted_ideas'.`);
    }

    await supabase.from('summarized_documents').insert({
      profile_id: ownerProfileId,
      filename: metadata?.filename || job.filename,
      file_size_bytes: typeof metadata?.file_size_bytes === 'number' ? metadata.file_size_bytes : null,
      language: typeof metadata?.language === 'string' ? metadata.language : null,
      total_sentences: typeof summary_data?.total_sentences === 'number' ? summary_data.total_sentences : null,
      total_ideas: ideas.length,
      processing_time_ms: typeof metadata?.processing_time_ms === 'number' ? metadata.processing_time_ms : null,
      mode: typeof metadata?.mode === 'string' ? metadata.mode : 'atomic',
    });

    if (ideas.length > 0) {
      const digestsToInsert = ideas.map((c) => ({
        user_id: ownerUserId,
        profile_id: ownerProfileId,
        sources: [`chat:${chat_id}`, `ingestion_job:${ingestion_job_id}`, `document:${metadata?.filename || job.filename}`],
        domain: 'document',
        concept: c.title || c.concept || 'Ideia extraída',
        application_hint: c.description || c.sentence || c.evidence || 'Ideia extraída do documento enviado pelo usuário.',
      }));

      const { error: digestError } = await supabase.from('knowledge_digests').insert(digestsToInsert);
      if (digestError) {
        console.error('[SUPABASE_ERROR] Erro ao inserir knowledge_digests:', digestError);
      }
    }

    // 3. Atualizar o status do job de ingestão para 'completed'
    await supabase.from('ingestion_jobs').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', ingestion_job_id);
    console.log(`[DEBUG] Ingestion Job ${ingestion_job_id} atualizado para 'completed'.`);

    // 4. Inserir a mensagem formatada no chat (como já estava fazendo)
    await supabase.from('messages').insert({
      chat_id: chat_id,
      user_id: ownerUserId,
      profile_id: ownerProfileId,
      role: 'assistant',
      content: summaryText
    });
    console.log('[DEBUG] Mensagem do assistente inserida no chat.');

    console.log(`[CALLBACK_SUCCESS] Chat ${chat_id} atualizado com os resultados da VERA.`);
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const errorMessage = getErrorMessage(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error('[GLOBAL_ERROR]: Erro inesperado na API Route:', errorMessage, errorStack);
    // Tenta retornar um erro genérico, mas o problema pode ser antes mesmo disso
    return NextResponse.json({ success: false, error: 'Erro interno do servidor ao processar o documento.' }, { status: 500 });
  }
}
