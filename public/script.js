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
const heroCreateBtn = document.getElementById("heroCreateBtn");
const heroJoinBtn = document.getElementById("heroJoinBtn");
const themeToggle = document.getElementById("themeToggle");
const panelChoice = document.getElementById("panelChoice");
const panelJoin = document.getElementById("panelJoin");
const panelSetup = document.getElementById("panelSetup");
const createMeetingBtn = document.getElementById("createMeetingBtn");
const joinMeetingBtn = document.getElementById("joinMeetingBtn");
const joinBackBtn = document.getElementById("joinBackBtn");
const setupBackBtn = document.getElementById("setupBackBtn");
const setupTitle = document.getElementById("setupTitle");
const setupStatus = document.getElementById("setupStatus");
const joinLinkInput = document.getElementById("joinLinkInput");
const joinLinkError = document.getElementById("joinLinkError");
const joinLinkBtn = document.getElementById("joinLinkBtn");
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
const admitRequests = document.getElementById("admitRequests");

let user = "Guest";
let myVideoStream = null;
let screenStream = null;
let myPeerId = null;
let joined = false;
let mediaSettled = false; // getUserMedia finished (successfully or not)
let previewStarted = false;
let requestPending = false; // guest is waiting for the host's decision
let currentRoomId = typeof ROOM_ID === "string" ? ROOM_ID : "";
let isHost = false;
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

/* ---------- Lobby panels ---------- */

const hour = new Date().getHours();
lobbyGreeting.textContent =
  hour < 12
    ? "Good morning — Together is ready for your next meeting."
    : hour < 17
      ? "Good afternoon — Together keeps your next call simple."
      : "Good evening — Together helps you connect instantly.";

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  const icon = themeToggle?.querySelector("i");
  if (icon) {
    icon.className = theme === "dark" ? "fas fa-moon" : "fas fa-sun";
  }
  themeToggle?.setAttribute(
    "aria-label",
    theme === "dark" ? "Switch to light theme" : "Switch to dark theme"
  );
}

const savedTheme = localStorage.getItem("vidconnect-theme");
const preferredTheme = savedTheme || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
applyTheme(preferredTheme);

themeToggle?.addEventListener("click", () => {
  const nextTheme = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  applyTheme(nextTheme);
  localStorage.setItem("vidconnect-theme", nextTheme);
});

function createNewMeeting() {
  currentRoomId = crypto.randomUUID();
  isHost = true;
  sessionStorage.setItem("vc-host:" + currentRoomId, "1");
  history.pushState({ panel: "setup" }, "", "/" + currentRoomId);
  enterSetup("forward");
  document.getElementById("lobby").scrollIntoView({ behavior: "smooth", block: "start" });
}

heroCreateBtn?.addEventListener("click", createNewMeeting);
document.getElementById("navStartBtn")?.addEventListener("click", createNewMeeting);

const footerYear = document.getElementById("footerYear");
if (footerYear) footerYear.textContent = new Date().getFullYear();

heroJoinBtn?.addEventListener("click", () => {
  joinLinkError.classList.add("hidden");
  showPanel(panelJoin, "forward");
  joinLinkInput.focus();
});

// Friendly note when arriving back here after leaving a call.
if (sessionStorage.getItem("vc-left")) {
  sessionStorage.removeItem("vc-left");
  setTimeout(() => showToast("You left the meeting"), 500);
}

/* ---------- Landing parallax (desktop pointers only) ---------- */

const heroImage = document.querySelector(".lobby__illustration img");
const orbEls = document.querySelectorAll(".lobby__orbs span");

if (
  window.matchMedia("(pointer: fine)").matches &&
  !window.matchMedia("(prefers-reduced-motion: reduce)").matches
) {
  let parallaxRaf = null;
  window.addEventListener("mousemove", (event) => {
    if (joined || parallaxRaf) return;
    parallaxRaf = requestAnimationFrame(() => {
      parallaxRaf = null;
      const x = event.clientX / window.innerWidth - 0.5;
      const y = event.clientY / window.innerHeight - 0.5;
      if (heroImage) {
        heroImage.style.transform = `translate(${x * -16}px, ${y * -12}px)`;
      }
      // `translate` composes with the orbs' float animation (which
      // animates `transform`) instead of overwriting it.
      orbEls.forEach((orb, i) => {
        orb.style.translate = `${x * (12 + i * 8)}px ${y * (10 + i * 6)}px`;
      });
    });
  });
}

let activePanel = null;
function showPanel(panel, direction = "forward") {
  if (activePanel === panel) return;
  [panelChoice, panelJoin, panelSetup].forEach((p) => p.classList.remove("active", "back"));
  panel.classList.add("active");
  if (direction === "back") panel.classList.add("back");
  activePanel = panel;
}

function setStatus(text, isError = false) {
  if (!text) {
    setupStatus.classList.add("hidden");
    setupStatus.textContent = "";
    return;
  }
  setupStatus.textContent = text;
  setupStatus.classList.remove("hidden");
  setupStatus.classList.toggle("lobby__status--error", isError);
}

function enterSetup(direction = "forward") {
  setupTitle.textContent = isHost ? "Ready to start?" : "Ready to join?";
  setStatus("");
  showPanel(panelSetup, direction);
  startPreview();
  updateJoinState();
  lobbyName.focus();
}

// Initial panel: landing choice on "/", setup screen on a shared room link.
if (!currentRoomId) {
  showPanel(panelChoice);
} else {
  isHost = sessionStorage.getItem("vc-host:" + currentRoomId) === "1";
  enterSetup();
}

createMeetingBtn.addEventListener("click", () => {
  currentRoomId = crypto.randomUUID();
  isHost = true;
  sessionStorage.setItem("vc-host:" + currentRoomId, "1");
  history.pushState({ panel: "setup" }, "", "/" + currentRoomId);
  enterSetup("forward");
});

joinMeetingBtn.addEventListener("click", () => {
  joinLinkError.classList.add("hidden");
  showPanel(panelJoin, "forward");
  joinLinkInput.focus();
});

joinBackBtn.addEventListener("click", () => showPanel(panelChoice, "back"));

setupBackBtn.addEventListener("click", () => {
  if (requestPending) return; // don't bail out mid-request
  stopPreview();
  currentRoomId = "";
  isHost = false;
  history.pushState({}, "", "/");
  showPanel(panelChoice, "back");
});

// Browser back button mirrors the in-page back animation.
window.addEventListener("popstate", () => {
  if (joined) return;
  if (window.location.pathname === "/") {
    stopPreview();
    currentRoomId = "";
    isHost = false;
    showPanel(panelChoice, "back");
  }
});

/* ---------- Join with a link ---------- */

function extractRoomId(input) {
  let candidate = input.trim();
  try {
    const url = new URL(candidate);
    if (url.origin !== window.location.origin) return { error: "different-site" };
    candidate = url.pathname;
  } catch (e) {
    /* not a full URL — treat as a code or path */
  }
  const parts = candidate.split("/").filter(Boolean);
  return { roomId: parts.pop() || "" };
}

function submitJoinLink() {
  joinLinkError.classList.add("hidden");
  const raw = joinLinkInput.value.trim();
  if (!raw) {
    joinLinkError.textContent = "Please paste a meeting link first.";
    joinLinkError.classList.remove("hidden");
    return;
  }
  const { roomId, error } = extractRoomId(raw);
  if (error === "different-site") {
    joinLinkError.textContent = "That link belongs to a different site. Paste a link from " + window.location.host + ".";
    joinLinkError.classList.remove("hidden");
    return;
  }
  if (!roomId || !/^[a-z0-9][a-z0-9-]{5,}$/i.test(roomId)) {
    joinLinkError.textContent = "That doesn't look like a valid meeting link. Check it and try again.";
    joinLinkError.classList.remove("hidden");
    return;
  }
  window.location.href = "/" + roomId;
}

joinLinkBtn.addEventListener("click", submitJoinLink);
joinLinkInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitJoinLink();
});

/* ---------- Camera preview (started only on the setup panel) ---------- */

function startPreview() {
  if (previewStarted) return;
  previewStarted = true;

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    lobbyPreviewOff.classList.remove("hidden");
    lobbyPreviewOffText.textContent = "Camera unavailable";
    showLobbyError(
      "Camera access is not available. Browsers only allow the camera on " +
      "http://localhost or over HTTPS. You opened: " + window.location.origin
    );
    lobbyMicBtn.disabled = true;
    lobbyCamBtn.disabled = true;
    mediaSettled = true;
    updateJoinState();
    return;
  }

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
      lobbyPreviewOffText.textContent = "Camera unavailable";
      showLobbyError(explainMediaError(error));
      lobbyMicBtn.disabled = true;
      lobbyCamBtn.disabled = true;
      mediaSettled = true;
      updateJoinState();
    });
}

// Release the camera when the user backs out of the setup screen.
function stopPreview() {
  if (myVideoStream) {
    myVideoStream.getTracks().forEach((t) => t.stop());
    myVideoStream = null;
  }
  lobbyPreview.srcObject = null;
  previewStarted = false;
  mediaSettled = false;
  lobbyError.classList.add("hidden");
  lobbyPreviewOff.classList.add("hidden");
  lobbyMicBtn.disabled = false;
  lobbyCamBtn.disabled = false;
  setMicUI(lobbyMicBtn, true);
  setCamUI(lobbyCamBtn, true);
  joinBtn.disabled = true;
  joinBtnText.textContent = "Connecting…";
}

function updateJoinState() {
  if (myPeerId && mediaSettled && !requestPending) {
    joinBtn.disabled = false;
    joinBtnText.textContent = isHost ? "Start meeting" : "Ask to join";
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

/* ---------- Joining ---------- */

function onJoinClick() {
  if (joined || !myPeerId || !mediaSettled || requestPending) return;
  user = lobbyName.value.trim() || "Guest";
  if (isHost) {
    joinMeeting(true);
  } else {
    requestPending = true;
    joinBtn.disabled = true;
    joinBtnText.textContent = "Waiting for the host…";
    setStatus("Asking to join — the host will let you in shortly.");
    socket.emit("request-join", currentRoomId, myPeerId, user);
  }
}

socket.on("waiting-for-host", () => {
  setStatus(
    "The meeting hasn't started yet. Keep this page open — " +
    "you'll be let in as soon as the host arrives."
  );
});

socket.on("join-approved", () => {
  if (!joined) joinMeeting(false);
});

socket.on("join-denied", () => {
  if (joined) return;
  requestPending = false;
  setStatus("The host denied your request to join this meeting.", true);
  updateJoinState();
});

function joinMeeting(asHost) {
  if (joined || !myPeerId) return;
  joined = true;
  requestPending = false;
  setStatus("");

  lobby.classList.add("hidden");
  // Hide the whole landing shell (navbar + footer) during the meeting.
  document.querySelector(".page-shell")?.classList.add("hidden");
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

  socket.emit("join-room", currentRoomId, myPeerId, user, !!asHost);
}

joinBtn.addEventListener("click", onJoinClick);
lobbyName.addEventListener("keydown", (e) => {
  if (e.key === "Enter") onJoinClick();
});

/* ---------- Host: admit / deny join requests ---------- */

socket.on("join-request", (requestId, userName) => {
  if (!joined) return;
  playReceiveTone();
  showToast(`${userName || "Someone"} is asking to join`);
  addAdmitCard(requestId, userName || "Guest");
});

socket.on("host-promoted", () => {
  isHost = true;
  sessionStorage.setItem("vc-host:" + currentRoomId, "1");
  showToast("You are now the host of this meeting");
});

function addAdmitCard(requestId, userName) {
  if (admitRequests.querySelector(`[data-req="${CSS.escape(requestId)}"]`)) return;

  const card = document.createElement("div");
  card.className = "admit-card";
  card.dataset.req = requestId;

  const text = document.createElement("span");
  text.className = "admit-card__text";
  const bold = document.createElement("b");
  bold.textContent = userName;
  text.append(bold, document.createTextNode(" wants to join this meeting"));

  const denyBtn = document.createElement("button");
  denyBtn.className = "admit-no";
  denyBtn.textContent = "Deny";
  denyBtn.addEventListener("click", () => {
    socket.emit("deny-user", currentRoomId, requestId);
    card.remove();
  });

  const admitBtn = document.createElement("button");
  admitBtn.className = "admit-yes";
  admitBtn.textContent = "Admit";
  admitBtn.addEventListener("click", () => {
    socket.emit("admit-user", currentRoomId, requestId);
    card.remove();
    showToast(`Admitted ${userName}`);
  });

  card.append(text, denyBtn, admitBtn);
  admitRequests.append(card);
}

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
  // Return to the landing page.
  sessionStorage.setItem("vc-left", "1");
  window.location.href = "/";
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

// Gentle two-note chime when a message or join request arrives.
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
