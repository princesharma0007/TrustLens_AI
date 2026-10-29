/** Text analysis using a configured Gemma-compatible JSON adapter or local rules. */
const isText = value => typeof value === 'string' && value.trim().length > 0;
const { PROVIDER_LEVELS: riskLevels } = require('./riskClassification');
const ruleAnalysis = require('./ruleAnalysisService');

function normalizeProviderResponse(payload, message) {
  // Accept the adapter's direct contract and its known single-level envelopes.
  const data = payload?.riskLevel !== undefined ? payload : payload?.analysis || payload?.data;
  if (!data || typeof data !== 'object' || !isText(data.riskLevel) ||
      !riskLevels.has(data.riskLevel.trim().toLowerCase()) || !isText(data.summary) ||
      !Array.isArray(data.indicators) || !Array.isArray(data.recommendedActions) ||
      !data.recommendedActions.every(isText)) throw new Error('Invalid analysis contract');
  const indicators = data.indicators.map(item => {
    const type = item?.type ?? item?.title;
    if (!isText(type) || !isText(item.evidence) || !isText(item.explanation) ||
        !message.toLowerCase().includes(item.evidence.toLowerCase())) throw new Error('Invalid evidence');
    return { type, evidence: item.evidence, explanation: item.explanation };
  });
  const riskLevel = riskLevels.get(data.riskLevel.trim().toLowerCase());
  if (riskLevel === 'low concern' && (indicators.length || ruleAnalysis.analyze(message).riskLevel === 'high concern')) {
    throw new Error('Contradictory low-concern findings');
  }
  let uncertainty = data.uncertainty;
  if (typeof uncertainty === 'number' && Number.isFinite(uncertainty) && uncertainty >= 0 && uncertainty <= 100) {
    // Legacy adapters returned a number. Do not portray it as a fraud probability.
    uncertainty = 'The provider returned a numeric uncertainty measure. It does not verify the sender or establish whether the message is fraudulent.';
  }
  if (!isText(uncertainty)) throw new Error('Invalid uncertainty');
  return {
    riskLevel,
    summary: data.summary, indicators, recommendedActions: data.recommendedActions,
    uncertainty, analysisMode: 'gemma-4',
  };
}

async function analyze(message) {
  const configured = Boolean(process.env.GEMMA_API_KEY && process.env.GEMMA_API_URL);
  let providerFailed = false;
  if (configured) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(process.env.GEMMA_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GEMMA_API_KEY}` },
        body: JSON.stringify({ message }), signal: controller.signal,
      });
      if (!response.ok) throw new Error('Provider request failed');
      return normalizeProviderResponse(await response.json(), message);
    } catch {
      // Never log provider errors, which may include credentials or submitted text.
      if (process.env.GEMMA_FALLBACK_ENABLED !== 'true') {
        const error = 'Configured AI analysis is unavailable. Please try again.';
        throw Object.assign(new Error(error), { status: 503, isPublic: true, publicMessage: error });
      }
      providerFailed = true;
    } finally {
      clearTimeout(timeout);
    }
  }

  const result = ruleAnalysis.analyze(message);
  if (providerFailed) result.uncertainty = `Configured Gemma analysis was unavailable; explicitly enabled rule-based fallback was used. ${result.uncertainty}`;
  return result;
}

module.exports = { analyze };
