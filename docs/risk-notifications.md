# Risk notification contract

The text and screenshot APIs emit four explicit categories, using the same rule
analysis service after OCR. The six-field JSON contract is unchanged.

| API value | Notification |
| --- | --- |
| `low concern` | Green: No Obvious Scam Indicators |
| `needs verification` | Amber: Verification Recommended |
| `high concern` | Red: Potential Scam Detected |
| `unclear` | Neutral: Unable to Determine Risk |
| Unknown/malformed/failure | Existing error; no risk notice |

Low concern means recognizable routine context and no meaningful detected risk or
unresolved sensitive request; it does not authenticate the sender or claims.
Empty indicators alone never imply low concern. See `risk-classification.md` for
criteria, evaluation results, and limitations.

Both notices are reusable instances of `risk-notification.ejs`. A persistent
polite/atomic status announces the completed assessment. Completion does not
move keyboard focus; the View Detailed Analysis link does so explicitly.
Notices clear on another analysis, edits/removal, failure, or page exit.
Demo notices have a visible MOCK DEMO label and Sample-prefixed headline.
No message or report is stored or inserted with innerHTML by this feature.
