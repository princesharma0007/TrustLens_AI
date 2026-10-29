const sharp = require('sharp');
const ocr = require('./ocrService');
const gemmaService = require('./gemmaService');
const { publicError } = ocr;
const MAX_BYTES = 5 * 1024 * 1024;
let processing = false;

// Check signatures before invoking any decoder, so SVG and other formats never
// enter the image pipeline even when their filename/MIME claims to be PNG.
function imageFormat(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return 'jpeg';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

async function analyze(buffer, { signal } = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw publicError(400, 'Choose an image before starting the analysis.');
  if (buffer.length > MAX_BYTES) throw publicError(413, 'The image exceeds 5 MB. Choose a smaller screenshot.');
  if (!imageFormat(buffer)) throw publicError(415, 'Only genuine PNG, JPEG, and WebP images are supported.');
  if (!ocr.isAvailable()) throw publicError(503, 'Screenshot analysis is unavailable. Paste the message instead.');
  if (processing) throw publicError(429, 'Another screenshot is being processed. Please wait and try again.');
  processing = true;
  try {
    let normalized;
    try {
      const image = sharp(buffer, { limitInputPixels: 12000000, failOn: 'warning' });
      const metadata = await image.metadata();
      if (metadata.format !== imageFormat(buffer) || (metadata.pages || 1) !== 1 ||
          !metadata.width || !metadata.height || metadata.width > 10000 || metadata.height > 10000) {
        throw new Error('Unsupported image');
      }
      // Full decoding rejects corrupted files. Re-encoding removes metadata and
      // bounds the OCR input without saving an image to disk.
      normalized = await image.rotate().flatten({ background: '#ffffff' })
        .resize({ width: 2000, height: 6000, fit: 'inside', withoutEnlargement: true })
        .greyscale().png().timeout({ seconds: 10 }).toBuffer();
    } catch {
      throw publicError(422, 'This image cannot be read. Use a clear, non-animated screenshot up to 12 megapixels.');
    }
    if (signal?.aborted) throw publicError(408, 'Screenshot analysis was cancelled.');
    const result = await ocr.extractText(normalized, { signal });
    const text = typeof result.text === 'string' ? result.text.trim() : '';
    if (!Number.isFinite(result.confidence) || result.confidence < 45 || (text.match(/[a-z0-9]/gi) || []).length < 3) {
      throw publicError(422, 'No clear English text could be read. Crop or sharpen the screenshot, or paste the message.');
    }
    if (result.truncated || text.length > 20000) throw publicError(422, 'The screenshot contains too much text. Crop it to one message and try again.');
    const analysis = await gemmaService.analyze(text);
    return {
      ...analysis,
      analysisMode: `ocr + ${analysis.analysisMode}`,
      uncertainty: `${analysis.uncertainty} Text was extracted using local English OCR, which can miss or misread words. Review the screenshot and verify independently.`,
    };
  } finally {
    processing = false;
  }
}

module.exports = { analyze, isAvailable: () => ocr.isAvailable(), MAX_BYTES };
