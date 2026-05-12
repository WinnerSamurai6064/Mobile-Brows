'use strict';

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

// ── Viewport / UA profiles ────────────────────────────────────────────────
const MODES = {
  mobile: {
    viewport: { width: 390, height: 844 },
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) ' +
      'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  },
  tablet: {
    viewport: { width: 768, height: 1024 },
    userAgent:
      'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) ' +
      'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  },
  desktop: {
    viewport: { width: 1366, height: 768 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
      'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    isMobile: false,
    hasTouch: false,
    deviceScaleFactor: 1,
  },
};

// ── Quality presets ────────────────────────────────────────────────────────
const QUALITY = {
  320: { width: 320,  quality: 40, fps: 5  },
  480: { width: 480,  quality: 60, fps: 8  },
  720: { width: 720,  quality: 75, fps: 12 },
};

class BrowserSession {
  constructor({ downloadDir, mode = 'mobile', quality = 480 }) {
    this.downloadDir = path.resolve(downloadDir);
    this.modeName    = mode;
    this.qualityKey  = parseInt(quality, 10);
    this.browser     = null;
    this.context     = null;
    this.page        = null;
    this._streamLoop = null;
    this._running    = false;
    this._frameCallback = null;  // called with each JPEG Buffer
    this._lastUrl    = 'about:blank';

    fs.mkdirSync(this.downloadDir, { recursive: true });
  }

  // ── Launch ────────────────────────────────────────────────────────────────
  async launch() {
    if (this.browser) await this.close();

    this.browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-sync',
        '--metrics-recording-only',
        '--safebrowsing-disable-auto-update',
        '--mute-audio',
      ],
    });

    await this._createContext();
    console.log(`[session] launched — mode=${this.modeName} quality=${this.qualityKey}`);
  }

  async _createContext() {
    if (this.context) {
      try { await this.context.close(); } catch (_) {}
    }

    const profile = MODES[this.modeName] || MODES.mobile;

    this.context = await this.browser.newContext({
      ...profile,
      acceptDownloads: true,
    });

    // Handle downloads
    this.context.on('page', page => {
      page.on('download', async dl => {
        try {
          const dest = path.join(this.downloadDir, dl.suggestedFilename());
          await dl.saveAs(dest);
          console.log(`[download] saved: ${dest}`);
        } catch (e) {
          console.error('[download] error:', e.message);
        }
      });
    });

    this.page = await this.context.newPage();
    this.page.on('download', async dl => {
      try {
        const dest = path.join(this.downloadDir, dl.suggestedFilename());
        await dl.saveAs(dest);
        console.log(`[download] saved: ${dest}`);
      } catch (e) {
        console.error('[download] error:', e.message);
      }
    });

    await this.page.goto(this._lastUrl || 'https://www.google.com');
  }

  // ── Streaming ─────────────────────────────────────────────────────────────
  startStream(callback) {
    this._frameCallback = callback;
    this._running = true;
    this._scheduleFrame();
  }

  stopStream() {
    this._running = false;
    if (this._streamLoop) clearTimeout(this._streamLoop);
  }

  _scheduleFrame() {
    if (!this._running) return;
    const preset = QUALITY[this.qualityKey] || QUALITY[480];
    const delay  = Math.round(1000 / preset.fps);
    this._streamLoop = setTimeout(() => this._captureFrame(), delay);
  }

  async _captureFrame() {
    if (!this._running || !this.page) return;
    try {
      const preset  = QUALITY[this.qualityKey] || QUALITY[480];
      const profile = MODES[this.modeName]     || MODES.mobile;
      const vw      = profile.viewport.width;
      const vh      = profile.viewport.height;

      // Scale the screenshot down to the target width
      const scale   = preset.width / vw;
      const clipW   = vw;
      const clipH   = vh;

      const buf = await this.page.screenshot({
        type:    'jpeg',
        quality: preset.quality,
        clip:    { x: 0, y: 0, width: clipW, height: clipH },
        scale:   'css',
      });

      if (this._frameCallback && buf) {
        // Build a small header: JSON prefix + \n + binary
        const meta   = JSON.stringify({
          t:  'frame',
          w:  Math.round(clipW  * scale),
          h:  Math.round(clipH  * scale),
          url: this.page.url(),
        });
        const metaBuf = Buffer.from(meta + '\n');
        this._frameCallback(Buffer.concat([metaBuf, buf]));
      }
    } catch (e) {
      if (!e.message.includes('Target closed')) {
        console.error('[frame]', e.message);
      }
    }
    this._scheduleFrame();
  }

  // ── Browser actions ───────────────────────────────────────────────────────
  async navigate(url) {
    if (!this.page) return;
    let target = url.trim();
    if (!/^https?:\/\//i.test(target)) {
      // bare domain or search query
      if (/\.\w{2,}(\/|$)/.test(target)) {
        target = 'https://' + target;
      } else {
        target = 'https://www.google.com/search?q=' + encodeURIComponent(target);
      }
    }
    this._lastUrl = target;
    try {
      await this.page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (e) {
      console.error('[navigate]', e.message);
    }
  }

  async click(x, y) {
    if (!this.page) return;
    try {
      // x/y come in as fractions of the stream canvas (0–1)
      const profile = MODES[this.modeName] || MODES.mobile;
      const px = Math.round(x * profile.viewport.width);
      const py = Math.round(y * profile.viewport.height);
      await this.page.mouse.click(px, py);
    } catch (e) {
      console.error('[click]', e.message);
    }
  }

  async scroll(x, y, deltaX, deltaY) {
    if (!this.page) return;
    try {
      const profile = MODES[this.modeName] || MODES.mobile;
      const px = Math.round(x * profile.viewport.width);
      const py = Math.round(y * profile.viewport.height);
      await this.page.mouse.wheel(deltaX, deltaY);
    } catch (e) {
      console.error('[scroll]', e.message);
    }
  }

  async type(text) {
    if (!this.page) return;
    try {
      await this.page.keyboard.type(text, { delay: 20 });
    } catch (e) {
      console.error('[type]', e.message);
    }
  }

  async pressKey(key) {
    if (!this.page) return;
    try {
      await this.page.keyboard.press(key);
    } catch (e) {
      console.error('[key]', e.message);
    }
  }

  async goBack() {
    if (!this.page) return;
    try { await this.page.goBack({ timeout: 10000 }); } catch (_) {}
  }

  async goForward() {
    if (!this.page) return;
    try { await this.page.goForward({ timeout: 10000 }); } catch (_) {}
  }

  async reload() {
    if (!this.page) return;
    try { await this.page.reload({ timeout: 15000 }); } catch (_) {}
  }

  // ── Mode / quality switching ──────────────────────────────────────────────
  async setMode(mode) {
    if (!MODES[mode]) return;
    this.modeName = mode;
    this._lastUrl = this.page?.url() || this._lastUrl;
    await this._createContext();
  }

  setQuality(q) {
    const k = parseInt(q, 10);
    if (QUALITY[k]) this.qualityKey = k;
  }

  // ── Reset ─────────────────────────────────────────────────────────────────
  async reset() {
    this._lastUrl = 'https://www.google.com';
    await this._createContext();
  }

  // ── Info ──────────────────────────────────────────────────────────────────
  currentUrl() {
    try { return this.page?.url() || ''; } catch (_) { return ''; }
  }

  status() {
    return {
      running:    !!this.page,
      mode:       this.modeName,
      quality:    this.qualityKey,
      url:        this.currentUrl(),
      fps:        QUALITY[this.qualityKey]?.fps || 0,
    };
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────
  async close() {
    this.stopStream();
    try { await this.context?.close(); } catch (_) {}
    try { await this.browser?.close(); } catch (_) {}
    this.browser = this.context = this.page = null;
  }
}

module.exports = BrowserSession;
