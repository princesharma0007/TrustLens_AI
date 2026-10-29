const { ocrError, metrics } = require('../scripts/evaluationMetrics');
test('CER counts substitutions and insertions rather than missing words only', () => { expect(ocrError('hello', 'hallo!')).toEqual({ edits: 2, referenceCharacters: 5 }); });
test('classification metrics expose false positives, misses and abstentions', () => {
  const result = metrics([{ expected: 'high concern', actual: 'unclear' }, { expected: 'low concern', actual: 'high concern' }, { expected: 'needs verification', actual: 'high concern' }, { expected: 'low concern', actual: 'low concern' }, { expected: 'unclear', actual: 'unclear' }], 'actual');
  expect(result).toMatchObject({ tp: 1, fp: 1, fn: 1, tn: 1, binarySamples: 4, precision: 0.5, recall: 0.5, f1: 0.5, falsePositiveRate: 0.5, falseNegativeRate: 0.5, unclearPredictions: 2 });
});
