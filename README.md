# TrustLens AI

A lightweight Express, EJS, and vanilla JavaScript scam-awareness prototype.

## Run locally

Requirements: Node.js LTS and npm.

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
The optional Gemma key in `.env.example` is not used by the current service.
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
The application does not store messages or log request bodies. Screenshot
analysis, authentication, feedback storage, and provider-specific Gemma
integration are not implemented.
