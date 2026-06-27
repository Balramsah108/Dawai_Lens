from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from uuid import UUID
from src.services.ocr import extract_from_image
from src.models.schemas import ExtractionResult

router = APIRouter(prefix="/ocr", tags=["OCR"])


class ExtractRequest(BaseModel):
    image_path: str       # local file path for now (R2 path later)
    prescription_id: UUID


@router.post("/extract", response_model=ExtractionResult)
def extract(request: ExtractRequest) -> ExtractionResult:
    try:
        result = extract_from_image(
            image_path=request.image_path,
            prescription_id=request.prescription_id,
        )

        # If Gemini returned no drug entries, tell the client clearly
        if len(result.drug_entries) == 0:
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "OCR_NO_EXTRACTION",
                    "message": "We could not read your prescription. Please try a clearer image or enter medicines manually."
                }
            )

        return result

    except HTTPException:
        raise  # re-raise HTTP exceptions as-is
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Image file not found")
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"OCR failed: {str(e)}")
