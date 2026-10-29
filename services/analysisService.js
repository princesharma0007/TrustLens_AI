const urls = require('./urlAnalysisService');
const gemma = require('./gemmaService');
const { LEVELS } = require('./riskClassification');

function normalizeText(text) {
  // Normalize instruction text without rewriting opaque URL paths or hiding
  // Unicode domain signals before structural/reputation inspection.
  return text.split(/(\s+)/u).map(part => urls.extractUrls(part).length ? part : part.normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '')).join('').replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/).map(block => block.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n\n');
}
async function analyze(input) {
  const text = normalizeText(input);
  const blocks = text.split('\n\n');
  if (blocks.length > 8) throw Object.assign(new Error('Too many separate text blocks. Crop or submit one message at a time.'), { status: 422, isPublic: true, publicMessage: 'Too many separate text blocks. Crop or submit one message at a time.' });
  const findings = await urls.analyzeUrls(text);
  const reports = await Promise.all(blocks.map(block => gemma.analyze(block)));
  if (reports.length === 1) return applyUrls(reports[0], findings);
  const ranks = [LEVELS.LOW, LEVELS.UNKNOWN, LEVELS.MEDIUM, LEVELS.HIGH];
  const strongest = reports.reduce((a, b) => ranks.indexOf(a.riskLevel) >= ranks.indexOf(b.riskLevel) ? a : b);
  return applyUrls({ ...strongest,
    summary: `Analyzed ${blocks.length} separated text blocks independently. ${strongest.summary}`,
    indicators: reports.flatMap(report => report.indicators),
    recommendedActions: [...new Set(reports.flatMap(report => report.recommendedActions))],
    uncertainty: `${strongest.uncertainty} Text-block boundaries may not represent separate messages. Review or submit one message at a time; no claims were combined across blocks.`,
    analysisMode: [...new Set(reports.map(report => report.analysisMode))].join(' + '),
  }, findings);
}
function applyUrls(report, findings) {
  if (!findings.length) return report;
  const malicious = findings.filter(item => item.status === 'known_malicious');
  const indicators = [...report.indicators];
  for (const item of findings) {
    if (item.status === 'known_malicious' || item.signals.length) indicators.push({
      type: item.status === 'known_malicious' ? 'Threat-intelligence match' : 'URL structure',
      evidence: item.url,
      explanation: item.status === 'known_malicious' ? 'Google Web Risk returned a threat-list match for this URL. Do not open it or submit information.' : `URL signals: ${item.signals.join(', ')}. These warrant verification and are not proof of fraud.`,
    });
  }
  return { ...report,
    riskLevel: malicious.length ? LEVELS.HIGH : [LEVELS.LOW, LEVELS.UNKNOWN].includes(report.riskLevel) ? LEVELS.MEDIUM : report.riskLevel,
    summary: malicious.length ? 'A configured threat-intelligence service reported a malicious URL. Review the findings before taking action.' : [LEVELS.LOW, LEVELS.UNKNOWN].includes(report.riskLevel) ? 'One or more URLs require independent verification. A threat-list check does not authenticate this message.' : report.summary,
    indicators, urlFindings: findings,
    recommendedActions: [...new Set([...report.recommendedActions, 'Open the official app or website independently. A no-known-threat result does not prove a URL or sender is safe.'])],
    uncertainty: `${report.uncertainty} URL checks do not authenticate the sender. Missing intelligence and HTTPS are not evidence of safety.`,
  };
}
module.exports = { analyze, normalizeText };
