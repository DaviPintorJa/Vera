from fastapi import FastAPI, UploadFile, File, Request
from fastapi.responses import JSONResponse
from pypdf import PdfReader
from pypdf.errors import PdfReadError
import io
import time
import logging
from summarizer import TextSummarizer

# Configuração de logs para depuração no Hugging Face
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Vera NLP Extrator")
summarizer_engine = TextSummarizer()

# Tratamento de exceções global conforme solicitado
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Erro inesperado: {str(exc)}")
    return JSONResponse(
        status_code=200, # Retorna 200 para evitar que a Vera receba um erro 500 genérico
        content={
            "success": False,
            "error": f"Falha no processamento (HuggingFace): {str(exc)}"
        }
    )

@app.post("/summarize-file")
async def summarize_file(file: UploadFile = File(...)) -> dict:
    start_time = time.time()
    
    try:
        # 1. Captura de metadados
        filename = file.filename
        content = await file.read()
        filesize = len(content)
        
        # 2. Extração de Texto baseada na extensão
        text = ""
        if filename.lower().endswith('.pdf'):
            logger.info(f"Iniciando processamento do PDF: {filename} (tamanho: {filesize} bytes)")
            try:
                reader = PdfReader(io.BytesIO(content))
                for page in reader.pages:
                    extracted = page.extract_text()
                    if extracted:
                        text += extracted + "\n"
                logger.info(f"Extração de texto do PDF concluída para {filename}.")
            except PdfReadError as pdf_err: # Captura erros específicos de leitura de PDF
                return JSONResponse(
                    status_code=200,
                    content={"success": False, "error": f"Arquivo PDF corrompido ou inválido: {str(pdf_err)}"}
                )
        else:
            # Assume texto simples (TXT)
            text = content.decode('utf-8', errors='ignore')

        if not text.strip():
            logger.warning(f"Arquivo {filename} não contém texto extraível após processamento.")
            return JSONResponse(
                status_code=200,
                content={"success": False, "error": "O arquivo não contém texto extraível."}
            )

        # 3. Processamento pela biblioteca summarizer.py
        # (A lógica de garantir float no relevance já deve estar no summarizer.py)
        logger.info(f"Iniciando sumarização do texto do arquivo {filename}...")
        summary_data = summarizer_engine.process(text)
        
        end_time = time.time()
        
        # 4. Resposta estruturada para a VERA
        return {
            "success": True,
            "metadata": {
                "filename": filename,
                "size_bytes": filesize,
                "processing_time_total_ms": round((end_time - start_time) * 1000, 2)
            },
            "summary_data": summary_data
        }

    except Exception as e:
        # O handler global já captura e formata, mas um log mais detalhado aqui ajuda a depurar
        logger.error(f"Erro inesperado no summarize_file para {file.filename}: {str(e)}", exc_info=True)
        raise e # Deixa o handler global capturar