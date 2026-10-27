/**
 * Placeholder analysis service.
 * Currently implements a simple rule‑based scam detection prototype.
 * When a real Gemma 4 runtime is integrated, replace the implementation
 * but keep the same exported function signature.
 */

/**
 * Analyze a message and return a structured result.
 * The returned object matches the contract described in the spec.
 *
 * @param {string} message – the user‑submitted text to analyse
 * @returns {Promise<Object>} analysis result
 */
async function analyze(message) {
  // Simple keyword‑based heuristics (demo only)
  const indicators = [];
  // Lower‑cased version for case‑insensitive matching
  const lowered = message.toLowerCase();

  // Patterns use the "i" flag for case‑insensitive matching but we capture
  // evidence from the original message to preserve original casing.
  const patterns = [
    { title: 'Urgency', regex: /\b(blocked|expire|deadline|minutes?)\b/i, explanation: 'Pressures the recipient to act quickly.' },
    { title: 'OTP request', regex: /\b(otp|one[-\s]?time\s?code)\b/i, explanation: 'Attempts to steal one‑time passwords.' },
    { title: 'Account threat', regex: /\b(account\s?will\s?be\s?blocked|suspend)\b/i, explanation: 'Creates fear about account status.' },
    { title: 'Verification link', regex: /\bverify\b/i, explanation: 'Tries to lure the user to click a verification link.' }
  ];

  for (const p of patterns) {
    if (p.regex.test(lowered)) {
      // Capture a short snippet of evidence from the original message (preserves case)
      const match = message.match(p.regex);
      indicators.push({
        title: p.title,
        evidence: match ? match[0] : p.title,
        explanation: p.explanation
      });
    }
  }

  // Risk score: each indicator adds 25 points, plus a modest length factor.
  // Score is capped at 100.
  const riskScore = Math.min(100, indicators.length * 25 + Math.floor(message.length / 100));
  const riskLevel = riskScore >= 75 ? 'high' : riskScore >= 40 ? 'medium' : 'low';

  // Human‑readable summary reflecting the number of indicators.
  let summary;
  if (indicators.length === 0) {
    summary = 'No obvious scam indicators detected.';
  } else if (indicators.length === 1) {
    summary = 'The message contains a potential scam indicator.';
  } else {
    summary = 'The message contains multiple potential scam indicators.';
  }

  const analysis = {
    riskLevel,
    riskScore,
    summary,
    indicators,
    recommendedActions: [
      'Do not share personal or OTP information.',
      'Verify the claim using official channels.'
    ],
    model: 'placeholder‑rule‑based',
    disclaimer: 'This assessment is a rule‑based heuristic, not a verified AI prediction or probability of fraud.'
  };

  return analysis;
}

module.exports = { analyze };
