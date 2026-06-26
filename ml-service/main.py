from fastapi import FastAPI
from dotenv import load_dotenv
from src.models.schemas import DrugEntry, ExtractionResult, PriceRecord

load_dotenv()

app = FastAPI(
    title="Dawai Lens ML Service",
    description="OCR pipeline and drug normalization",
    version="0.1.0"
)

@app.get("/health")
def health():
    return {"status": "ok", "service": "ml-service"}
