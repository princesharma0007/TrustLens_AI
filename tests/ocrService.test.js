const { EventEmitter } = require('node:events');
jest.mock('node:worker_threads', () => ({ Worker: jest.fn() }));
const { Worker } = require('node:worker_threads');
const ocr = require('../services/ocrService');
let worker;
beforeEach(() => {
  worker = new EventEmitter();
  worker.terminate = jest.fn().mockResolvedValue(0);
  Worker.mockImplementation(() => worker);
});
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });
test('returns worker extraction and terminates it', async () => {
  const result = ocr.extractText(Buffer.from('test'));
  worker.emit('message', { text: 'Extracted message', confidence: 98 });
  await expect(result).resolves.toMatchObject({ text: 'Extracted message' });
  expect(worker.terminate).toHaveBeenCalledTimes(1);
});
test('terminates OCR on client cancellation', async () => {
  const controller = new AbortController();
  const result = ocr.extractText(Buffer.from('test'), { signal: controller.signal });
  const assertion = expect(result).rejects.toMatchObject({ status: 408 });
  controller.abort();
  await assertion;
  expect(worker.terminate).toHaveBeenCalledTimes(1);
});
test('enforces a hard deadline including worker initialization', async () => {
  jest.useFakeTimers();
  const result = ocr.extractText(Buffer.from('test'));
  const assertion = expect(result).rejects.toMatchObject({ status: 504 });
  jest.advanceTimersByTime(45000);
  await assertion;
  expect(worker.terminate).toHaveBeenCalledTimes(1);
});
test('does not expose worker failure details', async () => {
  const result = ocr.extractText(Buffer.from('test'));
  const assertion = expect(result).rejects.toMatchObject({ status: 502, publicMessage: expect.not.stringContaining('PRIVATE') });
  worker.emit('error', new Error('PRIVATE'));
  await assertion;
});
