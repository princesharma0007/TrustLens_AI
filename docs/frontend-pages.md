# Frontend page rollout

Phase A updates the homepage, navigation, and shared design tokens. The live text
analyzer, skeleton, results, and local screenshot preview remain on `/`.

Current working destinations:

- `/#home`: homepage and illustrative product preview.
- `/#analyzer`: functioning text analyzer and local screenshot picker.
- `/#how-it-works`: workflow explanation.
- `/#about`: project purpose and current rule-based analysis limitations.

No backend changes are required for Phase A. Express already serves `/`, EJS,
and the public assets, including the new `/css/variables.css`.

## Coordinate with Member 2 for later phases

Only after the corresponding templates and navigation are ready:

| Planned GET route | Template | Phase |
| --- | --- | --- |
| `/analyzer` | `analyzer.ejs` | B |
| `/how-it-works` | `how-it-works.ejs` | D |
| `/about` | `about.ejs` | D |

Keep results on the analyzer during Phase C. Do not add a standalone `/results`
route until the team agrees on a private data-transfer mechanism. Messages and
reports must not be placed in query strings or browser storage by default.

The new `head.ejs` partial accepts an optional escaped `pageTitle`. Design tokens
live in `public/css/variables.css`; `style.css` contains shared component and
homepage styles. The navbar uses root-relative section links so it can be reused
on future pages before their dedicated navigation is introduced.

Screenshot analysis is now available through `POST /api/analyze-image`, multipart
field `image`. Local English OCR feeds the existing text pipeline (local rules by default, or the configured Gemma adapter). The
server passes `imageAnalysisAvailable` into the EJS view; image submission stays
disabled if its language data is missing. Selection itself never uploads.
The shared frontend request/renderer in `main.js` handles both text and image
results; `screenshot.js` owns selection, preview, and explicit Analyze actions.
Reports are associated with their input tab and invalidated on edits/removal.
No report or screenshot is stored in localStorage, sessionStorage, or URLs.

Helmet now permits blob image previews. Images remain browser-local until the
explicit analysis action; no uploaded file is exposed through a public route.
See README.md for limits, setup, and deterministic/real OCR test commands.
