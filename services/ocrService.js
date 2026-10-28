const { Worker } = require('node:worker_threads');
const path = require('node:path');
const fs = require('node:fs');
const language = require('@tesseract.js-data/eng');

function publicError(status, message) {
  return Object.assign(new Error(message), { status, publicMessage: message, isPublic: true });
}

function isAvailable() {
  return fs.existsSync(path.join(language.langPath, 'eng.traineddata.gz'));
}

// A short-lived outer worker provides a hard deadline, including OCR startup.
// Terminating it also terminates Tesseract's child worker. No image/text is logged.
function extractText(image, { signal } = {}) {
  return new Promise((resolve, reject) => {
    if (!isAvailable()) return reject(publicError(503, 'Screenshot analysis is unavailable. Paste the message instead.'));
    if (signal?.aborted) return reject(publicError(408, 'Screenshot analysis was cancelled.'));
    const worker = new Worker(path.join(__dirname, 'ocrWorker.js'), { workerData: { image } });
    let settled = false;
    const finish = async (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      await worker.terminate().catch(() => {});
      if (error) reject(error); else resolve(result);
    };
    const abort = () => finish(publicError(408, 'Screenshot analysis was cancelled.'));
    const timer = setTimeout(() => finish(publicError(504, 'Screenshot processing timed out. Crop the message and try again.')), 45000);
    signal?.addEventListener('abort', abort, { once: true });
    worker.on('message', result => {
      if (result.error) return finish(publicError(502, 'Text extraction failed. Try a clearer screenshot or paste the message.'));
      finish(null, result);
    });
    worker.on('error', () => finish(publicError(502, 'Text extraction failed. Try a clearer screenshot or paste the message.')));
    worker.on('exit', () => {
      if (!settled) finish(publicError(502, 'Text extraction stopped unexpectedly. Please try again.'));
    });
  });
}

module.exports = { extractText, isAvailable, publicError };
