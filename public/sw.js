// Minimal service worker: enables PWA installability. All requests
// pass through to the network unchanged (no caching, so deployments
// always take effect immediately).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
