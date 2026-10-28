'use strict';

// Navigation works as ordinary links even when JavaScript is unavailable.
const menuToggle = document.querySelector('.menu-toggle');
const navLinks = document.querySelector('#nav-links');

if (menuToggle && navLinks) {
  menuToggle.hidden = false;
  const closeMenu = () => {
    menuToggle.setAttribute('aria-expanded', 'false');
    navLinks.classList.remove('is-open');
  };

  menuToggle.addEventListener('click', () => {
    const isOpen = menuToggle.getAttribute('aria-expanded') === 'true';
    menuToggle.setAttribute('aria-expanded', String(!isOpen));
    navLinks.classList.toggle('is-open', !isOpen);
  });

  navLinks.addEventListener('click', (event) => {
    if (event.target.closest('a')) closeMenu();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && menuToggle.getAttribute('aria-expanded') === 'true') {
      closeMenu();
      menuToggle.focus();
    }
  });
}

const analyzerForm = document.querySelector('#analyzer-form');
if (analyzerForm) {
  const message = document.querySelector('#message');
  const counter = document.querySelector('#character-count');
  const error = document.querySelector('#analyzer-error');
  const status = document.querySelector('#analyzer-status');
  const submit = document.querySelector('#analyze-button');
  const output = document.querySelector('#analysis-output');
  const skeleton = document.querySelector('#analysis-skeleton');
  const results = document.querySelector('#analysis-results');
  const title = document.querySelector('#results-title');
  const demoButtons = [...document.querySelectorAll('[data-demo]')];
  const riskLabels = new Map([
    ['high concern', 'High Concern'],
    ['needs verification', 'Needs Verification'],
    ['unclear', 'Unclear'],
  ]);
  let busy = false;
  let currentController = null;
  window.addEventListener('pagehide', () => currentController?.abort());
  submit.disabled = false;
  demoButtons.forEach((button) => { button.disabled = false; });

  function clearError() {
    error.hidden = true;
    error.textContent = '';
    message.removeAttribute('aria-invalid');
  }

  function updateCounter() {
    counter.textContent = `${message.value.length.toLocaleString('en-US')} / 5,000 characters`;
  }
  updateCounter();
  window.addEventListener('pageshow', updateCounter);

  message.addEventListener('input', () => {
    updateCounter();
    clearError();
    if (output.dataset.source === 'text') { output.hidden = true; output.dataset.hasResult = 'false'; }
    status.textContent = 'Message changed. Analyze it to see updated results.';
  });

  function setBusy(value, source = 'text') {
    busy = value;
    submit.disabled = value;
    message.readOnly = value;
    demoButtons.forEach((button) => { button.disabled = value; });
    document.querySelectorAll('.analyzer-tab').forEach((tab) => { tab.disabled = value; });
    output.setAttribute('aria-busy', String(value));
    submit.textContent = value && source === 'text' ? 'Analyzing…' : 'Analyze message ↗';
    document.dispatchEvent(new CustomEvent('trustlens:analysis-state', { detail: { busy: value, source } }));
  }

  const isText = (value) => typeof value === 'string' && value.trim().length > 0;
  function validateResponse(data) {
    if (!data || typeof data !== 'object' ||
        !isText(data.riskLevel) || !riskLabels.has(data.riskLevel.trim().toLowerCase()) ||
        !isText(data.summary) || !isText(data.uncertainty) || !isText(data.analysisMode) ||
        !Array.isArray(data.indicators) || !Array.isArray(data.recommendedActions) ||
        !data.indicators.every((item) => item && isText(item.type) && isText(item.evidence) && isText(item.explanation)) ||
        !data.recommendedActions.every(isText)) {
      throw new Error('The analysis service returned an unexpected or incomplete response. Please try again.');
    }
    return data;
  }

  function element(tag, text, className) {
    const node = document.createElement(tag);
    node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function render(data, demo = false, source = 'text') {
    const risk = data.riskLevel.trim().toLowerCase();
    const badge = document.querySelector('#risk-level');
    badge.textContent = riskLabels.get(risk);
    badge.className = `risk-badge risk-${risk.replaceAll(' ', '-')}`;
    document.querySelector('#analysis-mode').textContent = demo
      ? 'MOCK DEMO — fixed sample data; not AI analysis of your message'
      : data.analysisMode === 'ocr + rule-based'
        ? 'Local OCR + rule-based prototype — not Gemma AI analysis'
      : data.analysisMode === 'rule-based'
        ? 'Rule-based prototype — not Gemma AI analysis'
        : `Analysis mode reported by service: ${data.analysisMode}`;
    document.querySelector('#result-summary').textContent = data.summary;
    document.querySelector('#result-uncertainty').textContent = data.uncertainty;
    const indicators = document.querySelector('#result-indicators');
    indicators.replaceChildren();
    data.indicators.forEach((item) => {
      const card = document.createElement('article');
      card.className = 'indicator-card';
      card.append(element('h5', item.type), element('blockquote', item.evidence), element('p', item.explanation));
      indicators.append(card);
    });
    if (!data.indicators.length) indicators.append(element('p', 'No warning indicators were returned. This does not establish that the message is safe.'));
    const actions = document.querySelector('#result-actions');
    actions.replaceChildren();
    data.recommendedActions.forEach((action) => actions.append(element('li', action)));
    if (!data.recommendedActions.length) actions.append(element('li', 'No specific actions were returned. Verify important requests through an official channel.'));
    skeleton.hidden = true;
    results.hidden = false;
    output.hidden = false;
    output.dataset.source = source;
    output.dataset.hasResult = 'true';
    title.textContent = demo ? 'Sample results — mock demo' : source === 'image' ? 'Screenshot analysis' : 'Message analysis';
  }

  analyzerForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy || document.querySelector('#text-panel').hidden) return;
    clearError();
    if (!message.value.trim() || message.value.length > 5000) {
      error.textContent = message.value.trim() ? 'Keep your message within 5,000 characters.' : 'Paste a message before starting the analysis.';
      error.hidden = false;
      message.setAttribute('aria-invalid', 'true');
      message.focus();
      return;
    }
    await analyzeRequest({ message: message.value.trim() });
  });

  async function analyzeRequest(payload) {
    if (busy) return;
    const source = payload.image ? 'image' : 'text';
    const activeError = source === 'image' ? document.querySelector('#screenshot-error') : error;
    const activeStatus = source === 'image' ? document.querySelector('#screenshot-status') : status;
    activeError.hidden = true;
    activeError.textContent = '';
    setBusy(true, source);
    output.dataset.hasResult = 'false';
    results.hidden = true;
    skeleton.hidden = false;
    output.hidden = false;
    title.textContent = source === 'image' ? 'Reading and analyzing your screenshot' : 'Analyzing your message';
    activeStatus.textContent = source === 'image' ? 'Reading screenshot text and checking warning signs. Please wait.' : 'Analyzing your message. Please wait.';
    const controller = new AbortController();
    currentController = controller;
    const timeout = window.setTimeout(() => controller.abort(), source === 'image' ? 65000 : 30000);
    try {
      let body;
      const headers = { Accept: 'application/json' };
      if (source === 'image') {
        body = new FormData();
        body.append('image', payload.image);
      } else {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(payload);
      }
      const response = await fetch(source === 'image' ? '/api/analyze-image' : '/api/analyze', {
        method: 'POST', headers, body, signal: controller.signal,
      });
      if (!response.ok) {
        if (source === 'image') {
          // Display only the public JSON error, as text. Never show raw HTML,
          // worker output, or an automatic mock report.
          let failure;
          try { failure = await response.json(); } catch (error) {
            if (error.name === 'AbortError') throw error;
          }
          if (isText(failure?.error) && failure.error.length <= 300) throw new Error(failure.error);
          throw new Error('Screenshot analysis failed. Try a clearer image or paste the message.');
        }
        if (response.status === 404 || response.status === 405 || response.status >= 500) throw new Error('The analysis service is unavailable. Please check that the backend is running and try again.');
        if (response.status === 429) throw new Error('Too many requests. Please wait a moment and try again.');
        if (response.status === 400) throw new Error('The message was not accepted. Submit text containing 1–5,000 characters.');
        if (response.status === 413) throw new Error('The request is too large. Shorten your message and try again.');
        throw new Error(`The analysis request failed (HTTP ${response.status}). Please try again.`);
      }
      let data;
      try { data = await response.json(); } catch (failure) {
        if (failure.name === 'AbortError') throw failure;
        throw new Error('The analysis service did not return valid JSON. Please try again.');
      }
      render(validateResponse(data), false, source);
      activeStatus.textContent = 'Analysis complete. Review the results below.';
    } catch (failure) {
      output.hidden = true;
      activeError.textContent = failure.name === 'AbortError'
        ? 'The analysis request timed out. Please try again.'
        : failure instanceof TypeError
          ? 'Could not connect to the analysis service. Check your connection and that the backend is running.'
          : failure.message;
      activeError.hidden = false;
      activeStatus.textContent = 'Analysis could not be completed. You can try again.';
    } finally {
      window.clearTimeout(timeout);
      currentController = null;
      setBusy(false, source);
      if (!output.hidden) title.focus();
    }
  }

  // Shared request/render path keeps image reports subject to the exact same
  // contract validation and safe DOM rendering as text reports.
  window.TrustLensAnalysis = Object.freeze({
    analyzeImage: (file) => {
      if (file instanceof File) return analyzeRequest({ image: file });
    },
    isBusy: () => busy,
  });

  demoButtons.forEach((button) => button.addEventListener('click', () => {
    if (busy) return;
    clearError();
    render({
      riskLevel: button.dataset.demo,
      summary: 'Fixed UI example: a message threatens to block an account and asks for an OTP. This sample does not evaluate your input.',
      indicators: [{ type: 'OTP request', evidence: 'Share your OTP', explanation: 'Requests sensitive authentication information.' }],
      recommendedActions: ['Do not share your OTP.', 'Verify using the official website or app.'],
      uncertainty: 'This is mock data for interface testing. No sender identity has been verified.',
      analysisMode: 'mock',
    }, true);
    status.textContent = 'Mock demo displayed. No message was sent or analyzed.';
    title.focus();
  }));
}
