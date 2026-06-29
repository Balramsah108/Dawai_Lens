from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from src.services.normalizer import normalize_drug
import os

router = APIRouter(prefix="/normalize", tags=["Normalizer"])


class NormalizeRequest(BaseModel):
    drug_name: str


class BatchNormalizeRequest(BaseModel):
    drug_names: list[str]


@router.post("/drug")
async def normalize_single(request: NormalizeRequest) -> dict:
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        raise HTTPException(status_code=500, detail="DATABASE_URL not configured")
    try:
        result = await normalize_drug(request.drug_name, db_url)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Normalization failed: {str(e)}")


@router.post("/batch")
async def normalize_batch(request: BatchNormalizeRequest) -> list:
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        raise HTTPException(status_code=500, detail="DATABASE_URL not configured")
    try:
        results = []
        for drug_name in request.drug_names:
            result = await normalize_drug(drug_name, db_url)
            results.append(result)
        return results
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Batch normalization failed: {str(e)}")
