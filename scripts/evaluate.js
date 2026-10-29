// Reproducible synthetic development evaluation: never reads production input.
const fs = require('node:fs');
const path = require('node:path');
const { metrics } = require('./evaluationMetrics');
const analysis = require('../services/analysisService');
const cases = require('../tests/fixtures/security-evaluation.json');
const baseline = require('../tests/fixtures/security-baseline.json');
(async () => {
  // Pin evaluation to local rules and structural URL analysis; no network.
  delete process.env.GEMMA_API_KEY; delete process.env.GEMMA_API_URL;
  delete process.env.URL_REPUTATION_ENABLED; delete process.env.GOOGLE_WEB_RISK_API_KEY;
  const rows = [];
  for (const item of cases) rows.push({ id: item.id, expected: item.expected, before: baseline.rows.find(row => row.id === item.id).before, after: (await analysis.analyze(item.message)).riskLevel });
  const result = { dataset: `${cases.length} development cases; not a held-out fraud benchmark`, positiveLabel: 'needs verification OR high concern (review warranted, not confirmed fraud)', binaryExclusions: 'expected unclear; predicted unclear counts as negative, including a false negative for review-positive cases', baselineCommit: baseline.commit, before: metrics(rows, 'before'), after: metrics(rows, 'after'), rows };
  fs.writeFileSync(path.join(__dirname, '../docs/security-evaluation.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
})().catch(() => { console.error('Synthetic evaluation failed.'); process.exitCode = 1; });
