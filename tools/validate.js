#!/usr/bin/env node
/* Headless calibration check: runs the full engine on a synthetic BBGM-shaped
   draft class and verifies the simulated stat distributions land near the
   empirical anchors in js/calibration.js — for EVERY era defined there, since
   the model and the anchors move together and an era nobody checks is an era
   that quietly rots.

   Usage: node tools/validate.js [nSeeds] [--json] [--era=modern]
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
			"teams", "stats", "tournament", "awards", "engine", "batch",
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
	const CAL = global.Calibration;
	const era = CAL.eraInfo(
		(cfgOverrides && cfgOverrides.era) || global.Config.DEFAULTS.era);
	/* Bands are DERIVED from the era anchor rather than typed in, so switching
	   era moves the model and the harness together — which is the whole point
	   of the era table. A band typed in by hand is a band that silently belongs
	   to whichever era it was written in. */
	const pace = (cfgOverrides && cfgOverrides.pace) || global.Config.DEFAULTS.pace;
	const paceK = pace / era.team.poss;
	/* Bands have to know how many seeds they are being judged on.

	   Every band here was drawn against the 20 seeds CI runs, so `node
	   tools/validate.js 3` — the invocation the README documents — failed "POY
	   in class (rate)" and `... 6` failed "PPG, bigs minus guards" purely on
	   sampling noise, and a developer following the documentation got a red
	   build for no reason.

	   `within`/`near` describe a MEAN, whose standard error goes as 1/sqrt(n),
	   so their half-width is scaled by sqrt(REF_SEEDS / n): unchanged at 20,
	   1.8x as wide at 6. `extreme` describes a MAXIMUM over the pooled sample,
	   whose expected value grows with the sample rather than converging, so
	   both of its bounds drift outward with n instead. */
	const REF_SEEDS = 20;
	/* Only ever WIDER, never narrower. These bands are modelling tolerances
	   against an anchor, not confidence intervals around a sample mean: how far
	   the simulated true-shooting percentage may sit from the era's own figure
	   is a statement about the model, and running more seeds does not make it
	   stricter. Scaling in both directions turned every band into a moving
	   target — a run at 40 seeds failed rows a run at 20 passed, which is the
	   same "the harness disagrees with itself depending on how you invoke it"
	   fault this scaling exists to fix. */
	const noiseK = Math.max(1, Math.sqrt(REF_SEEDS / Math.max(1, nSeeds)));
	const near = (v, pct_) => [v * (1 - pct_ * noiseK), v * (1 + pct_ * noiseK)];
	const within = (v, d) => [v - d * noiseK, v + d * noiseK];
	/* A band on an extreme value. The expected maximum of a sample grows like
	   log(n), so a band fixed at one seed count is wrong at every other one:
	   the assist leader over 1121 player-seasons is not the assist leader over
	   170. Both bounds move with log2(n / REF_SEEDS), by a tenth of the band's
	   own width per doubling. */
	const drift = 0.10 * Math.log2(Math.max(1, nSeeds) / REF_SEEDS);
	/* A maximum's LOWER bound falls with a smaller sample, because the expected
	   maximum of a small sample is smaller. Its upper bound does not: the
	   model's ceiling is a property of the model, not of how many draws were
	   taken from it, so a small sample can still contain the largest value the
	   model produces and that is not a failure. The upper bound only ever
	   drifts up, for a sample big enough to reach further into the tail. */
	const extreme = (lo, hi) =>
		[lo + (hi - lo) * drift, hi + (hi - lo) * Math.max(0, drift)];
	/* A band on a per-class count or rate, which is a mean over nSeeds classes
	   and so is far noisier at 3 seeds than at 20. Rates are clamped to [0, 1]
	   because a proportion cannot leave it. */
	const perClass = (lo, hi) => {
		const mid = (lo + hi) / 2;
		const half = ((hi - lo) / 2) * noiseK;
		return [mid - half, mid + half];
	};
	/* A correlation's standard error goes as 1/sqrt(N) too, and N here is the
	   pooled player count, which is proportional to the seed count. */
	const corrBand = (lo, hi) => {
		const b = perClass(lo, hi);
		return [Math.max(-1, b[0]), Math.min(1, b[1])];
	};
	const rateBand = (lo, hi) => {
		const b = perClass(lo, hi);
		return [Math.max(0, b[0]), Math.min(1, b[1])];
	};
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
	const teamTov = [];
	const teamFta = [];
	const teamPf = [];
	const teamFtaPerPf = [];
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
	const bottomThird = [];
	const paceOfHonoured = [];
	const paceOfAll = [];
	for (let s = 0; s < nSeeds; s++) {
		const lf = syntheticClass(s, 70);
		const res = global.Engine.run(
			lf, global.Config.make(Object.assign({ seed: "v" + s }, cfgOverrides)));
		const ncaa = res.players.filter((p) => !p.nonNcaa && p.stats);
		for (const p of ncaa) {
			const t = res.teams[p.newCollege];
			const conf = t ? t.conf : null;
			p.vConfStrength = conf && global.Colleges.CONFERENCES[conf]
				? global.Colleges.CONFERENCES[conf].strength : 50;
			p.vComps = BB.composites(p.newRatings);
			p.vLevel = t ? t.level : 50;
			all.push(p);
		}
		/* Class rank is the draft-slot proxy the audit ranks on: the bottom
		   third of a class is picks ~47-70, and what that group's scoring floor
		   looks like is the single most-felt symptom of the minutes model. */
		const byRank = ncaa.slice().sort((a, b) => b.newOvr - a.newOvr);
		for (const p of byRank.slice(Math.floor((byRank.length * 2) / 3))) {
			bottomThird.push(p.stats.ppg);
		}
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
			teamTov.push(tt.tov);
			teamFta.push(tt.fta);
			teamPf.push(tt.pf);
			if (tt.pf > 0) teamFtaPerPf.push(tt.fta / tt.pf);
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
		/* Tempo must not buy honours. productionScore is raw counting volume,
		   and PROGRAM_STYLES moves a team's possessions by +/-5.5 a game, so a
		   run-and-gun program handed its best player about 8% more of
		   everything for nothing he had done — and that score is what both the
		   award model and the draft board rank on. */
		for (const p of ncaa) {
			const t = res.teams[p.newCollege];
			if (!t || !Number.isFinite(t.pace)) continue;
			paceOfAll.push(t.pace);
			if ((p.awards || []).length) paceOfHonoured.push(t.pace);
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
	const apg = g((p) => p.stats.apg);
	const dy = era.draftYear;
	const rot = era.rotation;
	const tm = era.team;
	/* Correlation, for the relationships the tool is judged on: a class where
	   where you played predicts your scoring better than how good you are is a
	   broken class, and no per-stat band can see that. */
	function corr(xs, ys) {
		const mx = mean(xs);
		const my = mean(ys);
		let n = 0;
		let dx = 0;
		let dy2 = 0;
		for (let i = 0; i < xs.length; i++) {
			n += (xs[i] - mx) * (ys[i] - my);
			dx += (xs[i] - mx) * (xs[i] - mx);
			dy2 += (ys[i] - my) * (ys[i] - my);
		}
		return dx > 0 && dy2 > 0 ? n / Math.sqrt(dx * dy2) : 0;
	}
	// Overall-matched, so a size comparison is a comparison of size and not of
	// quality: taller players carry a higher ovr by construction (hgt is the
	// joint-heaviest term in BBGM's formula).
	const matched = all.filter((p) => p.newOvr >= 44 && p.newOvr <= 52);
	const mGuards = matched.filter((p) => p.newRatings.hgt < 32);
	const mBigs = matched.filter((p) => p.newRatings.hgt >= 73);
	const bigMinusGuard = mGuards.length && mBigs.length
		? mean(mBigs.map((p) => p.stats.ppg)) - mean(mGuards.map((p) => p.stats.ppg))
		: 0;
	const bigApg = all.filter((p) => p.newRatings.hgt >= 60).map((p) => p.stats.apg);

	// [name, value, lo, hi]. Every band that describes "what a season looks
	// like" is derived from the selected era's anchors in js/calibration.js.
	const rows = [
		/* Prospect rows are checked against the DRAFT_YEAR anchor for this era
		   — a prospect's final, highest-usage college season — not against the
		   pooled all-seasons figure the file used to target. See that file's
		   header: the pooled figure is the average season a future draftee
		   played, including 12-minute freshman years. */
		["MPG mean", mean(g((p) => p.stats.mpg))].concat(within(31.75, 2.25)),
		["MPG p95", pct(g((p) => p.stats.mpg), 0.95)].concat(within(35.95, 1.45)),
		["MPG p5", pct(g((p) => p.stats.mpg), 0.05)].concat(within(22, 7)),
		["USG% mean", mean(usg) * 100].concat(within(dy.usg.mean * 100, 2.5)),
		["USG% p95", pct(usg, 0.95) * 100].concat(within(dy.usg.p95 * 100, 3)),
		["USG% max", Math.max.apply(null, usg) * 100].concat(extreme(32, 37)),
		["PPG mean", mean(g((p) => p.stats.ppg))].concat(within(dy.ppg.mean, 1.6)),
		["PPG p95", pct(g((p) => p.stats.ppg), 0.95)].concat(within(dy.ppg.p95, 2.6)),
		// A per-seed maximum is noisy, so the band has to be wider than the
		// point estimate or the harness fails at random and everyone learns to
		// ignore it.
		["PPG leader (avg/seed)", mean(leaders)].concat(within(dy.ppg.p95 * 1.12, 3.5)),
		["PPG max", Math.max.apply(null, g((p) => p.stats.ppg))].concat(
			extreme(dy.ppg.p95 * 1.32 - 5.5, dy.ppg.p95 * 1.32 + 5.5)),
		["RPG max", Math.max.apply(null, g((p) => p.stats.rpg))].concat(extreme(10.5, 17)),
		["ORPG mean", mean(g((p) => p.stats.orpg))].concat(within(1.7, 0.7)),
		["APG p95", pct(apg, 0.95)].concat(within(6.3, 1.3)),
		/* The assist floor. At AST_EXP 4.1 the 10th percentile of the whole
		   class was 0.15 assists a game and the bigs' floor was 0.31 — nobody
		   plays 25 minutes a night and finishes there. */
		["APG p10", pct(apg, 0.10)].concat(within(1.05, 0.55)),
		["APG p10 (bigs)", pct(bigApg, 0.10)].concat(within(0.95, 0.55)),
		["APG leader (avg/seed)", mean(astLeaders)].concat(within(7.4, 1.4)),
		/* Widened from 10.5 when the per-class archetype pool went in: a class
		   drawn from 14 builds can genuinely be a class of playmakers, and its
		   best passer is then a different animal from the best passer in a
		   class of one of everything. The D-I single-season record is 13.3. */
		["APG max", Math.max.apply(null, apg)].concat(extreme(7.0, 12.0)),
		["BPG p95", pct(g((p) => p.stats.bpg), 0.95)].concat(within(2.2, 0.8)),
		// Real shot-blockers reach 3.5-4.6 (Kessler 4.6, Chet 3.7).
		["BPG max", Math.max.apply(null, g((p) => p.stats.bpg))].concat(extreme(2.8, 5.0)),
		["SPG max", Math.max.apply(null, g((p) => p.stats.spg))].concat(extreme(2.0, 4.2)),
		["PF mean", mean(g((p) => p.stats.pfpg))].concat(within(2.55, 0.85)),
		["TS% mean", mean(g((p) => p.stats.ts)) * 100].concat(within(dy.ts.mean * 100, 2)),
		["3P% mean", mean(g((p) => p.stats.tpp)) * 100].concat(
			within(dy.tpPct.median * 100, 2.6)),
		["FT% mean", mean(g((p) => p.stats.ftp)) * 100].concat(within(dy.ftPct.mean * 100, 3.5)),
		["FG% mean", mean(g((p) => p.stats.fgp)) * 100].concat(within(48, 4)),
		["FTA mean", mean(g((p) => p.stats.fta))].concat(within(4.2, 1.2)),
		["GP mean", mean(g((p) => p.stats.gp))].concat(within(dy.gp.mean, 2.5)),

		/* Team rows, against the era's own league averages, scaled to the pace
		   the run was made at. These are what catches a broken possession
		   model, which per-player rate bands cannot. */
		["Team PPG", mean(teamPts)].concat(near(tm.pts * paceK, 0.06)),
		["Team FGA", mean(teamFga)].concat(near(tm.fga * paceK, 0.06)),
		["Team poss", mean(teamPoss)].concat(near(tm.poss * paceK, 0.06)),
		["Team AST", mean(teamAst)].concat(near(tm.ast * paceK, 0.10)),
		["Team TRB", mean(teamTrb)].concat(near(tm.trb * paceK, 0.07)),
		["Team BLK", mean(teamBlk)].concat(near(tm.blk, 0.30)),
		["Team STL", mean(teamStl)].concat(near(tm.stl, 0.22)),
		/* Turnovers, free throws and fouls had no band at all, which is how
		   turnovers drifted 15% high, free throws 12% high and fouls 9% low
		   with every other check passing. */
		["Team TOV", mean(teamTov)].concat(near(tm.tov * paceK, 0.12)),
		["Team FTA", mean(teamFta)].concat(near(tm.fta * paceK, 0.13)),
		["Team PF", mean(teamPf)].concat(near(tm.pf, 0.09)),
		/* Fouls and free throws are the same event seen from two sides, and
		   they are produced by two entirely independent code paths with nothing
		   reconciling them: the sim used to commit fewer fouls than real D-I
		   while awarding more free throws than real D-I. The league ratio is
		   about 1.05 free-throw attempts per personal foul. */
		["Team FTA per PF", mean(teamFtaPerPf), 0.88, 1.28],

		/* The whole simulated field, against the D-I rotation-player baseline
		   for this era. Every program is simulated, so "is the average Division
		   I player right?" is a question with an answer. */
		["Field TS%", mean(field.map((l) => l.ts)) * 100].concat(within(rot.ts * 100, 2)),
		["Field 3P%", mean(field.map((l) => l.tpp)) * 100].concat(within(rot.tpPct * 100, 2)),
		["Field FT%", mean(field.map((l) => l.ftp)) * 100].concat(within(rot.ftPct * 100, 2.5)),
		["Field ORtg", mean(teamOrtg)].concat(within(rot.ortg, 3)),

		/* The documented per-player share ceilings, measured the way a reader
		   would check them: against the team total, not against the pool. */
		["Max share of team AST", Math.max.apply(null, maxAstShare), 0, 0.621],
		["Max share of team TRB", Math.max.apply(null, maxRebShare), 0, 0.401],
		["Max share of team BLK", Math.max.apply(null, maxBlkShare), 0, 0.681],

		/* The four things a user expects a draft class to express. None of them
		   is a distribution, so none of them was checked, and two were broken:
		   athleticism drove blocks and not steals, and the documented
		   talent-to-efficiency gradient was exported and never called. */
		/* Tightened from [-0.62, -0.15]. This row was the only one that could
		   see the location bias at all, and at -0.49 to -0.58 it sat one bad
		   commit from the edge of a tolerance drawn wide enough to hide it. */
		["corr(conference strength, PPG)",
			corr(g((p) => p.vConfStrength), g((p) => p.stats.ppg))].concat(corrBand(-0.50, -0.15)),
		["corr(ovr, PPG)", corr(g((p) => p.newOvr), g((p) => p.stats.ppg))].concat(
			corrBand(0.30, 0.75)),
		["corr(3PT rating, FG%)",
			corr(g((p) => p.newRatings.tp), g((p) => p.stats.fgp))].concat(corrBand(-0.80, -0.20)),
		["corr(3PT rating, 3P%)",
			corr(g((p) => p.newRatings.tp), g((p) => p.stats.tpp))].concat(corrBand(0.60, 0.95)),
		["corr(athleticism, BPG)",
			corr(g((p) => p.vComps.athleticism), g((p) => p.stats.bpg))].concat(corrBand(0.35, 0.80)),
		["corr(athleticism, SPG)",
			corr(g((p) => p.vComps.athleticism), g((p) => p.stats.spg))].concat(corrBand(0.18, 0.60)),
		["corr(passing, APG)",
			corr(g((p) => p.vComps.passing), g((p) => p.stats.apg))].concat(corrBand(0.60, 0.95)),
		["corr(ovr, TS%)", corr(g((p) => p.newOvr), g((p) => p.stats.ts))].concat(
			corrBand(0.28, 0.70)),
		/* Where a prospect played must not decide how long he played.

		   These three rows exist because nothing in the harness could see the
		   structural fault the minutes model had: every per-stat distribution
		   passed while a program's strength predicted a prospect's minutes
		   (-0.78) two and a half times better than his own rating did (+0.30).
		   corr(conference strength, PPG) came closest and its band had been
		   drawn wide enough to hide it. */
		["corr(program level, MPG)",
			corr(g((p) => p.vLevel), g((p) => p.stats.mpg))].concat(corrBand(-0.45, -0.02)),
		["corr(ovr, MPG)", corr(g((p) => p.newOvr), g((p) => p.stats.mpg))].concat(
			corrBand(0.30, 0.80)),
		/* Talent has to beat address. This is the whole claim of the minutes
		   model in one number, and it is the one that cannot be satisfied by
		   widening a band. */
		["|corr(ovr, MPG)| - |corr(level, MPG)|",
			Math.abs(corr(g((p) => p.newOvr), g((p) => p.stats.mpg))) -
				Math.abs(corr(g((p) => p.vLevel), g((p) => p.stats.mpg)))].concat(
			corrBand(0.10, 1)),
		/* The scoring floor of the back of a class. A second-rounder out of
		   D-I averaged roughly 13-15 points in his draft year; sub-8 seasons
		   are almost non-existent and belong to elite defensive bigs. */
		["PPG p10, bottom third of class", pct(bottomThird, 0.10), 7.8, 14],
		/* Build must not decide scoring the way quality does. At equal overall
		   rating the spread ran from -4.9 points (Defensive Pest) to +4.9
		   (Score-First Point) — 9.8 points, against 7.0 across the whole
		   ovr 30-60 range. */
		["max |archetype PPG residual|", archResidual(all), 0, 2.4],

		/* Scoring by size, at equal overall rating. A draft class's guards are
		   its volume scorers; the sim had seven-footers as the highest-scoring
		   group even after matching on quality. */
		["PPG, bigs minus guards (ovr-matched)", bigMinusGuard].concat(
			within(-0.2, 1.4)),

		["Pace of honoured minus pace of all",
			(paceOfHonoured.length ? mean(paceOfHonoured) : 0) -
				(paceOfAll.length ? mean(paceOfAll) : 0), -1.2, 1.2],

		/* Schedule integrity. */
		["Regular-season game spread", Math.max.apply(null, gamesSpread), 0, 1],
		["Champion record includes March", mean(postseasonInRecord), 1, 1],
		["Games logged out of order", outOfOrder.length, 0, 0],

		/* Award volume. Prospects are ranked against every returning player in
		   Division I — against their actual simulated seasons rather than a
		   regression on talent — so these are the rows that matter. */
		["National awards/class", mean(natAwards)].concat(perClass(2, 26)),
		["POY in class (rate)", mean(poyClasses)].concat(rateBand(0.05, 0.85)),
		["Consensus 1st Team/class", mean(firstTeam)].concat(perClass(0.2, 3)),
		["All-conference 1st/class", mean(confFirst)].concat(perClass(8, 26)),
		["All-conference 2nd/class", mean(confSecond)].concat(perClass(3, 18)),
		["Defensive awards/class", mean(defAwards)].concat(perClass(4, 26)),
		["Honoured players/class", mean(honouredCount)].concat(perClass(25, 58)),
		// Dominated by conference honours across ~31 conferences, which future
		// draft picks legitimately win a lot of.
		["Awards/class (all)", mean(awardsCount)].concat(perClass(70, 190)),
		["Non-D1 D-I awards", mean(nonNcaaAwards), 0, 0],
	];
	return { rows, all, field, leaders, awardsCount };
}

/* The worst mean scoring residual of any archetype against the class's own
   ovr fit — i.e. how much of a player's scoring is decided by his build rather
   than by how good he is. Builds with too few seasons to measure are skipped
   rather than allowed to fail the check on noise. */
function archResidual(all) {
	const xs = all.map((p) => p.newOvr);
	const ys = all.map((p) => p.stats.ppg);
	const mx = mean(xs);
	const my = mean(ys);
	let num = 0;
	let den = 0;
	for (let i = 0; i < xs.length; i++) {
		num += (xs[i] - mx) * (ys[i] - my);
		den += (xs[i] - mx) * (xs[i] - mx);
	}
	if (den <= 0) return 0;
	const slope = num / den;
	const icpt = my - slope * mx;
	const by = {};
	for (const p of all) (by[p.archetype] = by[p.archetype] || []).push(p);
	let worst = 0;
	for (const k of Object.keys(by)) {
		if (by[k].length < 12) continue;
		worst = Math.max(worst,
			Math.abs(mean(by[k].map((p) => p.stats.ppg - (icpt + slope * p.newOvr)))));
	}
	return worst;
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
	/* Which era to check. Both are checked by default: the model and the
	   anchors move together, so an era whose bands nobody runs is an era that
	   quietly rots. */
	const eraArg = (args.filter((a) => a.startsWith("--era="))[0] || "").slice(6);
	const eras = eraArg ? [eraArg] : Object.keys(global.Calibration.ERAS);

	const perEra = eras.map((era) => {
		const { rows, all } = collect(nSeeds, { era });
		const recon = reconcileError(all);
		const checks = rows.map(([name, v, lo, hi]) => ({
			name, value: v, lo, hi, ok: v >= lo && v <= hi,
		}));
		checks.push({
			name: "Stat line reconciles", value: recon, lo: 0, hi: 0.02, ok: recon <= 0.02,
		});
		return { era, checks, seasons: all.length };
	});

	// Checks that are not about a season at all, so they run once rather than
	// once per era.
	const checks = [];
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

	const fail = perEra.reduce((a, e) => a + e.checks.filter((c) => !c.ok).length, 0) +
		checks.filter((c) => !c.ok).length;
	const fmt = (x) => (Math.abs(x) >= 1000 || Number.isInteger(x) ? String(x) : x.toFixed(2));
	if (asJson) {
		console.log(JSON.stringify({
			seeds: nSeeds, failures: fail, eras: perEra, global: checks,
		}, null, 2));
	} else {
		for (const e of perEra) {
			console.log("Era " + e.era + " — " + nSeeds + " seeds, " +
				e.seasons + " NCAA player-seasons\n");
			for (const c of e.checks) {
				console.log(
					(c.ok ? "  ok   " : "  FAIL ") + c.name.padEnd(38) +
					c.value.toFixed(2).padStart(8) +
					"   [" + fmt(c.lo) + ", " + fmt(c.hi) + "]",
				);
			}
			console.log("");
		}
		for (const c of checks) {
			console.log(
				(c.ok ? "  ok   " : "  FAIL ") + c.name.padEnd(38) +
				c.value.toFixed(2).padStart(8) + "   [" + fmt(c.lo) + ", " + fmt(c.hi) + "]",
			);
		}
		console.log("\n" + (fail ? fail + " check(s) failed" : "all checks passed"));
	}
	process.exit(fail ? 1 : 0);
}

module.exports = { loadEngine, syntheticClass, collect, reconcileError, pct, mean };

if (require.main === module) main();
