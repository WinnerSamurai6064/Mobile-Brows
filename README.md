# 📱 Mobile Cloud Browser

A mobile-first remote browser streaming service. The real browser runs inside your Ubuntu VM using Playwright/Chromium. Your phone is only a viewer and controller — all browsing, cookies, sessions, and downloads happen from the VM.

---

## How It Works

```
Your Phone  ──WebSocket──▶  Node.js Server  ──Playwright──▶  Chromium (VM)
   canvas   ◀──JPEG frames──                ◀──screenshots──
touch/type  ──events──▶                     ──click/type──▶
```

1. Playwright launches Chromium headlessly on the VM.
2. A screenshot loop captures JPEG frames and sends them over WebSocket.
3. Your phone renders frames on a `<canvas>`.
4. Touch/tap/swipe/type events on the canvas are forwarded to Playwright, which drives the real browser.
5. Downloads land in the VM's `downloads/` folder.

**This is NOT VNC. NOT noVNC. NOT an iframe. NOT a remote desktop.**

---

## Requirements

- Ubuntu 20.04+ VM (4GB RAM minimum)
- Node.js 20+
- Open port 3000 (or configure your firewall / reverse proxy)

---

## Installation

### 1. Create the GitHub repo and commit all files yourself, then SSH into your VM:

```bash
ssh USERNAME@VM_PUBLIC_IP
```

### 2. Install git and curl if needed:

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl
```

### 3. Clone your repo:

```bash
git clone https://github.com/MY_USERNAME/mobile-cloud-browser.git
cd mobile-cloud-browser
```

### 4. Make scripts executable:

```bash
chmod +x install.sh start.sh stop.sh
```

### 5. Run the installer:

```bash
./install.sh
```

This will install Node.js 20, npm dependencies, Playwright, and Chromium.

### 6. Start the server:

```bash
./start.sh
```

### 7. Open in your browser:

```
http://VM_PUBLIC_IP:3000
```

---

## Usage

- **URL bar** — type a URL and tap Go (or press Enter)
- **Canvas** — tap to click, swipe to scroll
- **Back / Forward / Reload** — standard browser navigation
- **Keyboard** — tap the keyboard icon to open a text input bridge; type on your phone keyboard and it sends to the remote browser
- **Settings** — switch Browser Mode (Mobile / Tablet / Desktop) and Stream Quality (320p / 480p / 720p)
- **Reset** — restart the browser session
- **Downloads** — view files downloaded in the VM

---

## Stopping the Server

```bash
./stop.sh
```

---

## Expose with Cloudflare Tunnel (Recommended)

```bash
# Install cloudflared
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o cloudflared.deb
sudo dpkg -i cloudflared.deb

# Start a tunnel (no account needed for quick test)
cloudflared tunnel --url http://localhost:3000
```

You'll get a public HTTPS URL you can open on your phone.

---

## Expose with Caddy (HTTPS Reverse Proxy)

```bash
sudo apt install -y caddy

# /etc/caddy/Caddyfile
yourdomain.com {
    reverse_proxy localhost:3000
}

sudo systemctl restart caddy
```

---

## Environment Variables

Copy `.env.example` to `.env` in the `server/` folder and adjust as needed:

```bash
cp .env.example server/.env
```

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP/WS server port |
| `DEFAULT_BROWSER_MODE` | `mobile` | Starting browser mode |
| `DEFAULT_STREAM_QUALITY` | `480` | Starting stream quality (320/480/720) |
| `SESSION_TIMEOUT_MINUTES` | `15` | Idle timeout before session reset |
| `DOWNLOAD_DIR` | `../downloads` | Where VM downloads are saved |

---

## Project Structure

```
mobile-cloud-browser/
├── README.md
├── install.sh
├── start.sh
├── stop.sh
├── .gitignore
├── .env.example
├── server/
│   ├── package.json
│   ├── server.js          ← HTTP + WebSocket server
│   └── browser-session.js ← Playwright session manager
├── public/
│   ├── index.html         ← Mobile-first UI shell
│   ├── app.js             ← WebSocket client + canvas controller
│   └── style.css          ← Dark mobile-native styles
└── downloads/
    └── .gitkeep
```
