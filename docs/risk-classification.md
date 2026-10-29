# Contextual risk classification

Canonical categories and precedence live in services/riskClassification.js.
The rule engine uses bounded phrases and action relationships, not keyword counts,
message length, confidence scores, bank names, amounts, or phone numbers alone.

Current normalization, independent-block handling, selected Hindi patterns, and
optional URL intelligence are documented in [the upgrade guide](analysis-upgrade.md).
The evaluation below records the earlier 16-case milestone; current 26-case
results are in `security-evaluation.json`.

## Criteria

- High concern: a request to disclose/enter credentials; an employment offer paired
  with an upfront fee demand; an upfront-fee demand for a prize/loan or other
  financial benefit; a refund paired with UPI authorization; payment to
  restore account access; or an institutional/KYC link paired with an access threat.
- Needs verification: an unverified link, payment demand, account-access threat,
  account/KYC verification request, or forwarding/protective instruction using
  supplied contact details. These are indicative, not confirmed scams.
- Low concern: positively recognized transaction, college/library announcement,
  friendly personal context, or protective credential advice, AND no detected
  moderate/strong signal or unresolved sensitive-action vocabulary. A lack of
  matches alone never qualifies.
- Unclear: insufficient recognized context, including unsupported languages.

Strong/moderate findings take precedence over routine context. Completed debits
and credits are not payment requests. Protective credential advice is separated
from opposing instructions before analysis. Every finding quotes original input.
PNB-like forwarding instructions remain amber because supplied phone numbers
cannot be authenticated. Simple debit notices and official-channel advice can
be green. No sender/domain/telephone lookup or independent verification occurs.

Gemma adapters retain structured response/evidence validation. Explicit low and
low concern normalize to low concern; unknown values are rejected. Low results
with warning findings or a strong local contradiction are rejected as unavailable
(unless the existing explicit fallback flag permits rule analysis). Other valid
provider findings remain provider output; this is not a provider quality audit.
Failures and malformed results never become green. Rule output remains labeled
rule-based; fallback remains opt-in after a configured provider fails.

## Reproducible development evaluation

Fixture: tests/fixtures/risk-evaluation.json. API tests run every example.
These labels are engineering expectations, not independently verified fraud labels.
They were used during development, so they are not a held-out accuracy estimate.

| Example | Expected | Before | After |
| --- | --- | --- | --- |
| pnb-alert | needs verification | needs verification | needs verification |
| simple-debit | low concern | unclear | low concern |
| protective-alert | low concern | unclear | low concern |
| college | low concern | unclear | low concern |
| personal | low concern | unclear | low concern |
| sbi-otp | high concern | unclear | high concern |
| internship-fee | high concern | unclear | high concern |
| upi-refund | high concern | unclear | high concern |
| delivery-link | needs verification | unclear | needs verification |
| vague | unclear | unclear | unclear |
| account-verification | needs verification | unclear | needs verification |
| reactivation-payment | high concern | unclear | high concern |
| security-advice | low concern | unclear | low concern |
| ordinary-reminder | low concern | unclear | low concern |
| urgency-only | unclear | unclear | unclear |
| government-link | high concern | high concern | high concern |

before: exact-category agreement 4/16; false positives (expected low, predicted medium/high) 0/6; false negatives (expected medium/high, predicted low/unclear) 6/8.

after: exact-category agreement 16/16; false positives (expected low, predicted medium/high) 0/6; false negatives (expected medium/high, predicted low/unclear) 0/8.

The old detector abstained on all six benign examples; those neutral outcomes
are not counted as positive scam predictions. Its main measured failure was
missed action context, alongside an inability to emit low concern.

## Limits

English phrase rules are neither a semantic model nor verified fraud detection.
Obfuscation, spelling variations, multilingual text, subtle negation, unusual
formatting, and novel scams can be missed or misclassified. Links are conservatively
flagged without reputation checks, which can produce amber on legitimate links.
A routine-looking forged message can still be low concern. Gemma live quality
was not evaluated without configured credentials; provider tests use stubs.
OCR quality gates remain unchanged and transcription can alter interpretation.
