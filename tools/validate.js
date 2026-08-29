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

/* The named national player-of-the-year trophies replaced a single generic
   "National Player of the Year" string. */
const POY_RE = /^(Naismith Trophy|John R\. Wooden Award|Oscar Robertson Trophy|AP Player of the Year|NABC Player of the Year|Sporting News Player of the Year)$/;
const NATIONAL_RE = /All-American|All-Freshman Team|NABC All-Defensive|^(Naismith|John R\.|Oscar Robertson|AP Player|NABC Player|Sporting News|Lefty Driesell|Bob Cousy|Jerry West|Julius Erving|Karl Malone|Kareem|Pete Newell|Lute Olson|Wayman Tisdale|Consensus National)/;

function pct(vals, p) {
	const s = vals.slice().sort((a, b) => a - b);
	return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}
const mean = (v) => v.reduce((a, b) => a + b, 0) / v.length;

/* Run nSeeds classes and return every check row plus the raw samples. */
function collect(nSeeds, cfgOverrides) {
	const all = [];
	const field = [];
	const leaders = [];
	const astLeaders = [];
	const awardsCount = [];
	const honouredCount = [];
	const teamPts = [];
	const teamFga = [];
	const teamPoss = [];
	const teamAst = [];
	const teamTrb = [];
	const teamBlk = [];
	const teamStl = [];
	const teamOrtg = [];
	const maxAstShare = [];
	const maxRebShare = [];
	const maxBlkShare = [];
	const nonNcaaAwards = [];
	const natAwards = [];
	const poyClasses = [];
	const firstTeam = [];
	const confFirst = [];
	const confSecond = [];
	const defAwards = [];
	const gamesSpread = [];
	const postseasonInRecord = [];
	const outOfOrder = [];
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
		// Assists and rebounds are here because they were NOT, which is how
		// team assists sat 24% high for as long as they did.
		for (const t of Object.values(res.teams)) {
			if (!t.teamTotals) continue;
			const tt = t.teamTotals;
			teamPts.push(tt.pts);
			teamFga.push(tt.fga);
			teamPoss.push(tt.poss);
			teamAst.push(tt.ast);
			teamTrb.push(tt.trb);
			teamBlk.push(tt.blk);
			teamStl.push(tt.stl);
			if (tt.poss > 0) teamOrtg.push((100 * tt.pts) / tt.poss);
			// Every program plays the same regular season; only the postseason
			// varies.
			for (const fp of t.fieldPlayers || []) {
				if (fp.mpg >= 10) field.push(fp.line);
			}
			// The per-player share caps documented in js/stats.js, measured
			// against the team total the way a reader would check them.
			for (const p of t.prospects) {
				if (!p.stats) continue;
				if (tt.ast > 0) maxAstShare.push(p.stats.apg / tt.ast);
				if (tt.trb > 0) maxRebShare.push(p.stats.rpg / tt.trb);
				if (tt.blk > 0) maxBlkShare.push(p.stats.bpg / tt.blk);
			}
			// The log must be in calendar order after finalizeSchedule.
			for (let i = 1; i < t.log.length; i++) {
				if (t.log[i].when < t.log[i - 1].when - 1e-9) outOfOrder.push(1);
			}
		}
		const regGames = Object.values(res.teams).map((t) => t.regGames);
		gamesSpread.push(Math.max.apply(null, regGames) - Math.min.apply(null, regGames));
		// A team's displayed record has to include the games it played in
		// March. The champion goes 6-0 in the NCAA tournament; if w + l does
		// not move with it, the record contradicts the result printed beside it.
		const champ = res.tourney.champion.team;
		postseasonInRecord.push(
			champ.w + champ.l === champ.games &&
			champ.games >= champ.regGames + (champ.ncaaWins || 0) ? 1 : 0);
		// DII/pro players must never win a D-I national award. "Division II
		// All-American" and "Division II Player of the Year" are their OWN
		// awards (previously unreachable dead code) and are not leaks.
		const d1Only = (a) => NATIONAL_RE.test(a) && !/^Division II/.test(a);
		nonNcaaAwards.push(res.players.filter((p) =>
			p.nonNcaa && (p.awards || []).some(d1Only)).length);
		natAwards.push(res.players.reduce((a, p) => a +
			(p.awards || []).filter((x) => NATIONAL_RE.test(x)).length, 0));
		poyClasses.push(res.players.some((p) =>
			(p.awards || []).some((a) => POY_RE.test(a))) ? 1 : 0);
		firstTeam.push(res.players.filter((p) =>
			(p.awards || []).indexOf("Consensus First Team All-American") !== -1).length);
		honouredCount.push(res.players.filter((p) => (p.awards || []).length).length);
		confFirst.push(res.players.filter((p) =>
			(p.awards || []).some((a) => /^All-.+ First Team$/.test(a))).length);
		confSecond.push(res.players.filter((p) =>
			(p.awards || []).some((a) => /^All-.+ Second Team$/.test(a))).length);
		defAwards.push(res.players.reduce((a, p) => a +
			(p.awards || []).filter((x) => /Defensive|Driesell/.test(x)).length, 0));
		global.Engine.exportFile(res);
	}

	const g = (f) => all.map(f);
	const usg = g((p) => p.stats.usg);
	// [name, value, lo, hi] — bands sit within ~10% of the drafted-player
	// anchors in js/calibration.js. Team-level rows are the ones that catch a
	// broken possession model, which per-player rate bands cannot.
	const rows = [
		/* Prospect rows are checked against the DRAFT_YEAR anchor in
		   js/calibration.js — a prospect's final, highest-usage college season
		   — not against the pooled all-seasons figure the file used to target.
		   See that file's header: the pooled figure is the average season a
		   future draftee played, including 12-minute freshman years, and
		   calibrating to it deflated every volume statistic by about 9%. */
		["MPG mean", mean(g((p) => p.stats.mpg)), 28.5, 32.5],
		["MPG p95", pct(g((p) => p.stats.mpg), 0.95), 34.5, 37.4],
		["MPG p5", pct(g((p) => p.stats.mpg), 0.05), 15, 26],
		["USG% mean", mean(usg) * 100, 23, 27.5],
		["USG% p95", pct(usg, 0.95) * 100, 30, 35],
		["USG% max", Math.max.apply(null, usg) * 100, 32, 37],
		["PPG mean", mean(g((p) => p.stats.ppg)), 13, 16.5],
		// Derived, not chosen: with USG p95 ~32, MPG p95 ~36.5 and TS ~57,
		// 2*TS*(chances*(1-TO%)) puts the 95th percentile scorer near 22.
		["PPG p95", pct(g((p) => p.stats.ppg), 0.95), 19.5, 25],
		// A per-seed maximum is noisy, so the band has to be wider than the
		// point estimate or the harness fails at random and everyone learns to
		// ignore it.
		["PPG leader (avg/seed)", mean(leaders), 22, 29],
		["PPG max", Math.max.apply(null, g((p) => p.stats.ppg)), 26, 36],
		["RPG max", Math.max.apply(null, g((p) => p.stats.rpg)), 10.5, 17],
		["ORPG mean", mean(g((p) => p.stats.orpg)), 1.0, 2.4],
		["APG p95", pct(g((p) => p.stats.apg), 0.95), 5.0, 7.6],
		["APG leader (avg/seed)", mean(astLeaders), 6.5, 10.5],
		["APG max", Math.max.apply(null, g((p) => p.stats.apg)), 7.5, 13],
		["BPG p95", pct(g((p) => p.stats.bpg), 0.95), 1.6, 3.2],
		// Real shot-blockers reach 3.5-4.6 (Kessler 4.6, Chet 3.7). The old
		// 0.50 share cap made the top of this band unreachable by construction.
		["BPG max", Math.max.apply(null, g((p) => p.stats.bpg)), 3.0, 5.5],
		["SPG max", Math.max.apply(null, g((p) => p.stats.spg)), 2.0, 4.0],
		["PF mean", mean(g((p) => p.stats.pfpg)), 1.7, 3.1],
		["TS% mean", mean(g((p) => p.stats.ts)) * 100, 54.5, 59],
		["3P% mean", mean(g((p) => p.stats.tpp)) * 100, 32, 37],
		["FT% mean", mean(g((p) => p.stats.ftp)) * 100, 69, 76],
		["FG% mean", mean(g((p) => p.stats.fgp)) * 100, 44, 50],
		["FTA mean", mean(g((p) => p.stats.fta)), 3.4, 5.4],
		["GP mean", mean(g((p) => p.stats.gp)), 31, 36],

		/* Team rows. These are what catches a broken possession model, which
		   per-player rate bands cannot. Assists and rebounds are here because
		   they were not: team assists sat 24% high (16.8 against a real 13.5)
		   with every per-player band passing. */
		["Team PPG", mean(teamPts), 66, 74],
		["Team FGA", mean(teamFga), 52, 59],
		["Team poss", mean(teamPoss), 63, 73],
		["Team AST", mean(teamAst), 12, 15],
		["Team TRB", mean(teamTrb), 32, 37],
		["Team BLK", mean(teamBlk), 3.5, 6.5],
		["Team STL", mean(teamStl), 5, 8.5],

		/* The whole simulated field, against the D-I rotation-player baseline
		   in js/calibration.js. Every program is simulated now, so "is the
		   average Division I player right?" is a question with an answer. */
		["Field TS%", mean(field.map((l) => l.ts)) * 100, 51.5, 55.5],
		["Field 3P%", mean(field.map((l) => l.tpp)) * 100, 32, 36],
		["Field FT%", mean(field.map((l) => l.ftp)) * 100, 68, 73],
		["Field ORtg", mean(teamOrtg), 99, 106],

		/* The documented per-player share ceilings, measured the way a reader
		   would check them: against the team total, not against the pool. */
		["Max share of team AST", Math.max.apply(null, maxAstShare), 0, 0.621],
		["Max share of team TRB", Math.max.apply(null, maxRebShare), 0, 0.401],
		["Max share of team BLK", Math.max.apply(null, maxBlkShare), 0, 0.681],

		/* Schedule integrity. */
		["Regular-season game spread", Math.max.apply(null, gamesSpread), 0, 1],
		["Champion record includes March", mean(postseasonInRecord), 1, 1],
		["Games logged out of order", outOfOrder.length, 0, 0],

		/* Award volume. Prospects are ranked against every returning player in
		   Division I — now against their actual simulated seasons rather than
		   a regression on talent — so these are the rows that matter. */
		["National awards/class", mean(natAwards), 2, 26],
		["POY in class (rate)", mean(poyClasses), 0.05, 0.85],
		["Consensus 1st Team/class", mean(firstTeam), 0.2, 3],
		["All-conference 1st/class", mean(confFirst), 8, 26],
		["All-conference 2nd/class", mean(confSecond), 3, 18],
		["Defensive awards/class", mean(defAwards), 4, 26],
		["Honoured players/class", mean(honouredCount), 25, 58],
		// Dominated by conference honours across ~31 conferences, which future
		// draft picks legitimately win a lot of.
		["Awards/class (all)", mean(awardsCount), 70, 190],
		["Non-D1 D-I awards", mean(nonNcaaAwards), 0, 0],
	];
	return { rows, all, field, leaders, awardsCount };
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
