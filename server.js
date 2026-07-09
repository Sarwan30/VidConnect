const path = require("path");
const fs = require("fs");
const os = require("os");
const express = require("express");
const app = express();

// Serve over HTTPS when certs are present (required for camera access
// from other devices — browsers only allow getUserMedia on localhost
// or secure origins). Generate certs into ./certs (see README).
const certDir = path.join(__dirname, "certs");
const useHttps =
  fs.existsSync(path.join(certDir, "key.pem")) &&
  fs.existsSync(path.join(certDir, "cert.pem"));

const server = useHttps
  ? require("https").createServer(
      {
        key: fs.readFileSync(path.join(certDir, "key.pem")),
        cert: fs.readFileSync(path.join(certDir, "cert.pem")),
      },
      app
    )
  : require("http").Server(app);

const { ExpressPeerServer } = require("peer");
const { WebSocketServer } = require("ws");

app.set("view engine", "ejs");

// Gzip every response — HTML, CSS, JS shrink to a fraction of their size.
app.use(require("compression")());

// Client is served from this same server, so no CORS config is needed.
const io = require("socket.io")(server);

const peerServer = ExpressPeerServer(server, {
  debug: true,
  // By default the peer server attaches a ws server that rejects every
  // WebSocket upgrade on this HTTP server that isn't its own path
  // (including Socket.IO's), corrupting those handshakes. Attach with
  // noServer and only claim upgrades for the PeerJS path instead.
  createWebSocketServer: (options) => {
    const wss = new WebSocketServer({ noServer: true });
    server.on("upgrade", (req, socket, head) => {
      const pathname = new URL(req.url, "http://localhost").pathname;
      if (pathname === options.path) {
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit("connection", ws, req);
        });
      }
    });
    return wss;
  },
});

app.use("/peerjs", peerServer);

// Serve a minified build of the client script: compact, and mangled
// variable names make the shipped code much harder to read. Falls
// back to the original file if minification fails.
let minifiedScript = null;
require("terser")
  .minify(fs.readFileSync(path.join(__dirname, "public", "script.js"), "utf8"), {
    compress: true,
    mangle: true,
  })
  .then((result) => {
    minifiedScript = result.code;
  })
  .catch((error) => {
    console.error("Could not minify script.js, serving original:", error.message);
  });

app.get("/script.js", (req, res) => {
  res.setHeader("Cache-Control", "no-cache");
  if (minifiedScript) {
    res.type("application/javascript").send(minifiedScript);
  } else {
    res.sendFile(path.join(__dirname, "public", "script.js"));
  }
});

// Images and icons rarely change: cache for a week. Everything else
// revalidates with ETags (cheap 304s) so UI updates apply immediately.
app.use(
  express.static("public", {
    setHeaders(res, filePath) {
      if (/\.(png|webp|jpg|jpeg|svg|ico)$/i.test(filePath)) {
        res.setHeader("Cache-Control", "public, max-age=604800");
      } else {
        res.setHeader("Cache-Control", "no-cache");
      }
    },
  })
);
// Serve the PeerJS browser client from node_modules so the app
// doesn't depend on an external CDN being reachable.
app.use(
  "/vendor/peerjs",
  express.static(path.join(__dirname, "node_modules", "peerjs", "dist"), {
    maxAge: "7d",
    immutable: true,
  })
);

// WebRTC ICE servers for the browser. STUN alone only works when a
// direct peer-to-peer path exists; calls between different networks
// (e.g. mobile data <-> WiFi) usually need a TURN relay. Configure one
// via env vars: TURN_URLS (comma-separated), TURN_USERNAME, TURN_CREDENTIAL.
app.get("/ice-config", (req, res) => {
  // Only hand TURN credentials to the app's own pages — blocks other
  // sites (and curl scripts) from burning the relay bandwidth quota.
  const source = req.get("origin") || req.get("referer") || "";
  let sameSite = false;
  try {
    sameSite = new URL(source).host === req.get("host");
  } catch (e) {
    sameSite = false;
  }
  if (!sameSite) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const iceServers = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:global.stun.twilio.com:3478" },
  ];
  const { TURN_URLS, TURN_USERNAME, TURN_CREDENTIAL } = process.env;
  if (TURN_URLS && TURN_USERNAME && TURN_CREDENTIAL) {
    for (const url of TURN_URLS.split(",")) {
      iceServers.push({
        urls: url.trim(),
        username: TURN_USERNAME,
        credential: TURN_CREDENTIAL,
      });
    }
  }
  res.json({ iceServers });
});

// In-memory room state for the waiting-room (admit) flow.
// roomId -> { host, members: Map<socketId,{userId,userName}>,
//             pending: Map<socketId,{userId,userName}>, approved: Set<socketId> }
const rooms = new Map();
function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, { host: null, members: new Map(), pending: new Map(), approved: new Set() });
  }
  return rooms.get(roomId);
}

app.get("/room-status/:roomId", (req, res) => {
  const room = rooms.get(req.params.roomId);
  res.json({
    active: !!room && room.members.size > 0,
    hasHost: !!(room && room.host),
  });
});

// Landing page: create or join a meeting.
app.get("/", (req, res) => {
  res.render("room", { roomId: "" });
});

app.get("/:room", (req, res) => {
  res.render("room", { roomId: req.params.room });
});

const validRoomId = (roomId) =>
  typeof roomId === "string" && /^[\w-]{6,64}$/.test(roomId);
const cleanName = (userName) =>
  String(userName || "Guest").trim().slice(0, 30) || "Guest";

io.on("connection", (socket) => {
  let joinedRoomId = null;
  let joinRequests = 0;
  const messageTimes = [];

  // A guest asks to enter; the host must admit them first.
  socket.on("request-join", (roomId, userId, userName) => {
    if (!validRoomId(roomId) || typeof userId !== "string") return;
    if (++joinRequests > 20) return; // spam guard per connection
    const room = getRoom(roomId);
    if (room.approved.has(socket.id)) {
      socket.emit("join-approved");
      return;
    }
    room.pending.set(socket.id, { userId, userName: cleanName(userName) });
    if (room.host) {
      io.to(room.host).emit("join-request", socket.id, cleanName(userName));
    } else {
      socket.emit("waiting-for-host");
    }
  });

  socket.on("admit-user", (roomId, requestId) => {
    const room = rooms.get(roomId);
    if (!room || room.host !== socket.id || !room.pending.has(requestId)) return;
    room.pending.delete(requestId);
    room.approved.add(requestId);
    io.to(requestId).emit("join-approved");
  });

  socket.on("deny-user", (roomId, requestId) => {
    const room = rooms.get(roomId);
    if (!room || room.host !== socket.id || !room.pending.has(requestId)) return;
    room.pending.delete(requestId);
    io.to(requestId).emit("join-denied");
  });

  socket.on("join-room", (roomId, userId, rawName, asHost) => {
    if (!validRoomId(roomId) || typeof userId !== "string" || joinedRoomId) return;
    const userName = cleanName(rawName);
    const room = getRoom(roomId);
    const canHost = asHost && !room.host && room.members.size === 0;
    // Guests cannot slip in without being admitted by the host.
    if (!room.approved.has(socket.id) && !canHost) {
      socket.emit("join-denied");
      return;
    }
    if (canHost) {
      room.host = socket.id;
      // Guests who arrived before the host started the meeting.
      for (const [requestId, info] of room.pending) {
        io.to(socket.id).emit("join-request", requestId, info.userName);
      }
    }
    joinedRoomId = roomId;
    room.members.set(socket.id, { userId, userName });
    socket.join(roomId);
    socket.to(roomId).emit("user-connected", userId, userName);

    socket.on("message", (message) => {
      if (typeof message !== "string") return;
      const text = message.trim().slice(0, 2000); // cap message size
      if (!text) return;
      // Rate limit: at most 15 messages per rolling 5 seconds
      const now = Date.now();
      while (messageTimes.length && now - messageTimes[0] > 5000) messageTimes.shift();
      if (messageTimes.length >= 15) return;
      messageTimes.push(now);
      io.to(roomId).emit("createMessage", text, userName);
    });

    // Relay mute status so tiles can show a muted-mic badge.
    socket.on("mute-state", (muted) => {
      socket.to(roomId).emit("mute-state", userId, !!muted);
    });
  });

  // Host can remove a participant from the meeting.
  socket.on("remove-user", (roomId, targetUserId) => {
    const room = rooms.get(roomId);
    if (!room || room.host !== socket.id) return;
    for (const [sid, info] of room.members) {
      if (info.userId === targetUserId && sid !== socket.id) {
        io.to(sid).emit("kicked");
        const target = io.sockets.sockets.get(sid);
        // Give the "kicked" packet a moment to flush before closing.
        setTimeout(() => target && target.disconnect(true), 150);
        break;
      }
    }
  });

  socket.on("disconnect", () => {
    if (!joinedRoomId) {
      for (const room of rooms.values()) room.pending.delete(socket.id);
      return;
    }
    const room = rooms.get(joinedRoomId);
    if (!room) return;
    const me = room.members.get(socket.id);
    room.members.delete(socket.id);
    room.approved.delete(socket.id);
    if (me) socket.to(joinedRoomId).emit("user-disconnected", me.userId, me.userName);

    // If the host left, hand hosting to the longest-present member so
    // new participants can still be admitted.
    if (room.host === socket.id) {
      room.host = null;
      const next = room.members.keys().next();
      if (!next.done) {
        room.host = next.value;
        io.to(room.host).emit("host-promoted");
        for (const [requestId, info] of room.pending) {
          io.to(room.host).emit("join-request", requestId, info.userName);
        }
      }
    }
    if (room.members.size === 0 && room.pending.size === 0) {
      rooms.delete(joinedRoomId);
    }
  });
});

const PORT = process.env.PORT || 3030;
const HOST = "0.0.0.0"; // Bind to all available network interfaces
server.listen(PORT, HOST, () => {
  const proto = useHttps ? "https" : "http";
  console.log(`Server is running (${proto.toUpperCase()}). Open it at:`);
  console.log(`  ${proto}://localhost:${PORT}`);
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs) {
      if (a.family === "IPv4" && !a.internal) {
        console.log(`  ${proto}://${a.address}:${PORT}  (other devices on your network)`);
      }
    }
  }
  if (!useHttps) {
    console.log(
      "Note: without HTTPS, the camera only works on localhost. " +
      "Add certs/key.pem and certs/cert.pem to enable access from other devices."
    );
  }
});
