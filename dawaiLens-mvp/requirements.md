# Requirements Document

## Introduction

MedCompare is an Indian-market Progressive Web App (PWA) that enables patients to photograph or upload a prescription, automatically extract medicine names via OCR and AI, and instantly compare prices and delivery times across seven major Indian online pharmacies — 1mg, PharmEasy, Netmeds, Apollo 24/7, MedPlus, Amazon Pharmacy, and Flipkart Health+. The app never facilitates or processes any pharmacy transaction; it is a pure price-comparison and deep-link tool. The MVP scope targets a 20-day implementation window covering prescription capture, AI-powered extraction, multi-platform price comparison, generic substitution suggestions, and user account management with saved prescriptions.

---

## Glossary

- **MedCompare**: The web application described in this document.
- **Prescription**: A document (photo, scan, or PDF) issued by a licensed medical practitioner that authorises dispensing of Schedule H or H1 medicines.
- **OCR_Pipeline**: The multi-stage text-extraction service combining Google Cloud Vision, TrOCR, and Gemini Vision to convert prescription images into structured data.
- **Extraction_Result**: The structured JSON output of the OCR_Pipeline, containing one or more Drug_Entries.
- **Drug_Entry**: A single medicine line item containing: drug_name, strength, dosage_form, frequency, duration.
- **Normalizer**: The service that maps a Drug_Entry's raw drug_name (brand or handwritten variant) to a canonical generic salt name and a set of known brand variants in the Indian market.
- **Canonical_Drug**: A drug identified by its active salt name and strength, independent of brand.
- **Price_Record**: A single data point containing: platform_id, canonical_drug_id, brand_name, pack_size, mrp_inr, selling_price_inr, in_stock, delivery_eta_hours, affiliate_url, scraped_at.
- **Comparison_Table**: The UI component that displays Price_Records for all platforms side-by-side for a given Drug_Entry.
- **Platform**: One of the seven supported pharmacies: 1mg, PharmEasy, Netmeds, Apollo_247, MedPlus, Amazon_Pharmacy, Flipkart_Health_Plus.
- **Scraper**: A Playwright-based background worker that fetches Price_Records from a Platform.
- **Affiliate_URL**: A deep-link URL containing the partner/affiliate tracking code that opens the selected product on the Platform's website or app.
- **Generic_Suggestion**: An alternative brand with the same active salt and strength as a Drug_Entry, offered at a lower selling price than the cheapest matched brand.
- **User**: An authenticated individual who has created a MedCompare account via Firebase OTP.
- **Family_Profile**: A named sub-profile within a User account, representing one family member; each User may have at most 5 Family_Profiles (including the primary profile).
- **Rx_History**: The list of past Extraction_Results and their associated Price_Records saved under a User or Family_Profile.
- **Reminder**: A scheduled notification tied to a Drug_Entry's frequency and duration, stored per Family_Profile.
- **Schedule_H_Drug**: A medicine regulated under Schedule H of the Drugs and Cosmetics Act, 1940, which requires a valid prescription before sale.
- **Schedule_H1_Drug**: A medicine regulated under Schedule H1, carrying stricter dispensing controls than Schedule H.
- **Drug_DB**: The composite drug reference database comprising OpenFDA data, the Indian Drug Index, and the MedCompare curated dataset of 100,000+ Indian brand names.
- **Cache**: The Redis instance used to store Price_Records for up to 30 minutes to reduce redundant scraping.
- **Task_Queue**: The Celery + Redis job queue that manages asynchronous scraping and extraction tasks.
- **PWA**: Progressive Web App — the MedCompare frontend built with Next.js 14, installable on mobile devices and accessible via browser.

---

## Requirements

---

### Requirement 1: Prescription Capture

**User Story:** As a patient, I want to upload or photograph my prescription so that MedCompare can extract the medicines I need.

#### Acceptance Criteria

1. THE PWA SHALL accept prescription input in JPEG, PNG, HEIC, WebP, and PDF formats with a maximum file size of 20 MB per file and a maximum of 5 files per session.
2. WHEN the user selects the live-capture option, THE PWA SHALL activate the device camera and display a viewfinder within the browser.
3. WHEN a file is selected or captured, THE PWA SHALL display a preview of the image or first page of the PDF before the user confirms submission.
4. WHEN the user confirms submission on a connection of at least 5 Mbps download speed, THE PWA SHALL upload the file to Cloudflare R2 storage and return a secure object URL within 10 seconds.
5. IF the uploaded file exceeds 20 MB, THEN THE PWA SHALL display the error message "File size exceeds 20 MB limit. Please upload a smaller file." and reject the upload.
6. IF the uploaded file format is not in the accepted list, THEN THE PWA SHALL display the error message "Unsupported file type. Please upload a JPEG, PNG, HEIC, WebP, or PDF." and reject the upload.
7. IF the upload to Cloudflare R2 fails due to a network or storage error, THEN THE PWA SHALL display an error message prompting the user to try again, and SHALL NOT proceed to OCR processing.
8. IF the device camera is unavailable or the user denies camera permission, THEN THE PWA SHALL display a message indicating that camera access is unavailable and offer the file-upload option as an alternative.
9. IF a price lookup is attempted without a completed prescription upload, THEN THE PWA SHALL block the request and display a message requiring the user to upload a prescription first, enforcing Schedule H/H1 compliance.
10. THE PWA SHALL display a legal disclaimer stating "MedCompare is a price comparison tool and not a pharmacy or medical advisor. Always consult a licensed pharmacist before purchasing medicines." on the prescription capture screen.

---

### Requirement 2: AI Extraction Pipeline

**User Story:** As a patient, I want MedCompare to automatically read my prescription so that I don't have to type each medicine name manually.

#### Acceptance Criteria

1. WHEN a prescription file URL is available, THE OCR_Pipeline SHALL process the image through Gemini Vision as the primary extractor and return an Extraction_Result within 30 seconds.
2. WHEN Gemini Vision returns a low-confidence result (confidence score below 0.7), THE OCR_Pipeline SHALL classify the script type (printed or handwritten) and re-process the image using Google Cloud Vision for printed text or TrOCR for handwritten text as a fallback.
3. THE OCR_Pipeline SHALL extract zero or more Drug_Entry records from the prescription, each containing drug_name, strength, dosage_form, frequency, and duration.
4. WHEN a field in a Drug_Entry cannot be determined from the prescription, THE OCR_Pipeline SHALL set that field to null and flag it for user review.
5. WHEN extraction is complete, THE PWA SHALL always present the Extraction_Result in an editable review form before proceeding to price lookup, regardless of whether null fields are present.
6. WHEN the user confirms or corrects the Extraction_Result in the review form, THE PWA SHALL proceed to drug normalization and price lookup.
7. IF the OCR_Pipeline fails to extract any Drug_Entry from the prescription, THEN THE PWA SHALL display the message "We could not read your prescription. Please try a clearer image or enter medicines manually." and offer a manual entry form.
8. WHEN a prescription contains at least one legible medicine entry, THE OCR_Pipeline SHALL produce at least one Drug_Entry for that prescription when processing in Hindi or English scripts.
9. THE OCR_Pipeline SHALL return a structured JSON Extraction_Result. THE Pretty_Printer SHALL format the Extraction_Result back into a human-readable summary. FOR ALL valid Extraction_Results, parsing then formatting then parsing SHALL produce an Extraction_Result with field-for-field identical values for all non-null fields (round-trip property).

---

### Requirement 3: Drug Normalization

**User Story:** As a patient, I want MedCompare to recognise both brand names and generic names on my prescription so that I see all relevant products in the comparison.

#### Acceptance Criteria

1. WHEN a Drug_Entry is confirmed by the user, THE Normalizer SHALL map the drug_name to a Canonical_Drug using the Drug_DB within 2 seconds.
2. THE Drug_DB SHALL contain at least 100,000 Indian brand-name-to-generic-salt mappings.
3. WHEN the Normalizer finds an exact or fuzzy match (edit distance ≤ 2) for the drug_name in the Drug_DB, THE Normalizer SHALL return the Canonical_Drug and all known brand variants of that salt and strength. WHEN the Drug_Entry has no strength, THE Normalizer SHALL return all strength variants of the matched Canonical_Drug.
4. WHEN the Normalizer cannot find a match for the drug_name, THE Normalizer SHALL return a no-match result and THE PWA SHALL prompt the user to manually confirm or correct the drug name before proceeding. WHEN the user submits a corrected drug name, THE Normalizer SHALL re-run normalization on the corrected name.
5. THE Normalizer SHALL handle the following defined OCR substitution error pairs during fuzzy matching: "0" for "O", "1" for "l", "l" for "I", "5" for "S", and "8" for "B".
6. THE Normalizer SHALL treat drug names case-insensitively during matching.

---

### Requirement 4: Multi-Platform Price Scraping

**User Story:** As a patient, I want to see up-to-date prices from multiple pharmacies so that I can make an informed purchasing decision.

#### Acceptance Criteria

1. WHEN a Canonical_Drug has no cached Price_Records and is ready for price lookup, THE Scraper SHALL query all 7 Platforms (1mg, PharmEasy, Netmeds, Apollo_247, MedPlus, Amazon_Pharmacy, Flipkart_Health_Plus) in parallel via the Task_Queue.
2. WHEN a scrape job is enqueued, THE Scraper SHALL return Price_Records for all available Platforms within 45 seconds.
3. THE Cache SHALL store Price_Records with a time-to-live of 30 minutes. WHEN a cached Price_Record exists for a Canonical_Drug, THE Scraper SHALL return the cached record without making a new platform request.
4. WHEN a Platform returns no result for a Canonical_Drug, THE Scraper SHALL return a Price_Record with in_stock set to false and selling_price_inr set to null for that Platform.
5. IF a Platform's website is unreachable or returns an HTTP error after 3 retry attempts with a 5-second interval between retries, THEN THE Scraper SHALL mark that Platform as unavailable in the Comparison_Table for that query session and log the failure.
6. THE Scraper SHALL use Amazon PA-API for Amazon_Pharmacy results and the Flipkart Affiliate API for Flipkart_Health_Plus results, and SHALL use Playwright with residential proxies for the remaining 5 Platforms.
7. THE Scraper SHALL extract MRP in INR, selling price in INR, in-stock status, delivery ETA in hours, pack size, and the Affiliate_URL for each Price_Record. WHEN any of these fields is unavailable from the Platform, THE Scraper SHALL set that field to null in the Price_Record.
8. WHILE a scrape job is in progress, THE PWA SHALL display a loading indicator showing which Platforms have returned results and which are still pending.
9. WHEN the 45-second timeout is reached before all Platforms have responded, THE Scraper SHALL return all Price_Records received up to that point and mark non-responding Platforms as unavailable for that session.

---

### Requirement 5: Comparison View

**User Story:** As a patient, I want to see all pharmacy prices in one table so that I can quickly identify the best deal.

#### Acceptance Criteria

1. WHEN all Price_Records for a Drug_Entry are available, THE PWA SHALL render the Comparison_Table displaying platform name, brand name, pack size, MRP (INR), selling price (INR), discount percentage calculated as ((MRP − selling_price) / MRP × 100) rounded to one decimal place, in-stock status, and delivery ETA for each Platform.
2. THE Comparison_Table SHALL default to sorting rows by selling_price_inr ascending. Out-of-stock entries SHALL be placed at the bottom regardless of price. Ties in selling_price_inr SHALL be broken by delivery_eta_hours ascending.
3. THE PWA SHALL allow the user to re-sort the Comparison_Table by selling_price_inr, delivery_eta_hours, or discount_percentage. Rows with null values for the selected sort column SHALL be placed at the bottom.
4. WHEN a prescription contains multiple Drug_Entries, THE PWA SHALL display a separate Comparison_Table for each Drug_Entry and SHALL display a combined total cost row showing the sum of the cheapest in-stock selling_price_inr across all Drug_Entries. IF all Price_Records for a Drug_Entry are out of stock, THEN that Drug_Entry SHALL be excluded from the combined total and labelled "unavailable".
5. THE PWA SHALL highlight the row with the lowest in-stock selling_price_inr in green. THE PWA SHALL highlight the row with the lowest in-stock delivery_eta_hours in blue. WHEN a single row has both the lowest price and the fastest delivery, it SHALL receive both highlights.
6. WHEN a Price_Record has in_stock set to false, THE Comparison_Table SHALL display "Out of Stock" in the selling price cell and in the delivery ETA cell for that row, and SHALL display "—" in the discount percentage cell.
7. WHEN Price_Records are sourced from the Cache, THE Comparison_Table SHALL display the cache timestamp in IST alongside the data with the label "Prices as of [HH:MM IST]".
8. THE PWA SHALL display the Comparison_Table on screens with a minimum width of 320px using a responsive card layout on mobile, such that no horizontal scrolling is required and no content is clipped or overflows its container.

---

### Requirement 6: Generic Substitution Suggestions

**User Story:** As a patient, I want to know if there is a cheaper generic or alternate brand for my medicines so that I can save money.

#### Acceptance Criteria

1. WHEN Price_Records for a Drug_Entry are displayed and at least one Generic_Suggestion exists, THE PWA SHALL show a "Cheaper Alternatives" section listing the Generic_Suggestions for that Drug_Entry.
2. THE PWA SHALL display at most 3 Generic_Suggestions per Drug_Entry, sorted by the minimum in-stock selling_price_inr across all Platforms ascending.
3. A Generic_Suggestion SHALL only be presented when its in-stock selling_price_inr on at least one Platform is lower than the in-stock selling_price_inr of the prescribed brand on that same Platform. Platforms where the prescribed brand's selling_price_inr is null SHALL be excluded from this comparison.
4. WHEN a Generic_Suggestion is selected, THE PWA SHALL display a Comparison_Table for the suggested Canonical_Drug identical in format to Requirement 5.
5. THE PWA SHALL display a disclaimer alongside Generic_Suggestions stating "Generic substitutions should be confirmed with your pharmacist or doctor before purchase."
6. THE PWA SHALL label each Generic_Suggestion with its active salt name and strength so the user can verify equivalence.
7. IF no Generic_Suggestions exist for a Drug_Entry, THEN THE PWA SHALL not display the "Cheaper Alternatives" section for that Drug_Entry.

---

### Requirement 7: Deep Link Out

**User Story:** As a patient, I want to go directly to the pharmacy's app or website with my selected medicine pre-filled so that I can complete my purchase without searching again.

#### Acceptance Criteria

1. WHEN a user selects a Price_Record in the Comparison_Table and confirms the exit dialog, THE PWA SHALL open the Affiliate_URL for that record in a new browser tab.
2. THE Affiliate_URL SHALL be a valid HTTPS URL pointing to the selected product on the selected Platform.
3. THE PWA SHALL include at least one non-empty affiliate or partner tracking parameter in every Affiliate_URL.
4. WHEN a user selects a Price_Record in the Comparison_Table, THE PWA SHALL display the message "You are leaving MedCompare and visiting [Platform name]. MedCompare does not process or guarantee this transaction." in a dismissible dialog before opening the Affiliate_URL.
5. IF the user dismisses or cancels the exit dialog, THEN THE PWA SHALL close the dialog and return to the Comparison_Table without opening any new tab or navigating away.
6. WHEN the Affiliate_URL for a Platform is unavailable or null, THE PWA SHALL disable the deep-link button for that row and display "Link unavailable".
7. THE PWA SHALL never transmit the user's prescription image, personal data, or health information to any Platform via the Affiliate_URL or any redirect parameter.

---

### Requirement 8: User Authentication

**User Story:** As a patient, I want to create an account using my mobile number so that my prescriptions and preferences are saved securely.

#### Acceptance Criteria

1. THE PWA SHALL authenticate users via Firebase Auth using OTP sent to an Indian mobile number (10 digits, starting with 6–9).
2. WHEN a user enters a valid 10-digit Indian mobile number, THE PWA SHALL trigger an OTP delivery via Firebase Auth within 10 seconds.
3. WHEN a user submits a correct 6-digit OTP within 5 minutes of delivery, THE PWA SHALL create an authenticated session valid for 30 days and redirect the user to the home screen.
4. WHEN a user submits an incorrect OTP, THE PWA SHALL display a message indicating the OTP is incorrect and allow up to 3 retry attempts for that mobile number before locking that number's session for 10 minutes.
5. WHEN a user's 30-day session token expires, THE PWA SHALL redirect the user to the login screen and preserve any pending Comparison_Table state in localStorage for recovery after re-authentication.
6. IF Firebase Auth OTP delivery fails, THEN THE PWA SHALL display an error message and allow the user to request a resend, with a maximum of 3 resend attempts per mobile number per hour.
7. WHILE an unauthenticated user has rendered fewer than one Comparison_Table result in the current session, THE PWA SHALL allow the user to continue without an account.
8. IF an unauthenticated user attempts to view a second Comparison_Table result in the same session, THEN THE PWA SHALL display a prompt requiring account creation before proceeding.

---

### Requirement 9: User Account — Saved Rx History

**User Story:** As a patient, I want my past prescriptions and price comparisons to be saved so that I can refer to them later.

#### Acceptance Criteria

1. WHEN a User's Comparison_Table is first rendered, THE PWA SHALL automatically save the prescription file URL, Extraction_Result, and the current Price_Records to the User's Rx_History in PostgreSQL without requiring additional user action.
2. THE PWA SHALL display the Rx_History as a list sorted by most recent first, showing the upload timestamp, number of Drug_Entries, and a thumbnail of the prescription image. WHERE the upload timestamp is unavailable, THE PWA SHALL display the Extraction_Result creation timestamp.
3. WHEN a User selects an Rx_History entry, THE PWA SHALL reload the saved Extraction_Result and trigger a fresh price lookup to display an updated Comparison_Table. IF the fresh price lookup fails, THEN THE PWA SHALL display the saved Price_Records with a stale-data warning.
4. THE PWA SHALL retain Rx_History entries for a minimum of 12 months from the date of creation.
5. WHEN a User requests deletion of an Rx_History entry, THE PWA SHALL display a confirmation prompt before proceeding. WHEN the User confirms, THE PWA SHALL remove the entry from PostgreSQL and from Cloudflare R2 storage permanently.
6. WHEN an unauthenticated request is made to any Rx_History endpoint, THE Backend_API SHALL return HTTP 401 and SHALL NOT return any Rx_History data.

---

### Requirement 10: Family Profiles

**User Story:** As a caregiver, I want to manage medicine comparisons for my family members under one account so that I can track prescriptions for everyone.

#### Acceptance Criteria

1. THE PWA SHALL allow a User to have up to 5 Family_Profiles within a single account, including the primary profile that is auto-created at registration and counts as 1 of 5.
2. WHEN a User creates a Family_Profile, THE PWA SHALL require a profile name that is 1–50 characters and unique within the User's account, and an optional date of birth.
3. WHEN a User selects a Family_Profile before uploading a prescription, THE PWA SHALL associate the resulting Rx_History entry and Reminders with that Family_Profile.
4. IF a User uploads a prescription without selecting a Family_Profile, THEN THE PWA SHALL associate the resulting Rx_History entry and Reminders with the User's primary profile.
5. IF a User attempts to create a 6th Family_Profile, THEN THE PWA SHALL display the message "You have reached the maximum of 5 family profiles." and reject the creation.
6. WHEN a User renames a Family_Profile, THE PWA SHALL require the new name to be 1–50 characters and unique within the User's account.
7. WHEN a User requests deletion of a non-primary Family_Profile, THE PWA SHALL display a confirmation prompt warning that all associated Rx_History entries and Reminders will be permanently deleted. WHEN the User confirms, THE PWA SHALL permanently delete the Family_Profile and all associated data.
8. WHEN a Family_Profile is deleted, THE PWA SHALL permanently delete all Rx_History entries and Reminders associated with that Family_Profile.
9. THE PWA SHALL prevent deletion of the primary Family_Profile and SHALL not display a delete option for it.

---

### Requirement 11: Medicine Reminders

**User Story:** As a patient, I want to set reminders for my medicines so that I don't miss a dose.

#### Acceptance Criteria

1. WHEN an Extraction_Result contains a Drug_Entry with non-null frequency and duration, THE PWA SHALL offer the user an option to set a Reminder for that Drug_Entry.
2. WHEN a Reminder is set, THE PWA SHALL require the user to specify a start time (hour and minute in 24-hour format) and SHALL schedule browser push notifications at the parsed frequency intervals starting from that time for the duration of the course.
3. THE PWA SHALL allow the user to edit the reminder start time, frequency, and end date for any active Reminder.
4. THE PWA SHALL allow the user to manually deactivate any active Reminder before its end date. WHEN a Reminder is manually deactivated, THE PWA SHALL cancel all scheduled notifications for that Reminder.
5. WHEN a Reminder's end date is reached, THE PWA SHALL automatically deactivate the Reminder and mark it as completed in the associated Family_Profile's Rx_History entry.
6. WHEN a user attempts to set a Reminder and push notification permission has not been granted, THE PWA SHALL request push notification permission from the browser at that point. IF the user denies permission, THEN THE PWA SHALL inform the user that reminders require notification permission and SHALL NOT create the Reminder.

---

### Requirement 12: PWA and Mobile Web

**User Story:** As a patient using a mobile browser, I want MedCompare to work like a native app so that I can use it easily on my phone.

#### Acceptance Criteria

1. THE PWA SHALL include a valid Web App Manifest with at least one 192×192 pixel icon and one 512×512 pixel icon, a theme colour, and display mode set to "standalone".
2. WHEN a user revisits the PWA on a connection throttled to ≤1.6 Mbps downlink / 400 kbps uplink (Lighthouse 3G profile), THE service worker SHALL serve the cached application shell such that the home screen and prescription upload UI are interactive within 3 seconds.
3. THE PWA SHALL achieve a Lighthouse Performance score of 70 or above when audited using the Moto G4 reference device profile in Lighthouse.
4. WHEN the browser's installability criteria are met, THE PWA SHALL trigger the "Add to Home Screen" prompt on Android Chrome and iOS Safari.
5. THE PWA SHALL render all UI components correctly on viewport widths between 320px and 1440px such that no horizontal scrolling is required, no content is clipped or overflows its container, and all interactive elements are visible and reachable.
6. THE PWA SHALL pass WCAG 2.1 Level AA automated checks for colour contrast on all primary screens (prescription upload, comparison table, Rx history), and all interactive elements on those screens SHALL be operable via keyboard alone with a visible focus indicator.

---

### Requirement 13: Legal Compliance and Data Privacy

**User Story:** As a patient, I want to trust that MedCompare handles my prescription data safely and complies with Indian regulations.

#### Acceptance Criteria

1. THE PWA SHALL display a Terms of Service and Privacy Policy link in the footer of every page.
2. THE PWA SHALL display the disclaimer "MedCompare is a price comparison service only and does not sell, dispense, or advise on medicines. Consult a licensed pharmacist or doctor before purchasing." on the Comparison_Table screen.
3. THE PWA SHALL transmit all prescription images and personal data exclusively over HTTPS.
4. THE PWA SHALL store prescription images in Cloudflare R2 with server-side encryption at rest.
5. THE Backend_API SHALL serve prescription images only via time-limited signed proxy URLs and SHALL NOT expose direct Cloudflare R2 storage URLs to any client.
6. WHEN a user registers an account, THE PWA SHALL present a mandatory unchecked consent checkbox that the user must check before account creation can proceed, satisfying the explicit consent requirement of the Information Technology Act, 2000 and the DPDP Act, 2023.
7. WHEN a User submits a "Delete My Account" request, THE PWA SHALL display a confirmation prompt. WHEN confirmed, THE Backend_API SHALL purge (not anonymise or soft-delete) all User data, Family_Profiles, Rx_History entries, and prescription images from storage within 30 days.
8. WHEN THE Scraper queries a Platform for prices, THE Scraper SHALL transmit only the canonical medicine name and SHALL NOT include any User data, prescription content, or personal health information in the request.

---

### Requirement 14: Error Handling and Observability

**User Story:** As a developer operating MedCompare, I want errors to be captured and reported so that I can identify and fix production issues quickly.

#### Acceptance Criteria

1. WHEN an unhandled exception or a 5xx HTTP response occurs in the Backend_API, THE Backend_API SHALL log the error at ERROR severity to Sentry within 5 seconds, including the request path, error message, and stack trace.
2. WHEN an unhandled JavaScript exception occurs in the PWA, THE PWA SHALL report the exception to Sentry along with a breadcrumb trail of the last 10 user actions, where a user action is defined as a page navigation, button click, or form submission.
3. WHEN any of the following user actions occurs — prescription_uploaded, extraction_completed, comparison_viewed, deep_link_clicked, account_created — THE Backend_API SHALL emit the corresponding analytics event to PostHog within 5 seconds.
4. WHEN the Task_Queue has more than 50 pending scraping jobs, THE Backend_API SHALL return HTTP 429 to new comparison requests with an error message indicating the service is temporarily busy and the request should be retried.
5. IF the Drug_DB service is unavailable, THEN THE Backend_API SHALL return HTTP 503 with an error message indicating the drug database is temporarily unavailable and SHALL NOT proceed with normalization.

---

### Requirement 15: 20-Day Implementation Plan

**User Story:** As the development team, we need a realistic phased delivery plan so that the MVP is production-ready within 20 working days.

#### Acceptance Criteria

1. THE Development_Plan SHALL organise work into 5 phases, each spanning 4 days, covering: infrastructure setup, extraction pipeline, scraping engine, frontend comparison UI, and polish/launch.
2. THE Development_Plan SHALL identify the following as critical-path items (deliverables whose late completion directly delays staging deployment): OCR_Pipeline integration, Scraper implementation for at least 5 Platforms, Comparison_Table rendering, and Firebase Auth.
3. THE Development_Plan for Days 1–4 SHALL include: repository setup, Docker Compose for local dev, PostgreSQL schema migration, Redis and Celery configuration, Firebase Auth integration, and Cloudflare R2 bucket setup.
4. THE Development_Plan for Days 5–8 SHALL include: Gemini Vision API integration, Google Cloud Vision fallback, TrOCR handwriting model deployment, Drug_DB ingestion pipeline (OpenFDA + Indian Drug Index + curated CSV), and Normalizer service.
5. THE Development_Plan for Days 9–12 SHALL include: Playwright Scraper workers for 1mg, PharmEasy, Netmeds, Apollo_247, and MedPlus; Amazon PA-API integration; Flipkart Affiliate API integration; and Cache layer implementation with a minimum TTL of 60 minutes per drug per platform.
6. THE Development_Plan for Days 13–16 SHALL include: Next.js PWA scaffold, Comparison_Table component, prescription upload UI with camera capture support on mobile browsers, Extraction_Result review form, deep-link UI with confirmation dialog, and Generic_Suggestion component.
7. THE Development_Plan for Days 17–20 SHALL include: User account pages (Rx_History, Family_Profiles, Reminders), PWA manifest and service worker, Sentry and PostHog integration, achieving a minimum Lighthouse score of 90 for Performance, Accessibility, and Best Practices categories on mobile, legal disclaimer pages, and staging deployment to Vercel and Railway/Render.
