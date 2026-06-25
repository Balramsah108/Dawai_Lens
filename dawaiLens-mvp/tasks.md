# Implementation Plan: MedCompare MVP

## Overview

Implement MedCompare, an Indian-market PWA that extracts medicines from prescription photos via an AI/OCR pipeline and compares prices across seven Indian online pharmacies. The stack is Python 3.12 (FastAPI + Celery) for the backend and TypeScript (Next.js 14 App Router + React 18 + Tailwind CSS) for the frontend. Implementation follows a bottom-up approach: infrastructure → data models → OCR pipeline → scraping engine → comparison logic → frontend UI → auth and accounts → PWA polish.

## Tasks

- [ ] 1. Project scaffolding and infrastructure setup
  - [ ] 1.1 Initialise monorepo structure with backend (Python/FastAPI) and frontend (Next.js 14) packages
    - Create `backend/` with `pyproject.toml` (Poetry), `Dockerfile`, `requirements.txt` and `backend/src/` layout
    - Create `frontend/` with `package.json` (Next.js 14, TypeScript, Tailwind CSS, `@ducanh2912/next-pwa`)
    - Add `docker-compose.yml` for local dev: PostgreSQL 16, Redis 7, stubbed-R2 (MinIO), and a Celery worker container
    - _Requirements: 15.3_

  - [ ] 1.2 Configure PostgreSQL schema migrations with Alembic
    - Install `alembic` and `asyncpg`; create `alembic/env.py` targeting the `DATABASE_URL` env var
    - Write initial migration creating all tables from the design: `users`, `family_profiles`, `prescriptions`, `extraction_results`, `canonical_drugs`, `drug_brands`, `price_records`, `compare_sessions`, `reminders`
    - Create the `rx_history` PostgreSQL view as defined in the design
    - Enable `pg_trgm` extension; add `idx_drug_brands_name_trgm` GIN index
    - _Requirements: 15.3_

  - [ ] 1.3 Configure Redis connection and Celery application
    - Wire `redis-py` async client and `celery` app with `broker_url` and `result_backend` from env vars
    - Define two Celery queues: `ocr` and `scrape`; set `task_soft_time_limit=45` on scrape tasks
    - Add Redis key-TTL helpers matching the design's key conventions (`prices:*`, `session:*`, `task:*`, `guest_compares:*`, `otp_attempts:*`)
    - _Requirements: 4.3, 15.3_

  - [ ] 1.4 Set up Cloudflare R2 / MinIO client and presigned URL helpers
    - Configure `boto3` with the R2 (or MinIO for local) endpoint and credentials from env vars
    - Implement `generate_presigned_put(object_key, ttl=60)` and `generate_presigned_get(object_key, ttl=300)` helpers
    - Ensure bucket CORS blocks direct browser GET access to raw bucket paths
    - _Requirements: 1.4, 13.3, 13.4, 13.5_

  - [ ] 1.5 Integrate Firebase Admin SDK for backend token verification
    - Install `firebase-admin`; load service-account JSON from env var at startup
    - Implement `verify_firebase_token(id_token: str) -> FirebaseUser` dependency used by all protected routes
    - _Requirements: 8.1, 8.3_


- [ ] 2. Core Pydantic models, TypeScript types, and shared utilities
  - [ ] 2.1 Define all Pydantic v2 models for the backend
    - Implement `DrugEntry`, `ExtractionResult`, `PriceRecord`, `GenericSuggestion`, `CompareSession` as shown in the design
    - Add `model_validator` and `field_validator` annotations where the design specifies constraints (e.g., `confidence` between 0 and 1)
    - Implement `ExtractionResult` JSON serialiser and deserialiser (used by round-trip property test)
    - _Requirements: 2.3, 2.4, 2.9_

  - [ ]* 2.2 Write property test for ExtractionResult round-trip (Property 3)
    - **Property 3: Extraction_Result Round-Trip**
    - **Validates: Requirements 2.9**
    - Use `hypothesis` `@given` with a custom `st_extraction_result()` strategy
    - Assert `parse(format(result)) == result` for all non-null fields
    - Tag: `# Feature: medcompare-mvp, Property 3: ExtractionResult round-trip`

  - [ ] 2.3 Define TypeScript types for the frontend
    - Create `frontend/src/types/api.ts` with interfaces matching all Pydantic models: `DrugEntry`, `ExtractionResult`, `PriceRecord`, `GenericSuggestion`, `RxHistoryEntry`, `FamilyProfile`, `Reminder`
    - _Requirements: 2.3, 5.1_

  - [ ] 2.4 Implement file-upload validator utility (backend)
    - Write `validate_upload(mime_type: str, size_bytes: int) -> ValidationResult` pure function
    - Accept list: `image/jpeg`, `image/png`, `image/heic`, `image/webp`, `application/pdf`; max size 20 MB
    - Return typed result with appropriate error code (`FILE_TOO_LARGE`, `UNSUPPORTED_FILE_TYPE`) on rejection
    - _Requirements: 1.1, 1.5, 1.6_

  - [ ]* 2.5 Write property test for file upload validation (Property 1)
    - **Property 1: File Upload Validation**
    - **Validates: Requirements 1.1, 1.5, 1.6**
    - Use `hypothesis` `@given(mime_type=st.one_of(...), size_bytes=st.integers(...))`
    - Assert accept iff `mime_type in ALLOWED_TYPES and size_bytes <= 20 * 1024 * 1024`
    - Tag: `# Feature: medcompare-mvp, Property 1: File Upload Validation`


- [ ] 3. Prescription upload API
  - [ ] 3.1 Implement `POST /api/v1/prescriptions/upload-url` endpoint
    - Validate `mime_type` and `size_bytes` from request body using the validator from task 2.4
    - Generate a presigned R2 PUT URL (TTL 60 s) and return `{ upload_url, object_key }`
    - Return `FILE_TOO_LARGE` (422) or `UNSUPPORTED_FILE_TYPE` (422) on validation failure
    - _Requirements: 1.1, 1.4, 1.5, 1.6_

  - [ ] 3.2 Implement `POST /api/v1/prescriptions` endpoint
    - Accept `{ object_key, profile_id }`; verify the authenticated user owns the given `profile_id`
    - Insert a row into `prescriptions`; enqueue an OCR Celery task on the `ocr` queue; return `{ task_id }`
    - Return `PRESCRIPTION_REQUIRED` (403) if `object_key` is absent
    - _Requirements: 1.4, 1.7, 9.1_

  - [ ]* 3.3 Write unit tests for prescription upload endpoints
    - Mock `boto3.generate_presigned_url`; assert correct TTL and bucket path
    - Mock R2 write error → assert `UPLOAD_FAILED` (502) returned to client
    - Assert unauthenticated request returns 401
    - _Requirements: 1.7, 13.5_

- [ ] 4. OCR pipeline Celery worker
  - [ ] 4.1 Implement Gemini Vision primary extractor
    - Write `extract_with_gemini(image_bytes: bytes) -> tuple[ExtractionResult, float]` using the Google Generative AI SDK
    - Use `response_mime_type="application/json"` and `response_schema=ExtractionResult` to enforce structured output
    - Return `(result, confidence)` where `confidence` comes from the model's usage metadata or a heuristic on null-field count
    - _Requirements: 2.1, 2.3_

  - [ ] 4.2 Implement OCR fallback routing (GCV + TrOCR)
    - Write `classify_script(image_bytes) -> Literal["printed", "handwritten"]` via a lightweight Gemini prompt
    - Write `extract_with_gcv(image_bytes) -> str` using `google-cloud-vision` `DOCUMENT_TEXT_DETECTION`
    - Write `extract_with_trocr(image_bytes) -> str` loading `microsoft/trocr-large-handwritten` from HuggingFace
    - Wire into `ocr_pipeline(image_bytes)`: if Gemini confidence < 0.7 → classify → call fallback → re-parse raw text through Gemini structured output
    - _Requirements: 2.2_

  - [ ]* 4.3 Write property test for OCR fallback routing (Property 2)
    - **Property 2: OCR Fallback Routing**
    - **Validates: Requirements 2.2**
    - Use `hypothesis` to generate confidence floats across [0.0, 1.0]
    - Assert: `confidence < 0.7` → fallback called; `confidence >= 0.7` → fallback NOT called
    - Tag: `# Feature: medcompare-mvp, Property 2: OCR Fallback Routing`

  - [ ] 4.4 Implement PDF-to-image pre-processing step
    - Write `pdf_to_image(pdf_bytes: bytes) -> bytes` using `pypdfium2` to render the first page at 300 DPI as PNG
    - Integrate as the first step in `ocr_pipeline` when the object's MIME type is `application/pdf`
    - _Requirements: 2.1_

  - [ ] 4.5 Wire full OCR Celery task and persist ExtractionResult
    - Implement `process_prescription` Celery task: download object from R2 → pre-process PDF if needed → run `ocr_pipeline` → insert `extraction_results` row → update `task:{task_id}:status` in Redis → publish to SSE channel
    - If zero Drug_Entries extracted, set task status to `failed` with code `OCR_NO_EXTRACTION`
    - _Requirements: 2.1, 2.7_

  - [ ] 4.6 Implement `GET /api/v1/tasks/{task_id}` SSE endpoint
    - Subscribe to Redis Pub/Sub channel `task:{task_id}`; stream `{ status, result }` events to the client
    - On `done` event, return the full `ExtractionResult` JSON; on `failed`, return error code and user-facing message
    - _Requirements: 2.1, 2.7_

  - [ ]* 4.7 Write unit tests for OCR pipeline routing and fallback
    - Mock Gemini returning `confidence=0.65` → assert GCV or TrOCR called; `confidence=0.8` → assert no fallback
    - Assert zero-Drug_Entry result → task status set to `failed` with `OCR_NO_EXTRACTION`
    - _Requirements: 2.2, 2.7_


- [ ] 5. Drug Normalizer service
  - [ ] 5.1 Build the Drug_DB ingestion pipeline
    - Write a one-off management command `ingest_drug_db.py` that:
      - Downloads and parses OpenFDA drug label data (NDC → generic salt)
      - Parses the CDSCO Indian Drug Index CSV (brand → salt)
      - Loads the MedCompare curated CSV (100 k+ Indian brand → salt mappings)
    - Upsert all records into `canonical_drugs` and `drug_brands` tables
    - _Requirements: 3.2, 15.4_

  - [ ] 5.2 Implement the Normalizer matching algorithm
    - Write `normalize(drug_name: str) -> NormalizerResult` executing the three-stage algorithm from the design:
      1. Case-insensitive exact `ILIKE` lookup via SQLAlchemy
      2. Apply OCR substitution normalisation (`0→O`, `1→l`, `l→I`, `5→S`, `8→B`) then re-attempt exact lookup
      3. `pg_trgm` fuzzy match with edit distance ≤ 2 using `similarity()` threshold
    - Return `Canonical_Drug` + all brand variants on match; `{ matched: false, raw_name }` on no-match
    - _Requirements: 3.1, 3.3, 3.4, 3.5, 3.6_

  - [ ]* 5.3 Write property test for fuzzy drug matching with OCR substitutions (Property 4)
    - **Property 4: Fuzzy Drug Matching with OCR Substitutions**
    - **Validates: Requirements 3.3, 3.5, 3.6**
    - Use `hypothesis` to generate drug names from the DB and apply random OCR substitutions (edit distance ≤ 2)
    - Assert same `Canonical_Drug` returned for all substitution variants and case variants
    - Tag: `# Feature: medcompare-mvp, Property 4: Fuzzy Drug Matching with OCR Substitutions`

  - [ ]* 5.4 Write unit tests for Normalizer edge cases
    - Test exact match, fuzzy match (edit distance 1 and 2), edit distance 3 (must NOT match), each OCR pair, case variants, and no-match path
    - _Requirements: 3.4, 3.5, 3.6_

- [ ] 6. Checkpoint — Infrastructure and pipeline verified
  - Ensure all tests pass, ask the user if questions arise.


- [ ] 7. Price scraping engine
  - [ ] 7.1 Implement Redis price cache helpers
    - Write `get_cached_price(canonical_drug_id, platform_id) -> PriceRecord | None`
    - Write `set_cached_price(canonical_drug_id, platform_id, record, ttl=1800)` serialising `PriceRecord` to JSON
    - Write `clear_price_cache(canonical_drug_id)` for testing/admin use
    - _Requirements: 4.3_

  - [ ]* 7.2 Write property test for price cache round-trip (Property 5)
    - **Property 5: Price Cache Round-Trip**
    - **Validates: Requirements 4.3**
    - Use `hypothesis` to generate arbitrary `PriceRecord` objects and store/retrieve via Redis test instance
    - Assert field-for-field equality on retrieval before TTL; assert cache miss after TTL (mock `time.time`)
    - Tag: `# Feature: medcompare-mvp, Property 5: Price Cache Round-Trip`

  - [ ] 7.3 Implement base Playwright scraper with anti-bot configuration
    - Write `PlaywrightScraper` base class: launch browser with `playwright-stealth`, randomised viewport (360×780 → 414×896), randomised 200–800 ms delays, and per-request residential proxy rotation
    - Implement 3-retry policy with 5 s exponential backoff; on terminal failure return out-of-stock `PriceRecord` and log to Sentry
    - _Requirements: 4.5, 4.6_

  - [ ] 7.4 Implement platform-specific Playwright scrapers (1mg, PharmEasy, Netmeds, Apollo 247, MedPlus)
    - Write `OneMgScraper`, `PharmEasyScraper`, `NetmedsScraper`, `Apollo247Scraper`, `MedPlusScraper` extending `PlaywrightScraper`
    - Each scraper must extract: brand_name, pack_size, mrp_inr, selling_price_inr, in_stock, delivery_eta_hours, affiliate_url
    - When a platform returns no result, return `PriceRecord(in_stock=False, selling_price_inr=None, ...)`
    - _Requirements: 4.1, 4.4, 4.7, 15.5_

  - [ ] 7.5 Implement Amazon PA-API and Flipkart Affiliate API scrapers
    - Write `AmazonPharmacyScraper` using `SearchItems` with `SearchIndex=HealthPersonalCare` and `Keywords=<canonical_drug>`
    - Write `FlipkartHealthScraper` using the Flipkart Affiliate product search endpoint
    - Extract the same fields as Playwright scrapers; include affiliate tracking parameter in every URL
    - _Requirements: 4.6, 7.2, 7.3, 15.5_

  - [ ]* 7.6 Write property test for out-of-stock normalisation (Property 6)
    - **Property 6: Out-of-Stock Normalisation**
    - **Validates: Requirements 4.4**
    - Use `hypothesis` to mock empty/no-result scraper responses across all platforms
    - Assert returned `PriceRecord` always has `in_stock=False` and `selling_price_inr=None`
    - Tag: `# Feature: medcompare-mvp, Property 6: Out-of-Stock Normalisation`

  - [ ] 7.7 Implement `scrape_platform` Celery task and compare session orchestration
    - Write `scrape_platform(session_id, canonical_drug_id, platform_id)` Celery task: check cache → scrape if miss → store result in Redis + `price_records` table → publish `{ platform_id, status, price_record }` to `session:{session_id}` Pub/Sub channel
    - Write `POST /api/v1/compare` endpoint: create `CompareSession` in DB → enqueue 7 × n `scrape_platform` tasks → return `{ session_id, task_ids[] }`
    - Enforce 45 s soft time limit on each task; timed-out tasks publish `{ platform_id, status: "timeout" }`
    - _Requirements: 4.1, 4.2, 4.8, 4.9_

  - [ ] 7.8 Implement `GET /api/v1/compare/{session_id}` SSE endpoint and final result endpoint
    - SSE handler subscribes to `session:{session_id}` Pub/Sub; streams partial `PriceRecord` updates to the browser
    - Implement `GET /api/v1/compare/{session_id}/result` returning the full `ComparisonResult` JSON after session completes
    - Implement task queue depth check: if `queue_depth > 50` return HTTP 429 with `QUEUE_BUSY` error
    - _Requirements: 4.8, 4.9, 14.4_

  - [ ]* 7.9 Write property test for task queue backpressure (Property 13)
    - **Property 13: Task Queue Backpressure**
    - **Validates: Requirements 14.4**
    - Use `hypothesis` to generate queue depth values; mock Redis `queue_depth` key
    - Assert HTTP 429 iff `depth > 50`; assert no 429 for `depth <= 50`
    - Tag: `# Feature: medcompare-mvp, Property 13: Task Queue Backpressure`

  - [ ]* 7.10 Write unit tests for scraper retry and affiliate URL safety
    - Mock platform returning HTTP 503 three times → assert `PLATFORM_UNAVAILABLE` in response and Sentry event
    - Assert no PII (user_id, phone, prescription content) in any generated affiliate URL
    - _Requirements: 4.5, 7.7_


- [ ] 8. Comparison logic and generic suggestions
  - [ ] 8.1 Implement the default sort comparator and discount calculator
    - Write `default_sort_key(record: PriceRecord)` Python function as specified in the design (in_stock first, price asc, ETA asc, nulls last)
    - Write `calculate_discount_pct(mrp_inr, selling_price_inr) -> Decimal | None` returning `round((mrp - price) / mrp * 100, 1)` or `None` when inputs are invalid
    - Write equivalent TypeScript versions in `frontend/src/lib/comparison.ts` for client-side display
    - _Requirements: 5.1, 5.2, 5.3_

  - [ ]* 8.2 Write property test for Comparison Table sort invariant (Property 7)
    - **Property 7: Comparison Table Sort Invariant**
    - **Validates: Requirements 5.2, 5.3**
    - Use `hypothesis` to generate lists of `PriceRecord` objects (in-stock and out-of-stock, null prices/ETAs)
    - Assert sorted result satisfies all three conditions simultaneously (in-stock first, non-decreasing price, non-decreasing ETA for ties)
    - Tag: `# Feature: medcompare-mvp, Property 7: Comparison Table Sort Invariant`

  - [ ]* 8.3 Write property test for discount calculation correctness (Property 8)
    - **Property 8: Discount Calculation Correctness**
    - **Validates: Requirements 5.1**
    - Use `hypothesis` `@given(mrp=st.decimals(...), price=st.decimals(...))` where `price <= mrp` and `mrp > 0`
    - Assert result equals `round((mrp - price) / mrp * 100, 1)` and is never negative
    - Tag: `# Feature: medcompare-mvp, Property 8: Discount Calculation Correctness`

  - [ ] 8.4 Implement combined total calculation
    - Write `calculate_combined_total(per_drug_record_groups: list[list[PriceRecord]]) -> Decimal | None`
    - Logic: for each group find `min(selling_price_inr for r if r.in_stock and r.selling_price_inr is not None)`; sum across groups that have at least one such value; return `None` if all groups are out-of-stock
    - Write equivalent TypeScript version in `frontend/src/lib/comparison.ts`
    - _Requirements: 5.4_

  - [ ]* 8.5 Write property test for combined total calculation (Property 9)
    - **Property 9: Combined Total Calculation**
    - **Validates: Requirements 5.4**
    - Use `hypothesis` to generate groups of `PriceRecord` lists with mixed in/out-of-stock states
    - Assert total equals sum of per-group minimums over in-stock records; out-of-stock groups excluded
    - Tag: `# Feature: medcompare-mvp, Property 9: Combined Total Calculation`

  - [ ] 8.6 Implement best-price and best-ETA highlight logic
    - Write `compute_highlights(records: list[PriceRecord]) -> dict[UUID, set[str]]` returning a map of record IDs to `{"green", "blue"}` highlight sets
    - A record with the globally minimum in-stock `selling_price_inr` gets `"green"`; minimum `delivery_eta_hours` gets `"blue"`; both minimums → both highlights
    - _Requirements: 5.5_

  - [ ]* 8.7 Write property test for best-price and best-ETA highlights (Property 10)
    - **Property 10: Best-Price and Best-ETA Highlights**
    - **Validates: Requirements 5.5**
    - Use `hypothesis` to generate non-empty lists with at least one in-stock record
    - Assert exactly the global-minimum records receive the corresponding highlight; dual-minimum record receives both
    - Tag: `# Feature: medcompare-mvp, Property 10: Best-Price and Best-ETA Highlights`

  - [ ] 8.8 Implement generic suggestion computation
    - Write `compute_generic_suggestions(prescribed_records: list[PriceRecord], canonical_drug_id: UUID, db_session) -> list[GenericSuggestion]`
    - Query `drug_brands` for same salt+strength, different brand names; for each candidate fetch price records
    - Filter: include only suggestions where at least one platform has in-stock price strictly less than the prescribed brand on that same platform (exclude platforms where prescribed brand price is null)
    - Sort by `min(selling_price)` ascending; return at most 3
    - _Requirements: 6.1, 6.2, 6.3, 6.6_

  - [ ]* 8.9 Write property test for generic suggestion price filter (Property 11)
    - **Property 11: Generic Suggestion Price Filter**
    - **Validates: Requirements 6.3**
    - Use `hypothesis` to generate prescribed and suggestion `PriceRecord` sets with varying prices and in-stock states
    - Assert suggestion included iff ∃ platform where suggestion in-stock price < prescribed in-stock price on same platform
    - Tag: `# Feature: medcompare-mvp, Property 11: Generic Suggestion Price Filter`

- [ ] 9. Checkpoint — Backend logic complete
  - Ensure all tests pass, ask the user if questions arise.


- [ ] 10. Firebase Auth integration (backend + frontend)
  - [ ] 10.1 Implement OTP login API and session management
    - Write `POST /api/v1/auth/session` endpoint: verify Firebase ID token via `firebase_admin.auth.verify_id_token()` → upsert `users` row → set 30-day HttpOnly Secure SameSite=Strict session cookie
    - Implement Redis `otp_attempts:{phone}` counter (TTL 600 s) as secondary OTP lockout safeguard; return `OTP_LOCKED` (429) after 3 failures
    - Implement guest compare counter: `guest_compares:{fp}` Redis key; return `{ requires_auth: true }` when count reaches 1
    - _Requirements: 8.1, 8.3, 8.4, 8.6, 8.7, 8.8_

  - [ ]* 10.2 Write property test for OTP lockout invariant (Property 14)
    - **Property 14: OTP Lockout Invariant**
    - **Validates: Requirements 8.4**
    - Use `hypothesis` to generate sequences of correct/incorrect OTP submissions for a phone number
    - Assert that after exactly 3 consecutive failures within 600 s, all subsequent attempts (correct or incorrect) are rejected until TTL lifts
    - Tag: `# Feature: medcompare-mvp, Property 14: OTP Lockout Invariant`

  - [ ] 10.3 Implement Firebase Auth login UI in Next.js
    - Create `frontend/src/app/auth/login/page.tsx` with mobile number input (10-digit, starting with 6–9 validation), invisible reCAPTCHA `RecaptchaVerifier`, OTP input (6-digit), and "Resend OTP" button (max 3 per hour)
    - Call `signInWithPhoneNumber` → `confirmationResult.confirm(otp)` → POST ID token to `/api/v1/auth/session`
    - Display `OTP_LOCKED` and `AUTH_REQUIRED` errors per the design's error catalogue
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.6_

  - [ ]* 10.4 Write unit tests for Firebase token verification
    - Mock `firebase_admin.auth.verify_id_token`; assert invalid token → 401 with `UNAUTHENTICATED`
    - Assert unauthenticated request to any protected endpoint returns 401
    - _Requirements: 8.3, 9.6_

- [ ] 11. User account — Rx History and Family Profiles
  - [ ] 11.1 Implement Rx History API endpoints
    - Implement `GET /api/v1/rx-history` (paginated, authenticated) returning `rx_history` view rows sorted by `compared_at` desc
    - Implement `GET /api/v1/rx-history/{rx_id}` returning the full entry with saved `PriceRecord` IDs
    - Implement `DELETE /api/v1/rx-history/{rx_id}` with ownership check → delete from `compare_sessions`, `extraction_results`, `prescriptions` tables and from R2
    - Implement `GET /api/v1/rx-history/{rx_id}/image` returning a 302 redirect to a 300 s presigned GET URL
    - Ensure all endpoints return 401 for unauthenticated requests
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

  - [ ]* 11.2 Write property test for signed proxy URL safety (Property 12)
    - **Property 12: Signed Proxy URL Safety**
    - **Validates: Requirements 13.5**
    - Use `hypothesis` to generate arbitrary R2 object keys
    - Assert returned URL is HTTPS, contains `X-Amz-Signature`, has `X-Amz-Expires <= 300`, and does not contain the raw bucket hostname
    - Tag: `# Feature: medcompare-mvp, Property 12: Signed Proxy URL Safety`

  - [ ] 11.3 Implement Family Profile API endpoints
    - Implement `GET /api/v1/profiles`, `POST /api/v1/profiles`, `PATCH /api/v1/profiles/{id}`, `DELETE /api/v1/profiles/{id}`
    - Enforce profile count cap ≤ 5 (`PROFILE_LIMIT_REACHED` 422); enforce unique name within account (`PROFILE_NAME_DUPLICATE` 422)
    - Block deletion of the primary profile; cascade delete all associated Rx_History and Reminders on profile deletion
    - Auto-create primary profile at user registration
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9_

  - [ ]* 11.4 Write property test for Family Profile name uniqueness (Property 15)
    - **Property 15: Family Profile Name Uniqueness**
    - **Validates: Requirements 10.2, 10.6**
    - Use `hypothesis` to generate sequences of create/rename operations on profiles within one account
    - Assert no duplicate names exist at any point; any duplicate-causing operation is rejected
    - Tag: `# Feature: medcompare-mvp, Property 15: Family Profile Name Uniqueness`

  - [ ]* 11.5 Write property test for Family Profile count cap (Property 16)
    - **Property 16: Family Profile Count Cap**
    - **Validates: Requirements 10.1, 10.5**
    - Use `hypothesis` to generate sequences of create/delete operations
    - Assert active profile count never exceeds 5; any 6th create is rejected with 422
    - Tag: `# Feature: medcompare-mvp, Property 16: Family Profile Count Cap`

  - [ ] 11.6 Implement Reminders API endpoints
    - Implement `POST /api/v1/reminders`, `PATCH /api/v1/reminders/{id}`, `DELETE /api/v1/reminders/{id}`
    - `POST` validates `start_time` (HH:MM 24 h), `frequency_hours`, and `end_date`; associates reminder with the given `profile_id`
    - `DELETE` sets `is_active=false` and cancels; PATCH allows editing `start_time`, `frequency_hours`, `end_date`
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

  - [ ] 11.7 Implement account deletion endpoint
    - Write `POST /api/v1/account/delete` (authenticated): set `deleted_at` on the `users` row → enqueue an async purge Celery task
    - Purge task: delete all `family_profiles`, `prescriptions`, `extraction_results`, `compare_sessions`, `price_records`, and `reminders` rows for the user; delete all R2 objects; hard-delete the `users` row — complete within 30 days
    - _Requirements: 13.7_

  - [ ]* 11.8 Write unit tests for account and profile lifecycle
    - Assert primary profile cannot be deleted; assert correct cascade on profile deletion (Rx_History + Reminders removed)
    - Assert `DELETE /account/delete` confirmation prompt required and data purged
    - Assert `GET /rx-history` returns 401 for unauthenticated requests
    - _Requirements: 9.6, 10.7, 10.8, 10.9, 13.7_


- [ ] 12. Frontend — Prescription capture and review screens
  - [ ] 12.1 Implement `/upload` page — prescription capture UI
    - Create `frontend/src/app/upload/page.tsx` with:
      - File picker accepting JPEG, PNG, HEIC, WebP, PDF; max 5 files, max 20 MB each
      - Live camera capture button using `getUserMedia`; display viewfinder; fallback to file picker if camera unavailable (Req 1.8)
      - Image/PDF preview before submission confirmation
      - Family profile selector (calls `GET /api/v1/profiles`)
      - Legal disclaimer text per Req 1.10
      - Schedule H/H1 gate: disable submission if no prescription uploaded (Req 1.9)
    - On confirmation: call `POST /api/v1/prescriptions/upload-url` → PUT directly to R2 → call `POST /api/v1/prescriptions`
    - Display `FILE_TOO_LARGE` and `UNSUPPORTED_FILE_TYPE` inline error messages
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10_

  - [ ] 12.2 Implement upload progress and SSE task polling
    - Poll `GET /api/v1/tasks/{task_id}` via TanStack Query; display per-step progress (uploading → extracting → done)
    - On completion navigate to `/review?task_id={task_id}`; on failure display `OCR_NO_EXTRACTION` with manual entry option
    - _Requirements: 2.1, 2.7_

  - [ ] 12.3 Implement `/review` page — Extraction_Result review form
    - Create `frontend/src/app/review/page.tsx` displaying all `DrugEntry` fields in an editable form
    - Null fields highlighted for user review; user can correct any field; manual medicine entry available (Req 2.7)
    - "Confirm and Compare" button calls `POST /api/v1/compare` and navigates to `/compare/{sessionId}`
    - _Requirements: 2.5, 2.6, 2.7_

  - [ ]* 12.4 Write unit tests for upload validation error display
    - Assert `FILE_TOO_LARGE` error renders the exact message from Req 1.5
    - Assert `UNSUPPORTED_FILE_TYPE` error renders the exact message from Req 1.6
    - Assert Schedule H gate blocks submission and shows required message
    - _Requirements: 1.5, 1.6, 1.9_

- [ ] 13. Frontend — Comparison Table and Generic Suggestions
  - [ ] 13.1 Implement `ComparisonTable` component
    - Create `frontend/src/components/ComparisonTable.tsx` displaying: platform name, brand name, pack size, MRP (INR), selling price (INR), discount %, in-stock status, delivery ETA
    - Apply green highlight to lowest in-stock price row(s), blue to fastest in-stock ETA row(s); dual highlight when single row holds both
    - Show "Out of Stock" in price and ETA cells; "—" in discount cell for out-of-stock rows (Req 5.6)
    - Display cache timestamp as "Prices as of [HH:MM IST]" when data is from cache (Req 5.7)
    - Responsive: card layout on mobile ≥ 320px, table on wider viewports; no horizontal scroll (Req 5.8)
    - _Requirements: 5.1, 5.2, 5.5, 5.6, 5.7, 5.8_

  - [ ] 13.2 Implement sort controls and combined total row
    - Add sort control buttons (selling price / delivery ETA / discount %) to `ComparisonTable`; re-sort using client-side `default_sort_key` logic from `frontend/src/lib/comparison.ts`
    - Render a combined total row below all per-drug tables using `calculate_combined_total`; label out-of-stock drugs as "unavailable" in total (Req 5.4)
    - _Requirements: 5.2, 5.3, 5.4_

  - [ ] 13.3 Implement SSE progress indicator for live scraping
    - Subscribe to `GET /api/v1/compare/{session_id}` SSE stream using `EventSource`
    - Display per-platform loading indicators showing which platforms have returned results and which are pending (Req 4.8)
    - Populate `ComparisonTable` rows incrementally as each `PriceRecord` arrives
    - _Requirements: 4.8_

  - [ ] 13.4 Implement `GenericSuggestions` component
    - Create `frontend/src/components/GenericSuggestions.tsx` showing up to 3 cheaper alternatives with salt name, strength, and minimum platform price
    - Include pharmacist disclaimer (Req 6.5); hide section entirely if no suggestions exist (Req 6.7)
    - Clicking a suggestion navigates to a new `/compare` session for the suggested Canonical_Drug
    - _Requirements: 6.1, 6.2, 6.4, 6.5, 6.6, 6.7_

  - [ ] 13.5 Implement `/compare/[sessionId]` page
    - Create `frontend/src/app/compare/[sessionId]/page.tsx` wiring together the SSE stream, per-Drug_Entry `ComparisonTable` tabs, `GenericSuggestions`, combined total, and legal disclaimer (Req 13.2)
    - Show `AUTH_REQUIRED` prompt when unauthenticated user attempts second comparison
    - _Requirements: 5.1, 13.2_

  - [ ]* 13.6 Write unit tests for Comparison Table rendering and sort
    - Assert discount percentage rendered to one decimal place
    - Assert out-of-stock row displays "Out of Stock" and "—" for discount
    - Assert sort by ETA places fastest delivery first among in-stock rows
    - Assert combined total excludes out-of-stock Drug_Entries
    - _Requirements: 5.1, 5.2, 5.4, 5.6_

- [ ] 14. Frontend — Deep-link exit dialog
  - [ ] 14.1 Implement deep-link confirmation dialog component
    - Create `frontend/src/components/DeepLinkDialog.tsx` shown when user clicks a platform row
    - Display "You are leaving MedCompare and visiting [Platform name]. MedCompare does not process or guarantee this transaction."
    - On confirm: open `Affiliate_URL` in a new tab (`window.open(url, "_blank", "noopener,noreferrer")`)
    - On cancel/dismiss: close dialog without navigating or opening any tab
    - Disable button and show "Link unavailable" when `affiliate_url` is null
    - Assert the Affiliate_URL contains at least one non-empty affiliate tracking parameter before opening
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

  - [ ]* 14.2 Write unit tests for deep-link dialog behaviour
    - Assert cancel → no `window.open` called; assert confirm → new tab opened with correct URL
    - Assert null `affiliate_url` → button disabled with "Link unavailable" text
    - Assert no PII in the URL passed to `window.open`
    - _Requirements: 7.1, 7.5, 7.6, 7.7_


- [ ] 15. Frontend — Rx History, Family Profiles, and Reminders screens
  - [ ] 15.1 Implement `/history` page
    - Create `frontend/src/app/history/page.tsx` listing Rx_History entries sorted by most recent first
    - Show upload timestamp (fall back to extraction creation timestamp), Drug_Entry count, and prescription thumbnail (via `/rx-history/{id}/image` presigned proxy)
    - _Requirements: 9.2_

  - [ ] 15.2 Implement `/history/[rxId]` page
    - Load saved `ExtractionResult` and trigger a fresh `POST /api/v1/compare`; display updated `ComparisonTable`
    - On fresh price lookup failure, display saved `PriceRecord` data with a stale-data warning banner
    - Include delete button with confirmation prompt; on confirm call `DELETE /api/v1/rx-history/{rx_id}`
    - _Requirements: 9.3, 9.5_

  - [ ] 15.3 Implement `/profiles` page — Family Profile management
    - Create `frontend/src/app/profiles/page.tsx` listing all profiles; allow create, rename, and delete
    - Show `PROFILE_LIMIT_REACHED` error toast if user attempts a 6th profile
    - Show `PROFILE_NAME_DUPLICATE` error toast on duplicate name
    - Omit delete button for the primary profile (Req 10.9); show deletion confirmation warning about data loss
    - _Requirements: 10.1, 10.2, 10.5, 10.6, 10.7, 10.9_

  - [ ] 15.4 Implement `/reminders` page
    - Create `frontend/src/app/reminders/page.tsx` listing active reminders per profile
    - Wire `POST /api/v1/reminders` form (start time in 24 h HH:MM, frequency, end date); show edit and deactivate controls
    - Request browser push notification permission when user first sets a reminder; if denied show info message and block creation (Req 11.6)
    - Schedule `Notification` API push calls at computed intervals for the reminder duration
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_

  - [ ]* 15.5 Write unit tests for profile and reminder UI constraints
    - Assert 6th profile creation attempt shows `PROFILE_LIMIT_REACHED` message
    - Assert primary profile has no delete button in the DOM
    - Assert reminder creation blocked when notification permission denied
    - _Requirements: 10.5, 10.9, 11.6_

- [ ] 16. Checkpoint — All screens and accounts complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 17. PWA manifest, service worker, and legal compliance
  - [ ] 17.1 Configure PWA manifest and service worker
    - Create `frontend/public/manifest.json` with `display: "standalone"`, `theme_color: "#1A6B4A"`, 192×192 and 512×512 icons
    - Configure `@ducanh2912/next-pwa` in `next.config.js`: `StaleWhileRevalidate` for app shell, `NetworkFirst` (3 s timeout) for API routes, `CacheFirst` for static assets
    - Defer "Add to Home Screen" install prompt until after first comparison is completed
    - _Requirements: 12.1, 12.2, 12.4_

  - [ ] 17.2 Add legal disclaimer pages and footer links
    - Create `/terms` and `/privacy` static pages
    - Add footer component to the root layout with links to both pages (visible on every page, Req 13.1)
    - Ensure comparison screen shows the "MedCompare is a price comparison service only…" disclaimer (Req 13.2)
    - _Requirements: 13.1, 13.2_

  - [ ] 17.3 Implement DPDP Act consent gate on registration
    - Add mandatory unchecked consent checkbox to the registration step in `/auth/login`; block account creation until checked
    - _Requirements: 13.6_

  - [ ]* 17.4 Write unit tests for legal and consent gate
    - Assert registration form rejects submission when consent checkbox is unchecked
    - Assert legal disclaimer text is present in comparison page DOM
    - Assert Terms and Privacy links present in footer across at least upload, compare, and history pages
    - _Requirements: 13.1, 13.2, 13.6_


- [ ] 18. Observability — Sentry and PostHog integration
  - [ ] 18.1 Integrate Sentry into the FastAPI backend
    - Install and initialise `sentry-sdk[fastapi]`; configure DSN from env var
    - Ensure all `5xx` responses capture the exception at `ERROR` level with `request_id`, path, and stack trace within 5 s
    - Redact personal data (phone, prescription content) from Celery task error events before sending to Sentry
    - _Requirements: 14.1_

  - [ ] 18.2 Integrate Sentry into the Next.js frontend
    - Install `@sentry/nextjs`; wrap app with `Sentry.init`; configure breadcrumb capture for the last 10 user actions (page navigations, button clicks, form submissions)
    - Wrap all pages with React Error Boundaries; call `Sentry.captureException` in `onError` handlers
    - _Requirements: 14.2_

  - [ ] 18.3 Integrate PostHog analytics event emission
    - In the FastAPI backend, emit analytics events to PostHog within 5 s for: `prescription_uploaded`, `extraction_completed`, `comparison_viewed`, `deep_link_clicked`, `account_created`
    - Ensure no PII is included in event properties
    - _Requirements: 14.3_

  - [ ]* 18.4 Write integration tests for observability
    - Mock Sentry test DSN; trigger a 5xx response → assert Sentry event received within 5 s
    - Stub PostHog; trigger `comparison_viewed` → assert event emitted with correct event name
    - _Requirements: 14.1, 14.3_

- [ ] 19. Accessibility and responsive layout audit
  - [ ] 19.1 Implement WCAG 2.1 AA fixes for primary screens
    - Run `axe-core` automated checks on upload, comparison, and Rx_History screens
    - Fix all colour contrast failures (use brand green `#1A6B4A` with white text where ratio ≥ 4.5:1)
    - Ensure all interactive elements have visible `:focus` outlines and are keyboard-operable (Tab/Enter/Escape)
    - _Requirements: 12.6_

  - [ ] 19.2 Validate responsive layout across viewport range
    - Test all screens at 320px, 375px, 768px, 1280px, 1440px viewports; fix any horizontal scroll or clipped content
    - Verify `ComparisonTable` uses card layout on mobile (≤ 767px) and table layout on wider viewports
    - _Requirements: 5.8, 12.5_

  - [ ]* 19.3 Write automated accessibility tests with axe-playwright
    - Run `axe-playwright` on `/upload`, `/compare/[sessionId]`, and `/history` pages
    - Assert zero `critical` or `serious` violations from `axe-core`
    - _Requirements: 12.6_

- [ ] 20. Final integration and staging deployment
  - [ ] 20.1 Wire end-to-end integration test suite
    - Write integration tests against local Docker Compose stack covering:
      - Prescription upload → OCR → normalise → compare → verify `rx_history` row created in DB
      - Guest compare limit: second compare without auth returns `AUTH_REQUIRED`
      - Family profile CRUD and cascade deletion
      - Account deletion: trigger purge → verify DB records and R2 objects removed
    - _Requirements: 9.1, 8.7, 8.8, 10.7, 13.7_

  - [ ] 20.2 Configure Lighthouse CI and run performance audit
    - Add `lighthouserc.js` asserting Performance ≥ 70, Accessibility ≥ 90, Best Practices ≥ 90 on Moto G4 profile
    - Fix any failing Lighthouse assertions (defer non-critical JS, use `next/image` with proper sizing, etc.)
    - _Requirements: 12.3, 15.7_

  - [ ] 20.3 Deploy to Vercel (frontend) and Railway/Render (backend + workers)
    - Configure Vercel project with production and preview environments; set all required env vars (Firebase, Sentry DSN, PostHog key, R2 credentials)
    - Configure Railway with 2 web containers (FastAPI) and 4 worker containers (Celery); provision managed PostgreSQL and Redis
    - Verify staging end-to-end flow: upload prescription → compare → deep-link out
    - _Requirements: 15.7_

- [ ] 21. Final checkpoint — All tests pass and staging deployment verified
  - Ensure all tests pass, ask the user if questions arise.


## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP delivery; however, property tests directly gate correctness guarantees and are strongly recommended before production.
- The backend is Python 3.12 (FastAPI + Celery + Hypothesis for PBT); the frontend is TypeScript (Next.js 14 + React 18 + Tailwind CSS + Jest/Testing Library).
- All 16 correctness properties from the design document are covered by property-based test sub-tasks (Properties 1–16); each PBT sub-task is annotated with its property number and the requirements it validates.
- Checkpoints at tasks 6, 9, 16, and 21 ensure incremental validation.
- Infrastructure tasks (1.x, 2.x) are prerequisites for all subsequent work.
- Scraper tasks (7.3–7.8) are independent of the frontend and can progress in parallel with tasks 12–15.
- Property 3 (ExtractionResult round-trip, task 2.2) must be implemented close to task 2.1 to catch serialisation bugs early.
- Tasks 20.3 (staging deployment) requires all prior tasks to be complete and all tests passing.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.4", "1.5"] },
    { "id": 2, "tasks": ["2.1", "2.3", "2.4"] },
    { "id": 3, "tasks": ["2.2", "2.5", "3.1"] },
    { "id": 4, "tasks": ["3.2", "4.1", "5.1", "7.1"] },
    { "id": 5, "tasks": ["3.3", "4.2", "4.4", "5.2", "7.2"] },
    { "id": 6, "tasks": ["4.3", "4.5", "5.3", "5.4", "7.3", "8.1"] },
    { "id": 7, "tasks": ["4.6", "4.7", "7.4", "7.5", "8.2", "8.3", "8.4", "8.6", "10.1"] },
    { "id": 8, "tasks": ["7.6", "7.7", "8.5", "8.7", "8.8", "10.2", "10.3"] },
    { "id": 9, "tasks": ["7.8", "7.9", "7.10", "8.9", "10.4", "11.1"] },
    { "id": 10, "tasks": ["11.2", "11.3", "11.6", "11.7", "12.1"] },
    { "id": 11, "tasks": ["11.4", "11.5", "11.8", "12.2", "12.3"] },
    { "id": 12, "tasks": ["12.4", "13.1", "15.1"] },
    { "id": 13, "tasks": ["13.2", "13.3", "13.4", "15.2", "15.3", "15.4"] },
    { "id": 14, "tasks": ["13.5", "13.6", "14.1", "15.5"] },
    { "id": 15, "tasks": ["14.2", "17.1", "17.2", "17.3", "18.1", "18.2", "18.3"] },
    { "id": 16, "tasks": ["17.4", "18.4", "19.1", "19.2"] },
    { "id": 17, "tasks": ["19.3", "20.1"] },
    { "id": 18, "tasks": ["20.2"] },
    { "id": 19, "tasks": ["20.3"] }
  ]
}
```
