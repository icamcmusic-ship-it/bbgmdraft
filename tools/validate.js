#!/usr/bin/env node
/* Headless calibration check: runs the full engine on a synthetic BBGM-shaped
   draft class and verifies the simulated stat distributions land near the
   empirical 2009-21 drafted-player anchors in js/calibration.js.

   Usage: node tools/validate.js [nSeeds]
   Exits non-zero if any check falls outside its tolerance band. */
"use strict";

global.window = global;
const path = require("path");
for (const f of [
	"rng", "bbgm", "colleges", "config", "calibration", "ratings",
	"teams", "stats", "tournament", "awards", "engine",
]) require(path.join(__dirname, "..", "js", f + ".js"));

const { Rng, clamp } = global.BBGMRng;
const BB = global.BBGM;

/* A synthetic class shaped like a real BBGM export: position-correlated
   ratings, 18% blank colleges, mixed birthplaces. */
function syntheticClass(seed, n) {
	const rng = new Rng("synth:" + seed);
	// Colleges are drawn frequency-weighted, matching how BBGM itself assigns
	// them — most prospects come from power programs, not random mid-majors.
	const names = global.Colleges.names;
	const weights = names.map((n) => global.Colleges.frequencyOf(n));
	const wTotal = weights.reduce((a, b) => a + b, 0);
	const pickCollege = (r) => {
		let x = r * wTotal;
		for (let i = 0; i < names.length; i++) {
			x -= weights[i];
			if (x <= 0) return names[i];
		}
		return names[names.length - 1];
	};
	const players = [];
	for (let i = 0; i < n; i++) {
		const pr = rng.child("p" + i);
		const hgt = clamp(Math.round(pr.normal(48, 17)), 5, 95);
		const b = (hgt - 30) / 55;
		const r = {};
		for (const k of BB.RATING_KEYS) r[k] = clamp(Math.round(pr.normal(45, 13)), 5, 90);
		r.hgt = hgt;
		// Size-correlated skill ratings, like real BBGM generation.
		r.tp = clamp(Math.round(pr.normal(52 - 22 * b, 12)), 5, 90);
		r.ft = clamp(Math.round(pr.normal(52 - 12 * b, 11)), 5, 90);
		r.ins = clamp(Math.round(pr.normal(40 + 16 * b, 11)), 5, 90);
		r.reb = clamp(Math.round(pr.normal(42 + 18 * b, 11)), 5, 90);
		r.pss = clamp(Math.round(pr.normal(55 - 20 * b, 12)), 5, 90);
		r.fuzz = 0;
		r.ovr = BB.ovr(r);
		r.pot = clamp(r.ovr + Math.round(pr.uniform(4, 26)), r.ovr, 90);
		r.pos = BB.pos(r);
		r.skills = [];
		players.push({
			pid: i,
			firstName: "Test", lastName: "P" + i,
			born: { year: 2007, loc: pr.random() < 0.75 ? "Anytown, WA, USA" : "Belgrade, Serbia" },
			hgt: 66 + Math.round((hgt / 100) * 24),
			weight: Math.round(165 + hgt * 0.9),
			college: pr.random() < 0.18 ? "" : pickCollege(pr.random()),
			draft: { year: 2026 },
			ratings: [r],
		});
	}
	return { startingSeason: 2026, players };
}

function pct(vals, p) {
	const s = vals.slice().sort((a, b) => a - b);
	return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}
const mean = (v) => v.reduce((a, b) => a + b, 0) / v.length;

const N_SEEDS = Number(process.argv[2]) || 12;
const cfg = global.Config.make({});
const all = [];
const leaders = [];
const awardsCount = [];
for (let s = 0; s < N_SEEDS; s++) {
	const lf = syntheticClass(s, 70);
	const res = global.Engine.run(lf, global.Config.make({ seed: "v" + s }));
	const ncaa = res.players.filter((p) => !p.nonNcaa && p.stats);
	for (const p of ncaa) all.push(p);
	leaders.push(Math.max.apply(null, ncaa.map((p) => p.stats.ppg)));
	awardsCount.push(res.players.reduce((a, p) => a + (p.awards ? p.awards.length : 0), 0));
	global.Engine.exportFile(res);
}

const g = (f) => all.map(f);
const rows = [
	// [name, value, lo, hi] — bands around the drafted-player anchors, wide
	// enough for synthetic-class drift, tight enough to catch 2x misses.
	["MPG mean", mean(g((p) => p.stats.mpg)), 24, 32],
	["MPG p95", pct(g((p) => p.stats.mpg), 0.95), 33, 36.5],
	["MPG p5", pct(g((p) => p.stats.mpg), 0.05), 8, 25],
	["USG% mean", mean(g((p) => (p.stats.usg * 40) / p.stats.mpg)) * 100, 18, 27],
	["USG% max", Math.max.apply(null, g((p) => (p.stats.usg * 40) / p.stats.mpg)) * 100, 0, 36],
	["PPG mean", mean(g((p) => p.stats.ppg)), 9, 16],
	["PPG leader (avg/seed)", mean(leaders), 17, 30],
	["RPG max", Math.max.apply(null, g((p) => p.stats.rpg)), 0, 16],
	["APG max", Math.max.apply(null, g((p) => p.stats.apg)), 0, 9.5],
	["BPG max", Math.max.apply(null, g((p) => p.stats.bpg)), 0, 4.2],
	["TS% mean", mean(g((p) => p.stats.ts)) * 100, 52, 59],
	["3P% mean", mean(g((p) => p.stats.tpp)) * 100, 31, 37],
	["FT% mean", mean(g((p) => p.stats.ftp)) * 100, 69, 76],
	["FG% mean", mean(g((p) => p.stats.fgp)) * 100, 43, 50],
	["GP mean", mean(g((p) => p.stats.gp)), 29, 36],
	["Awards/class", mean(awardsCount), 20, 90],
];

let fail = 0;
console.log("Calibration check over " + N_SEEDS + " seeds, " + all.length + " NCAA player-seasons\n");
for (const [name, v, lo, hi] of rows) {
	const ok = v >= lo && v <= hi;
	if (!ok) fail++;
	console.log(
		(ok ? "  ok   " : "  FAIL ") + name.padEnd(24) +
		v.toFixed(2).padStart(8) + "   [" + lo + ", " + hi + "]",
	);
}

// Solver exactness across the usable target range.
let miss = 0;
const rng = new Rng("solver");
for (let i = 0; i < 2000; i++) {
	const orig = {};
	for (const k of BB.RATING_KEYS) orig[k] = Math.round(rng.uniform(20, 80));
	orig.fuzz = 0;
	const t = Math.round(rng.uniform(20, 65));
	const b = global.RatingsBuilder.rebuild(rng.child("s" + i), orig, t, t + 10, cfg);
	if (b.ovr !== t) miss++;
}
console.log("\nSolver: " + miss + "/2000 off-target " + (miss === 0 ? "(ok)" : "(FAIL)"));
if (miss > 0) fail++;

process.exit(fail ? 1 : 0);
