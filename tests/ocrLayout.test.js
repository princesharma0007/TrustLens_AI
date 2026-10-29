const { layoutText } = require('../services/ocrLayout');
const line = (text, y0) => ({ text, bbox: { y0, y1: y0 + 20 } });
test('soft wrapping keeps an instruction together; a large visual gap separates claims', () => {
  const data = { blocks: [{ paragraphs: [{ lines: [line('Share your', 0), line('OTP', 30), line('College announcement', 200)] }] }] };
  expect(layoutText(data)).toBe('Share your\nOTP\n\nCollege announcement');
});
test('text remains usable when layout metadata is unavailable', () => { expect(layoutText({ text: 'hello', blocks: null })).toBe('hello'); });
