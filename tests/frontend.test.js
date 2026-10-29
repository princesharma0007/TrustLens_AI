const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Small DOM boundary harness; real image decoding/layout are browser checks.
class Node {
  constructor() {
    this.value = ''; this.hidden = false; this.disabled = false;
    this.textContent = ''; this.dataset = {}; this.attributes = {};
    this.events = {}; this.children = [];
  }
  addEventListener(type, callback) { this.events[type] = callback; }
  setAttribute(key, value) { this.attributes[key] = value; }
  toggleAttribute(key, force) { if (force) this.setAttribute(key, ''); else this.removeAttribute(key); if (key === 'hidden') this.hidden = force; }
  removeAttribute(key) { delete this.attributes[key]; }
  replaceChildren() { this.children = []; }
  append(...nodes) { this.children.push(...nodes); }
  focus() { this.focused = true; }
  getBoundingClientRect() { return { top: 100, bottom: 300 }; }
  scrollIntoView(options) { this.scrollOptions = options; }
  set innerHTML(value) { throw new Error('Unsafe HTML rendering'); }
}
class TestFile {}
class TestFormData {
  constructor() { this.entries = new Map(); }
  append(key, value) { this.entries.set(key, value); }
  get(key) { return this.entries.get(key); }
}
let nodes, browser, fetchMock;
beforeEach(() => {
  jest.useFakeTimers();
  const ids = ['analyzer-form', 'message', 'character-count', 'analyzer-error', 'analyzer-status', 'analyze-button', 'analysis-output', 'analysis-skeleton', 'analysis-results', 'results-title', 'risk-level', 'analysis-mode', 'result-summary', 'result-uncertainty', 'result-indicators', 'result-actions', 'text-panel', 'screenshot-error', 'screenshot-status', 'extracted-text', 'extracted-text-content'];
  for (const source of ['text', 'image']) {
    const prefix = `risk-notification-${source}`;
    ids.push(prefix, `${prefix}-title`, `${prefix}-description`, `${prefix}-demo`, `${prefix}-details`, ...['positive', 'danger', 'warning', 'neutral'].map(tone => `${prefix}-icon-${tone}`));
  }
  ids.push('screenshot-input', 'remove-screenshot', 'demo-high', 'demo-verification', 'demo-unclear');
  nodes = Object.fromEntries(ids.map(id => ['#' + id, new Node()]));
  for (const source of ['text', 'image']) nodes[`#risk-notification-${source}`].hidden = true;
  nodes['#demo-high'].dataset.demo = 'high concern';
  nodes['#demo-verification'].dataset.demo = 'needs verification';
  nodes['#demo-unclear'].dataset.demo = 'unclear';
  browser = { innerHeight: 900, setTimeout, clearTimeout, events: {}, addEventListener(type, handler) { this.events[type] = handler; } };
  fetchMock = jest.fn();
  const document = {
    querySelector: selector => nodes[selector] || null,
    querySelectorAll: selector => selector === '[data-demo]' ? [nodes['#demo-high'], nodes['#demo-verification'], nodes['#demo-unclear']] : [],
    createElement: () => new Node(),
    dispatchEvent: jest.fn(),
  };
  const context = { document, window: browser, fetch: fetchMock, AbortController, File: TestFile, FormData: TestFormData, TypeError, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } } };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/js/risk-notification.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/js/main.js'), 'utf8'), context);
});
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });
const data = {
  riskLevel: 'high concern', summary: '<img src=x onerror=alert(1)>',
  indicators: [{ type: 'OTP request', evidence: '<script>OTP</script>', explanation: 'Sensitive authentication information.' }],
  recommendedActions: ['Verify independently.'], uncertainty: 'OCR may misread words.', analysisMode: 'ocr + rule-based',
};

test('image submission uses FormData, immediate skeleton, and duplicate prevention', async () => {
  let finish;
  fetchMock.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const file = new TestFile();
  const pending = browser.TrustLensAnalysis.analyzeImage(file);
  expect(nodes['#analysis-skeleton'].hidden).toBe(false);
  expect(nodes['#analysis-output'].attributes['aria-busy']).toBe('true');
  expect(browser.TrustLensAnalysis.isBusy()).toBe(true);
  await browser.TrustLensAnalysis.analyzeImage(file);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, options] = fetchMock.mock.calls[0];
  expect(url).toBe('/api/analyze-image');
  expect(options.body.get('image')).toBe(file);
  expect(options.headers['Content-Type']).toBeUndefined();
  finish({ ok: true, json: async () => data });
  await pending;
  expect(nodes['#result-summary'].textContent).toBe(data.summary);
  expect(nodes['#analysis-output'].dataset.source).toBe('image');
  expect(nodes['#analysis-output'].dataset.hasResult).toBe('true');
  expect(nodes['#results-title'].textContent).toBe('Screenshot analysis');
  expect(nodes['#analysis-mode'].textContent).toContain('not Gemma AI');
  expect(nodes['#analysis-output'].attributes['aria-busy']).toBe('false');
  expect(browser.TrustLensAnalysis.isBusy()).toBe(false);
});
test('image processing failures show a retryable error without mock reports', async () => {
  fetchMock.mockResolvedValue({ ok: false, status: 422, json: async () => ({ error: 'No clear English text could be read.' }) });
  await browser.TrustLensAnalysis.analyzeImage(new TestFile());
  expect(nodes['#screenshot-error'].textContent).toContain('No clear English');
  expect(nodes['#screenshot-error'].hidden).toBe(false);
  expect(nodes['#analysis-output'].hidden).toBe(true);
  expect(nodes['#screenshot-status'].textContent).toContain('try again');
  expect(nodes['#analysis-mode'].textContent).not.toContain('MOCK');
});
test('invalid image response is rejected before results are rendered', async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ summary: 'incomplete' }) });
  await browser.TrustLensAnalysis.analyzeImage(new TestFile());
  expect(nodes['#analysis-output'].hidden).toBe(true);
  expect(nodes['#screenshot-error'].textContent).toContain('incomplete');
});
test('text validation still prevents whitespace-only requests', async () => {
  nodes['#message'].value = '   ';
  await nodes['#analyzer-form'].events.submit({ preventDefault() {} });
  expect(fetchMock).not.toHaveBeenCalled();
  expect(nodes['#message'].attributes['aria-invalid']).toBe('true');
});

test('leaving the page aborts an in-flight image request', async () => {
  fetchMock.mockImplementation((url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { name: 'AbortError' })));
  }));
  const pending = browser.TrustLensAnalysis.analyzeImage(new TestFile());
  browser.events.pagehide();
  await pending;
  expect(browser.TrustLensAnalysis.isBusy()).toBe(false);
  expect(nodes['#analysis-output'].hidden).toBe(true);
});

test('rejects the original numeric uncertainty response without displaying a report', async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ...data, uncertainty: 99 }) });
  nodes['#message'].value = 'A valid transaction alert';
  await nodes['#analyzer-form'].events.submit({ preventDefault() {} });
  expect(nodes['#analyzer-error'].textContent).toContain('unexpected or incomplete');
  expect(nodes['#analysis-output'].hidden).toBe(true);
});
test('renders the actual banking-message analysis instead of the original incomplete-response error', async () => {
  const sample = 'A/c X5559 debited INR 100.00 Dt 27-10-26 11:33:32 to MAST POINT thru UPI:871752530660. Bal INR 846.53 Not u? Fwd this SMS to 9264092640 to block UPI.-PNB';
  const response = await require('../services/gemmaService').analyze(sample);
  fetchMock.mockResolvedValue({ ok: true, json: async () => response });
  nodes['#message'].value = sample;
  await nodes['#analyzer-form'].events.submit({ preventDefault() {} });
  expect(nodes['#analyzer-error'].hidden).toBe(true);
  expect(nodes['#analysis-output'].hidden).toBe(false);
  expect(nodes['#risk-level'].textContent).toBe('Needs Verification');
  expect(nodes['#result-summary'].textContent).toContain('transaction alert');
  expect(nodes['#result-uncertainty'].textContent).toContain('have not been independently verified');
});
test('renders legitimate empty indicator arrays', async () => {
  const response = await require('../services/gemmaService').analyze('Hello, our meeting is tomorrow.');
  expect(response.indicators).toEqual([]);
  fetchMock.mockResolvedValue({ ok: true, json: async () => response });
  nodes['#message'].value = 'Hello, our meeting is tomorrow.';
  await nodes['#analyzer-form'].events.submit({ preventDefault() {} });
  expect(nodes['#analyzer-error'].hidden).toBe(true);
  expect(nodes['#analysis-output'].hidden).toBe(false);
  expect(nodes['#result-indicators'].children[0].textContent).toContain('does not establish');
});


test.each([
  ['high concern', 'danger', 'Potential Scam Detected'],
  ['needs verification', 'warning', 'Verification Recommended'],
  ['unclear', 'neutral', 'Unable to Determine Risk'],
  ['low concern', 'positive', 'No Obvious Scam Indicators'],
])('successful %s analysis displays its explicit risk notification', async (riskLevel, tone, title) => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ...data, riskLevel }) });
  nodes['#message'].value = 'Test message';
  await nodes['#analyzer-form'].events.submit({ preventDefault() {} });
  expect(nodes['#risk-notification-text'].hidden).toBe(false);
  expect(nodes['#risk-notification-text'].dataset.tone).toBe(tone);
  expect(nodes['#risk-notification-text-title'].textContent).toBe(title);
  expect(nodes['#analyzer-status'].textContent).toContain(title);
  expect(nodes['#analysis-output'].hidden).toBe(false);
  expect(nodes['#results-title'].focused).not.toBe(true);
  expect(nodes[`#risk-notification-text-icon-${tone}`].hidden).toBe(false);
});
test('empty findings and unclear classification never produce a green notification', async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ...data, riskLevel: 'unclear', indicators: [] }) });
  nodes['#message'].value = 'Hello';
  await nodes['#analyzer-form'].events.submit({ preventDefault() {} });
  expect(nodes['#risk-notification-text'].dataset.tone).toBe('neutral');
});
test.each(['unknown', 'safe', 'low'])('unsupported %s API classification stays an error instead of green', async riskLevel => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ...data, riskLevel }) });
  nodes['#message'].value = 'Test message';
  await nodes['#analyzer-form'].events.submit({ preventDefault() {} });
  expect(nodes['#risk-notification-text'].hidden).toBe(true);
  expect(nodes['#analyzer-error'].hidden).toBe(false);
});
test('a second request clears the old notice before loading and on API failure', async () => {
  nodes['#message'].value = 'Test message';
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => data });
  await nodes['#analyzer-form'].events.submit({ preventDefault() {} });
  expect(nodes['#risk-notification-text'].hidden).toBe(false);
  let finish;
  fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = nodes['#analyzer-form'].events.submit({ preventDefault() {} });
  expect(nodes['#risk-notification-text'].hidden).toBe(true);
  expect(nodes['#analysis-skeleton'].hidden).toBe(false);
  finish({ ok: false, status: 500 });
  await pending;
  expect(nodes['#risk-notification-text'].hidden).toBe(true);
  expect(nodes['#analyzer-error'].hidden).toBe(false);
});
test('demo notifications are visibly identified as samples', () => {
  nodes['#demo-high'].events.click({ preventDefault() {} });
  expect(nodes['#risk-notification-text-title'].textContent).toBe('Sample — Potential Scam Detected');
  expect(nodes['#risk-notification-text-demo'].hidden).toBe(false);
  expect(fetchMock).not.toHaveBeenCalled();
});
test('editing or removing an input clears its notification', async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => data });
  nodes['#message'].value = 'Test message';
  await nodes['#analyzer-form'].events.submit({ preventDefault() {} });
  nodes['#message'].events.input();
  expect(nodes['#risk-notification-text'].hidden).toBe(true);
  await browser.TrustLensAnalysis.analyzeImage(new TestFile());
  expect(nodes['#risk-notification-image'].hidden).toBe(false);
  nodes['#remove-screenshot'].events.click({ preventDefault() {} });
  expect(nodes['#risk-notification-image'].hidden).toBe(true);
});
test('only the explicit View Detailed Analysis action moves focus to the report', async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => data });
  nodes['#message'].value = 'Test message';
  await nodes['#analyzer-form'].events.submit({ preventDefault() {} });
  expect(nodes['#results-title'].focused).not.toBe(true);
  nodes['#risk-notification-text-details'].events.click({ preventDefault() {} });
  expect(nodes['#results-title'].focused).toBe(true);
});

test('actual routine-message analysis reaches green without labeling it verified', async () => {
  const response = await require('../services/ruleAnalysisService').analyze('Rs. 500 was debited from your account.');
  fetchMock.mockResolvedValue({ ok: true, json: async () => response });
  nodes['#message'].value = 'Rs. 500 was debited from your account.';
  await nodes['#analyzer-form'].events.submit({ preventDefault() {} });
  expect(nodes['#risk-notification-text'].dataset.tone).toBe('positive');
  expect(nodes['#risk-notification-text-description'].textContent).toContain('have not been independently verified');
  expect(nodes['#risk-level'].textContent).toBe('Low Concern');
});
test.each([
  { ok: false, status: 503 },
  { ok: true, json: async () => ({ riskLevel: 'low concern', summary: 'Incomplete' }) },
])('failure after a green result clears the notice', async failure => {
  nodes['#message'].value = 'Hi, see you at lunch tomorrow.';
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ ...data, riskLevel: 'low concern', indicators: [] }) });
  await nodes['#analyzer-form'].events.submit({ preventDefault() {} });
  expect(nodes['#risk-notification-text'].dataset.tone).toBe('positive');
  fetchMock.mockResolvedValueOnce(failure);
  await nodes['#analyzer-form'].events.submit({ preventDefault() {} });
  expect(nodes['#risk-notification-text'].hidden).toBe(true);
  expect(nodes['#analyzer-error'].hidden).toBe(false);
});

test('screenshot extracted text is safe, collapsed, and cleared on the next text result', async () => {
  const extractedText = '<img src=x onerror=alert(1)>\nShop bit.ly/demo';
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ ...data, extractedText, ocrConfidence: 94 }) });
  await browser.TrustLensAnalysis.analyzeImage(new TestFile());
  expect(nodes['#extracted-text'].hidden).toBe(false);
  expect(nodes['#extracted-text'].open).toBe(false);
  expect(nodes['#extracted-text-content'].textContent).toBe(extractedText);
  nodes['#extracted-text'].open = true;
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => data });
  nodes['#message'].value = 'A new text message';
  await nodes['#analyzer-form'].events.submit({ preventDefault() {} });
  expect(nodes['#extracted-text'].hidden).toBe(true);
  expect(nodes['#extracted-text-content'].textContent).toBe('');
});
test.each([{ extractedText: 42 }, { extractedText: '' }, { ocrConfidence: 10 }, { ocrConfidence: 101 }])('rejects malformed optional OCR fields', async fields => {
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ ...data, ...fields }) });
  await browser.TrustLensAnalysis.analyzeImage(new TestFile());
  expect(nodes['#analysis-output'].hidden).toBe(true);
  expect(nodes['#risk-notification-image'].hidden).toBe(true);
});
