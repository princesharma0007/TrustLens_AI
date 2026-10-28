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
  removeAttribute(key) { delete this.attributes[key]; }
  replaceChildren() { this.children = []; }
  append(...nodes) { this.children.push(...nodes); }
  focus() { this.focused = true; }
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
  const ids = ['analyzer-form', 'message', 'character-count', 'analyzer-error', 'analyzer-status', 'analyze-button', 'analysis-output', 'analysis-skeleton', 'analysis-results', 'results-title', 'risk-level', 'analysis-mode', 'result-summary', 'result-uncertainty', 'result-indicators', 'result-actions', 'text-panel', 'screenshot-error', 'screenshot-status'];
  nodes = Object.fromEntries(ids.map(id => ['#' + id, new Node()]));
  browser = { setTimeout, clearTimeout, events: {}, addEventListener(type, handler) { this.events[type] = handler; } };
  fetchMock = jest.fn();
  const document = {
    querySelector: selector => nodes[selector] || null,
    querySelectorAll: () => [],
    createElement: () => new Node(),
    dispatchEvent: jest.fn(),
  };
  const context = { document, window: browser, fetch: fetchMock, AbortController, File: TestFile, FormData: TestFormData, TypeError, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/main.js'), 'utf8'), context);
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
