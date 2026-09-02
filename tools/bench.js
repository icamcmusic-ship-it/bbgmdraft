#!/usr/bin/env node
/* Time the staged pipeline, so the performance table in the README is a
   measurement anybody can reproduce rather than six numbers quoted to a tenth
   of a millisecond with no way to check them.

   Usage: node tools/bench.js [reps] [--json] [--md]

   Each row changes ONE setting on a runner that has already run once, so what
   is timed is exactly what the staged re-run does: the phases that setting
   invalidates, and no others. The reported number is the median of `reps`
   runs, because a mean over a JIT warming up is not a number anybody can
   compare against. */
"use strict";

const V = require("./validate.js");
V.loadEngine();

const args = process.argv.slice(2);
const reps = Number(args.filter((a) => !a.startsWith("--"))[0]) || 7;
const asJson = args.includes("--json");
const asMd = args.includes("--md");

/* The changes worth timing: one per distinct entry point into the staged
   pipeline, from the cheapest (a note template that re-runs nothing else) to
   the most expensive (a seed, which re-runs everything). */
const CASES = [
	["Note template", { noteLines: ["stat"] }],
	["Award strictness", { awardStrictness: 1.7 }],
	["Potential bias / spread", { potBias: 1.5 }],
	["March upsets", { upsetFactor: 1.6 }],
	["Pace, stat randomness", { pace: 72 }],
	["Specialization, archetypes, seed", { seed: "bench-other" }],
];

function median(v) {
	const s = v.slice().sort((a, b) => a - b);
	const m = Math.floor(s.length / 2);
	return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function main() {
	const lf = V.syntheticClass(1, 70);
	const base = { seed: "bench" };
	const runner = global.Engine.createRunner(lf);

	// Warm-up: the first run compiles everything and builds the whole season,
	// and timing it as if it were a re-run would be a lie.
	const first = [];
	for (let i = 0; i < Math.max(3, Math.min(reps, 5)); i++) {
		const fresh = global.Engine.createRunner(V.syntheticClass(1, 70));
		const t0 = process.hrtime.bigint();
		fresh.run(global.Config.make(Object.assign({}, base, { seed: "cold" + i })));
		first.push(Number(process.hrtime.bigint() - t0) / 1e6);
	}

	const rows = [];
	for (const [label, patch] of CASES) {
		const times = [];
		const phases = [];
		for (let i = 0; i < reps; i++) {
			// Back to the baseline, then the one change, so every rep times the
			// same transition rather than the second one being a no-op.
			runner.run(global.Config.make(base));
			const cfg = global.Config.make(Object.assign({}, base, patch));
			// A seed has to differ every rep or the runner short-circuits.
			if (patch.seed) cfg.seed = patch.seed + i;
			const t0 = process.hrtime.bigint();
			const res = runner.run(cfg);
			times.push(Number(process.hrtime.bigint() - t0) / 1e6);
			if (!phases.length) phases.push.apply(phases, res.phasesRun || []);
		}
		rows.push({ label, ms: median(times), phases });
	}

	const coldMs = median(first);
	if (asJson) {
		console.log(JSON.stringify({
			node: process.version, reps, coldMs, rows,
		}, null, 2));
		return;
	}
	const fmt = (x) => (x >= 10 ? x.toFixed(0) : x.toFixed(1)) + " ms";
	if (asMd) {
		console.log("| Change | Phases re-run | Engine time |");
		console.log("| --- | --- | --- |");
		for (const r of rows) {
			console.log("| " + r.label + " | " + (r.phases.join(" → ") || "nothing") +
				" | " + fmt(r.ms) + " |");
		}
		console.log("\n_Median of " + reps + " runs, " + process.version +
			". A cold run (whole pipeline, no cache) is " + fmt(coldMs) + "._");
		return;
	}
	console.log("Node " + process.version + ", median of " + reps + " runs\n");
	console.log("  " + "cold run (everything)".padEnd(36) + fmt(coldMs).padStart(9));
	for (const r of rows) {
		console.log("  " + r.label.padEnd(36) + fmt(r.ms).padStart(9) +
			"   " + (r.phases.join(" → ") || "nothing"));
	}
}

module.exports = { CASES, median };

if (require.main === module) main();
