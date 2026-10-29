# Shared analysis, OCR review, and URL intelligence

## Diagnosis

At baseline commit 79268e6dfa7564ac0042027e6ecdecf76b9e6577 both endpoints called
Gemma/rules, but shared no canonical normalization. The rule service examined
only the first URL and had no reputation checks. Full-message relationship rules
could combine an employment announcement with an unrelated payment request.
OCR never enlarged small screenshots, dropped layout information, and the report
allowed inspection but not guided correction. Hindi requests were unrecognized.

Real testing found a further issue: even a large gap could remain inside one
Tesseract block. The layout adapter now preserves block boundaries AND large
vertical gaps between recognized lines. Soft wraps remain inside the same block.
This resolved the failing multi-message regression without breaking wrapped OTPs.

## Architecture and API

Text -> validate -> analysisService.normalizeText -> URL inspection -> Gemma/rules
per separated block -> combine independent findings -> shared frontend report.
Image -> validate/decode in memory -> mild preprocessing -> local English OCR ->
quality gate -> EXACT SAME analysisService -> same frontend report.

NFKC/space normalization applies to instruction text, preserving opaque URL tokens
and their Unicode signals. Single newlines become spaces; blank lines separate
blocks. Up to eight blocks are analyzed independently. Strongest concern wins;
unknown evidence prevents an all-green combined result. Claims are not combined
across boundaries. Same normalized input/configuration/intelligence state gives
the same assessment. Analysis mode and OCR caveats honestly differ by input type.

Six original fields remain. Optional screenshot fields are extractedText,
ocrConfidence, and textExtractionStatus=readable. Extraction failures return 422
with textExtractionStatus=insufficient, a public error, and NO risk category.
Optional urlFindings includes URL, status, reputationStatus, provider, signals,
and a controlled reason code. The same renderer validates and displays them
as text; it never makes links clickable or inserts untrusted HTML.

## OCR and correction

Small screenshots are enlarged at most 2x (bounded to 2000 x 6000), using existing
Sharp. Low-contrast grayscale ranges of 30–119 receive a full-range contrast
stretch. Blank/noisy ranges are not amplified. There is no thresholding, guessed
phone correction, URL expansion, or invented text. All prior image/size/quality,
timeout, cancellation and concurrency gates remain. Average confidence below 45,
empty/too-short output, and invalid confidence yield an extraction error.

Local English Tesseract layout blocks and large gaps (greater than 3 median glyph
heights and 48 pixels) become reviewable boundaries. This is not reliable message-
bubble or sender detection; ambiguous layouts still require review/cropping.
Boundaries can also separate related paragraphs and reduce a finding's severity.

The native Text Extracted from Screenshot disclosure starts collapsed. Its review
button deliberately copies text into the existing editable text form and focuses
that field. Users correct it and explicitly Analyze again. No automatic request
occurs. Extracts over 5000 characters require cropping or copying one message;
there is no truncation. Nothing is persisted in browser storage or to image files.

## URL reputation configuration and privacy

Default: URL_REPUTATION_ENABLED=false; GOOGLE_WEB_RISK_API_KEY empty. Structural
checks still run, with unknown intelligence clearly labelled as not performed.
To opt in, enable Google Web Risk in your Google Cloud project, provision a
restricted server-side key, and put these settings in the local secret environment:

```
URL_REPUTATION_ENABLED=true
GOOGLE_WEB_RISK_API_KEY=<your restricted server-side key>
```

This opts into sending submitted URLs, including paths/queries, to Google; full
messages/images are not sent to Web Risk. Existing explicitly configured Gemma
adapters may receive text. Never commit keys. No actual keys were configured here,
so live reputation and live Gemma inference were NOT verified.

Implementation follows Google's [Lookup API](https://docs.cloud.google.com/web-risk/docs/lookup-api),
[API-key header guidance](https://docs.cloud.google.com/docs/authentication/api-keys-use),
and [positive-match caching](https://docs.cloud.google.com/web-risk/docs/caching).
Only https://webrisk.googleapis.com/v1/uris:search is contacted, with an
x-goog-api-key header, redirect:error, and a 2500ms timeout covering body parsing.
The app never resolves, visits, or follows a submitted URL. Hence there is no
submitted-target HTTP/DNS-rebinding/redirect path into internal resources.
Literal IPs (including mapped/encoded IPs), local/reserved hosts, embedded
credentials and unusual ports are excluded from external reputation lookup.
Private DNS records need no resolution because targets are never contacted.

At most eight lookups per input, 20/minute and two concurrent per process; later
URLs remain explicitly unknown. More than 32 distinct URLs or eight blocks yields
a controlled 422 rather than silent truncation. Positive matches are cached until
the provider's expiry, in a bounded 128-entry memory-only map keyed by SHA-256 of
credential + URL. No raw URLs, keys, images or text are stored in that cache.
Failures and negative results are not cached. Quotas/caches are per process;
multiple deployed instances would require a shared limit policy.

| URL status | Meaning |
| --- | --- |
| known_malicious | Validated configured-provider threat match; high concern |
| no_known_threat | Successful lookup returned no match; not proof of safety |
| suspicious | Shortener, IP, Unicode/punycode, credentials, possible brand/domain deception, or other structural signal |
| unknown | No credentials, skipped/limited check, invalid URL, or unavailable provider |

Structural signals never claim a provider match. Separate reputationStatus retains
no-match/unavailable information even when structural status is suspicious.
Brand/domain and edit-distance checks are heuristic, finite and can flag legitimate
sites; they are not verified domain registries. HTTPS and brand-looking names do
not lower whole-message risk. Any submitted URL warrants at least verification;
strong credentials/payment findings or a threat match remain high concern.

## Classification and measured evaluation

Low concern still requires recognizable routine context and no unresolved risk;
missing keywords alone do not qualify. Existing banking/promotion/credential/
advance-fee rules remain, with selected Hindi credential-request patterns and
protection against mistaking Hindi safety advice for disclosure requests. This
is not general multilingual support; English OCR is unchanged.

Run:

```
node scripts/evaluate.js
RUN_REAL_OCR=1 npm test -- --runInBand
```

Text results: docs/security-evaluation.json; immutable before labels and baseline
commit: tests/fixtures/security-baseline.json. The 26 labelled development cases
include banks, college/personal messages, promotions, KYC, OTP/PIN, fees, unknown
and deceptive URLs, Hindi requests and unrelated blocks. These were used during
development and are NOT a held-out or verified real-world fraud benchmark.

Binary positive means needs verification OR high concern, i.e. review warranted,
NOT confirmed scam. Two expected-unclear cases are excluded from binary metrics;
predicted unclear on a positive case counts as a miss. Binary sample count: 24
(16 review-positive, 8 low-concern). All 26 count for category agreement.

| Metric | Before | After |
| --- | --- | --- |
| TP / FP / FN / TN | 14 / 0 / 2 / 8 | 16 / 0 / 0 / 8 |
| Review precision | 1.0000 | 1.0000 |
| Review recall | 0.8750 | 1.0000 |
| Review F1 | 0.9333 | 1.0000 |
| False-positive rate | 0/8 | 0/8 |
| False-negative rate | 2/16 | 0/16 |
| Exact four-category matches | 23/26 | 26/26 |

The multi-message severity correction is distinct from binary metrics, where both
amber/red count positive. Two Hindi misses explain the recall improvement.
Confirmed-malicious provider behavior is separately tested with explicit stubs;
no fabricated threat-list match is included as live reputation evidence.

OCR results: docs/ocr-evaluation.json. Six real synthetic images cover single
messages, small low-contrast text and multiple messages. Each records original,
legacy-preprocessing extraction, current extraction, fixture-corrected text,
character edit counts, and resulting risk categories. Whitespace-normalized CER
was 0/335 characters both before and after. Thus no character-accuracy improvement
is demonstrated on this small set. Layout/classification parity improved in the
multi-message regression. All six image assessments matched reanalysis of the
extracted text, and fixture-corrected text produced the expected category.

The before OCR pass uses legacy scaling with the same current OCR/layout worker;
it is a preprocessing comparison, not a full historical OCR implementation replay.
Synthetic blank/blurred image errors and deterministic low-confidence injections
exercise extraction gates separately. No sensitive user images or OTPs are logged;
only synthetic test evidence is written by the evaluation tools.

## Remaining limitations

OCR can change digits, punctuation and URLs despite high average confidence.
Layout boundaries are approximate, and screenshots containing chat chrome or
unrelated content may require cropping. Link/shortener/brand heuristics and Hindi
patterns are finite. Missing reputation never establishes safety. A no-match
result can miss new threats, and a forged routine-looking message can be green.
Gemma adapters and threat lists can change or fail. Third-party integration tests
use stubs until credentials permit an explicitly authorized live check.
