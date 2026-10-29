const notification = require('../public/js/risk-notification');

test('green policy is reserved for an explicit low-concern classification', () => {
  expect(notification.describe('low concern')).toEqual({
    tone: 'positive', title: 'No Obvious Scam Indicators',
    description: "No strong warning signs were detected. The sender's identity and claims have not been independently verified.",
  });
});
test.each(['unclear', 'low', 'safe', 'genuine', 'verified', '', null, undefined, '__proto__'])('never treats %s as low concern', value => {
  expect(notification.describe(value).tone).toBe('neutral');
});
