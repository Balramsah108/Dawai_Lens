from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from dotenv import load_dotenv
from src.routes.ocr import router as ocr_router
from src.routes.normalize import router as normalize_router

load_dotenv()

app = FastAPI(
    title="Dawai Lens ML Service",
    description="OCR pipeline and drug normalization",
    version="0.1.0"
)

# Custom validation error handler — fixes FastAPI bytes serialization bug
@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    errors = []
    for error in exc.errors():
        errors.append({
            "loc": [str(l) for l in error.get("loc", [])],
            "msg": error.get("msg", ""),
            "type": error.get("type", ""),
        })
    return JSONResponse(
        status_code=422,
        content={"detail": errors},
    )

app.include_router(ocr_router, prefix="/api/v1")
app.include_router(normalize_router, prefix="/api/v1")

@app.get("/health")
def health():
    return {"status": "ok", "service": "ml-service"}
