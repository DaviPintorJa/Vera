from fastapi import FastAPI, UploadFile, File
import uvicorn
from pypdf import PdfReader
import io
from summarizer import TextSummarizer

app = FastAPI()
summarizer = TextSummarizer()

@app.post("/process")
async def process_document(file: UploadFile = File(...)):
    content_type = file.content_type
    filename = file.filename
    
    contents = await file.read()
    text = ""

    try:
        if filename.lower().endswith('.pdf'):
            # Extração de texto do PDF
            reader = PdfReader(io.BytesIO(contents))
            for page in reader.pages:
                extracted = page.extract_text()
                if extracted:
                    text += extracted + "\n"
        else:
            # Texto simples
            text = contents.decode('utf-8', errors='ignore')

        if not text.strip():
            return {"success": False, "error": "Não foi possível extrair texto do arquivo."}

        # Processamento NLP
        summary_data = summarizer.process(text)

        return {
            "success": True,
            "message": f"Arquivo '{filename}' processado com sucesso!",
            "metadata": {
                "filename": filename,
                "type": content_type,
                "size_bytes": len(contents)
            },
            "data": summary_data
        }
    except Exception as e:
        return {"success": False, "error": str(e)}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)