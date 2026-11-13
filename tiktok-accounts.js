/* Optional, isolated add-on. No existing provider or scheduler state is read. */
(() => {
  'use strict';
  const panel = document.getElementById('tab-tiktok');
  if (!panel) return;
  const input = panel.querySelector('#tt-service-url');
  const button = panel.querySelector('#tt-connect');
  const frame = panel.querySelector('#tt-workspace');
  const message = panel.querySelector('#tt-message');
  const storageKey = 'madara_tiktok_workspace_url_v1';
  let origin = '';
  const back = document.createElement('button');
  back.id = 'tt-back-to-panel';
  back.type = 'button';
  back.textContent = '← Back to main panel';
  back.addEventListener('click', () => {
    const previous = document.querySelector('.tab-btn[data-tab="order"]');
    if (previous) previous.click();
  });
  panel.prepend(back);
  try { input.value = localStorage.getItem(storageKey) || ''; } catch (_) {}
  function visibility() {
    const focused = panel.classList.contains('active');
    document.body.classList.toggle('tt-focus-mode', focused);
    if (frame.contentWindow && origin) frame.contentWindow.postMessage({type:'madara-tiktok-visibility',visible:focused && !document.hidden}, origin);
  }
  button.addEventListener('click', () => {
    try {
      const url = new URL(input.value.trim());
      if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw Error('Enter just the HTTPS service origin, such as https://your-service.onrender.com.');
      // The remote browser is a separate origin with its own member login.
      // Same-origin embedding would weaken the iframe sandbox boundary.
      if (url.origin === location.origin) throw Error('Use the separate TikTok browser service URL, not this panel URL.');
      origin = url.origin;
      frame.src = origin + '/';
      frame.hidden = false;
      panel.classList.add('tt-connected');
      try { localStorage.setItem(storageKey, origin); } catch (_) {}
      message.textContent = 'Sign in to your TikTok workspace below. If embedding is blocked, set ALLOWED_EMBED_ORIGINS on the browser service to this panel’s origin: ' + location.origin;
    } catch (error) { message.textContent = error.message || 'Enter a valid HTTPS service URL.'; }
  });
  frame.addEventListener('load', visibility);
  new MutationObserver(visibility).observe(panel, {attributes:true,attributeFilter:['class']});
  document.addEventListener('visibilitychange', visibility);
  visibility();
})();
