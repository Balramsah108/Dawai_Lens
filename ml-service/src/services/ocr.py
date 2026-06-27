import os
import json
import base64
from pathlib import Path
from google import genai
from google.genai import types
from src.models.schemas import DrugEntry, ExtractionResult
from datetime import datetime, timezone
from uuid import UUID


def _build_prompt() -> str:
    return """
You are a medical prescription reader. Extract all medicines from this prescription image.

Return ONLY a valid JSON object with this exact structure:
{
  "drug_entries": [
    {
      "drug_name": "medicine name here",
      "strength": "e.g. 500mg or null",
      "dosage_form": "e.g. tablet/syrup/injection or null",
      "frequency": "e.g. twice daily or null",
      "duration": "e.g. 5 days or null"
    }
  ],
  "confidence": 0.95
}

Rules:
- drug_name is required, all other fields are optional (use null if not found)
- confidence is a number between 0.0 and 1.0
- If you cannot read the prescription clearly, set confidence below 0.7
- Return an empty drug_entries array only if no medicines are visible at all
- Do not include any text outside the JSON
"""


def extract_from_image(image_path: str, prescription_id: UUID) -> ExtractionResult:
    """Extract drug entries from a prescription image using Gemini Vision."""

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY not set in environment")

    client = genai.Client(api_key=api_key)

    # Load image and encode as base64
    image_bytes = Path(image_path).read_bytes()
    image_b64 = base64.b64encode(image_bytes).decode("utf-8")

    # Detect mime type from extension
    ext = Path(image_path).suffix.lower()
    mime_map = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
        ".heic": "image/heic",
    }
    mime_type = mime_map.get(ext, "image/jpeg")

    # Call Gemini with new SDK
    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=[
            types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
            _build_prompt(),
        ],
    )

    # Parse response
    raw = response.text.strip()

    # Strip markdown code blocks if present
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]

    data = json.loads(raw)
    confidence = float(data.get("confidence", 0.9))

    drug_entries = [
        DrugEntry(**entry) for entry in data.get("drug_entries", [])
    ]

    return ExtractionResult(
        prescription_id=prescription_id,
        drug_entries=drug_entries,
        confidence=confidence,
        ocr_engine="gemini",
        created_at=datetime.now(timezone.utc),
    )
