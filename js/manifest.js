/* The scripts this tool is made of, in load order, in ONE place.

   The same list used to be written out four times — the <script> tags in
   index.html, the importScripts call in js/worker.js, the precache list in
   sw.js and the require loop in tools/validate.js — and kept in step by hand.
   They drifted: the service worker cached four files while the page loaded
   thirty. This file is the list; the worker, the service worker and the test
   harness read it, and tools/tests/fixes.js fails if index.html's tags are
   not exactly `page` below.

   (index.html cannot read it: a plain <script> list is what lets the tool run
   straight off the disk, where fetch() of a local file is blocked.)

   Each entry is [name, where]. Every script loads in the page; `where` says
   what ELSE loads it: "all" = the batch worker and the Node harness too,
   "node" = the Node harness but not the worker (nothing there needs it), and
   "page" = the browser only (it draws, or needs the DOM). The names are paths
   under js/ without the extension. This file loads in a window, a worker or
   Node, so it takes whichever global it finds. */
(function (root) {
	"use strict";

	const SCRIPTS = [
		["text", "all"], ["rng", "all"], ["bbgm", "all"], ["bbgmstats", "all"],
		["colleges", "all"], ["config", "all"], ["calibration", "all"],
		["ratings", "all"], ["traits", "all"], ["teams", "all"], ["stats", "all"],
		["rankings", "all"], ["tournament", "all"], ["awards", "all"], ["engine", "all"],
		/* The batch worker has no use for sample, but Node does: it is how a test
		   gets a class without a file, and nothing in it touches the DOM. */
		["sample", "node"], ["batch", "all"],
		// The face drawer and its vendored library: DOM and SVG, never Node.
		["vendor/facesjs", "page"], ["faces", "page"],
		["news", "all"], ["universe", "all"],
		/* These build text and files from result objects and touch no DOM, so the
		   harness loads them to test what they write; the worker never needs them. */
		["almanac", "node"], ["replay", "node"], ["site", "node"], ["replaymeta", "node"],
		["views", "page"], ["play", "node"], ["app", "page"],
	];

	const names = (keep) => SCRIPTS.filter((s) => keep(s[1])).map((s) => s[0]);
	const api = {
		scripts: SCRIPTS.map((s) => s.slice()),
		// Every script, in the order the page loads them.
		page: names(() => true),
		// What js/worker.js imports.
		worker: names((w) => w === "all"),
		// What tools/validate.js requires.
		node: names((w) => w === "all" || w === "node"),
	};

	if (typeof module !== "undefined" && module.exports) module.exports = api;
	else root.BBGMManifest = api;
})(typeof self !== "undefined" ? self : this);
