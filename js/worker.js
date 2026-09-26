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
	"text.js", "rng.js", "bbgm.js", "bbgmstats.js", "colleges.js", "config.js", "calibration.js",
	"ratings.js", "traits.js", "teams.js", "stats.js", "rankings.js", "tournament.js", "awards.js",
	"engine.js", "batch.js", "news.js", "universe.js",
);

/* THE SEARCH, WHICH IS THE OTHER THING WORTH SENDING HERE.

   The interactive path cannot move off the main thread: the staged runner
   keeps its state between calls as a graph of live objects, and that is not a
   message. A SEARCH is the opposite shape — "Reroll until…" runs up to sixty
   full simulations and needs one boolean per candidate and one seed at the
   end — so it is all cost and no payload, which is exactly what a worker is
   for. It used to run on the main thread, sliced with setTimeout(0), which
   keeps the tab technically alive and makes it useless for twenty seconds.

   The predicates come from Engine.REROLL_PREDICATES rather than from the UI,
   so the worker and the main-thread fallback cannot drift apart and CI can
   test them. */
function runSearch(msg) {
	const runner = self.Engine.createRunner(msg.leagueFile);
	const clauses = (msg.keys || [])
		.map((k) => self.Engine.parseRerollClause(k))
		.filter(Boolean);
	if (!clauses.length) {
		self.postMessage({ type: "searchDone", found: null, tries: 0, hits: [] });
		return;
	}
	const rng = new self.BBGMRng.Rng(msg.base);
	const hits = clauses.map(() => 0);
	let found = null;
	let k = 0;
	for (; k < msg.maxTries && !found; k++) {
		const seed = "u" + Math.floor(rng.random() * 1e9).toString(36);
		const cfg = self.Config.make(msg.cfg);
		cfg.seed = seed;
		cfg.overrides = msg.cfg.overrides || {};
		try {
			const res = runner.run(cfg);
			let all = true;
			clauses.forEach((c, i) => {
				let hit = false;
				try { hit = !!c.test(res); } catch (err) { hit = false; }
				if (hit) hits[i]++; else all = false;
			});
			if (all) found = seed;
		} catch (err) { /* a failed candidate is just not the one */ }
		self.postMessage({ type: "searchProgress", done: k + 1, total: msg.maxTries });
	}
	/* The SEED, not the result. The main thread re-runs it through its own
	   runner, which is what puts the class in the pill, the history and the
	   undo stack — and means nothing about the result graph has to survive a
	   structured clone. */
	self.postMessage({ type: "searchDone", found, tries: k, hits });
}

self.onmessage = function (e) {
	const msg = e.data || {};
	if (msg.type === "search") {
		try { runSearch(msg); } catch (err) {
			self.postMessage({ type: "error",
				message: err && err.message ? err.message : String(err) });
		}
		return;
	}
	if (msg.type === "probe") {
		try {
			// One runner across the seeds, the way a batch uses it.
			const runner = self.Engine.createRunner(msg.leagueFile);
			const rows = [].concat(msg.seed).map((seed) => {
				const cfg = self.Config.make(msg.cfg);
				cfg.seed = seed;
				cfg.overrides = msg.cfg.overrides || {};
				return self.BatchStats.fingerprint(runner.run(cfg));
			});
			self.postMessage({ type: "probe", rows: Array.isArray(msg.seed) ? rows : rows[0] });
		} catch (err) {
			self.postMessage({ type: "error", message: err && err.message ? err.message : String(err) });
		}
		return;
	}
	if (msg.type !== "batch") return;
	try {
		const runner = self.Engine.createRunner(msg.leagueFile);
		const out = [];
		/* Every class in a batch used to draw Math.random() (`cfg.seed = ""`),
		   so a batch could not be re-run, an anomaly in it could not be
		   bisected, and a batch result could not be shared. Each iteration is
		   derived from the batch's own seed instead, so "class 37 of this
		   batch" is a reproducible thing. */
		const base = self.BatchStats.batchSeed(msg.cfg, msg.baseSeed);
		for (let i = 0; i < msg.n; i++) {
			const cfg = self.Config.make(msg.cfg);
			cfg.seed = base + "#" + i;
			cfg.overrides = msg.cfg.overrides || {};
			out.push(self.BatchStats.summarize(runner.run(cfg)));
			/* The rows so far travel with the progress message.

			   Cancelling a 200-class sweep at class 180 used to throw away all
			   180 — the worker was terminated and its `out` went with it — so
			   "this is taking longer than I thought" and "I have no results"
			   were the same button. The rows are small (one summary object a
			   class), so shipping the tail on every tick costs a structured
			   clone of a few kilobytes and buys a cancel that keeps its work.

			   Sent as a tail rather than the whole array so the clone stays
			   O(1) per tick instead of O(n^2) over the batch. */
			self.postMessage({
				type: "progress", done: i + 1, total: msg.n, row: out[out.length - 1],
			});
		}
		self.postMessage({ type: "done", rows: out, baseSeed: base });
	} catch (err) {
		self.postMessage({ type: "error", message: err && err.message ? err.message : String(err) });
	}
};
