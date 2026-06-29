import os
import asyncpg
from typing import Optional


OCR_SUBSTITUTIONS = {
    '0': 'O', '1': 'l', 'l': 'I', '5': 'S', '8': 'B'
}


def apply_ocr_substitutions(text: str) -> str:
    """Apply common OCR character substitutions."""
    result = text
    for wrong, correct in OCR_SUBSTITUTIONS.items():
        result = result.replace(wrong, correct)
    return result


async def normalize_drug(drug_name: str, db_url: str) -> dict:
    """
    Normalize a drug name to its canonical form using 3-stage matching:
    1. Exact case-insensitive match
    2. OCR substitution + exact match
    3. Fuzzy trigram match (edit distance <= 2)
    """
    conn = await asyncpg.connect(db_url)
    try:
        # Stage 1: Exact case-insensitive match
        row = await conn.fetchrow(
            """
            SELECT cd.id, cd.salt_name, cd.strength, cd.dosage_form, cd.schedule,
                   array_agg(db.brand_name) as brand_variants
            FROM drug_brands db
            JOIN canonical_drugs cd ON cd.id = db.canonical_drug_id
            WHERE db.brand_name ILIKE $1
            GROUP BY cd.id, cd.salt_name, cd.strength, cd.dosage_form, cd.schedule
            LIMIT 1
            """,
            drug_name
        )

        if row:
            return _build_match_result(row, drug_name, 'exact')

        # Stage 2: OCR substitution + exact match
        substituted = apply_ocr_substitutions(drug_name)
        if substituted != drug_name:
            row = await conn.fetchrow(
                """
                SELECT cd.id, cd.salt_name, cd.strength, cd.dosage_form, cd.schedule,
                       array_agg(db.brand_name) as brand_variants
                FROM drug_brands db
                JOIN canonical_drugs cd ON cd.id = db.canonical_drug_id
                WHERE db.brand_name ILIKE $1
                GROUP BY cd.id, cd.salt_name, cd.strength, cd.dosage_form, cd.schedule
                LIMIT 1
                """,
                substituted
            )
            if row:
                return _build_match_result(row, drug_name, 'ocr_substitution')

        # Stage 3: Fuzzy trigram match
        row = await conn.fetchrow(
            """
            SELECT cd.id, cd.salt_name, cd.strength, cd.dosage_form, cd.schedule,
                   array_agg(db.brand_name) as brand_variants,
                   similarity(db.brand_name, $1) as sim
            FROM drug_brands db
            JOIN canonical_drugs cd ON cd.id = db.canonical_drug_id
            WHERE similarity(db.brand_name, $1) > 0.3
            GROUP BY cd.id, cd.salt_name, cd.strength, cd.dosage_form, cd.schedule, sim
            ORDER BY sim DESC
            LIMIT 1
            """,
            drug_name
        )

        if row:
            return _build_match_result(row, drug_name, 'fuzzy')

        # No match found
        return {
            'matched': False,
            'raw_name': drug_name,
            'canonical_drug_id': None,
            'salt_name': None,
            'strength': None,
            'brand_variants': [],
        }

    finally:
        await conn.close()


def _build_match_result(row: asyncpg.Record, raw_name: str, match_type: str) -> dict:
    return {
        'matched': True,
        'raw_name': raw_name,
        'match_type': match_type,
        'canonical_drug_id': str(row['id']),
        'salt_name': row['salt_name'],
        'strength': row['strength'],
        'dosage_form': row['dosage_form'],
        'schedule': row['schedule'],
        'brand_variants': list(row['brand_variants'] or []),
    }
