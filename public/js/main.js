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
    output.hidden = true;
    status.textContent = 'Message changed. Analyze it to see updated results.';
  });

  function setBusy(value) {
    busy = value;
    submit.disabled = value;
    message.readOnly = value;
    demoButtons.forEach((button) => { button.disabled = value; });
    output.setAttribute('aria-busy', String(value));
    submit.textContent = value ? 'Analyzing…' : 'Analyze message ↗';
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

  function render(data, demo = false) {
    const risk = data.riskLevel.trim().toLowerCase();
    const badge = document.querySelector('#risk-level');
    badge.textContent = riskLabels.get(risk);
    badge.className = `risk-badge risk-${risk.replaceAll(' ', '-')}`;
    document.querySelector('#analysis-mode').textContent = demo
      ? 'MOCK DEMO — fixed sample data; not AI analysis of your message'
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
    title.textContent = demo ? 'Sample results — mock demo' : 'Message analysis';
  }

  analyzerForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    clearError();
    if (!message.value.trim() || message.value.length > 5000) {
      error.textContent = message.value.trim() ? 'Keep your message within 5,000 characters.' : 'Paste a message before starting the analysis.';
      error.hidden = false;
      message.setAttribute('aria-invalid', 'true');
      message.focus();
      return;
    }
    setBusy(true);
    results.hidden = true;
    skeleton.hidden = false;
    output.hidden = false;
    title.textContent = 'Analyzing your message';
    status.textContent = 'Analyzing your message. Please wait.';
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ message: message.value.trim() }),
        signal: controller.signal,
      });
      if (!response.ok) {
        if (response.status === 404 || response.status === 405 || response.status >= 500) {
          throw new Error('The analysis service is unavailable. Please check that the backend is running and try again.');
        }
        if (response.status === 429) throw new Error('Too many requests. Please wait a moment and try again.');
        throw new Error(`The analysis request failed (HTTP ${response.status}). Please try again.`);
      }
      let data;
      try { data = await response.json(); } catch (failure) {
        if (failure.name === 'AbortError') throw failure;
        throw new Error('The analysis service did not return valid JSON. Please try again.');
      }
      render(validateResponse(data));
      status.textContent = 'Analysis complete. Review the results below.';
    } catch (failure) {
      output.hidden = true;
      error.textContent = failure.name === 'AbortError'
        ? 'The analysis request timed out. Please try again.'
        : failure instanceof TypeError
          ? 'Could not connect to the analysis service. Check your connection and that the backend is running.'
          : failure.message;
      error.hidden = false;
      status.textContent = 'Analysis could not be completed.';
    } finally {
      window.clearTimeout(timeout);
      setBusy(false);
      if (!output.hidden) title.focus();
    }
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
