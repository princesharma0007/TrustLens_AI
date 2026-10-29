# Screenshot extraction and classification

## Flow and additive API metadata

The multipart image route decodes and normalizes the image in memory, performs
local English Tesseract OCR, validates extraction quality, and passes the trimmed
text directly to the same analysis service used by the text endpoint. It never
visits URLs. No image or extracted text is logged or saved by application code.
The response has Cache-Control: no-store.

The six existing analysis fields are unchanged. Screenshot successes additionally
return `extractedText` (the exact trimmed input to analysis, up to 20,000 characters)
and `ocrConfidence` (Tesseract's 0–100 recognition estimate, not a fraud score).
The frontend accepts these optional fields with type/size validation, preserving
compatibility with older responses that omit them. Text and demo reports hide
the extraction section. The native details/summary section starts collapsed,
works by keyboard, and renders extracted text with textContent and wrapping.
Text stays in the current page/report; it is not persisted in browser storage.
Configured text-model inference may receive extracted text as before; this is
not image understanding. Rule mode stays labeled Local OCR + rule-based.

Empty/nontext output, nonfinite/out-of-range confidence, confidence below 45, or
fewer than three ASCII alphanumeric characters returns an extraction-related 422
before analysis. Existing truncation, image validation, cancellation, concurrency,
and timeout checks remain. Readable but unrecognized context can still be unclear;
it is not promoted to green. Confidence is only a quality gate, not a guarantee
that every word or link was recognized correctly.

## Reproduction and root cause

No original user screenshot was attached. A synthetic retail SMS reproduced the
reported category with real OCR before changes:

```
Retail sale! Up to 60% off.
Shop: bit.ly/SaleDemo
You only have 2 days!
```

OCR confidence was 94 before changes. Text reached classification intact, but
links without http/https/www were not detected and retail promotion was not a
recognized routine context. The result was unclear, with no indicators. The API
was not losing the analyzed text; it simply omitted it from the response.

After changes, a second synthetic image processed through the real multipart API
extracted the same text at confidence 95 and returned needs verification.
A shortened link obscures its destination, and the promotional deadline encourages
quick action. Neither alone proves fraud. Normal advertising can be unsolicited
spam, but consent/sender authenticity cannot be inferred from the text.

URL detection now includes common plain domains and known shortened-link hosts.
No expansion, domain reputation, sender lookup, or verification is performed.
Offer deadlines are explained when combined with promotional links; they do not
force high concern. Link-free retail offers can be low concern only with positive
retail/discount context and no meaningful warning or unresolved sensitive request.
Sensitive instructions can span OCR line breaks; evidence preserves original text.

## Actual synthetic OCR checks

Run `RUN_REAL_OCR=1 npm test -- --runInBand`. Opt-in tests emit synthetic evidence
only; production OCR never logs extracted text.

| Synthetic screenshot | Extracted text | After |
| --- | --- | --- |
| Promotion | Text shown above | needs verification |
| Transaction | Rs. 500 was debited from your account. | low concern |
| College | College announcement: lectures start / tomorrow in Room 204. | low concern |
| Phishing | Share your / OTP to prevent account suspension. | high concern |

Slash denotes a real line break in this table. Recognition estimates were 95–96
in the local run. The existing phishing fixture and blank-image error also run
through actual OCR. A deliberately blurred, low-resolution synthetic screenshot
also returns an extraction-related 422 through the multipart API. API tests separately inject low-confidence, empty and malformed
OCR results to verify deterministic error handling and that classification is not
called. A real degraded-image confidence is machine/image dependent; its exact
score is not hardcoded as a threshold test.

## Limits

These are synthetic regression examples, not an accuracy benchmark. English OCR
can alter domains, numbers and words. Bare-domain suffix/shortener lists are
finite; obfuscated or broken links may remain unrecognized. A legitimate link is
conservatively amber. Forged routine-looking messages can still be low concern.
Inspect the screenshot and extracted text, and use independent official channels.
Gemma network inference was not verified without a configured adapter/credentials.
