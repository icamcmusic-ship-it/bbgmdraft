#!/usr/bin/env node
/* Headless calibration check: runs the full engine on a synthetic BBGM-shaped
   draft class and verifies the simulated stat distributions land near the
   empirical 2009-21 drafted-player anchors in js/calibration.js.

   Usage: node tools/validate.js [nSeeds] [--json]
   Exits non-zero if any check falls outside its tolerance band.

   Also importable: require("./validate.js") exposes syntheticClass/loadEngine
   so other tools (tools/test.js, calibration sweeps) build the same class. */
"use strict";

const path = require("path");

function loadEngine() {
	if (!global.window) global.window = global;
	if (!global.Engine) {
		for (const f of [
			"rng", "bbgm", "colleges", "config", "calibration", "ratings",
			"teams", "stats", "tournament", "awards", "engine",
		]) require(path.join(__dirname, "..", "js", f + ".js"));
	}
	return global;
}

loadEngine();
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
			draft: { year: 2026, round: 1 + Math.floor(i / 30), pick: 1 + (i % 30) },
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

/* Run nSeeds classes and return every check row plus the raw samples. */
function collect(nSeeds, cfgOverrides) {
	const all = [];
	const leaders = [];
	const astLeaders = [];
	const awardsCount = [];
	const teamPts = [];
	const teamFga = [];
	const teamPoss = [];
	const nonNcaaAwards = [];
	const natAwards = [];
	const poyClasses = [];
	const firstTeam = [];
	for (let s = 0; s < nSeeds; s++) {
		const lf = syntheticClass(s, 70);
		const res = global.Engine.run(
			lf, global.Config.make(Object.assign({ seed: "v" + s }, cfgOverrides)));
		const ncaa = res.players.filter((p) => !p.nonNcaa && p.stats);
		for (const p of ncaa) all.push(p);
		leaders.push(Math.max.apply(null, ncaa.map((p) => p.stats.ppg)));
		astLeaders.push(Math.max.apply(null, ncaa.map((p) => p.stats.apg)));
		awardsCount.push(res.players.reduce((a, p) => a + (p.awards ? p.awards.length : 0), 0));
		// Team-level totals: the check that would have caught the possession bug.
		for (const t of Object.values(res.teams)) {
			if (!t.teamTotals) continue;
			teamPts.push(t.teamTotals.pts);
			teamFga.push(t.teamTotals.fga);
			teamPoss.push(t.teamTotals.poss);
		}
		// DII/pro players must never win a D-I national award. "Division II
		// All-American" and "Division II Player of the Year" are their OWN
		// awards (previously unreachable dead code) and are not leaks.
		const d1Only = (a) => /All-American|^National /.test(a) && !/^Division II/.test(a);
		nonNcaaAwards.push(res.players.filter((p) =>
			p.nonNcaa && (p.awards || []).some(d1Only)).length);
		natAwards.push(res.players.reduce((a, p) => a +
			(p.awards || []).filter((x) =>
				/^National|All-American|All-Freshman/.test(x)).length, 0));
		poyClasses.push(res.players.some((p) =>
			(p.awards || []).indexOf("National Player of the Year") !== -1) ? 1 : 0);
		firstTeam.push(res.players.filter((p) =>
			(p.awards || []).indexOf("Consensus First Team All-American") !== -1).length);
		global.Engine.exportFile(res);
	}

	const g = (f) => all.map(f);
	const usg = g((p) => p.stats.usg);
	// [name, value, lo, hi] — bands sit within ~10% of the drafted-player
	// anchors in js/calibration.js. Team-level rows are the ones that catch a
	// broken possession model, which per-player rate bands cannot.
	const rows = [
		["MPG mean", mean(g((p) => p.stats.mpg)), 26, 32],
		["MPG p95", pct(g((p) => p.stats.mpg), 0.95), 34, 37],
		["MPG p5", pct(g((p) => p.stats.mpg), 0.05), 8, 25],
		["USG% mean", mean(usg) * 100, 20.5, 25.5],
		["USG% p95", pct(usg, 0.95) * 100, 28, 34],
		["USG% max", Math.max.apply(null, usg) * 100, 30, 36],
		["PPG mean", mean(g((p) => p.stats.ppg)), 11, 15],
		// Derived, not chosen: with USG p95 30-33, MPG p95 ~35 and TS ~56.5,
		// 2*TS*(chances*(1-TO%)) puts the 95th percentile scorer near 20.
		["PPG p95", pct(g((p) => p.stats.ppg), 0.95), 18.5, 24],
		// A per-seed maximum is noisy: across 12-40 seeds this lands 22.8-23.6,
		// so the band has to be wider than the point estimate or the harness
		// fails at random and everyone learns to ignore it.
		["PPG leader (avg/seed)", mean(leaders), 21.5, 28],
		["PPG max", Math.max.apply(null, g((p) => p.stats.ppg)), 26, 34],
		["RPG max", Math.max.apply(null, g((p) => p.stats.rpg)), 11, 17],
		["ORPG mean", mean(g((p) => p.stats.orpg)), 1.0, 2.4],
		["APG p95", pct(g((p) => p.stats.apg), 0.95), 4.6, 7.0],
		["APG leader (avg/seed)", mean(astLeaders), 5.5, 9.5],
		["APG max", Math.max.apply(null, g((p) => p.stats.apg)), 7.5, 12.5],
		["BPG p95", pct(g((p) => p.stats.bpg), 0.95), 1.6, 3.0],
		["BPG max", Math.max.apply(null, g((p) => p.stats.bpg)), 2.6, 5.0],
		["PF mean", mean(g((p) => p.stats.pfpg)), 1.7, 3.0],
		["TS% mean", mean(g((p) => p.stats.ts)) * 100, 54, 58.5],
		["3P% mean", mean(g((p) => p.stats.tpp)) * 100, 32, 37],
		["FT% mean", mean(g((p) => p.stats.ftp)) * 100, 69, 76],
		["FG% mean", mean(g((p) => p.stats.fgp)) * 100, 44, 50],
		["FTA mean", mean(g((p) => p.stats.fta)), 3.4, 5.0],
		["GP mean", mean(g((p) => p.stats.gp)), 30, 35],
		["Team PPG", mean(teamPts), 68, 77],
		["Team FGA", mean(teamFga), 53, 60],
		["Team poss", mean(teamPoss), 63, 74],
		// Award volume. The old model handed out fixed quotas by array index:
		// every class contained the National Player of the Year and all five
		// Consensus First Teamers. Prospects are now ranked against the whole
		// of Division I, so these are the rows that matter — a 70-man class
		// should contain the POY only sometimes, and one or two First Teamers.
		["National awards/class", mean(natAwards), 2, 12],
		["POY in class (rate)", mean(poyClasses), 0.02, 0.5],
		["Consensus 1st Team/class", mean(firstTeam), 0.2, 2.5],
		// The total is dominated by all-conference honours across ~25
		// conferences, which future draft picks legitimately win a lot of.
		["Awards/class (all)", mean(awardsCount), 35, 85],
		["Non-D1 D-I awards", mean(nonNcaaAwards), 0, 0],
	];
	return { rows, all, leaders, awardsCount };
}

/* The stat line printed in a note must reconcile with itself: recomputing
   points from the attempts and percentages shown beside it must match PPG. */
function reconcileError(all) {
	let worst = 0;
	for (const p of all) {
		const s = p.stats;
		const twoMade = s.fgp * s.fga - s.tpa * s.tpp;
		const recomputed = twoMade * 2 + s.tpa * s.tpp * 3 + s.fta * s.ftp;
		worst = Math.max(worst, Math.abs(recomputed - s.ppg));
	}
	return worst;
}

function main() {
	const args = process.argv.slice(2);
	const asJson = args.includes("--json");
	const nSeeds = Number(args.filter((a) => !a.startsWith("--"))[0]) || 12;

	const { rows, all } = collect(nSeeds);
	const recon = reconcileError(all);
	const checks = rows.map(([name, v, lo, hi]) => ({
		name, value: v, lo, hi, ok: v >= lo && v <= hi,
	}));
	checks.push({
		name: "Stat line reconciles", value: recon, lo: 0, hi: 0.02, ok: recon <= 0.02,
	});

	// Solver exactness across the usable target range.
	let miss = 0;
	const rng = new Rng("solver");
	const cfg = global.Config.make({});
	for (let i = 0; i < 2000; i++) {
		const orig = {};
		for (const k of BB.RATING_KEYS) orig[k] = Math.round(rng.uniform(20, 80));
		orig.fuzz = 0;
		const t = Math.round(rng.uniform(20, 65));
		const b = global.RatingsBuilder.rebuild(rng.child("s" + i), orig, t, t + 10, cfg);
		if (b.ovr !== t) miss++;
	}
	checks.push({ name: "Solver off-target /2000", value: miss, lo: 0, hi: 0, ok: miss === 0 });

	const fail = checks.filter((c) => !c.ok).length;
	if (asJson) {
		console.log(JSON.stringify({
			seeds: nSeeds, seasons: all.length, failures: fail, checks,
		}, null, 2));
	} else {
		console.log("Calibration check over " + nSeeds + " seeds, " +
			all.length + " NCAA player-seasons\n");
		for (const c of checks) {
			console.log(
				(c.ok ? "  ok   " : "  FAIL ") + c.name.padEnd(24) +
				c.value.toFixed(2).padStart(8) + "   [" + c.lo + ", " + c.hi + "]",
			);
		}
		console.log("\n" + (fail ? fail + " check(s) failed" : "all checks passed"));
	}
	process.exit(fail ? 1 : 0);
}

module.exports = { loadEngine, syntheticClass, collect, reconcileError, pct, mean };

if (require.main === module) main();
