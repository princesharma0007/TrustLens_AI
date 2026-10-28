'use strict';

// Selection is local. Only an explicit Analyze action sends multipart data.
const screenshotInput = document.querySelector('#screenshot-input');
if (screenshotInput) {
  const tabs = [...document.querySelectorAll('.analyzer-tab')];
  const textPanel = document.querySelector('#text-panel');
  const screenshotPanel = document.querySelector('#screenshot-panel');
  const outputPanel = document.querySelector('#analysis-output');
  const preview = document.querySelector('#screenshot-preview');
  const image = document.querySelector('#screenshot-image');
  const actions = document.querySelector('#screenshot-actions');
  const error = document.querySelector('#screenshot-error');
  const status = document.querySelector('#screenshot-status');
  const fileName = document.querySelector('#screenshot-name');
  const fileSize = document.querySelector('#screenshot-size');
  const maxBytes = 5 * 1024 * 1024;
  const formats = new Map([
    ['image/png', /\.png$/i],
    ['image/jpeg', /\.jpe?g$/i],
    ['image/webp', /\.webp$/i],
  ]);
  let objectUrl = null;
  let fallbackReader = null;
  let selectionVersion = 0;
  const panel = document.querySelector('#screenshot-panel');
  const analyzeButton = document.querySelector('#analyze-screenshot');
  const available = panel.dataset.analysisAvailable === 'true';
  let selectedFile = null;
  let busy = false;

  function updateControls() {
    analyzeButton.disabled = !available || !selectedFile || busy;
    screenshotInput.disabled = busy;
    document.querySelector('#change-screenshot').disabled = busy;
    document.querySelector('#remove-screenshot').disabled = busy;
  }
  updateControls();
  document.addEventListener('trustlens:analysis-state', (event) => {
    busy = event.detail.busy;
    analyzeButton.textContent = busy && event.detail.source === 'image' ? 'Analyzing screenshot…' : 'Analyze Screenshot';
    updateControls();
  });
  analyzeButton.addEventListener('click', () => {
    if (available && selectedFile && !busy) window.TrustLensAnalysis?.analyzeImage(selectedFile);
  });

  document.querySelector('.analyzer-tabs').hidden = false;
  function activateTab(tab) {
    if (tab.disabled || tab.getAttribute('aria-selected') === 'true') return;
    const showText = tab.id === 'text-tab';
    tabs.forEach((item) => {
      const active = item === tab;
      item.setAttribute('aria-selected', String(active));
      item.tabIndex = active ? 0 : -1;
    });
    textPanel.hidden = !showText;
    screenshotPanel.hidden = showText;
    outputPanel.hidden = outputPanel.dataset.hasResult !== 'true' || outputPanel.dataset.source !== (showText ? 'text' : 'image');
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activateTab(tab));
    tab.addEventListener('keydown', (event) => {
      const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
      if (!keys.includes(event.key) || tab.disabled) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      activateTab(tabs[next]);
      tabs[next].focus();
    });
  });

  function releasePreview() {
    selectionVersion += 1;
    selectedFile = null;
    if (outputPanel.dataset.source === 'image') {
      outputPanel.hidden = true;
      outputPanel.dataset.hasResult = 'false';
    }
    updateControls();
    image.onload = null;
    image.onerror = null;
    if (fallbackReader) {
      fallbackReader.abort();
      fallbackReader = null;
    }
    image.removeAttribute('src');
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
    preview.hidden = true;
    actions.hidden = true;
    fileName.textContent = '';
    fileSize.textContent = '';
  }

  function clearError() {
    error.hidden = true;
    error.textContent = '';
    screenshotInput.removeAttribute('aria-invalid');
  }

  function rejectFile(message) {
    releasePreview();
    screenshotInput.value = '';
    error.textContent = message;
    error.hidden = false;
    screenshotInput.setAttribute('aria-invalid', 'true');
    status.textContent = 'No image selected. Choose another screenshot.';
  }

  screenshotInput.addEventListener('change', () => {
    if (busy) return;
    const file = screenshotInput.files[0];
    // Cancelling the native picker leaves the existing preview unchanged.
    if (!file) return;
    releasePreview();
    clearError();
    const extension = formats.get(file.type);
    if (!extension || !extension.test(file.name)) {
      rejectFile('Choose a PNG, JPG, or WebP image. Other file types are not supported.');
      return;
    }
    if (file.size === 0 || file.size > maxBytes) {
      rejectFile(file.size === 0 ? 'This image is empty. Choose another screenshot.' : 'This image exceeds 5 MB. Choose a smaller screenshot.');
      return;
    }
    const version = selectionVersion;
    fileName.textContent = file.name;
    fileSize.textContent = file.size < 1024 * 1024
      ? `${(file.size / 1024).toFixed(1)} KB`
      : `${(file.size / (1024 * 1024)).toFixed(2)} MB`;
    actions.hidden = false;
    status.textContent = 'Opening a local preview. No image is being uploaded.';
    image.onload = () => {
      if (version !== selectionVersion) return;
      preview.hidden = false;
      selectedFile = file;
      updateControls();
      status.textContent = available ? 'Screenshot ready. Choose Analyze Screenshot to send it for local OCR and analysis.' : 'Local preview only. Screenshot analysis is unavailable on this server.';
    };
    // Use an object URL for efficient local preview, with a local fallback
    // for environments that restrict blob image sources.
    // Neither path sends the image to the server or writes it to storage.
    image.onerror = () => {
      if (version !== selectionVersion) return;
      image.onerror = () => {
        if (version === selectionVersion) rejectFile('This image could not be displayed. It may be damaged or unsupported. Choose another image.');
      };
      fallbackReader = new FileReader();
      fallbackReader.onload = (event) => {
        if (version !== selectionVersion) return;
        fallbackReader = null;
        image.src = event.target.result;
      };
      fallbackReader.onerror = () => {
        if (version === selectionVersion) rejectFile('This image could not be read. Please choose it again.');
      };
      fallbackReader.readAsDataURL(file);
    };
    try {
      objectUrl = URL.createObjectURL(file);
      image.src = objectUrl;
    } catch {
      rejectFile('A local preview could not be created. Please choose the image again.');
    }
  });

  document.querySelector('#change-screenshot').addEventListener('click', () => screenshotInput.click());
  document.querySelector('#remove-screenshot').addEventListener('click', () => {
    releasePreview();
    screenshotInput.value = '';
    clearError();
    status.textContent = 'Image removed. Choose a screenshot to analyze.';
    screenshotInput.focus();
  });
  // Clear sensitive selections even when the browser caches the page in memory.
  window.addEventListener('pagehide', () => {
    releasePreview();
    screenshotInput.value = '';
  });
}
