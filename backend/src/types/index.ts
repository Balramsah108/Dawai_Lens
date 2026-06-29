export interface DrugEntry {
  drug_name: string;
  strength: string | null;
  dosage_form: string | null;
  frequency: string | null;
  duration: string | null;
}

export interface ExtractionResult {
  prescription_id: string;
  drug_entries: DrugEntry[];
  confidence: number | null;
  ocr_engine: string | null;
  created_at: string;
}
