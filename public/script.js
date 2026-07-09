const socket = io("/");
const videoGrid = document.getElementById("video-grid");
const myVideo = document.createElement("video");
const showChat = document.querySelector("#showChat");
const backBtn = document.querySelector(".header__back");
myVideo.muted = true;

backBtn.addEventListener("click", () => {
  document.querySelector(".main__left").style.display = "flex";
  document.querySelector(".main__left").style.flex = "1";
  document.querySelector(".main__right").style.display = "none";
  document.querySelector(".header__back").style.display = "none";
});

showChat.addEventListener("click", () => {
  document.querySelector(".main__right").style.display = "flex";
  document.querySelector(".main__right").style.flex = "1";
  document.querySelector(".main__left").style.display = "none";
  document.querySelector(".header__back").style.display = "block";
});

const user = prompt("Enter your name") || "Guest";

// Connect to the PeerJS server hosted by this same app, so it works
// from any device that can reach the server (not just localhost).
let peer = null;
try {
  peer = new Peer(undefined, {
    host: window.location.hostname,
    port: window.location.port || (window.location.protocol === "https:" ? 443 : 80),
    path: "/peerjs",
    secure: window.location.protocol === "https:",
    config: {
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:global.stun.twilio.com:3478" },
      ],
    },
  });

  peer.on("error", (error) => {
    console.error("PeerJS error:", error);
  });

  peer.on("open", (id) => {
    console.log("PeerJS connected, my id:", id);
    myPeerId = id;
    joinRoomWhenReady();
  });
} catch (error) {
  console.error("Could not create PeerJS connection:", error);
  alert("Could not connect to the video server. You may not be able to see other participants.");
}

// Track active calls so we can close them when a user leaves.
const peers = {};

let myVideoStream = null;
let myPeerId = null;
let joined = false;

// Only join the room once BOTH the camera stream and the peer
// connection are ready, so we can always answer incoming calls.
const joinRoomWhenReady = () => {
  if (joined || !myVideoStream || !myPeerId) return;
  joined = true;
  socket.emit("join-room", ROOM_ID, myPeerId, user);
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

if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
  alert(
    "Camera access is not available. Browsers only allow the camera on " +
    "http://localhost or over HTTPS. You opened: " + window.location.origin
  );
} else {
  navigator.mediaDevices
    .getUserMedia({
      audio: true,
      video: true,
    })
    .then((stream) => {
      myVideoStream = stream;
      addVideoStream(myVideo, stream);

      if (peer) {
        peer.on("call", (call) => {
          call.answer(stream);
          const video = document.createElement("video");
          peers[call.peer] = call;
          call.on("stream", (userVideoStream) => {
            addVideoStream(video, userVideoStream, call.peer);
          });
          call.on("close", () => {
            video.remove();
          });
        });
      }

      socket.on("user-connected", (userId) => {
        connectToNewUser(userId, stream);
      });

      joinRoomWhenReady();
    })
    .catch((error) => {
      console.error("Error accessing media devices:", error);
      alert(explainMediaError(error));
    });
}

const connectToNewUser = (userId, stream) => {
  if (!peer) return;
  const call = peer.call(userId, stream);
  const video = document.createElement("video");
  peers[userId] = call;
  call.on("stream", (userVideoStream) => {
    addVideoStream(video, userVideoStream, userId);
  });
  call.on("close", () => {
    video.remove();
  });
};

const addVideoStream = (video, stream, userId) => {
  if (userId) {
    video.setAttribute("data-user-id", userId);
  }
  video.playsInline = true;
  video.srcObject = stream;
  video.addEventListener("loadedmetadata", () => {
    video.play();
    // The stream event can fire more than once; only append the element once.
    if (!videoGrid.contains(video)) {
      videoGrid.append(video);
    }
  });
};

const text = document.querySelector("#chat_message");
const send = document.getElementById("send");
const messages = document.querySelector(".messages");
const chatWindow = document.querySelector(".main__chat_window");

const sendMessage = () => {
  if (text.value.trim().length !== 0) {
    socket.emit("message", text.value.trim());
    text.value = "";
  }
};

send.addEventListener("click", sendMessage);

text.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    sendMessage();
  }
});

const inviteButton = document.querySelector("#inviteButton");
const muteButton = document.querySelector("#muteButton");
const stopVideo = document.querySelector("#stopVideo");

muteButton.addEventListener("click", () => {
  if (!myVideoStream) return;
  const audioTrack = myVideoStream.getAudioTracks()[0];
  if (!audioTrack) return;
  audioTrack.enabled = !audioTrack.enabled;
  muteButton.classList.toggle("background__red", !audioTrack.enabled);
  muteButton.innerHTML = audioTrack.enabled
    ? `<i class="fas fa-microphone"></i>`
    : `<i class="fas fa-microphone-slash"></i>`;
});

stopVideo.addEventListener("click", () => {
  if (!myVideoStream) return;
  const videoTrack = myVideoStream.getVideoTracks()[0];
  if (!videoTrack) return;
  videoTrack.enabled = !videoTrack.enabled;
  stopVideo.classList.toggle("background__red", !videoTrack.enabled);
  stopVideo.innerHTML = videoTrack.enabled
    ? `<i class="fas fa-video"></i>`
    : `<i class="fas fa-video-slash"></i>`;
});

inviteButton.addEventListener("click", () => {
  prompt(
    "Copy this link and send it to people you want to meet with",
    window.location.href
  );
});

// Build chat messages with DOM APIs (textContent) so user input
// can never be injected as HTML.
socket.on("createMessage", (message, userName) => {
  const messageEl = document.createElement("div");
  messageEl.classList.add("message");

  const nameEl = document.createElement("b");
  const icon = document.createElement("i");
  icon.className = "far fa-user-circle";
  const nameSpan = document.createElement("span");
  nameSpan.textContent = ` ${userName === user ? "me" : userName}`;
  nameEl.append(icon, nameSpan);

  const textEl = document.createElement("span");
  textEl.textContent = message;

  messageEl.append(nameEl, textEl);
  messages.append(messageEl);
  chatWindow.scrollTop = chatWindow.scrollHeight;
});

socket.on("user-disconnected", (userId) => {
  if (peers[userId]) {
    peers[userId].close();
    delete peers[userId];
  }
  const videoElement = document.querySelector(`[data-user-id="${userId}"]`);
  if (videoElement) {
    videoElement.remove();
  }
});
