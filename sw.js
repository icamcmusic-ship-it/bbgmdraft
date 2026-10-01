/* Offline shell. Every file this tool needs is static, so once the page has
   been opened online the whole thing works with the network off.

   NETWORK FIRST, then the cache. The code changes with every release and a
   cache-first worker would keep serving last month's engine to anyone who
   installed it; network-first always takes the new file when there is one and
   falls back to the copy on disk only when the fetch fails. The cache name
   carries a version so an old cache is dropped on activate. */
const CACHE = "bbgm-draft-workshop-v1";

self.addEventListener("install", (e) => {
	e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["./", "index.html", "icon.svg", "manifest.webmanifest"]))
		.then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
	e.waitUntil(caches.keys()
		.then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
		.then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
	const req = e.request;
	if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
	e.respondWith(fetch(req).then((res) => {
		if (res && res.ok) {
			const copy = res.clone();
			caches.open(CACHE).then((c) => c.put(req, copy));
		}
		return res;
	}).catch(() => caches.match(req).then((hit) => hit || caches.match("index.html"))));
});
