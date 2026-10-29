function distance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) { const next = [i]; for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); row = next; }
  return row[b.length];
}
const canonical = text => text.normalize('NFKC').replace(/\s+/g, ' ').trim();
function ocrError(expected, actual) { const reference = canonical(expected); return { edits: distance(reference, canonical(actual)), referenceCharacters: reference.length }; }
function metrics(rows, field) {
  const positive = level => ['needs verification', 'high concern'].includes(level);
  const labelled = rows.filter(row => row.expected !== 'unclear');
  const tp = labelled.filter(row => positive(row.expected) && positive(row[field])).length;
  const fp = labelled.filter(row => !positive(row.expected) && positive(row[field])).length;
  const fn = labelled.filter(row => positive(row.expected) && !positive(row[field])).length;
  const tn = labelled.filter(row => !positive(row.expected) && !positive(row[field])).length;
  const ratio = (a, b) => b ? Number((a / b).toFixed(4)) : null;
  return { samples: rows.length, binarySamples: labelled.length, tp, fp, fn, tn,
    precision: ratio(tp, tp + fp), recall: ratio(tp, tp + fn), f1: ratio(2 * tp, 2 * tp + fp + fn), falsePositiveRate: ratio(fp, fp + tn), falseNegativeRate: ratio(fn, fn + tp),
    exactCategoryMatches: rows.filter(row => row.expected === row[field]).length,
    unclearPredictions: rows.filter(row => row[field] === 'unclear').length };
}
module.exports = { ocrError, metrics };
