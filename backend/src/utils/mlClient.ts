import type { ExtractionResult } from '../types/index.js';

const ML_SERVICE_URL = process.env.ML_SERVICE_URL ?? 'http://localhost:8000';

export const extractPrescription = async (
  imagePath: string,
  prescriptionId: string
): Promise<ExtractionResult> => {
  const response = await fetch(`${ML_SERVICE_URL}/api/v1/ocr/extract`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_path: imagePath,
      prescription_id: prescriptionId,
    }),
  });

  if (!response.ok) {
    const error = await response.json() as { detail: unknown };
    throw new Error(`ML service error: ${JSON.stringify(error.detail)}`);
  }

  return response.json() as Promise<ExtractionResult>;
};
