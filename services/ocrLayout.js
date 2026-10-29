/** Preserve large visual gaps without treating ordinary soft wraps as messages. */
function layoutText(data) {
  const blocks = [];
  for (const block of data.blocks || []) {
    const lines = (block.paragraphs || []).flatMap(paragraph => paragraph.lines || []).filter(line => line.text?.trim());
    if (!lines.length) { if (block.text?.trim()) blocks.push(block.text.trim()); continue; }
    const heights = lines.map(line => line.bbox?.y1 - line.bbox?.y0).filter(value => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
    const height = heights[Math.floor(heights.length / 2)] || 20;
    let text = '', previous;
    for (const line of lines) {
      const gap = line.bbox?.y0 - previous?.bbox?.y1;
      const separator = previous ? gap > Math.max(48, 3 * height) ? '\n\n' : '\n' : '';
      text += separator + line.text.trim(); previous = line;
    }
    blocks.push(text);
  }
  return blocks.length ? blocks.join('\n\n') : data.text;
}
module.exports = { layoutText };
