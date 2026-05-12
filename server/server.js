'use strict';

require('dotenv').config();

const express    = require('express');
const http       = require('http');
const { WebSocketServer } = require('ws');
const path       = require('path');
const fs         = require('fs');
const BrowserSession = require('./browser-session');

// ── Config ────────────────────────────────────────────────────────────────
const PORT         = parseInt(process.env.PORT || '3000', 10);
const DOWNLOAD_DIR = path.resolve(process.env.DOWNLOAD_DIR || '../downloads');
const DEFAULT_MODE = process.env.DEFAULT_BROWSER_MODE   || 'mobile';
const DEFAULT_QUAL = parseInt(process.env.DEFAULT_STREAM_QUALITY || '480', 10);
const TIMEOUT_MIN  = parseInt(process.env.SESSION_TIMEOUT_MINUTES || '15', 10);

fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

// ── Express app ───────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ── Browser session ───────────────────────────────────────────────────────
let session = new BrowserSession({
  downloadDir: DOWNLOAD_DIR,
  mode:        DEFAULT_MODE,
  quality:     DEFAULT_QUAL,
});

let sessionReady = false;
(async () => {
  await session.launch();
  sessionReady = true;
  console.log('[server] browser session ready');
})();

// ── Idle timeout ──────────────────────────────────────────────────────────
let idleTimer = null;
function resetIdleTimer() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    console.log('[server] idle timeout — resetting session');
    await session.reset();
  }, TIMEOUT_MIN * 60 * 1000);
}
resetIdleTimer();

// ── REST API ──────────────────────────────────────────────────────────────
app.get('/api/status', (_req, res) => {
  res.json({ ok: true, session: session.status() });
});

app.post('/api/reset', async (_req, res) => {
  try {
    await session.reset();
    resetIdleTimer();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/downloads', (_req, res) => {
  try {
    const files = fs.readdirSync(DOWNLOAD_DIR)
      .filter(f => f !== '.gitkeep')
      .map(f => {
        const full = path.join(DOWNLOAD_DIR, f);
        const stat = fs.statSync(full);
        return { name: f, size: stat.size, mtime: stat.mtime };
      })
      .sort((a, b) => b.mtime - a.mtime);
    res.json({ ok: true, files });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── HTTP server + WS server ───────────────────────────────────────────────
const server = http.createServer(app);
const wss    = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', async (ws, req) => {
  console.log(`[ws] client connected from ${req.socket.remoteAddress}`);

  if (!sessionReady) {
    ws.send(JSON.stringify({ t: 'error', msg: 'Session not ready yet, please wait…' }));
  }

  // Start streaming frames to this client
  session.startStream(frameBuf => {
    if (ws.readyState === ws.OPEN) {
      ws.send(frameBuf, { binary: true });
    }
  });

  // Send current URL immediately
  ws.send(JSON.stringify({ t: 'url', url: session.currentUrl() }));

  ws.on('message', async (data) => {
    resetIdleTimer();
    try {
      const msg = JSON.parse(data.toString());
      await handleClientMessage(msg);
    } catch (e) {
      console.error('[ws] bad message:', e.message);
    }
  });

  ws.on('close', () => {
    console.log('[ws] client disconnected');
    session.stopStream();
  });

  ws.on('error', err => {
    console.error('[ws] error:', err.message);
  });
});

async function handleClientMessage(msg) {
  if (!session) return;

  switch (msg.t) {
    case 'navigate':
      await session.navigate(msg.url);
      break;

    case 'click':
      await session.click(msg.x, msg.y);
      break;

    case 'scroll':
      await session.scroll(msg.x, msg.y, msg.dx || 0, msg.dy || 0);
      break;

    case 'type':
      await session.type(msg.text);
      break;

    case 'key':
      await session.pressKey(msg.key);
      break;

    case 'back':
      await session.goBack();
      break;

    case 'forward':
      await session.goForward();
      break;

    case 'reload':
      await session.reload();
      break;

    case 'set_mode':
      await session.setMode(msg.mode);
      break;

    case 'set_quality':
      session.setQuality(msg.quality);
      break;

    case 'reset':
      await session.reset();
      break;

    default:
      console.warn('[ws] unknown message type:', msg.t);
  }
}

// ── Graceful shutdown ─────────────────────────────────────────────────────
process.on('SIGTERM', shutdown);
process.on('SIGINT',  shutdown);

async function shutdown() {
  console.log('[server] shutting down…');
  session.stopStream();
  await session.close();
  server.close(() => process.exit(0));
}

// ── Start ─────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log(`║  Mobile Cloud Browser running            ║`);
  console.log(`║  http://0.0.0.0:${PORT}                   ║`);
  console.log('╚══════════════════════════════════════════╝');
  console.log('');
});
