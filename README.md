# TrustLens AI

A lightweight Express, EJS, and vanilla JavaScript scam-awareness prototype.

## Run locally

Requirements: Node.js 20.9+ (a current LTS release is recommended) and npm.

```bash
npm ci
npm run dev
```

Open http://localhost:3000. `npm start` runs the same server. The default port is
3000; optionally copy `.env.example` to `.env` and set `PORT` to change it.
No API key or database is required for the current prototype.

## Current analysis mode

Analysis uses **rule-based heuristics, not Gemma AI**. The frontend explicitly
labels this mode and explains that an assessment cannot prove safety or fraud.
The existing Gemma-compatible HTTP adapter is used only when both
`GEMMA_API_KEY` and `GEMMA_API_URL` are set. Its endpoint must accept JSON
`{ "message": "..." }` and return the analysis contract; this is not a universal
vendor-specific Gemma API client. Provider responses are validated and known
legacy field names/envelopes are normalized before reaching the browser.

A configured provider failure returns a safe 503 by default. Rule-based fallback
is used only when `GEMMA_FALLBACK_ENABLED=true`, and is explicitly disclosed in
`uncertainty`. Leaving the provider unconfigured selects the existing local
rule-based engine; it never claims Gemma analysis.
Mock samples are separate, explicitly labeled UI demos and are never used as
fallbacks when a real API request fails.

## Project structure

- `server.js`: Express setup, EJS homepage, public assets, and safe errors.
- `routes/api.js`: analysis route; delegates to validation and the service.
- `middleware/validateMessage.js`: validates and trims incoming messages.
- `services/gemmaService.js`: current rule-based placeholder.
- `views/`: EJS homepage and shared navigation/footer partials.
- `public/`: CSS and browser JavaScript.
- `tests/api.test.js`: Jest/Supertest integration tests.

## API contract

`POST /api/analyze` accepts JSON `{ "message": "text to check" }` with 1–5,000
characters after trimming. JSON request bodies are capped at 64 KB to accommodate
UTF-8 and JSON escaping. Successful responses have these top-level fields:

```json
{
  "riskLevel": "high concern",
  "summary": "The message contains multiple potential scam indicators.",
  "indicators": [
    {
      "type": "OTP request",
      "evidence": "OTP",
      "explanation": "Requests sensitive authentication information."
    }
  ],
  "recommendedActions": ["Verify the claim using official channels."],
  "uncertainty": "The sender's identity cannot be verified from this text alone.",
  "analysisMode": "rule-based"
}
```

Risk categories are `high concern`, `needs verification`, and `unclear`.
Errors use appropriate HTTP status codes and `{ "success": false, "error": "..." }`.
The browser validates successful responses before displaying their text safely.

## Verification

```bash
npm test -- --runInBand
node --check server.js
node --check routes/api.js
node --check middleware/validateMessage.js
node --check services/gemmaService.js
node --check public/js/main.js
git diff --check
```

For a manual check, submit a message mentioning an account being blocked and an
OTP. Confirm the results say **Rule-based prototype — not Gemma AI analysis**.
Also test whitespace, the 5,000-character limit, mobile navigation, and keyboard
focus. Use network throttling to inspect the skeleton; blocking `/api/analyze`
should show an error without mock results.

Never commit `.env` or real API keys. Remove personal information before testing.
The application does not store messages or log request bodies. Authentication, feedback storage, and a vendor-specific Gemma SDK integration are not implemented.


## Screenshot analysis

`POST /api/analyze-image` accepts `multipart/form-data`, exactly one file under
`image`. Supported actual formats are PNG, JPEG, and WebP, up to 5 MB
(5,242,880 bytes), 12 megapixels, and 10,000 pixels on either axis. Animated
images, SVG, and files that cannot be fully decoded are rejected. Filenames and
client MIME declarations are not trusted for server-side validation.

The server decodes and normalizes the image with Sharp, then reads English text
with local Tesseract.js OCR. Extracted text is passed directly to the existing
rule-based analysis service. The response keeps the same six fields, with
`analysisMode: "ocr + rule-based"` by default (or `"ocr + gemma-4"` when the
configured adapter actually succeeds), plus an OCR limitation in `uncertainty`. Neither the full extracted text nor the image is returned.
This is **not Gemma analysis**.

English language data is included in the `@tesseract.js-data/eng` npm package.
`npm ci` installs it together with the OCR engine. There is no startup model
or runtime CDN download and no OCR credential to configure. OCR runs only when
an image-analysis request arrives. The browser enables submission after the
server reports the local language data is available and the preview decodes.
No upload occurs when a file is selected.

Image buffers and OCR text are held only in memory. The multipart handler has
no disk storage, normalized images have metadata removed, and each OCR worker
is terminated after its request. Uploads are never placed in `public/`.
Responses have `Cache-Control: no-store`; private file names, pixels, and text
are not logged. The browser retains the selected image only for preview/retry
until removal or leaving the page. Only explicit Analyze submits it.

Limits per Node process:

- 10 image requests per IP per minute, including invalid requests.
- At most 2 simultaneous multipart uploads and 1 decoding/OCR job; busy clients
  receive 429 instead of being queued.
- A 10-second decoding limit and 45-second OCR deadline, with worker cleanup
  on client disconnect. The browser allows 65 seconds for an image request.
- Up to 20,000 extracted characters; longer images require cropping rather
  than silently discarding text.

Unreadable/low-quality English text returns 422. OCR failure returns a safe
error; it never triggers mock results. Small text, blur, mixed languages, and
complex layouts may reduce accuracy. OCR confidence is used only to reject
unreadable text, never displayed as a scam probability. Verify the original
image and important requests independently.

The IP rate limit is in memory and resets on restart. Multiple server processes
would need a shared limiter. Reverse-proxy deployments must configure Express
`trust proxy` for their known proxy topology before relying on per-client IP
limits; do not enable blanket trust.

Run all deterministic tests (OCR is mocked at the engine boundary):

```bash
npm test -- --runInBand
```

Run the separate real OCR checks without mocks:

```bash
RUN_REAL_OCR=1 npm test -- --runInBand tests/ocr.real.test.js
```

`tests/fixtures/message-screenshot.png` is a generated, non-private test image.
For a manual real upload, start the app, choose Upload Screenshot, select that
fixture, and click Analyze Screenshot. Expect High Concern, an OTP indicator,
and a visible **Local OCR + rule-based prototype — not Gemma AI analysis** label.


## Analysis response regression

Successful text and image responses expose the six top-level fields documented
above. In particular, `uncertainty` is explanatory text, not a numeric score or
fraud probability. Empty indicator arrays are valid. Unsupported provider
findings are rejected rather than fabricated; quoted evidence must occur in the
submitted message. Legacy numeric provider uncertainty is described as an
unverified numeric measure, not presented as a probability.

Transaction language and protective instructions (such as forwarding an SMS to
block an unrecognized transaction) are contextual patterns, not proof of fraud.
The rules recommend independently checking official bank channels rather than
trusting or condemning the embedded contact details.

Text analysis is limited to 10 POST requests per IP per minute, independently of
the screenshot limiter. Both use process-local memory stores.
