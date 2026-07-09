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

const { v4: uuidv4 } = require("uuid");
const { ExpressPeerServer } = require("peer");
const { WebSocketServer } = require("ws");

app.set("view engine", "ejs");

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
app.use(express.static("public"));
// Serve the PeerJS browser client from node_modules so the app
// doesn't depend on an external CDN being reachable.
app.use(
  "/vendor/peerjs",
  express.static(path.join(__dirname, "node_modules", "peerjs", "dist"))
);

app.get("/", (req, res) => {
  res.redirect(`/${uuidv4()}`);
});

app.get("/:room", (req, res) => {
  res.render("room", { roomId: req.params.room });
});

io.on("connection", (socket) => {
  socket.on("join-room", (roomId, userId, userName) => {
    socket.join(roomId);

    // Give the joining client a moment to set up its media stream
    // before others try to call it.
    setTimeout(() => {
      socket.to(roomId).emit("user-connected", userId);
    }, 1000);

    socket.on("message", (message) => {
      io.to(roomId).emit("createMessage", message, userName);
    });

    socket.on("disconnect", () => {
      socket.to(roomId).emit("user-disconnected", userId);
    });
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
