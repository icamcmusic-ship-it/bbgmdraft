/* Batch worker.

   runBatch(60) used to be 60 x ~200ms of frozen tab inside one setTimeout,
   with no progress bar, no cancel, and a status line that said "Generating N
   classes…" and then nothing for eleven seconds. Users reasonably assume that
   is a crash.

   The engine modules are written against a `global` that is `window` in the
   page and `self` here, so the worker loads exactly the same code the page
   does. app.js falls back to a chunked main-thread loop when a worker cannot
   be constructed — opening index.html straight off the disk (file://) blocks
   workers in most browsers, and that is the documented way to use this tool. */
"use strict";

self.importScripts(
	"rng.js", "bbgm.js", "colleges.js", "config.js", "calibration.js",
	"ratings.js", "teams.js", "stats.js", "tournament.js", "awards.js",
	"engine.js", "batch.js",
);

self.onmessage = function (e) {
	const msg = e.data || {};
	if (msg.type !== "batch") return;
	try {
		const runner = self.Engine.createRunner(msg.leagueFile);
		const out = [];
		for (let i = 0; i < msg.n; i++) {
			const cfg = self.Config.make(msg.cfg);
			cfg.seed = "";
			cfg.overrides = msg.cfg.overrides || {};
			out.push(self.BatchStats.summarise(runner.run(cfg)));
			self.postMessage({ type: "progress", done: i + 1, total: msg.n });
		}
		self.postMessage({ type: "done", rows: out });
	} catch (err) {
		self.postMessage({ type: "error", message: err && err.message ? err.message : String(err) });
	}
};
