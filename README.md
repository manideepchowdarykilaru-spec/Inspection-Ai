# LM-Inspect AI

**Legal Metrology Packaged Commodity Compliance System** — an AI-assisted screening and decision-support platform for Legal Metrology enforcement officers, built for the Smart India Hackathon.

The system scans a packaged commodity, extracts the declarations printed on its label, validates them against a configurable catalogue of Legal Metrology (Packaged Commodities) Rules, 2011, highlights potential non-compliances on the package image with supporting evidence, and compiles a departmental inspection report.

> **Positioning.** LM-Inspect AI performs *screening*. Every result is presented as a potential non-compliance requiring official verification. Final determination under the Legal Metrology Act, 2009 rests with the authorised official following physical verification where required. This distinction is enforced throughout the UI copy, the score card, the findings panel and the generated report.

---

## 1. Running it locally

Requires **Node 18+** and a running **PostgreSQL** server (developed against PostgreSQL 18 on Node 22).

```bash
npm install
```

Copy `.env.example` to `.env` and set your PostgreSQL password. If you do not know it, reset it: stop the server, set the two local `host` lines in `C:Program FilesPostgreSQL<version>datapg_hba.conf` to `trust`, restart, run `ALTER USER postgres WITH PASSWORD '…';`, then set `pg_hba.conf` back to `scram-sha-256` and restart again.

```bash
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@127.0.0.1:5432/lm_inspect
```

Create and seed the database:

```bash
npm run db:setup
```

Start the API and the interface together:

```bash
npm run dev
```

Open <http://localhost:5173>. The API runs on port 4000 and Vite proxies `/api` to it.

| Script | What it does |
|---|---|
| `npm run dev` | API (tsx watch) + Vite, concurrently |
| `npm run dev:mobile` | Same, but HTTPS so the camera works on a phone over the LAN |
| `npm run db:setup` | Create the database, apply the schema, seed if empty |
| `npm run db:reset` | Truncate and re-seed the demonstration corpus |
| `npm run ocr:smoke` | Render a test label, run OCR over it and print the extraction + score |
| `npm run ocr:bench` | Build adversarial variants and print the robustness table |
| `npm run typecheck` | Type-check the frontend and the backend projects |
| `npm start` | Production server: the API also serves `frontend/dist` on one origin |
| `npm run build` | Type-check and build the production bundle into `frontend/dist` |

**Camera capture** is available from **New Inspection → Capture with camera** and from **Evidence → Capture**. It opens a live `getUserMedia` preview with a framing guide, multi-shot capture, front/rear switching and per-shot discard. Frames are kept at up to a 2600 px longest edge — OCR needs the pixels — and stored as JPEG evidence; the dialog shows the live sensor resolution and warns below 1280 px. Each shot is measured for sharpness the moment it is taken (variance of the Laplacian) and flagged **blurry** in the strip, so a shaken frame is retaken before it reaches the recogniser. Browsers only expose the camera in a secure context — `localhost` qualifies, a plain-http LAN address does not, which is what `npm run dev:mobile` is for. Permission denied, no device, camera busy and insecure context each get their own message plus a file-upload fallback.

## 2. Demo credentials

Shown on the login screen; click any row to fill the form.

| Role | Official ID | Password | What changes |
|---|---|---|---|
| Inspector | `LM-TS-INS-1042` | `inspect@2026` | Scan, verify findings, generate reports, regional analytics |
| Supervisor | `LM-TS-SUP-2008` | `review@2026` | + close inspections, state-level analytics |
| Administrator | `LM-TS-ADM-3001` | `admin@2026` | + user management, compliance rule configuration |

The sidebar, the header actions and the route guards all respond to the signed-in role.

---

## 3. The demonstration flow

```
Landing → Login → Dashboard → New Inspection → AI scan → OCR extraction →
Declaration detection → Rule validation → Violation highlighting →
Screening score → Officer review → Generate report → Saved to history
```

1. **Login** with the Inspector account.
2. **Dashboard** — KPIs, compliance trend, top recurring violations, recent inspections.
3. **New Inspection** — drop package images (or leave empty to use a demonstration sample), pick one of four samples, record the place of inspection, press **Start AI Compliance Scan**.
4. **Image Analysis Workspace** — the seven pipeline stages run visibly; declarations appear as they are classified; detection boxes are drawn on the label.
5. Press **Save inspection & review findings** — the inspection is written to history and the detail screen opens.
6. **Compliance Results** tab — annotated package, structured declarations, screening score with its four-part breakdown, particulars, audit trail.
7. **Findings** tab — each potential violation with severity, rule reference, detected value, *why it was flagged*, recommended verification and confidence. Press **Show on label** to zoom the image to that region. Mark verified / dismiss / add a note — every action is written to the audit trail.
8. **Generate Report** — a departmental inspection report with print-to-PDF and editable (.doc) export.

**The four demonstration samples produce genuinely different outcomes**, because the score is computed by the rule engine rather than hard-coded:

| Sample | Score | Outcome | Why |
|---|---|---|---|
| Packaged Basmati Rice | 96 | Compliant | Every mandatory declaration present and well formed; one low-severity print-contrast advisory |
| Packaged Biscuits | ~80 | Needs Manual Review | Consumer care lacks an e-mail; MRP lacks the tax qualifier; date print height below threshold |
| Imported Chocolate | ~85 | Needs Manual Review | Import compliance rule triggers; importer address incomplete and faintly printed; unit symbol case |
| Packaged Spice Blend | ~47 | Potential Non-Compliance | Consumer care absent (high severity), malformed MRP, non-SI unit, two declarations below print-height threshold |

---

## 4. Project structure

The repository is split into the browser application, the API, and the code both of them import.

```
frontend/                 React SPA (Vite)
  index.html, public/
  vite.config.ts          root pinned to this folder; aliases @ → src, @shared → ../shared
  tailwind.config.js, postcss.config.js, tsconfig.json
  scripts/dev-https.mjs   HTTPS dev server for on-device camera testing
  src/
    components/
      charts/             ChartCard, shared palette, tooltip, axis presets
      compliance/         ComplianceScore, ImageAnnotator, DeclarationPanel,
                          RuleValidationTable, ReadabilityPanel, ViolationCard,
                          ScanProgress, InspectionTimeline
      inspection/         UploadZone, CameraCapture, EvidenceGrid
      layout/             Sidebar, Header, GlobalSearch, RequireCapability, DataGate
      ui/                 Button, Card, Badge, Form, DataTable, Modal, KpiCard, EmptyState
    context/              AuthContext, ToastContext
    hooks/                useDatabase, useMediaQuery
    layouts/              AppLayout (chrome, guards, responsive shell)
    lib/utils.ts          cn(), file download; re-exports shared/lib/utils
    pages/                Landing, Login, Dashboard, NewInspection, AnalysisWorkspace,
                          InspectionDetail, InspectionHistory, ProductRepository,
                          ProductDetail, Violations, Reports, ReportDetail, Analytics,
                          EvidenceGallery, Notifications, UserManagement,
                          RuleConfiguration, Settings, TextExtraction
    services/             api (HTTP client), storage (in-memory cache + write-through),
                          complianceService (scan runner), inspectionService,
                          productService, reportService, analyticsService,
                          notificationService, ruleService, authService,
                          imageService, scanIdentity

backend/                  Express API
  tsconfig.json           alias @shared → ../shared
  src/
    index.ts              routes: scan, ocr/text, bootstrap, CRUD, admin reset
    db/                   pool, schema.sql, repo (row ⇄ domain mapping), seed
    ocr/                  preprocess (orientation, PCA grey, polarity, denoise,
                          flatten, perspective, deskew, Sauvola, upscale, refocus),
                          Tesseract worker, layout segmentation, field extraction,
                          contrast measurement, multi-image merge
  scripts/
    db-setup.ts           create + migrate + seed
    ocr-smoke-test.ts     end-to-end OCR → rules → score on a generated label
    ocr-bench.ts          robustness bench over adversarial label variants
    make-test-label.mjs, make-photo-sim.mjs, make-webcam-sim.mjs,
    make-test-variants.mjs   rotated / inverted / shadow / small / noisy /
                          combined / sideways-red / perspective / coloured

shared/                   Imported by both sides through @shared/*
  types.ts                complete domain model + OCR request/response contract
  data/                   rules.ts (rule catalogue), declarations.ts (catalogue of
                          the twelve declarations), demoProducts.ts (demo corpus),
                          mockData.ts (users, seeds, analytics), labelImages.ts,
                          caseFactory.ts, seedCorpus.ts
  rules/ruleEngine.ts     one validator per rule, scoring, status, findings
  ocr/demoOcr.ts          declaration builders for the vector demo labels
  pipeline.ts             stage list, PipelineResult, evaluateCase, buildInspection
  lib/                    format.ts, utils.ts (no DOM dependency)
```

Each folder has its own `tsconfig.json`; the root one only references the three. All npm scripts run from the repository root.

Stack: React 18 · TypeScript · Vite · Tailwind CSS · React Router · Recharts · React Hook Form · Lucide · Express · PostgreSQL (`pg`) · Tesseract.js · Jimp.

---

## 5. How scanning works

There are two paths, and the interface says which one ran.

**Uploaded or captured photographs are read by real OCR.** `POST /api/scan` sends the image to the Express server, which runs **Tesseract** (`tesseract.js`) over the pixels and then extracts declarations from the result:

1. **Layout segmentation** (`backend/src/ocr/segments.ts`) — Tesseract returns one "line" per horizontal band, which on a two-column label merges unrelated declarations into `NET QUANTITY  MAXIMUM RETAIL PRICE`. Splitting each line at large horizontal gaps recovers the columns, which is what makes caption→value association work on real packages.
2. **Field extraction** (`backend/src/ocr/extract.ts`) — each declaration is located by caption keywords and read either inline or from the segment directly below it in the same column, with pattern-only fallbacks for labels that print a value without a caption. Twelve declarations are tracked.
3. **Evidence regions are the actual pixels** — every hit keeps the word boxes it came from, so the annotation overlay, click-to-highlight and readability metrics all describe *that* image.
4. **Contrast is measured, not assumed** (`backend/src/ocr/imageMetrics.ts`) — the WCAG contrast ratio is computed per word box and reduced to a median. Measuring over the union box of a multi-line block would average in the whitespace and under-report a crisp address block as ~5:1 instead of ~20:1.

**Print height is only reported when the scale is known.** A photograph carries no inherent physical scale. If the inspector records the panel width in millimetres on the New Inspection form, height is reported in mm and the Second Schedule threshold is applied; if not, `scaleKnown` is false, the panel shows pixels with "no scale", and rule `LMPC-RDB-01` returns **Needs Review** stating that print height cannot be derived from the image — instead of asserting a breach it cannot substantiate.

**The four demonstration samples** use the vector label corpus rather than OCR, so the walkthrough is fast and deterministic. Those labels are rendered at a known DPI, so their scale is genuine.

### Preprocessing — what the recogniser is actually shown

A package photograph defeats OCR in predictable ways, and each one is handled before any recognition runs (`backend/src/ocr/preprocess.ts`). The photograph is decoded once and shared by every stage; all pixel work happens on a single grey plane, and Jimp only decodes and encodes.

| Obstacle | Stage | How |
|---|---|---|
| Carton photographed on its side | **Orientation** | Each of the four 90° rotations is tried on a small copy; the one yielding the most confident words wins. An upright image is accepted immediately, so it costs almost nothing in the common case |
| Print and panel of similar brightness but different hue (cream on red, blue on green) | **Colour projection** | The grey plane is the principal component of the label's RGB pixels rather than plain luminance, when that separates ink from background at least 1.3× better. Computed on the label crop only, so a busy background cannot steer it |
| Light print on a dark pouch or a red panel | **Polarity** | Median luminance below 112 → image inverted so Tesseract sees dark ink on paper |
| Sensor speckle, JPEG artefacts | **Denoise** | 3×3 median filter — removes grain without eroding strokes |
| Shadow or glare across the panel | **Flatten illumination** | Divide by the local mean (integral-image window ≈ 1/12 of the short edge), then a 1st–99th percentile contrast stretch |
| Panel photographed off-axis (keystoned) | **Perspective** | Sobel edges → Hough lines → the four strongest lines bounding the ink region → homography → bilinear warp to a flat rectangle. Only applied when the quadrilateral is sane; the keystone removed is reported |
| Camera not square to the label | **Deskew** | Row-projection variance search over ±12° in 0.5° steps; the angle that makes the text lines band most sharply is the tilt, and the image is rotated back |
| Uneven exposure defeating one global threshold | **Sauvola binarisation** | Adaptive threshold that follows the local mean and standard deviation, so lit and shadowed regions binarise on their own terms |
| Small print | **Upscale** | Bilinear up to ×3 toward a 2400 px long edge, with an unsharp mask on the grey variant |
| Label is a fraction of the frame | **Refocus** | Ink-density bounds locate the printed panel *before* OCR; the crop is re-processed and read at full recogniser resolution |

Captions and values on real cartons are often printed in different orientations — "Net Quantity:" running one way, "300g" another — so the extractor no longer depends on captions: dates fall back to chronological order (earliest = packed, latest = expiry), the price to the largest amount that is not a per-unit figure, the quantity to the largest total, and the manufacturer to the first corporate-entity line that is not the consumer-care block.

Two variants come out — lighting-flattened grey and Sauvola-binarised — because neither wins on every package. Both are recognised; the read that locates more declarations with more confidence is kept. If it is still thin, sparse-text and single-block segmentation are tried on the winning variant.

Every stage is an exact geometric transform (`toSourceBox`), so a word box in recogniser space maps back through pad → upscale → deskew → perspective → quarter turns → downscale → crop onto the original photograph. That is what lets the interface draw boxes on *your* picture and measure contrast from *your* pixels.

**Robustness bench** (`npm run ocr:bench`) over the clean label and adversarial variants of it — declarations found out of twelve:

| Image | Before | After |
|---|---|---|
| Clean label | 11/12 | **11/12** |
| Rotated 6° | 5/12 | **11/12** |
| Small label in a 12 MP frame | 3/12 | **11/12** |
| Small + tilted + shadowed | 6/12 | **10/12** |
| Sideways carton, cream print on red, small in a cluttered frame | 0/12 | **10–11/12** |
| Blue print on a green panel | — | **11/12** |
| Photographed off-axis (perspective) | — | **10/12** |
| Off-axis and coloured | — | **9/12** |
| Inverted (white on black) | — | **11/12** |
| Heavy shadow gradient | — | **11/12** |
| Noise + heavy compression | — | **11/12** |
| 720p webcam captures | 1–3/12 | 1–5/12, flagged POOR |
| **Mean (14 images)** | 7.2/12 | **9.4/12** |

The webcam rows are the honest limit: at 5–8 px of cap height there is nothing for any recogniser to read, so the pipeline says so rather than inventing a result.

### Several panels, one inspection

The mandatory declarations are rarely all on one face — the retail price sits on the front, the manufacturer and consumer-care block on the back, batch and dates on a flap. Every uploaded image is read, one after another (the OCR worker is single-threaded and a 12 MP frame is memory-heavy), and the readings are **merged**: for each of the twelve declarations the most confident reading across the set is kept, with completeness as the tie-break so a full address beats a fragment. A region remembers which image it was read from, so the evidence overlay always draws a box on the photograph it came from; selecting a declaration or a finding switches to that photograph. The workspace rail shows each image's own result (declarations read, quality), and the saved inspection carries an image switcher. Text Extraction reads several images the same way, with a tab per image.

### Seeing what the recogniser saw

**Text Extraction** (sidebar) reads every printed line from a photograph and shows the original and the preprocessed image side by side, with each line's confidence and a slider to filter by it; hovering a line highlights where it came from on the original. The scan workspace has the same view behind **What the OCR saw**. Both list the exact stages that were applied — including the detected tilt and whether the label was refocused.

Run `npm run ocr:smoke` to see the whole chain on a generated test label — it prints the extracted declarations with confidence, contrast and readability, then the rule results and screening score both with and without a scale reference.

## 6. How the rule engine works

`shared/data/rules.ts` holds the catalogue; `shared/rules/ruleEngine.ts` holds one validator per rule id. **No compliance logic lives in a component.**

Each validator receives the extracted declarations plus the rule's own configurable `params` and returns:

```ts
{
  ruleId, ruleName, category, legalReference, declarationKey,
  detectedValue, expectation, status,        // PASS | FAIL | REVIEW | NOT_APPLICABLE
  severity, confidence, explanation, evidenceRegion, weight
}
```

17 rules ship across five categories, covering `PRESENCE`, `FORMAT`, `CONDITIONAL_PRESENCE`, `CROSS_FIELD` and `READABILITY` validation — for example `LMPC-R06-06` (consumer care details), `LMPC-FMT-01` (MRP declaration format), `LMPC-IMP-01` (importer details, which only applies when country of origin is outside India) and `LMPC-RDB-01` (minimum declaration height).

**Scoring.** Weights sum to 100 across four buckets — Mandatory Declarations 45, Formatting 20, Readability 20, Packaging Information 15. `PASS` earns the full weight, `REVIEW` earns half, `FAIL` earns nothing, and `NOT_APPLICABLE` is excluded from both the numerator and the denominator so the bucket renormalises (an Indian-origin package is not penalised for having no importer declaration).

**Status precedence.** A high-severity mandatory failure lands in `NON_COMPLIANT` regardless of the numeric score — a missing consumer-care block cannot be diluted by an otherwise well-printed label. This is visible in the seeded corpus: Nilgiri Dawn tea scores 91 but is non-compliant.

**Findings** are derived from `FAIL` and `REVIEW` results, sorted by severity, with a `REVIEW` never carrying more than medium severity.

Administrators edit weights, severities, activation and validation parameters at **Settings → Compliance Rules**. Changing `minHeightMm` on `LMPC-RDB-01` immediately alters how subsequent scans classify print height — which is the point: when the Rules are amended, the catalogue is updated, not the application.

---

## 7. Architecture as built, and where it goes next

```
React SPA  ──/api──▶  Express (tsx)  ──▶  PostgreSQL
                          │
                          └──▶ Tesseract (tesseract.js) + Jimp
```

The server owns the two things a browser cannot honestly do on its own: OCR over an uploaded photograph, and durable storage. The **rule engine is imported by both sides** from `shared/rules/ruleEngine.ts`, so the client and the server evaluate packages with the same code — there is no second implementation to drift out of step.

The client hydrates its whole working set in one `GET /api/bootstrap` call and holds it in memory, which is what lets every table, chart and counter read synchronously. Each mutation updates the cache, notifies subscribers and persists in the background; a failed write re-hydrates from the server and raises a toast, so the screen cannot disagree with the database for long.

Steps a production deployment would take from here:

| Now | Next |
|---|---|
| Tesseract in-process, synchronous | PaddleOCR PP-OCRv4 in a Celery/RQ worker, jobs polled or pushed over WebSocket |
| Regex + layout heuristics for field extraction | LayoutLMv3 or a fine-tuned token classifier trained on Indian package labels |
| Evidence stored as data URLs in `evidence.data_url` | S3-compatible object storage with signed URLs and server-side encryption |
| Mock `signIn` against a seeded user table | JWT issue/refresh, password hashing, httpOnly refresh cookie |
| Report rendered client-side (print-to-PDF, Word-compatible HTML) | Server-rendered PDF (WeasyPrint) and DOCX (python-docx) with signed download URLs |
| Rule catalogue mutable in place | Versioned rules so an inspection can always be re-read against the rules it was evaluated under |

## 7a. Deploying

The API is a long-running Node process that keeps a Tesseract worker warm and accepts multi-megabyte photo uploads, so it needs a host that runs a persistent server — **Render**, Railway or Fly.io — rather than a serverless platform (Vercel and Netlify functions cap request bodies at 4.5–6 MB and time out at 10–60 s, which a multi-image scan exceeds). GitHub Pages, Netlify and Vercel can host the static `frontend/dist` if a split deployment is preferred.

The simplest layout is one Render web service that runs `npm start`: the API serves the built interface itself, so there is one origin, no CORS and no `VITE_API_URL`. `render.yaml` in the repository root is a blueprint for it. Steps:

1. Create a PostgreSQL database (Render Postgres or Neon) and copy its connection string.
2. Create the web service from the GitHub repository. Build command `npm ci && npm run build`, start command `npm start`, **Starter plan (2 GB)** — OCR over a 12 MP frame does not fit in 512 MB.
3. Set `DATABASE_URL` in the service environment. **Choose the same region as the database**: every query is a network round trip, and a database on another continent turns a 20 ms query into 500 ms.
4. The first start applies the schema and seeds the corpus automatically.

### Why it opens quickly on a phone

- **The working set is served from memory.** `/api/bootstrap` is cached in the API process and rebuilt only after a write, so the response is immediate however far away the database is (6 s → 20 ms against a remote database).
- **Responses are gzipped** — the bootstrap payload is 650 KB of JSON and 49 KB on the wire.
- **The landing and login screens do not wait for data.** Only `/app` is gated on hydration.
- **Each workspace screen is its own chunk.** The entry bundle fell from 390 KB to 153 KB; the 430 KB charting library is fetched only when the dashboard or analytics is opened.
- **Hashed assets are immutable** (cached for a year), `index.html` is revalidated on each visit, and the web font is requested from a `<link>` in the head so it downloads alongside the bundle.

For local development keep `DATABASE_URL` pointed at the local PostgreSQL; developing against a remote database works but every cache rebuild after a save takes several seconds.

## 8. Target production architecture

```
React SPA (this repo)
   │  HTTPS + JWT
   ▼
API Gateway ── FastAPI (Python)
   ├── auth-service        JWT issue/refresh, RBAC, audit log writer
   ├── inspection-service  inspections, violations, evidence links
   ├── rule-service        rule catalogue, versioning, evaluation endpoint
   ├── ocr-worker (async)  Celery/RQ workers, GPU-optional, OpenCV + PaddleOCR
   ├── report-service      PDF (WeasyPrint) + DOCX (python-docx) generation
   └── analytics-service   materialised aggregates for the dashboards
   │
   ├── PostgreSQL          transactional store (schema below)
   ├── Redis               job queue + short-lived caches
   └── S3-compatible store package images and evidence, server-side encrypted
```

Notes for a production deployment: submit scans as asynchronous jobs (the SPA already models the pipeline as stages, so it can poll or subscribe over WebSocket); keep an append-only `audit_log` table; version the rule catalogue so an inspection can always be re-read against the rules it was evaluated under; store evidence checksums at upload time for chain of custody.

---

## 9. Database schema

The live schema is `backend/src/db/schema.sql`. Entities that are queried, filtered and mutated individually are normalised; the analysis payload of an inspection (declarations, rule results, score breakdown) is stored as JSONB because it is an immutable snapshot of what the engine produced at that moment and must not drift when the rule catalogue is later amended.

Outline:

```sql
users(id PK, official_id UNIQUE, name, email, role, designation,
      department, region, phone, status, last_active_at, created_at)

products(id PK, name, brand, category, manufacturer, manufacturer_address,
         importer, country_of_origin, net_quantity, mrp, packed_on,
         best_before, consumer_care, fssai_license, barcode, batch_number,
         primary_image_id FK→evidence, created_at)

inspections(id PK, product_id FK→products, inspector_id FK→users, region,
            location, inspected_at, source, stage, status,
            screening_score, score_breakdown JSONB, remarks,
            ocr_result JSONB, rule_catalogue_version, created_at)

declarations(id PK, inspection_id FK→inspections, declaration_key,
             detected_value, confidence, bbox JSONB, readability JSONB)

compliance_rules(id PK, name, category, legal_reference, description,
                 declaration_key, validation_type, mandatory, severity,
                 weight, active, params JSONB, version,
                 updated_at, updated_by FK→users)

rule_results(id PK, inspection_id FK→inspections, rule_id FK→compliance_rules,
             rule_version, detected_value, expectation, status, severity,
             confidence, explanation, evidence_region JSONB)

violations(id PK, inspection_id FK→inspections, rule_id FK→compliance_rules,
           title, category, severity, detected, explanation,
           recommended_action, confidence, evidence_region JSONB,
           state, officer_note, verified_by FK→users, verified_at)

evidence(id PK, inspection_id FK→inspections, evidence_number, type,
         object_key, description, captured_at,
         uploaded_by FK→users, checksum_sha256)

reports(id PK, inspection_id FK→inspections, generated_by FK→users,
        generated_at, status, format, object_key,
        screening_score, compliance_status, violation_count)

audit_log(id PK, inspection_id FK→inspections, actor_id FK→users,
          action, detail, at, ip_address)       -- append-only

notifications(id PK, user_id FK→users, title, body, priority,
              category, link, read, created_at)
```

Suggested indexes: `inspections(inspected_at DESC)`, `inspections(product_id)`, `inspections(inspector_id, status)`, `violations(rule_id, state)`, `products(brand)`, plus a trigram index on `products(name)` for the global search.

---

## 10. Notes on the prototype

- Data lives in PostgreSQL. The corpus is seeded deterministically by `npm run db:setup`; **Settings → System Preferences → Reset demonstration data** (or `npm run db:reset`) truncates and re-seeds it.
- OCR accuracy has been verified against generated raster labels and adversarial degradations of them (tilt, inversion, shadow, noise, small-in-frame, webcam resolution), not against photographs of physical packages. Orientation handles 90° turns, deskew handles small tilts in the image plane, and perspective rectification handles a flat panel photographed off-axis; there is no dewarping for curved pouches or bottles — that is the next thing worth adding. Every finding is written as requiring official verification for exactly this reason.
- Sample manufacturers, addresses, phone numbers, licence numbers and barcodes are fictitious. No real personal information is used.
- Accessibility: keyboard-navigable tables and dialogs, labelled controls, visible focus rings, `aria-live` toasts, semantic headings, and layouts that reflow from desktop to tablet and phone: the sidebar becomes a drawer below the `lg` breakpoint, the global search drops under the header, wide tables scroll inside their card, the analytics period selector moves into the page on phones, and the camera dialog and scan workspace stack vertically at 375 px. `npm run dev:mobile` serves the app over HTTPS on the LAN so it can be tried on a real phone or tablet with its camera.
