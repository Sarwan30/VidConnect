# Together

Together is a fast, browser-based video meeting platform — create a room,
share a link, and start talking. No downloads, no sign-ups.

Built with Express, Socket.IO, and PeerJS (WebRTC).

## Features

- **Create or join** meetings from a modern landing page (dark & light themes)
- **Waiting room**: the host gets a notification and admits (or denies) each guest
- **Host controls**: participants panel with remove-from-meeting
- Video/audio calls with multiple participants per room
- **Screen sharing** with automatic camera restore, and click-to-pin any tile
- Pre-join lobby with camera preview, mic/camera toggles, and device pickers
- In-call chat with sounds, unread badge, and join/leave notices
- Mute indicators on video tiles
- TURN relay support for calls across different networks
- Responsive layout for desktop, tablet, and mobile; installable as a PWA

## Getting started

```bash
npm install
npm start        # or: npm run dev (auto-restarts on changes)
```

Then open the URL printed in the terminal (default <http://localhost:3030>).

## Using it from other devices (WiFi / LAN)

Browsers only allow camera/microphone access on `localhost` or over HTTPS,
so the server automatically switches to HTTPS when it finds certificates
in `certs/`. To (re)generate a self-signed certificate (replace the IP
with this machine's LAN IP from `ipconfig`):

```bash
mkdir -p certs
openssl req -x509 -newkey rsa:2048 -keyout certs/key.pem -out certs/cert.pem \
  -days 365 -nodes -subj "/CN=Together" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:192.168.1.8"
```

Then `npm start` and open the `https://<your-ip>:3030` URL it prints from
any device on the same WiFi (accept the self-signed-certificate warning).

## Configuration

Set these in a local `.env` file (gitignored — Node loads it natively via
`--env-file-if-exists`) or in your host's environment settings:

- `PORT` — server port (default `3030`)
- `TURN_URLS` — comma-separated TURN URLs (required for calls across
  different networks, e.g. mobile data ↔ WiFi; free tier at metered.ca)
- `TURN_USERNAME` / `TURN_CREDENTIAL` — TURN credentials

Open `/ice-config` from the app's own pages to verify TURN is configured.

## Deploying

Works out of the box on any host that runs a persistent Node server
(Render, Railway, Fly.io — **not** Vercel, which is serverless and cannot
hold the WebSocket connections this app needs):

- Build command: `npm install`
- Start command: `npm start`
- Add the `TURN_*` environment variables in the host's dashboard

The platform's HTTPS proxy is detected automatically (no `certs/` needed).

## How it works

- **Express** serves the landing/room pages and static assets (client JS
  is minified in memory at startup)
- **Socket.IO** handles signaling: join requests, host admission, chat,
  mute states, and presence
- **PeerJS** (mounted at `/peerjs` on the same server) brokers the
  WebRTC peer-to-peer video/audio connections

---

Developed by [Sarwan Kumar](https://www.linkedin.com/in/sarwankumar-swe/)
