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
  // If Gemma 4 credentials are provided, attempt real inference.
  // Expected env vars: GEMMA_API_KEY and GEMMA_API_URL (the endpoint that accepts a POST with JSON { message }).
  // The provider must return a JSON payload matching our contract.
  let useGemma = process.env.GEMMA_API_KEY && process.env.GEMMA_API_URL;

  if (useGemma) {
    if (typeof fetch === 'function') {
      try {
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timeout = setTimeout(() => {
          if (controller) controller.abort();
        }, 5000);
        const resp = await fetch(process.env.GEMMA_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.GEMMA_API_KEY}`
          },
          body: JSON.stringify({ message }),
          signal: controller ? controller.signal : undefined
        });
        clearTimeout(timeout);
        if (!resp.ok) throw new Error(`Gemma API error ${resp.status}`);
        let data;
        try {
          data = await resp.json();
        } catch (e) {
          throw new Error('Invalid JSON from Gemma');
        }
        const required = ['riskLevel', 'riskScore', 'summary', 'indicators', 'recommendedActions', 'uncertainty'];
        const hasAll = required.every(f => f in data);
        if (hasAll) {
          return { ...data, analysisMode: 'gemma-4' };
        }
      } catch (e) {
        console.error('Gemma inference failed:', e);
      }
    }
    // Force fallback mode
    useGemma = false;
  }

  // ---------- Rule‑based fallback (existing implementation) ----------
  // Simple keyword‑based heuristics (demo only)
  const indicators = [];
  const lowered = message.toLowerCase();

  const patterns = [
    { title: 'Urgency', regex: /\b(blocked|expire|deadline|minutes?)\b/i, explanation: 'Pressures the recipient to act quickly.' },
    { title: 'OTP request', regex: /\b(otp|one[-\s]?time\s?code)\b/i, explanation: 'Attempts to steal one‑time passwords.' },
    { title: 'Account threat', regex: /\b(account\s?will\s?be\s?blocked|suspend)\b/i, explanation: 'Creates fear about account status.' },
    { title: 'Verification link', regex: /\bverify\b/i, explanation: 'Tries to lure the user to click a verification link.' }
  ];

  for (const p of patterns) {
    if (p.regex.test(lowered)) {
      const match = message.match(p.regex);
      indicators.push({
        title: p.title,
        evidence: match ? match[0] : p.title,
        explanation: p.explanation
      });
    }
  }

  const riskScore = Math.min(100, indicators.length * 25 + Math.floor(message.length / 100));
  const riskLevel = riskScore >= 75 ? 'high' : riskScore >= 40 ? 'medium' : 'low';

  let summary;
  if (indicators.length === 0) {
    summary = 'No obvious scam indicators detected.';
  } else if (indicators.length === 1) {
    summary = 'The message contains a potential scam indicator.';
  } else {
    summary = 'The message contains multiple potential scam indicators.';
  }

  const uncertainty = 100 - riskScore;

  const analysis = {
    riskLevel,
    riskScore,
    summary,
    indicators,
    recommendedActions: [
      'Do not share personal or OTP information.',
      'Verify the claim using official channels.'
    ],
    model: useGemma ? 'gemma-4' : 'placeholder‑rule‑based',
    disclaimer: 'This assessment is a rule‑based heuristic, not a verified AI prediction or probability of fraud.',
    uncertainty,
    analysisMode: useGemma ? 'gemma-4' : 'rule-based'
  };

  return analysis;
}

module.exports = { analyze };
