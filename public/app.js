'use strict';

// ── WebSocket connection ──────────────────────────────────────────────────
const WS_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;

let ws       = null;
let wsReady  = false;

// ── State ─────────────────────────────────────────────────────────────────
let currentMode    = 'mobile';
let currentQuality = 480;
let fpsCounter     = { frames: 0, last: Date.now() };

// ── DOM refs ──────────────────────────────────────────────────────────────
const canvas          = document.getElementById('screen');
const ctx             = canvas.getContext('2d');
const statusOverlay   = document.getElementById('status-overlay');
const statusText      = document.getElementById('status-text');
const urlInput        = document.getElementById('url-input');
const fpsBadge        = document.getElementById('fps-badge');
const keyboardBridge  = document.getElementById('keyboard-bridge');
const remoteTextInput = document.getElementById('remote-text-input');
const settingsPanel   = document.getElementById('settings-panel');
const downloadsPanel  = document.getElementById('downloads-panel');
const downloadsList   = document.getElementById('downloads-list');
const scrim           = document.getElementById('scrim');

// ── Connect ───────────────────────────────────────────────────────────────
function connect() {
  setStatus('Connecting…');
  ws = new WebSocket(WS_URL);
  ws.binaryType = 'arraybuffer';

  ws.addEventListener('open', () => {
    wsReady = true;
    console.log('[ws] connected');
    setStatus('Loading browser…');
  });

  ws.addEventListener('message', onMessage);

  ws.addEventListener('close', () => {
    wsReady = false;
    setStatus('Disconnected — retrying…');
    showOverlay(true);
    setTimeout(connect, 3000);
  });

  ws.addEventListener('error', () => {
    wsReady = false;
  });
}

function send(obj) {
  if (ws && wsReady && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

// ── Message handler ───────────────────────────────────────────────────────
async function onMessage(ev) {
  const data = ev.data;

  if (typeof data === 'string') {
    // JSON control message
    try {
      const msg = JSON.parse(data);
      if (msg.t === 'url')   urlInput.value = msg.url || '';
      if (msg.t === 'error') setStatus(msg.msg);
    } catch (_) {}
    return;
  }

  // Binary: header JSON line + JPEG bytes
  const buf   = new Uint8Array(data);
  const nlIdx = buf.indexOf(10); // '\n'
  if (nlIdx === -1) return;

  let meta;
  try {
    meta = JSON.parse(new TextDecoder().decode(buf.slice(0, nlIdx)));
  } catch (_) { return; }

  const jpeg = buf.slice(nlIdx + 1);
  if (!jpeg.length) return;

  await renderFrame(jpeg, meta);

  // FPS
  fpsCounter.frames++;
  const now = Date.now();
  if (now - fpsCounter.last >= 1000) {
    const fps = Math.round(fpsCounter.frames * 1000 / (now - fpsCounter.last));
    fpsBadge.textContent = `${fps} fps`;
    fpsBadge.classList.add('visible');
    fpsCounter.frames = 0;
    fpsCounter.last   = now;
  }

  // Update URL bar if changed
  if (meta.url && meta.url !== 'about:blank' && document.activeElement !== urlInput) {
    urlInput.value = meta.url;
  }
}

// ── Frame rendering ───────────────────────────────────────────────────────
function renderFrame(jpegBytes, meta) {
  return new Promise(resolve => {
    const blob = new Blob([jpegBytes], { type: 'image/jpeg' });
    const url  = URL.createObjectURL(blob);
    const img  = new Image();

    img.onload = () => {
      // Resize canvas to match frame dimensions (only if changed)
      if (canvas.width !== img.naturalWidth || canvas.height !== img.naturalHeight) {
        canvas.width  = img.naturalWidth;
        canvas.height = img.naturalHeight;
      }
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      showOverlay(false);
      resolve();
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(); };
    img.src = url;
  });
}

// ── Overlay helpers ───────────────────────────────────────────────────────
function setStatus(msg) {
  statusText.textContent = msg;
}
function showOverlay(show) {
  statusOverlay.classList.toggle('hidden', !show);
}

// ── Canvas coordinate mapping ─────────────────────────────────────────────
// Returns normalised [0..1] coords relative to the rendered frame inside the canvas
function getRelativeCoords(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();

  // The canvas CSS fills the viewport but its pixel dimensions match the frame.
  // We need to map from screen pixels to [0-1] inside the rendered image area.
  const scaleX  = canvas.width  / rect.width;
  const scaleY  = canvas.height / rect.height;

  const px = (clientX - rect.left) * scaleX;
  const py = (clientY - rect.top)  * scaleY;

  return {
    x: Math.min(1, Math.max(0, px / canvas.width)),
    y: Math.min(1, Math.max(0, py / canvas.height)),
  };
}

// ── Touch & mouse events on canvas ───────────────────────────────────────
let touchStartX = 0;
let touchStartY = 0;
let touchStartTime = 0;
let longPressTimer = null;
let swipeTracking  = false;
let lastSwipeY     = 0;
let lastSwipeX     = 0;

const viewport = document.getElementById('viewport');

viewport.addEventListener('touchstart', e => {
  e.preventDefault();
  const t = e.touches[0];
  touchStartX   = t.clientX;
  touchStartY   = t.clientY;
  touchStartTime = Date.now();
  lastSwipeX    = t.clientX;
  lastSwipeY    = t.clientY;
  swipeTracking = true;

  // Long-press → right click
  longPressTimer = setTimeout(() => {
    longPressTimer = null;
    const coords = getRelativeCoords(t.clientX, t.clientY);
    send({ t: 'key', key: 'ContextMenu' });
  }, 600);
}, { passive: false });

viewport.addEventListener('touchmove', e => {
  e.preventDefault();
  if (!swipeTracking) return;
  const t = e.touches[0];

  const dx = lastSwipeX - t.clientX;
  const dy = lastSwipeY - t.clientY;

  clearTimeout(longPressTimer);
  longPressTimer = null;

  const coords = getRelativeCoords(t.clientX, t.clientY);
  send({ t: 'scroll', x: coords.x, y: coords.y, dx: dx * 2, dy: dy * 2 });

  lastSwipeX = t.clientX;
  lastSwipeY = t.clientY;
}, { passive: false });

viewport.addEventListener('touchend', e => {
  e.preventDefault();
  swipeTracking = false;

  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }

  const elapsed = Date.now() - touchStartTime;
  const dx = Math.abs(e.changedTouches[0].clientX - touchStartX);
  const dy = Math.abs(e.changedTouches[0].clientY - touchStartY);

  // Only fire click if not a swipe
  if (elapsed < 500 && dx < 10 && dy < 10) {
    const coords = getRelativeCoords(touchStartX, touchStartY);
    send({ t: 'click', x: coords.x, y: coords.y });
  }
}, { passive: false });

// Mouse fallback (desktop testing)
let mouseDown = false;
let mouseDownX = 0, mouseDownY = 0;

viewport.addEventListener('mousedown', e => {
  mouseDown  = true;
  mouseDownX = e.clientX;
  mouseDownY = e.clientY;
});

viewport.addEventListener('mousemove', e => {
  if (!mouseDown) return;
  const dx = mouseDownX - e.clientX;
  const dy = mouseDownY - e.clientY;
  if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
    const coords = getRelativeCoords(e.clientX, e.clientY);
    send({ t: 'scroll', x: coords.x, y: coords.y, dx: dx * 1.5, dy: dy * 1.5 });
    mouseDownX = e.clientX;
    mouseDownY = e.clientY;
  }
});

viewport.addEventListener('mouseup', e => {
  if (!mouseDown) return;
  mouseDown = false;
  const dx = Math.abs(e.clientX - mouseDownX);
  const dy = Math.abs(e.clientY - mouseDownY);
  if (dx < 5 && dy < 5) {
    const coords = getRelativeCoords(e.clientX, e.clientY);
    send({ t: 'click', x: coords.x, y: coords.y });
  }
});

viewport.addEventListener('wheel', e => {
  e.preventDefault();
  const coords = getRelativeCoords(e.clientX, e.clientY);
  send({ t: 'scroll', x: coords.x, y: coords.y, dx: e.deltaX, dy: e.deltaY });
}, { passive: false });

// ── URL bar ───────────────────────────────────────────────────────────────
document.getElementById('btn-go').addEventListener('click', navigateFromBar);
urlInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); navigateFromBar(); }
});

function navigateFromBar() {
  const val = urlInput.value.trim();
  if (!val) return;
  send({ t: 'navigate', url: val });
  urlInput.blur();
}

// Allow normal text selection / cursor in URL input
urlInput.addEventListener('touchstart', e => { e.stopPropagation(); }, { passive: true });
urlInput.addEventListener('touchmove',  e => { e.stopPropagation(); }, { passive: true });

// ── Nav buttons ───────────────────────────────────────────────────────────
document.getElementById('btn-back')   .addEventListener('click', () => send({ t: 'back'    }));
document.getElementById('btn-forward').addEventListener('click', () => send({ t: 'forward' }));
document.getElementById('btn-reload') .addEventListener('click', () => send({ t: 'reload'  }));

// ── Keyboard bridge ───────────────────────────────────────────────────────
document.getElementById('btn-keyboard').addEventListener('click', () => {
  keyboardBridge.classList.remove('hidden');
  setTimeout(() => remoteTextInput.focus(), 100);
});
document.getElementById('btn-close-keyboard').addEventListener('click', () => {
  keyboardBridge.classList.add('hidden');
});

document.getElementById('btn-send-text').addEventListener('click', sendRemoteText);
remoteTextInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendRemoteText(); }
});

function sendRemoteText() {
  const text = remoteTextInput.value;
  if (!text) return;
  send({ t: 'type', text });
  remoteTextInput.value = '';
}

// Allow keyboard input in the bridge textarea
remoteTextInput.addEventListener('touchstart', e => { e.stopPropagation(); }, { passive: true });
remoteTextInput.addEventListener('touchmove',  e => { e.stopPropagation(); }, { passive: true });

// Key shortcuts
document.querySelectorAll('.key-shortcut').forEach(btn => {
  btn.addEventListener('click', () => {
    send({ t: 'key', key: btn.dataset.key });
  });
});

// ── Settings panel ────────────────────────────────────────────────────────
document.getElementById('btn-settings').addEventListener('click', openSettings);
document.getElementById('btn-close-settings').addEventListener('click', closeSettings);
scrim.addEventListener('click', closeAll);

function openSettings() {
  settingsPanel.classList.remove('hidden');
  scrim.classList.remove('hidden');
}
function closeSettings() {
  settingsPanel.classList.add('hidden');
  if (downloadsPanel.classList.contains('hidden')) scrim.classList.add('hidden');
}
function closeAll() {
  settingsPanel.classList.add('hidden');
  downloadsPanel.classList.add('hidden');
  scrim.classList.add('hidden');
}

// Mode buttons
document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const mode = btn.dataset.mode;
    if (mode === currentMode) return;
    currentMode = mode;
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    send({ t: 'set_mode', mode });
    showOverlay(true);
    setStatus(`Switching to ${mode} mode…`);
  });
});

// Quality buttons
document.querySelectorAll('.quality-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const q = parseInt(btn.dataset.quality, 10);
    currentQuality = q;
    document.querySelectorAll('.quality-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    send({ t: 'set_quality', quality: q });
  });
});

// Reset
document.getElementById('btn-reset').addEventListener('click', async () => {
  closeAll();
  showOverlay(true);
  setStatus('Resetting browser…');
  send({ t: 'reset' });
});

// ── Downloads panel ───────────────────────────────────────────────────────
document.getElementById('btn-downloads').addEventListener('click', () => {
  closeSettings();
  loadDownloads();
  downloadsPanel.classList.remove('hidden');
  scrim.classList.remove('hidden');
});
document.getElementById('btn-close-downloads').addEventListener('click', () => {
  downloadsPanel.classList.add('hidden');
  scrim.classList.add('hidden');
});

async function loadDownloads() {
  downloadsList.innerHTML = '<div class="empty-state">Loading…</div>';
  try {
    const res   = await fetch('/api/downloads');
    const data  = await res.json();
    if (!data.files || data.files.length === 0) {
      downloadsList.innerHTML = '<div class="empty-state">No downloads yet</div>';
      return;
    }
    downloadsList.innerHTML = data.files.map(f => `
      <div class="download-item">
        <div class="dl-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
            <polyline points="13 2 13 9 20 9"/>
          </svg>
        </div>
        <div class="dl-info">
          <div class="dl-name">${escHtml(f.name)}</div>
          <div class="dl-meta">${formatBytes(f.size)} · ${formatDate(f.mtime)}</div>
        </div>
      </div>
    `).join('');
  } catch (e) {
    downloadsList.innerHTML = '<div class="empty-state">Failed to load downloads</div>';
  }
}

function escHtml(s) {
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function formatBytes(n) {
  if (n < 1024)       return `${n} B`;
  if (n < 1024*1024)  return `${(n/1024).toFixed(1)} KB`;
  return `${(n/1024/1024).toFixed(1)} MB`;
}
function formatDate(d) {
  try {
    return new Date(d).toLocaleString(undefined, { dateStyle:'short', timeStyle:'short' });
  } catch (_) { return ''; }
}

// ── Boot ──────────────────────────────────────────────────────────────────
connect();
