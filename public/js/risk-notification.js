/* Explicit classification policy. Never infer low concern from missing signals. */
(function (root) {
  'use strict';
  const states = {
    'high concern': {
      tone: 'danger', title: 'Potential Scam Detected',
      description: 'This message contains suspicious indicators commonly associated with scams. Review the detailed findings before taking action.',
    },
    'needs verification': {
      tone: 'warning', title: 'Verification Recommended',
      description: 'Some details require additional verification. Confirm the sender and request through official channels.',
    },
    'low concern': {
      tone: 'positive', title: 'No Obvious Scam Indicators',
      description: "No strong warning signs were detected. The sender's identity and claims have not been independently verified.",
    },
    unclear: {
      tone: 'neutral', title: 'Unable to Determine Risk',
      description: 'This assessment could not establish a clear risk level. Verify the sender and request through official channels before acting.',
    },
  };
  Object.values(states).forEach(Object.freeze);
  const api = Object.freeze({
    describe(riskLevel) {
      const key = typeof riskLevel === 'string' ? riskLevel.trim().toLowerCase() : '';
      return Object.hasOwn(states, key) ? states[key] : states.unclear;
    },
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TrustLensRiskNotification = api;
})(typeof window !== 'undefined' ? window : globalThis);
