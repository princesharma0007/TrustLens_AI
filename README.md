# TrustLens_AI

A beginner-friendly Node.js + Express + EJS MVC scaffold for a digital scam-awareness project.

## Included

- MVC separation: routes, controllers, views, and services
- A working text-analysis demo using simple rule-based checks
- JSON API: `POST /api/analyze`
- Basic Helmet security headers, JSON size limits, and rate limiting
- Feedback model and optional MongoDB connection helper for future work
- Multer upload middleware scaffold for a future screenshot feature
- A placeholder for provider-specific Gemma 4 integration

## Requirements

- Node.js (LTS recommended)
- npm

## Run locally

1. Extract this folder and open a terminal inside it.
2. Install dependencies:

   ```bash
   npm install
   ```

3. Copy `.env.example` to `.env`.
4. Start the development server:

   ```bash
   npm run dev
   ```

   Or use `npm start`.

5. Open `http://localhost:3000`.

## Current status

The message analysis is **rule-based prototype logic**, not Gemma 4. The app explicitly labels this in its results. The Gemma service is a placeholder because API request formats depend on the runtime/provider you select.

## Suggested next tasks

1. Agree on the JSON response contract as a team.
2. Select a Gemma 4 runtime and implement `services/gemmaService.js` using its current documentation.
3. Validate model output before showing it to users.
4. Add screenshot processing only after choosing OCR or a compatible multimodal model.
5. Add feedback endpoints and connect the optional MongoDB model if needed.
6. Test false positives, missed warning signs, privacy handling, and malformed inputs.

## Important safety notes

- Do not commit `.env` or API keys.
- Do not store full user messages by default.
- Never claim a message is definitively fraudulent based only on an AI response.
- Before production use, verify uploaded file contents, delete temporary files, and add robust error handling.
- The upload middleware is scaffolding only; screenshot upload is not connected to the UI yet.
