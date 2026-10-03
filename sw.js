/* Offline shell. Every file this tool needs is static, so once the page has
   been opened online the whole thing works with the network off.

   NETWORK FIRST, then the cache. The code changes with every release and a
   cache-first worker would keep serving last month's engine to anyone who
   installed it; network-first always takes the new file when there is one and
   falls back to the copy on disk only when the fetch fails. The cache name
   carries a version so an old cache is dropped on activate. */
/* v2: the install step now caches every file the page needs. It used to cache
   four (the shell and the manifest), so the first offline visit after a single
   online one found no scripts and no stylesheet, and every failed script
   request was answered with index.html — thirty "Unexpected token '<'" errors
   and no app. The scripts come from js/manifest.js; tools/tests/fixes.js fails when
   index.html loads a script that is not in it. */
const CACHE = "bbgm-draft-workshop-v2";

/* The scripts are listed once, in js/manifest.js, which this worker imports (an
   imported script is stored with the worker, so it is there offline too). The
   files that are not scripts are named here. */
importScripts("js/manifest.js");

const SHELL = [
	"./", "index.html", "icon.svg", "manifest.webmanifest", "css/style.css",
	"js/manifest.js", "js/worker.js",
].concat(self.BBGMManifest.page.map((f) => "js/" + f + ".js"));

self.addEventListener("install", (e) => {
	/* One missing file must not fail the whole install, so each is added on
	   its own and the failures are ignored. */
	e.waitUntil(caches.open(CACHE)
		.then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))
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
	}).catch(() => caches.match(req).then((hit) => {
		if (hit) return hit;
		/* The page is the only thing that may stand in for another request:
		   answering a script or a stylesheet with index.html is a syntax
		   error, not a fallback. */
		return req.mode === "navigate" ? caches.match("index.html") : Response.error();
	})));
});
