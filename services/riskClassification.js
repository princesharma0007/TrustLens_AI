/** Canonical API categories; low concern requires positive routine context. */
const LEVELS = Object.freeze({ LOW: 'low concern', MEDIUM: 'needs verification', HIGH: 'high concern', UNKNOWN: 'unclear' });
const PROVIDER_LEVELS = new Map([
  ...Object.values(LEVELS).map(value => [value, value]),
  ['high', LEVELS.HIGH], ['medium', LEVELS.MEDIUM], ['low', LEVELS.LOW],
]);
function classify({ strong = false, moderate = false, routine = false }) {
  return strong ? LEVELS.HIGH : moderate ? LEVELS.MEDIUM : routine ? LEVELS.LOW : LEVELS.UNKNOWN;
}
module.exports = { LEVELS, PROVIDER_LEVELS, classify };
