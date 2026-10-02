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
   and no app. Keep this list in step with index.html and js/worker.js;
   tools/tests/sw.js fails when a script is on the page and not here. */
const CACHE = "bbgm-draft-workshop-v2";

const SHELL = [
	"./", "index.html", "icon.svg", "manifest.webmanifest", "css/style.css",
	"js/text.js", "js/rng.js", "js/bbgm.js", "js/bbgmstats.js", "js/colleges.js",
	"js/config.js", "js/calibration.js", "js/ratings.js", "js/traits.js",
	"js/teams.js", "js/stats.js", "js/rankings.js", "js/tournament.js",
	"js/awards.js", "js/engine.js", "js/sample.js", "js/batch.js",
	"js/vendor/facesjs.js", "js/faces.js", "js/news.js", "js/universe.js",
	"js/almanac.js", "js/replay.js", "js/site.js", "js/replaymeta.js",
	"js/views.js", "js/play.js", "js/app.js", "js/worker.js",
];

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
