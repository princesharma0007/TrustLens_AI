const { parentPort, workerData } = require('node:worker_threads');
const { createWorker } = require('tesseract.js');
const language = require('@tesseract.js-data/eng');

(async () => {
  let worker;
  try {
    worker = await createWorker('eng', 1, {
      langPath: language.langPath,
      gzip: true,
      cacheMethod: 'none',
      logger: () => {},
      errorHandler: () => {},
    });
    await worker.setParameters({ user_defined_dpi: '150' });
    const { data } = await worker.recognize(Buffer.from(workerData.image));
    parentPort.postMessage({ text: data.text.slice(0, 20001), confidence: data.confidence, truncated: data.text.length > 20000 });
  } catch {
    parentPort.postMessage({ error: true });
  } finally {
    if (worker) await worker.terminate();
  }
})();
