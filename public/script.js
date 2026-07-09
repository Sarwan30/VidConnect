const socket = io("/");

const lobby = document.getElementById("lobby");
const lobbyPreview = document.getElementById("lobbyPreview");
const lobbyPreviewOff = document.getElementById("lobbyPreviewOff");
const lobbyError = document.getElementById("lobbyError");
const lobbyName = document.getElementById("lobbyName");
const lobbyGreeting = document.getElementById("lobbyGreeting");
const lobbyPreviewOffText = document.getElementById("lobbyPreviewOffText");
const lobbyMicBtn = document.getElementById("lobbyMicBtn");
const lobbyCamBtn = document.getElementById("lobbyCamBtn");
const joinBtn = document.getElementById("joinBtn");
const joinBtnText = document.getElementById("joinBtnText");
const appEl = document.getElementById("app");
const videoGrid = document.getElementById("video-grid");
const participantCount = document.getElementById("participantCount");
const muteButton = document.getElementById("muteButton");
const stopVideo = document.getElementById("stopVideo");
const screenShareBtn = document.getElementById("screenShareBtn");
const chatToggle = document.getElementById("chatToggle");
const chatClose = document.getElementById("chatClose");
const inviteButton = document.getElementById("inviteButton");
const leaveBtn = document.getElementById("leaveBtn");
const chatWindow = document.getElementById("chatWindow");
const messages = document.querySelector(".messages");
const chatInput = document.getElementById("chat_message");
const sendBtn = document.getElementById("send");
const toastEl = document.getElementById("toast");

let user = "Guest";
let myVideoStream = null;
let screenStream = null;
let myPeerId = null;
let joined = false;
let mediaSettled = false; // getUserMedia finished (successfully or not)
const peers = {}; // userId -> MediaConnection
const names = {}; // userId -> display name

/* ---------- Peer connection ---------- */

// Connect to the PeerJS server hosted by this same app, so it works
// from any device that can reach the server (not just localhost).
// ICE servers (STUN + optional TURN relay) come from the server so
// TURN credentials can be configured with env vars instead of code.
let peer = null;

const FALLBACK_ICE = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:global.stun.twilio.com:3478" },
];

fetch("/ice-config")
  .then((res) => res.json())
  .catch(() => ({ iceServers: FALLBACK_ICE }))
  .then((config) => createPeer(config.iceServers || FALLBACK_ICE));

function createPeer(iceServers) {
  try {
    peer = new Peer(undefined, {
      host: window.location.hostname,
      port: window.location.port || (window.location.protocol === "https:" ? 443 : 80),
      path: "/peerjs",
      secure: window.location.protocol === "https:",
      config: { iceServers },
    });

    peer.on("error", (error) => {
      console.error("PeerJS error:", error);
    });

    peer.on("open", (id) => {
      myPeerId = id;
      updateJoinState();
    });

    peer.on("call", (call) => {
      const callerName = (call.metadata && call.metadata.userName) || "Guest";
      names[call.peer] = callerName;
      call.answer(outgoingStream());
      registerCall(call.peer, call);
    });
  } catch (error) {
    console.error("Could not create PeerJS connection:", error);
    showLobbyError("Could not connect to the video server. Please reload the page.");
  }
}

/* ---------- Media helpers ---------- */

const activeVideoTrack = () =>
  (screenStream && screenStream.getVideoTracks()[0]) ||
  (myVideoStream && myVideoStream.getVideoTracks()[0]) ||
  null;

// The stream sent to other participants: mic audio plus whichever
// video source is active (screen share wins over camera).
const outgoingStream = () => {
  const tracks = [];
  if (myVideoStream) tracks.push(...myVideoStream.getAudioTracks());
  const video = activeVideoTrack();
  if (video) tracks.push(video);
  return tracks.length ? new MediaStream(tracks) : undefined;
};

const explainMediaError = (error) => {
  if (!window.isSecureContext) {
    return (
      "Camera access is blocked because this page is not secure. " +
      "Browsers only allow the camera on http://localhost or over HTTPS. " +
      "You opened: " + window.location.origin
    );
  }
  switch (error && error.name) {
    case "NotAllowedError":
      return "Camera/microphone permission was denied. Click the camera icon in the address bar to allow it, then reload.";
    case "NotFoundError":
      return "No camera or microphone was found on this device.";
    case "NotReadableError":
      return "The camera is already in use by another application (e.g. Zoom, Teams). Close it and reload.";
    default:
      return "Cannot access camera and microphone: " + (error && error.message);
  }
};

function showLobbyError(text) {
  lobbyError.textContent = text;
  lobbyError.classList.remove("hidden");
}

/* ---------- Lobby ---------- */

const hour = new Date().getHours();
lobbyGreeting.textContent =
  hour < 12 ? "Good morning!" : hour < 17 ? "Good afternoon!" : "Good evening!";

// Friendly note when arriving back here after leaving a call.
if (sessionStorage.getItem("vc-left")) {
  sessionStorage.removeItem("vc-left");
  setTimeout(() => showToast("You left the meeting"), 500);
}

if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
  lobbyPreviewOff.classList.remove("hidden");
  showLobbyError(
    "Camera access is not available. Browsers only allow the camera on " +
    "http://localhost or over HTTPS. You opened: " + window.location.origin
  );
  lobbyMicBtn.disabled = true;
  lobbyCamBtn.disabled = true;
  mediaSettled = true;
  updateJoinState();
} else {
  navigator.mediaDevices
    .getUserMedia({ audio: true, video: true })
    .then((stream) => {
      myVideoStream = stream;
      lobbyPreview.srcObject = stream;
      mediaSettled = true;
      updateJoinState();
      // Defensive: if the user somehow joined before the camera was
      // ready, show their tile and re-enable the media controls now.
      if (joined) {
        updateLocalTile();
        muteButton.disabled = false;
        stopVideo.disabled = false;
        screenShareBtn.disabled = false;
      }
    })
    .catch((error) => {
      console.error("Error accessing media devices:", error);
      lobbyPreviewOff.classList.remove("hidden");
      showLobbyError(explainMediaError(error));
      lobbyMicBtn.disabled = true;
      lobbyCamBtn.disabled = true;
      mediaSettled = true;
      updateJoinState();
    });
}

function updateJoinState() {
  if (myPeerId && mediaSettled) {
    joinBtn.disabled = false;
    joinBtnText.textContent = "Join meeting";
  }
}

/* ---------- Pre-join mic/camera toggles ---------- */

const setMicUI = (button, on) => {
  button.classList.toggle(button.classList.contains("preview-btn") ? "preview-btn--off" : "control-btn--off", !on);
  button.innerHTML = on
    ? `<i class="fas fa-microphone"></i>`
    : `<i class="fas fa-microphone-slash"></i>`;
};

const setCamUI = (button, on) => {
  button.classList.toggle(button.classList.contains("preview-btn") ? "preview-btn--off" : "control-btn--off", !on);
  button.innerHTML = on
    ? `<i class="fas fa-video"></i>`
    : `<i class="fas fa-video-slash"></i>`;
};

lobbyMicBtn.addEventListener("click", () => {
  const track = myVideoStream && myVideoStream.getAudioTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  setMicUI(lobbyMicBtn, track.enabled);
});

lobbyCamBtn.addEventListener("click", () => {
  const track = myVideoStream && myVideoStream.getVideoTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  setCamUI(lobbyCamBtn, track.enabled);
  lobbyPreviewOff.classList.toggle("hidden", track.enabled);
  if (!track.enabled) lobbyPreviewOffText.textContent = "Camera is off";
});

function joinMeeting() {
  if (joined || !myPeerId) return;
  joined = true;
  user = lobbyName.value.trim() || "Guest";

  lobby.classList.add("hidden");
  appEl.classList.remove("hidden");
  if (window.innerWidth <= 900) appEl.classList.remove("chat-open");

  if (myVideoStream) {
    addVideoTile("me", `${user} (You)`, new MediaStream(myVideoStream.getVideoTracks()), {
      muted: true,
      mirrored: true,
    });
    // Carry the pre-join mic/camera choices into the in-call controls.
    const audioTrack = myVideoStream.getAudioTracks()[0];
    const videoTrack = myVideoStream.getVideoTracks()[0];
    if (audioTrack) setMicUI(muteButton, audioTrack.enabled);
    if (videoTrack) setCamUI(stopVideo, videoTrack.enabled);
  } else {
    muteButton.disabled = true;
    stopVideo.disabled = true;
    screenShareBtn.disabled = true;
  }

  socket.emit("join-room", ROOM_ID, myPeerId, user);
}

joinBtn.addEventListener("click", joinMeeting);
lobbyName.addEventListener("keydown", (e) => {
  if (e.key === "Enter") joinMeeting();
});

/* ---------- Video tiles ---------- */

function addVideoTile(userId, label, stream, { muted = false, mirrored = false } = {}) {
  let tile = videoGrid.querySelector(`[data-tile="${CSS.escape(userId)}"]`);
  let video;
  if (!tile) {
    tile = document.createElement("div");
    tile.className = "video-tile";
    tile.dataset.tile = userId;

    video = document.createElement("video");
    video.autoplay = true;
    video.playsInline = true;
    video.addEventListener("loadedmetadata", () => {
      video.play().catch(() => {});
    });

    const name = document.createElement("span");
    name.className = "video-tile__name";

    tile.append(video, name);
    videoGrid.append(tile);
  } else {
    video = tile.querySelector("video");
  }

  tile.querySelector(".video-tile__name").textContent = label;
  video.muted = muted;
  video.classList.toggle("mirrored", mirrored);
  if (video.srcObject !== stream) video.srcObject = stream;
  updateParticipantCount();
}

function removeVideoTile(userId) {
  const tile = videoGrid.querySelector(`[data-tile="${CSS.escape(userId)}"]`);
  if (!tile) return;
  // Fade the tile out before removing it from the grid.
  tile.classList.add("video-tile--leaving");
  setTimeout(() => {
    tile.remove();
    updateParticipantCount();
  }, 220);
}

function updateParticipantCount() {
  participantCount.innerHTML =
    `<i class="fas fa-user-group"></i> ${Math.max(videoGrid.children.length, 1)}`;
}

function registerCall(userId, call) {
  peers[userId] = call;
  call.on("stream", (remoteStream) => {
    addVideoTile(userId, names[userId] || "Guest", remoteStream);
  });
  call.on("close", () => {
    removeVideoTile(userId);
  });
}

/* ---------- Room events ---------- */

socket.on("user-connected", (userId, userName) => {
  if (!joined) return;
  names[userId] = userName || "Guest";
  systemMessage(`${names[userId]} joined the meeting`);
  showToast(`${names[userId]} joined`);

  if (!peer) return;
  const stream = outgoingStream();
  if (!stream) return; // nothing to send; they will still see others
  const call = peer.call(userId, stream, { metadata: { userName: user } });
  if (call) registerCall(userId, call);
});

socket.on("user-disconnected", (userId, userName) => {
  if (peers[userId]) {
    peers[userId].close();
    delete peers[userId];
  }
  removeVideoTile(userId);
  const name = names[userId] || userName || "Guest";
  systemMessage(`${name} left the meeting`);
  showToast(`${name} left`);
});

/* ---------- Controls ---------- */

muteButton.addEventListener("click", () => {
  if (!myVideoStream) return;
  const audioTrack = myVideoStream.getAudioTracks()[0];
  if (!audioTrack) return;
  audioTrack.enabled = !audioTrack.enabled;
  setMicUI(muteButton, audioTrack.enabled);
});

stopVideo.addEventListener("click", () => {
  if (!myVideoStream) return;
  const videoTrack = myVideoStream.getVideoTracks()[0];
  if (!videoTrack) return;
  videoTrack.enabled = !videoTrack.enabled;
  setCamUI(stopVideo, videoTrack.enabled);
});

/* ---------- Screen share ---------- */

async function startScreenShare() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
    showToast("Screen sharing is not supported in this browser");
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
  } catch (error) {
    return; // user cancelled the picker
  }
  screenStream = stream;
  const screenTrack = screenStream.getVideoTracks()[0];
  // The browser's own "Stop sharing" bar also ends the track.
  screenTrack.addEventListener("ended", stopScreenShare);
  replaceOutgoingVideoTrack(screenTrack);
  updateLocalTile();
  screenShareBtn.classList.add("control-btn--active");
  showToast("You are sharing your screen");
}

function stopScreenShare() {
  if (!screenStream) return;
  screenStream.getTracks().forEach((t) => t.stop());
  screenStream = null;
  const cameraTrack = myVideoStream && myVideoStream.getVideoTracks()[0];
  if (cameraTrack) replaceOutgoingVideoTrack(cameraTrack);
  updateLocalTile();
  screenShareBtn.classList.remove("control-btn--active");
  showToast("Screen sharing stopped");
}

// Swap the video track inside every active call without renegotiating.
function replaceOutgoingVideoTrack(track) {
  Object.values(peers).forEach((call) => {
    const pc = call.peerConnection;
    if (!pc) return;
    const sender = pc.getSenders().find((s) => s.track && s.track.kind === "video");
    if (sender) sender.replaceTrack(track);
  });
}

function updateLocalTile() {
  if (!joined) return;
  const video = activeVideoTrack();
  addVideoTile("me", `${user} (You)`, video ? new MediaStream([video]) : null, {
    muted: true,
    mirrored: !screenStream, // never mirror a shared screen
  });
}

screenShareBtn.addEventListener("click", () => {
  if (screenStream) {
    stopScreenShare();
  } else {
    startScreenShare();
  }
});

/* ---------- Leave ---------- */

function leaveMeeting() {
  joined = false;
  Object.values(peers).forEach((call) => call.close());
  socket.disconnect();
  if (peer) peer.destroy();
  [myVideoStream, screenStream].forEach((stream) => {
    if (stream) stream.getTracks().forEach((t) => t.stop());
  });
  // Return to the landing page (the pre-join screen for this room).
  sessionStorage.setItem("vc-left", "1");
  window.location.reload();
}

leaveBtn.addEventListener("click", leaveMeeting);

/* ---------- Chat sounds (generated, no audio files needed) ---------- */

let audioCtx = null;
function getAudioCtx() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!audioCtx) audioCtx = new AC();
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

function playNote(ctx, freq, start, duration, volume) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(volume, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.05);
}

// Soft single blip when you send a message.
function playSendTone() {
  const ctx = getAudioCtx();
  if (!ctx) return;
  playNote(ctx, 740, ctx.currentTime, 0.12, 0.05);
}

// Gentle two-note chime when a message arrives.
function playReceiveTone() {
  const ctx = getAudioCtx();
  if (!ctx) return;
  const t = ctx.currentTime;
  playNote(ctx, 587, t, 0.12, 0.06);
  playNote(ctx, 880, t + 0.09, 0.18, 0.06);
}

/* ---------- Chat ---------- */

function sendMessage() {
  const value = chatInput.value.trim();
  if (value.length !== 0) {
    socket.emit("message", value);
    chatInput.value = "";
    playSendTone();
  }
}

sendBtn.addEventListener("click", sendMessage);
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendMessage();
});

// Build chat messages with DOM APIs (textContent) so user input
// can never be injected as HTML.
socket.on("createMessage", (message, userName) => {
  const isOwn = userName === user;
  if (!isOwn) {
    playReceiveTone();
    // Unread indicator when the chat panel is closed
    if (!appEl.classList.contains("chat-open")) showChatBadge();
  }

  const messageEl = document.createElement("div");
  messageEl.classList.add("message");
  if (isOwn) messageEl.classList.add("message--own");

  const meta = document.createElement("div");
  meta.className = "message__meta";
  const author = document.createElement("span");
  author.className = "message__author";
  author.textContent = isOwn ? "You" : userName;
  const time = document.createElement("span");
  time.className = "message__time";
  time.textContent = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  meta.append(author, time);

  const textEl = document.createElement("span");
  textEl.className = "message__text";
  textEl.textContent = message;

  messageEl.append(meta, textEl);
  messages.append(messageEl);
  chatWindow.scrollTop = chatWindow.scrollHeight;
});

function systemMessage(text) {
  const el = document.createElement("div");
  el.className = "message message--system";
  el.textContent = text;
  messages.append(el);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

function showChatBadge() {
  if (!chatToggle.querySelector(".chat-badge")) {
    const badge = document.createElement("span");
    badge.className = "chat-badge";
    chatToggle.append(badge);
  }
}

function clearChatBadge() {
  const badge = chatToggle.querySelector(".chat-badge");
  if (badge) badge.remove();
}

chatToggle.addEventListener("click", () => {
  appEl.classList.toggle("chat-open");
  if (appEl.classList.contains("chat-open")) clearChatBadge();
});
chatClose.addEventListener("click", () => appEl.classList.remove("chat-open"));

/* ---------- Invite & toast ---------- */

inviteButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(window.location.href);
    showToast("Invite link copied to clipboard");
  } catch (error) {
    prompt("Copy this link and send it to people you want to meet with", window.location.href);
  }
});

let toastTimer = null;
function showToast(text) {
  toastEl.textContent = text;
  toastEl.classList.add("toast--visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("toast--visible"), 2600);
}
