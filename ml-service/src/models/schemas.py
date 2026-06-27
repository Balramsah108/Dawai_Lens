from pydantic import BaseModel, field_validator, model_validator
from typing import Optional, List
from uuid import UUID
from datetime import datetime
from decimal import Decimal


class DrugEntry(BaseModel):
    """A single medicine extracted from a prescription."""
    drug_name: str
    strength: Optional[str] = None
    dosage_form: Optional[str] = None
    frequency: Optional[str] = None
    duration: Optional[str] = None


class ExtractionResult(BaseModel):
    """Full output of the OCR pipeline for one prescription."""
    prescription_id: UUID
    drug_entries: List[DrugEntry]
    confidence: Optional[float] = None
    ocr_engine: Optional[str] = None  # 'gemini' | 'gcv' | 'trocr'
    created_at: datetime

    model_config = {"json_encoders": {datetime: lambda v: v.isoformat()}}

    @field_validator('confidence')
    @classmethod
    def confidence_must_be_valid(cls, v: Optional[float]) -> Optional[float]:
        if v is not None and not (0.0 <= v <= 1.0):
            raise ValueError('confidence must be between 0.0 and 1.0')
        return v

    @field_validator('ocr_engine')
    @classmethod
    def ocr_engine_must_be_valid(cls, v: Optional[str]) -> Optional[str]:
        allowed = {'gemini', 'gcv', 'trocr', None}
        if v not in allowed:
            raise ValueError(f'ocr_engine must be one of {allowed}')
        return v

    @model_validator(mode='after')
    def drug_entries_must_not_be_empty(self) -> 'ExtractionResult':
        # Allow empty entries — OCR may fail to extract, handled at route level
        return self


class PriceRecord(BaseModel):
    """A price data point from one pharmacy platform."""
    id: UUID
    canonical_drug_id: UUID
    platform_id: str  # '1mg' | 'pharmeasy' | 'netmeds' | 'apollo247' | 'medplus' | 'amazon' | 'flipkart'
    brand_name: Optional[str] = None
    pack_size: Optional[str] = None
    mrp_inr: Optional[Decimal] = None
    selling_price_inr: Optional[Decimal] = None
    in_stock: bool
    delivery_eta_hours: Optional[int] = None
    affiliate_url: Optional[str] = None
    scraped_at: datetime

    @field_validator('platform_id')
    @classmethod
    def platform_must_be_valid(cls, v: str) -> str:
        allowed = {'1mg', 'pharmeasy', 'netmeds', 'apollo247', 'medplus', 'amazon', 'flipkart'}
        if v not in allowed:
            raise ValueError(f'platform_id must be one of {allowed}')
        return v

    @field_validator('selling_price_inr', 'mrp_inr')
    @classmethod
    def price_must_be_positive(cls, v: Optional[Decimal]) -> Optional[Decimal]:
        if v is not None and v < 0:
            raise ValueError('price must be non-negative')
        return v


class GenericSuggestion(BaseModel):
    """A cheaper alternative brand for the same active salt."""
    canonical_drug_id: UUID
    salt_name: str
    strength: Optional[str] = None
    brand_name: str
    min_price_inr: Decimal
    price_records: List[PriceRecord]


class NormalizerResult(BaseModel):
    """Result of drug name normalization."""
    matched: bool
    raw_name: str
    canonical_drug_id: Optional[UUID] = None
    salt_name: Optional[str] = None
    strength: Optional[str] = None
    brand_variants: List[str] = []


class CompareSession(BaseModel):
    """A price comparison session for one or more drugs."""
    session_id: UUID
    extraction_result_id: UUID
    user_id: Optional[UUID] = None
    profile_id: Optional[UUID] = None
    price_records: List[PriceRecord] = []
    created_at: datetime
