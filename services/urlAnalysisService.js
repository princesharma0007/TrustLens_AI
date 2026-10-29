const { createHash } = require('node:crypto');
const { isIP } = require('node:net');
const SHORTENERS = new Set(['bit.ly', 'tinyurl.com', 't.co', 'cutt.ly', 'rb.gy', 'shorturl.at', 'is.gd', 's.id', 'buff.ly', 'goo.gl']);
const BRANDS = { paypal: ['paypal.com'], amazon: ['amazon.com', 'amazon.in'], google: ['google.com'], microsoft: ['microsoft.com'], sbi: ['sbi.co.in', 'onlinesbi.sbi'], pnb: ['pnbindia.in'] };
const cache = new Map();
const inFlight = new Map();
let windowStart = 0, calls = 0;
function extractUrls(text) {
  const pattern = /\b(?:https?:\/\/|www\.)[^\s<>]+|(?<![\p{L}\p{N}@.-])(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?\.)+(?:com|org|net|in|co|io|ly|me|gl|cc|link|app|shop|info|xyz|site|live|top|at|gd|id|to|gy|be|one)(?:\/[^\s<>]*)?(?![\p{L}\p{N}.-])/giu;
  return [...new Set((text.match(pattern) || []).map(url => url.replace(/[.,!?;:)\]}]+$/, '')))];
}
function inspect(raw) {
  const signals = [];
  let parsed;
  try { parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { return { url: raw, signals: ['invalid_url'], eligible: false }; }
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
  const bare = host.replace(/^www\./, '');
  const ip = isIP(host.replace(/^\[|\]$/g, ''));
  if (SHORTENERS.has(bare)) signals.push('shortened_link');
  if (ip) signals.push('ip_address');
  if (host.includes('xn--') || /[^\x00-\x7f]/.test(raw)) signals.push('internationalized_domain');
  if (parsed.username || parsed.password) signals.push('embedded_credentials');
  if (!host.includes('.') || /(?:^|\.)(?:localhost|local|internal|test|invalid|example)$/.test(host)) signals.push('internal_or_reserved_host');
  if (parsed.port && !['80', '443'].includes(parsed.port)) signals.push('unusual_port');
  const labels = host.split('.');
  for (const [brand, domains] of Object.entries(BRANDS)) {
    if (domains.some(domain => host === domain || host.endsWith(`.${domain}`))) continue;
    const resembles = labels.some(label => label.includes(brand) || label.replaceAll('1', 'l').replaceAll('0', 'o') === brand || distance(label, brand) === 1);
    if (resembles) { signals.push('possible_brand_impersonation'); break; }
  }
  parsed.hash = '';
  // No target DNS or HTTP requests, ever. Reject all literal IPs (including
  // IPv6/mapped/encoded IPv4), local names and credentials from external lookup.
  return { url: raw, normalizedUrl: parsed.href, signals, eligible: !ip && !signals.includes('internal_or_reserved_host') && !signals.includes('embedded_credentials') && !signals.includes('unusual_port') };
}
function distance(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 2;
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) { const next = [i]; for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); row = next; }
  return row[b.length];
}
async function lookup(uri) {
  const key = process.env.GOOGLE_WEB_RISK_API_KEY;
  if (process.env.URL_REPUTATION_ENABLED !== 'true' || !key) return { reputationStatus: 'unknown', provider: 'none', reason: 'not_configured' };
  const digest = createHash('sha256').update(`${key}\0${uri}`).digest('hex');
  const now = Date.now();
  for (const [id, entry] of cache) if (entry.expires <= now) cache.delete(id);
  if (cache.has(digest)) return cache.get(digest).result;
  if (inFlight.has(digest)) return inFlight.get(digest);
  if (now - windowStart >= 60000) { windowStart = now; calls = 0; }
  if (calls >= 20 || inFlight.size >= 2) return { reputationStatus: 'unknown', provider: 'none', reason: 'lookup_limit' };
  calls++;
  const pending = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    try {
      const endpoint = new URL('https://webrisk.googleapis.com/v1/uris:search');
      endpoint.searchParams.set('uri', uri);
      for (const type of ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE']) endpoint.searchParams.append('threatTypes', type);
      const response = await fetch(endpoint.href, { headers: { 'x-goog-api-key': key }, signal: controller.signal, redirect: 'error' });
      if (!response.ok) throw new Error('Lookup failed');
      const data = await response.json();
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid response');
      if (Object.keys(data).length === 0) return { reputationStatus: 'no_known_threat', provider: 'google-web-risk', reason: 'no_match' };
      const types = data.threat?.threatTypes;
      const expires = Date.parse(data.threat?.expireTime);
      if (!Array.isArray(types) || !types.length || !types.every(type => ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE'].includes(type)) || !Number.isFinite(expires) || expires <= Date.now()) throw new Error('Invalid threat match');
      const result = { reputationStatus: 'known_malicious', provider: 'google-web-risk', reason: 'threat_match' };
      if (cache.size >= 128) cache.delete(cache.keys().next().value);
      cache.set(digest, { result, expires });
      return result;
    } catch {
      return { reputationStatus: 'unknown', provider: 'google-web-risk', reason: 'lookup_unavailable' };
    } finally { clearTimeout(timer); }
  })();
  inFlight.set(digest, pending);
  try { return await pending; } finally { inFlight.delete(digest); }
}
async function analyzeUrls(text) {
  const urls = extractUrls(text);
  if (urls.length > 32) throw Object.assign(new Error('Too many links. Submit one message at a time.'), { status: 422, isPublic: true, publicMessage: 'Too many links. Submit one message at a time.' });
  const findings = [];
  // Work sequentially; max eight remote calls and a bounded 20-second deadline.
  for (let index = 0; index < urls.length; index++) {
    const structure = inspect(urls[index]);
    const checked = !structure.eligible || index >= 8 || structure.url.length > 2048
      ? { reputationStatus: 'unknown', provider: 'none', reason: 'not_eligible' }
      : await lookup(structure.normalizedUrl);
    const status = checked.reputationStatus === 'known_malicious' ? 'known_malicious'
      : structure.signals.length ? 'suspicious' : checked.reputationStatus;
    findings.push({ url: structure.url, status, signals: structure.signals, ...checked });
    if (findings.length >= 32) break;
  }
  return findings;
}
function reset() { cache.clear(); inFlight.clear(); windowStart = 0; calls = 0; }
module.exports = { extractUrls, inspect, analyzeUrls, reset };
