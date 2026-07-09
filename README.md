# VidConnect

A simple video chat app (Zoom-style) built with Express, Socket.IO, and PeerJS (WebRTC).

## Features

- Video/audio calls with multiple participants per room
- Pre-join lobby with camera preview and name entry
- Screen sharing (with automatic camera restore when sharing stops)
- Leave / end-call button with a rejoin screen
- Unique room links — opening `/` redirects to a new room, share the URL to invite others
- Text chat with name labels, timestamps, and join/leave notifications
- Mute microphone / stop camera toggles, participant counter, copy-invite-link button
- Responsive layout with a mobile chat view

## Getting started

```bash
npm install
npm start        # or: npm run dev (auto-restarts on changes)
```

Then open the URL printed in the terminal. You'll be redirected to a new
room — copy the URL (or use the invite button) and open it in another tab
or on another device on the same network to join the call.

## Using it from other devices (WiFi / LAN)

Browsers only allow camera/microphone access on `localhost` or over HTTPS,
so the server automatically switches to HTTPS when it finds certificates
in `certs/`. To (re)generate a self-signed certificate, run this from the
project folder (replace `192.168.1.8` with this PC's WiFi IP from
`ipconfig` if it changes):

```bash
mkdir -p certs
openssl req -x509 -newkey rsa:2048 -keyout certs/key.pem -out certs/cert.pem \
  -days 365 -nodes -subj "/CN=VidConnect" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:192.168.1.8"
```

Then `npm start` and open the `https://<your-ip>:3030` URL it prints from
any device on the same WiFi. The first time, the browser shows a warning
because the certificate is self-signed — click **Advanced → Proceed** to
continue. Delete the `certs/` folder to go back to plain HTTP.

## How it works

- **Express** serves the room page (`views/room.ejs`) and static assets.
- **Socket.IO** handles signaling: who joined/left a room, and chat messages.
- **PeerJS** (mounted at `/peerjs` on the same server) brokers the WebRTC
  peer-to-peer video/audio connections between participants.

## Configuration

- `PORT` environment variable sets the server port (default `3030`).
