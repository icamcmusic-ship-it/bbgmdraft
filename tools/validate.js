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

/* An archetype with no role-usage entry used to fall through to a silent
   1.0. Under a harness that is a bug that cannot be seen, so the harness
   asks for it to throw instead. Set before the engine is loaded, because
   js/ratings.js reads it once at load time. */
process.env.BBGM_STRICT_ROLES = "1";

function loadEngine() {
	if (!global.window) global.window = global;
	if (!global.Engine) {
		/* Every module the page loads, in the page's own order — news.js and
		   universe.js included. They used to be left out, so nothing that
		   ran in CI ever read a News article's text, which is exactly how
		   "a Arizona State dunk" shipped. faces.js is the one exception: it
		   wraps the vendored facesjs and draws SVG, which has no business in
		   a Node harness. */
		for (const f of [
			"text", "rng", "bbgm", "bbgmstats", "colleges", "config", "calibration", "ratings",
			"traits",
			"teams", "stats", "rankings", "tournament", "awards", "engine", "batch",
			"sample", "news", "universe",
		]) require(path.join(__dirname, "..", "js", f + ".js"));
	}
	return global;
}

loadEngine();
const { Rng, clamp } = global.BBGMRng;
const BB = global.BBGM;

/* THE FIXTURES.

   There are two, and which one is the DEFAULT is the single most consequential
   decision in this file.

   `syntheticClass` draws every rating from N(45, 13). That produces a class
   with mean ovr 45, half of it at ovr 45 or better and barely 1% under 30.
   No BBGM draft class has ever looked like that. A real export runs ovr 20-55
   with a mean near 35 and a large low-ovr mass, because a draft class is a
   RANKED LIST: the first pick and the seventieth are not two draws from one
   normal distribution, they are the two ends of a decaying slot curve.

   Every band in this file used to be measured against the N(45, 13) class, and
   every one of them passed — while the same engine, handed a realistically
   shaped class, produced 12.7 points a game against an anchor of 14.6, a
   quarter of the class under 9 points, and 4.2 twenty-point scorers where a
   real class has 7 or 8. The harness was correctly certifying a model
   calibrated to a population the tool never sees.

   So `realisticClass` is the default, `syntheticClass` is kept as a second
   fixture (it is a useful stress test: a class of uniformly good players is a
   different load on the usage model), and rows are tagged with which fixtures
   they are meaningful on. */

/* Shared skeleton: colleges, birthplaces and physicals, drawn the way BBGM
   itself draws them. `targetOvr` is null for the synthetic fixture (take
   whatever the ratings produce) or a number for the realistic one. */
function makeClass(rng, n, targetOvrAt) {
	// Colleges are drawn frequency-weighted, matching how BBGM itself assigns
	// them — most prospects come from power programs, not random mid-majors.
	const names = global.Colleges.names;
	const weights = names.map((x) => global.Colleges.frequencyOf(x));
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
		let r = {};
		for (const k of BB.RATING_KEYS) r[k] = clamp(Math.round(pr.normal(45, 13)), 5, 90);
		r.hgt = hgt;
		// Size-correlated skill ratings, like real BBGM generation.
		r.tp = clamp(Math.round(pr.normal(52 - 22 * b, 12)), 5, 90);
		r.ft = clamp(Math.round(pr.normal(52 - 12 * b, 11)), 5, 90);
		r.ins = clamp(Math.round(pr.normal(40 + 16 * b, 11)), 5, 90);
		r.reb = clamp(Math.round(pr.normal(42 + 18 * b, 11)), 5, 90);
		r.pss = clamp(Math.round(pr.normal(55 - 20 * b, 12)), 5, 90);
		r.fuzz = 0;
		const target = targetOvrAt ? targetOvrAt(i, pr) : null;
		if (target !== null) {
			/* Shift every rating but hgt by one scalar until BBGM's own ovr
			   formula returns the draft slot's target. Shifting rather than
			   rescaling keeps the size correlations above intact, so the
			   realistic fixture differs from the synthetic one in exactly one
			   respect: the shape of the ovr curve. */
			const shifted = (d) => {
				const o = { fuzz: 0 };
				for (const k of BB.RATING_KEYS) {
					o[k] = k === "hgt" ? r.hgt : clamp(Math.round(r[k] + d), 1, 95);
				}
				return o;
			};
			let lo = -45;
			let hi = 45;
			for (let it = 0; it < 40; it++) {
				const mid = (lo + hi) / 2;
				if (BB.ovr(shifted(mid)) < target) lo = mid;
				else hi = mid;
			}
			r = shifted((lo + hi) / 2);
		}
		r.ovr = BB.ovr(r);
		r.pot = clamp(r.ovr + Math.round(pr.uniform(3, 20)), r.ovr, 90);
		r.pos = BB.pos(r);
		r.skills = [];
		players.push({
			pid: i,
			firstName: "Test", lastName: "P" + i,
			born: { year: 2007, loc: pr.random() < 0.75 ? "Anytown, WA" : "Belgrade, Serbia" },
			hgt: 66 + Math.round((hgt / 100) * 24),
			weight: Math.round(165 + hgt * 0.9),
			college: pr.random() < 0.18 ? "" : pickCollege(pr.random()),
			draft: { year: 2026, round: 1 + Math.floor(i / 30), pick: 1 + (i % 30) },
			ratings: [r],
		});
	}
	return { startingSeason: 2026, players };
}

/* The legacy fixture: every rating N(45, 13), so ovr ~ N(45, 6). Retained as a
   stress test and so the old numbers stay reproducible. NOT the default. */
function syntheticClass(seed, n) {
	return makeClass(new Rng("synth:" + seed), n, null);
}

/* The default fixture: a draft-slot-shaped ovr curve.

   ovr(slot) = 53 - 31 * slot^0.8, slot = pick index / (n - 1), plus N(0, 3.2)
   of scouting noise. That runs from about 53 at the top of the board to about
   22 at the bottom with a mean near 35 — which is what a BBGM export of a
   draft class actually looks like, and is a completely different load on the
   stat model from a class where half the field is ovr 45 or better. */
function realisticClass(seed, n) {
	const rng = new Rng("real:" + seed);
	return makeClass(rng, n, (i, pr) => {
		const slot = n > 1 ? i / (n - 1) : 0;
		return clamp(Math.round(53 - 31 * Math.pow(slot, 0.8) + pr.normal(0, 3.2)), 15, 62);
	});
}

const FIXTURES = { realistic: realisticClass, synthetic: syntheticClass };

/* The named national player-of-the-year trophies replaced a single generic
   "National Player of the Year" string. */
const POY_RE = /^(Naismith Trophy|John R\. Wooden Award|Oscar Robertson Trophy|AP Player of the Year|NABC Player of the Year|Sporting News Player of the Year)$/;
const FINALIST_RE = /finalist|Late Season Top|honorable mention|watch list/;
const NATIONAL_RE = /All-American|All-Freshman Team|NABC All-Defensive|^(Naismith|John R\.|Oscar Robertson|AP Player|NABC Player|Sporting News|Lefty Driesell|Bob Cousy|Jerry West|Julius Erving|Tim Duncan|Kareem|Pete Newell|Lute Olson|Wayman Tisdale|Consensus National)/;

function pct(vals, p) {
	const s = vals.slice().sort((a, b) => a - b);
	return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}
const mean = (v) => v.reduce((a, b) => a + b, 0) / v.length;
const sd = (v) => {
	const m = mean(v);
	return Math.sqrt(mean(v.map((x) => (x - m) * (x - m))));
};

/* Run nSeeds classes and return every check row plus the raw samples.

   `fixture` names the class shape (see FIXTURES above); it defaults to the
   realistic one. Rows carry a `scope`:

     prospect   about the draft class itself — PPG, usage, the scoring floor,
                the ovr-to-production relationship. Only meaningful on a class
                shaped like a real one, so these run on the realistic fixture
                alone.
     field      about the whole simulated Division I — team totals, the
                rotation-player baseline. The 70 prospects are a rounding error
                in 360 programs, so these are fixture-independent and are
                checked on both.
     structure  about the engine rather than the season (schedule integrity,
                award plumbing, reconciliation). Also fixture-independent. */
function collect(nSeeds, cfgOverrides, fixture) {
	const makeFixture = FIXTURES[fixture] || FIXTURES.realistic;
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
	/* Only ever WIDER, never narrower. These bands are modeling tolerances
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
		/* A floor that has scaled below 5% is a floor a four-seed run can
		   miss on the draw alone (no 1 seed won in four Marches happens
		   about one run in twenty at a true 45%), which is how a developer
		   learns to ignore the harness. Below that the floor is zero. */
		return [b[0] < 0.05 ? 0 : b[0], Math.min(1, b[1])];
	};
	/* Tags for a player's build. Read off the archetype table rather than off
	   the player, because a player carries the build's NAME and the tags are
	   what the rows below are about. Built once. */
	const ARCH_TAGS = {};
	for (const a of global.RatingsBuilder.ARCHETYPES) ARCH_TAGS[a.name] = a.t || [];
	const archTags = (p) => ARCH_TAGS[p.archetype] || [];

	const all = [];
	const field = [];
	const leaders = [];
	const astLeaders = [];
	const awardsCount = [];
	const honoredCount = [];
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
	const finalistAwards = [];
	const poyClasses = [];
	const firstTeam = [];
	const confFirst = [];
	const confSecond = [];
	const defAwards = [];
	const gamesSpread = [];
	const postseasonInRecord = [];
	const outOfOrder = [];
	const bottomThird = [];
	/* The MIDDLE of a class — ranks 20-50, which is picks ~20 through ~50 and
	   the part of a board where every name is supposed to be an argument.
	   Kept separately from the bottom third because the two fail differently:
	   the bottom third collapses toward zero, the middle collapses toward its
	   own mean, and a band on either one cannot see the other. */
	const midClass = [];
	const backTen = [];
	const paceOfHonored = [];
	const paceOfAll = [];
	const usgBins = {};
	const scorers20 = [];
	const scorers25 = [];
	/* March. Nothing here was banded, so the bracket could be — and was —
	   systematically more chaotic than the real one with every stat band
	   passing: 1 seeds beat 16 seeds 92% of the time against a real 99%,
	   won 23% of titles against a real 55-65%, and filled 20% of Final Four
	   places against a real 40%. Seed-line win rates in the round of 64,
	   the champion's seed and the Final Four's composition are the three
	   readings that describe how chalky a tournament is, and all three
	   drift in either direction: a curve steep enough for the same school
	   to win every year is the opposite failure and the bands have a top. */
	const seedLine = { "1v16": [0, 0], "2v15": [0, 0], "5v12": [0, 0], "8v9": [0, 0] };
	const champSeedOne = [];
	const champSeedDeep = [];
	const ffOneShare = [];
	/* The first in-season AP poll. A November ballot is the preseason ballot
	   with the losers moved down; it used to be re-derived from two games
	   of results, which put a 2-0 Colgate at No. 2. */
	const pollWeek1 = [];
	for (let s = 0; s < nSeeds; s++) {
		const lf = makeFixture(s, 70);
		/* NARRATIVES OFF, deliberately.

		   A season narrative (see NARRATIVES in js/engine.js) is a stated
		   deviation from an ordinary season — a scoring explosion, a defensive
		   slog, an attrition year — and it moves pace, efficiency, injuries and
		   the upset factor on purpose. Every band in this file is a claim
		   about the MODEL's agreement with an empirical anchor, so measuring
		   it against a season that has announced itself as unusual measures
		   the wrong thing: the class maximum was landing above its band about
		   one run in three purely because that run drew "a scoring explosion".

		   The narratives are banded separately, and wider, at the bottom of
		   this file — which is the check that actually matters for them: that
		   they move the season without leaving the sport. */
		const res = global.Engine.run(
			lf, global.Config.make(Object.assign(
				{ seed: "v" + s, narrative: false }, cfgOverrides)));
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
		/* Ranks 20-50 of the class by overall rating. */
		for (const p of byRank.slice(19, 50)) {
			if (p.stats) midClass.push(p.stats.ppg);
		}
		/* The last ten men on the board. The bottom-third percentile row sees
		   the floor of the class; this sees its LEVEL, which is a different
		   failure and moved differently under every fix tried. */
		for (const p of byRank.slice(Math.max(0, byRank.length - 10))) backTen.push(p.stats.ppg);
		scorers20.push(ncaa.filter((p) => p.stats.ppg >= 20).length);
		scorers25.push(ncaa.filter((p) => p.stats.ppg >= 25).length);
		/* Usage, in one-point bins. No per-stat distribution band can see a
		   WALL: a clamp that pins a tenth of the class onto one value leaves
		   the mean, the p5 and the p95 all perfectly respectable. Only the
		   shape shows it. */
		for (const p of ncaa) {
			const bin = Math.floor(p.stats.usg * 100);
			usgBins[bin] = (usgBins[bin] || 0) + 1;
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
		/* Tempo must not buy honors. productionScore is raw counting volume,
		   and PROGRAM_STYLES moves a team's possessions by +/-5.5 a game, so a
		   run-and-gun program handed its best player about 8% more of
		   everything for nothing he had done — and that score is what both the
		   award model and the draft board rank on. */
		for (const p of ncaa) {
			const t = res.teams[p.newCollege];
			if (!t || !Number.isFinite(t.pace)) continue;
			paceOfAll.push(t.pace);
			if ((p.awards || []).length) paceOfHonored.push(t.pace);
		}
		const regGames = Object.values(res.teams).map((t) => t.regGames);
		gamesSpread.push(Math.max.apply(null, regGames) - Math.min.apply(null, regGames));
		const tourney = res.tourney;
		if (tourney && tourney.regions && tourney.champion) {
			for (const r of Object.keys(tourney.regions)) {
				for (const g of tourney.regions[r].rounds[0] || []) {
					const hi = Math.min(g.a.seed, g.b.seed);
					const lo = Math.max(g.a.seed, g.b.seed);
					const k = hi + "v" + lo;
					if (!seedLine[k]) continue;
					seedLine[k][1]++;
					if (g.winner.seed === hi) seedLine[k][0]++;
				}
			}
			champSeedOne.push(tourney.champion.seed === 1 ? 1 : 0);
			champSeedDeep.push(tourney.champion.seed >= 5 ? 1 : 0);
			const ff = tourney.finalFour || [];
			if (ff.length) ffOneShare.push(ff.filter((x) => x.seed === 1).length / ff.length);
		}
		const hist = res.pollHistory;
		if (hist && hist.length > 2 && hist[0].ranks && hist[1].ranks) {
			const pre = new Set(hist[0].ranks.slice(0, 25).map((r) => r.team));
			const w1 = hist[1].ranks.slice(0, 10);
			if (w1.length) pollWeek1.push(w1.filter((r) => pre.has(r.team)).length / w1.length);
		}
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
		/* A league's OWN honors are not a leak, however they are spelled.
		   "Division II All-American", "NAIA All-American" and "Prep
		   All-American" all match the national regex because they are all
		   All-American teams — of a different division. */
		const OWN_AWARD = /^(Division II|NAIA|Prep|National Prep)/;
		const d1Only = (a) => NATIONAL_RE.test(a) && !OWN_AWARD.test(a);
		nonNcaaAwards.push(res.players.filter((p) =>
			p.nonNcaa && (p.awards || []).some(d1Only)).length);
		/* A finalist is not a winner. The finalist tier reuses the trophy's own
		   name, so it matches NATIONAL_RE — counting those as national awards
		   would triple this row for a change that hands out no new trophies. */
		natAwards.push(res.players.reduce((a, p) => a +
			(p.awards || []).filter((x) => NATIONAL_RE.test(x) && !FINALIST_RE.test(x))
				.length, 0));
		finalistAwards.push(res.players.reduce((a, p) => a +
			(p.awards || []).filter((x) => FINALIST_RE.test(x)).length, 0));
		poyClasses.push(res.players.some((p) =>
			(p.awards || []).some((a) => POY_RE.test(a))) ? 1 : 0);
		firstTeam.push(res.players.filter((p) =>
			(p.awards || []).indexOf("Consensus First Team All-American") !== -1).length);
		honoredCount.push(res.players.filter((p) => (p.awards || []).length).length);
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
	/* Widened from ovr 44-52 and hgt <32 / >=73: at four seeds those
	   windows held about a dozen players a side, and a dozen scoring
	   averages move by three points between two draws of the same model.
	   The wider window is still guards against genuine centres at the same
	   overall, and it is three times the sample. */
	const matched = all.filter((p) => p.newOvr >= 42 && p.newOvr <= 54);
	const mGuards = matched.filter((p) => p.newRatings.hgt < 35);
	const mBigs = matched.filter((p) => p.newRatings.hgt >= 68);
	const bigMinusGuard = mGuards.length && mBigs.length
		? mean(mBigs.map((p) => p.stats.ppg)) - mean(mGuards.map((p) => p.stats.ppg))
		: 0;
	/* This row's noise is set by the size of the two matched subgroups, not by
	   the seed count: it compares ovr 44-52 guards against ovr 44-52
	   seven-footers, and at 8 seeds that can be a dozen players a side. Scaling
	   its band by nSeeds like every other row therefore under-widened it, and
	   the row failed at 6 and 8 seeds while passing at 3, 12 and 20 — noise
	   masquerading as a finding, which is exactly what this harness exists not
	   to do. Widen it by its own smallest subgroup instead. */
	const matchedN = Math.max(1, Math.min(mGuards.length, mBigs.length));
	const matchedK = Math.max(1, Math.sqrt(80 / matchedN));
	const bigApg = all.filter((p) => p.newRatings.hgt >= 60).map((p) => p.stats.apg);

	/* The share of the class sitting in the single busiest one-point usage bin.
	   A smooth distribution over a ~20-point range puts 5-6% in its modal bin;
	   anything above about 8% is a clamp, not a mode. */
	const usgTotal = Object.keys(usgBins).reduce((a, k) => a + usgBins[k], 0) || 1;
	const worstUsgBin = Object.keys(usgBins)
		.reduce((a, k) => Math.max(a, usgBins[k] / usgTotal), 0);
	/* A raw share is the wrong yardstick: how much of a distribution lands in
	   its busiest one-point bin depends on how wide the distribution is. A
	   normal puts 1 / (sd * sqrt(2*pi)) of itself in its modal unit bin — 8.0%
	   at sd 5, 8.9% at sd 4.5 — so 9% can be a perfectly healthy mode or a
	   clamp, and only the ratio to that expectation tells them apart. The two
	   walls this row exists to catch scored about 1.45 on it. */
	const usgSd = (function () {
		const m = mean(usg);
		return Math.sqrt(mean(usg.map((v) => (v - m) * (v - m))));
	})();
	const usgSpike = worstUsgBin * (usgSd * 100) * Math.sqrt(2 * Math.PI);

	// [name, value, lo, hi]. Every band that describes "what a season looks
	// like" is derived from the selected era's anchors in js/calibration.js.
	const prospectRows = [
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
		/* Tightened from +/-1.6. A 3.2-point-wide band on a 14.6-point quantity
		   certifies an 11% error as passing, and an 11% error is exactly the
		   size of the fault this suite failed to see. The 1/sqrt(n) widening
		   below still applies, so the CI seed count decides how much slack
		   there is — but the base tolerance is now narrow enough that a real
		   miscalibration cannot hide inside it at 20 seeds. */
		["PPG mean", mean(g((p) => p.stats.ppg))].concat(within(dy.ppg.mean, 0.9)),
		/* Wider than the mean's band on purpose. The mean is derived from the
		   era's own numbers and is therefore a hard target; p95 carries the
		   1.50 mean-to-p95 ratio that the old stated anchor pair implied, which
		   is an assumption about the SHAPE of the distribution and not a
		   measurement of it. The model produces 1.55-1.57. */
		["PPG p95", pct(g((p) => p.stats.ppg), 0.95)].concat(within(dy.ppg.p95, 2.6)),
		/* The LEVEL of a class, which no percentile band can express: how many
		   genuine scorers it contains. A real draft class has seven or eight
		   twenty-point scorers and about one at twenty-five. This is the row
		   that fails when the model is quietly handing the class's possessions
		   to its synthesized teammates. */
		["20+ PPG scorers/class", mean(scorers20)].concat(perClass(6.0, 14.0)),
		["25+ PPG scorers/class", mean(scorers25)].concat(perClass(0.5, 3.8)),
		/* The bottom of the board, as a level rather than a percentile. Picks
		   61-70 are late second-rounders — mid-major seniors and toolsy
		   projects — and they average around ten points, not seven. */
		["PPG mean, last ten on board", mean(backTen)].concat(within(12.5, 2.2)),
		/* Two clamps used to pin about 29% of every class onto two usage
		   values (a soft floor asymptote at 13.65% and the lower bound of the
		   personal ceiling at 19.5%), which is what "the stats all feel the
		   same" is from the inside. No band on a mean or a percentile can see
		   a wall, so the shape is checked directly. */
		/* The upper bound widens with a smaller sample, and by more than a mean
		   would. This is a MAXIMUM over about twenty-five bins of a multinomial
		   share: at 20 seeds each bin's share has a standard error near 0.008
		   and at 4 seeds near 0.017, and taking a maximum turns that into bias
		   rather than noise, so a perfectly smooth distribution scores higher
		   here on a small sample. Without the widening this row failed at the
		   documented low-seed invocation while passing at 20, which is the
		   fault the whole seed-scaling section above exists to prevent. */
		["USG spike vs a smooth mode", usgSpike, 0, 1.30 + 0.45 * (noiseK - 1)],
		// A per-seed maximum is noisy, so the band has to be wider than the
		// point estimate or the harness fails at random and everyone learns to
		// ignore it.
		["PPG leader (avg/seed)", mean(leaders)].concat(within(dy.ppg.p95 * 1.18, 2.6)),
		["PPG max", Math.max.apply(null, g((p) => p.stats.ppg))].concat(
			extreme(dy.ppg.p95 * 1.32 - 5.5, dy.ppg.p95 * 1.32 + 5.5)),
		["RPG max", Math.max.apply(null, g((p) => p.stats.rpg))].concat(extreme(10.5, 17)),
		["ORPG mean", mean(g((p) => p.stats.orpg))].concat(within(1.7, 0.7)),
		/* The MEDIAN assist and rebound line, which had no band at all — so the
		   only thing checked about the middle of these two distributions was
		   nothing, and a realistically shaped class sat at 1.6 assists and 4.7
		   rebounds while every banded row passed. Both are derived from the
		   era's own team totals: a team's 13.5 assists are shared over 200
		   player-minutes, so a prospect playing the anchor's 30.6 draws 2.07 of
		   them at a proportional share. He is a better passer and rebounder
		   than the average man on the floor, so the anchor sits a little above
		   proportional; the tolerance covers how much "a little" is. */
		["APG median", pct(apg, 0.50)].concat(
			within((tm.ast / 200) * dy.mpg.mean * 1.16, 0.75)),
		["RPG median", pct(g((p) => p.stats.rpg), 0.50)].concat(
			within((tm.trb / 200) * dy.mpg.mean * 1.08, 0.85)),
		["APG p95", pct(apg, 0.95)].concat(within(6.5, 1.5)),
		/* The assist floor. At AST_EXP 4.1 the 10th percentile of the whole
		   class was 0.15 assists a game and the bigs' floor was 0.31 — nobody
		   plays 25 minutes a night and finishes there. */
		["APG p10", pct(apg, 0.10)].concat(within(1.05, 0.55)),
		["APG p10 (bigs)", pct(bigApg, 0.10)].concat(within(0.95, 0.55)),
		["APG leader (avg/seed)", mean(astLeaders)].concat(within(8.0, 1.8)),
		/* Widened from 10.5 when the per-class archetype pool went in: a class
		   drawn from 14 builds can genuinely be a class of playmakers, and its
		   best passer is then a different animal from the best passer in a
		   class of one of everything. The D-I single-season record is 13.3. */
		["APG max", Math.max.apply(null, apg)].concat(extreme(7.0, 12.0)),
		["BPG p95", pct(g((p) => p.stats.bpg), 0.95)].concat(within(2.2, 0.8)),
		/* Real shot-blockers reach 3.5-4.6 in a modern season (Kessler 4.6,
		   Chet 3.7); the D-I single-season records sit higher (Bradley 5.2 as
		   a freshman, Foyle 6.4), so a seven-foot anchor on a roster of
		   shot-blockers reaching five once in 1,400 seasons is the tail the
		   model should have, not a fault. */
		["BPG max", Math.max.apply(null, g((p) => p.stats.bpg))].concat(extreme(2.8, 5.5)),
		["SPG max", Math.max.apply(null, g((p) => p.stats.spg))].concat(extreme(2.0, 4.2)),
		["PF mean", mean(g((p) => p.stats.pfpg))].concat(within(2.35, 0.85)),
		/* The band on the PF mean is exactly the failure mode the README's
		   "Shape" section warns about: a quarter of every class used to
		   average over 4.0 fouls a game — a season average of 5.28 is not a
		   high number, it is an impossible one (five ends a night, and the
		   real D-I leader sits around 3.6-3.8) — while the mean sat
		   comfortably inside its band. So the tail is banded directly. */
		["PF max", Math.max.apply(null, g((p) => p.stats.pfpg))].concat(extreme(2.9, 3.95)),
		["PF share above 4.0/g", g((p) => p.stats.pfpg).filter((v) => v > 4.0).length /
			Math.max(1, all.length), 0, 0.005],
		/* Conditional rows. Marginal bands cannot see a flat conditional
		   distribution: team blocks and rebounds were on target while
		   seven-footers medianed 1.1 blocks — the within-team share model
		   spread them too evenly. Real drafted 7-footers average roughly
		   1.8-2.2 blocks and 8.5-9.5 rebounds; a real class's big:guard
		   block ratio is 8-10x, not 4x. */
		["BPG mean (81+ inches)", (function () {
			const v = all.filter((p) => p.newHgtInches >= 81).map((p) => p.stats.bpg);
			return v.length ? mean(v) : 1.9;
		})()].concat(within(1.9, 0.75)),
		["RPG mean (81+ inches)", (function () {
			const v = all.filter((p) => p.newHgtInches >= 81).map((p) => p.stats.rpg);
			return v.length ? mean(v) : 8.7;
		})()].concat(within(8.7, 1.6)),
		["BLK big:guard ratio", (function () {
			const bigs = all.filter((p) => p.newHgtInches >= 81).map((p) => p.stats.bpg);
			const guards = all.filter((p) => p.newHgtInches < 76).map((p) => p.stats.bpg);
			if (!bigs.length || !guards.length) return 8;
			return mean(bigs) / Math.max(0.05, mean(guards));
		})(), 4.5, 16],
		/* The assist floor, conditioned on minutes: a wing playing 28+ a
		   night in D-I basketball does not finish with 0.8 assists, and
		   24% of the class used to. */
		["APG p10 (28+ MPG)", (function () {
			const v = all.filter((p) => p.stats.mpg >= 28).map((p) => p.stats.apg);
			return v.length ? pct(v, 0.10) : 1.3;
		})()].concat(within(1.45, 0.65)),
		["TS% mean", mean(g((p) => p.stats.ts)) * 100].concat(within(dy.ts.mean * 100, 1.8)),
		/* THREE-POINT PERCENTAGE, measured against the population the anchor
		   describes.

		   This row used to be the unfiltered MEAN of every prospect's 3P%
		   against a MEDIAN anchor, and it passed by 0.01 points — which is not
		   a passing check, it is a coin flip that any change to the archetype
		   table would land on either side of. Two things were wrong with the
		   comparison and they pushed the same way:

		     - Mean against median. dy.tpPct is a median because a per-player
		       shooting percentage has a long low tail, and averaging it does
		       not give you the median back.
		     - The whole class against a population of shooters. About 15% of a
		       generated class takes under half a three a game, and a 7-footer
		       who went 4-for-19 all season contributes a 21% to the mean with
		       the same weight as a guard who took 250. The source dataset's
		       median is not computed over those players, because a shooting
		       percentage on nineteen attempts is not a measurement.

		   So: the median, over the prospects who have a real three-point role.
		   The threshold is one attempt a game, which is the point below which
		   the percentage stops being a fact about the player. Measured, this
		   also moves the row off the band edge it was living on — the two eras
		   now sit +1.1 and -0.4 from their anchors instead of -1.6 and -0.9. */
		["3P% median (1+ 3PA)", pct(all.filter((p) => p.stats.tpa >= 1)
			.map((p) => p.stats.tpp), 0.50) * 100].concat(
			within(dy.tpPct.median * 100, 1.65)),
		["FT% mean", mean(g((p) => p.stats.ftp)) * 100].concat(within(dy.ftPct.mean * 100, 2.2)),
		["FG% mean", mean(g((p) => p.stats.fgp)) * 100].concat(within(48, 4)),
		["FTA mean", mean(g((p) => p.stats.fta))].concat(within(4.2, 1.2)),
		["GP mean", mean(g((p) => p.stats.gp))].concat(within(dy.gp.mean, 2.5)),

		/* THE POSITION GRADIENT.

		   Every row above bands a MEAN or a percentile of the whole class, and
		   a mean cannot see a gradient. That is not a hypothetical: the model
		   shipped with a centre-to-point-guard assist ratio of 2.3x against a
		   real 3.8x, and every assist row in this file passed, because the
		   assist POOL was correctly calibrated at the team level and only the
		   SHARE was flat. The audit that found it measured a position table by
		   hand. These rows are that table, so the next one is measured here.

		   Positions are read off the height rating rather than newPos, because
		   newPos is itself derived from the ratings and a change to the
		   position solver would move the band without moving the basketball.

		   Reference, drafted players' final college season (2015-24): PG 3.6
		   rebounds and 5.3 assists, C 8.8 and 1.4. That is a rebound ratio of
		   2.4x and an assist ratio of 3.8x. */
		["C:PG rebound ratio", (function () {
			const g2 = all.filter((p) => p.newRatings.hgt < 30).map((p) => p.stats.rpg);
			const c = all.filter((p) => p.newRatings.hgt >= 62).map((p) => p.stats.rpg);
			if (!g2.length || !c.length) return 2.6;
			return mean(c) / Math.max(0.2, mean(g2));
		})()].concat(perClass(2.05, 3.3)),
		["PG:C assist ratio", (function () {
			const g2 = all.filter((p) => p.newRatings.hgt < 30).map((p) => p.stats.apg);
			const c = all.filter((p) => p.newRatings.hgt >= 62).map((p) => p.stats.apg);
			if (!g2.length || !c.length) return 3.8;
			return mean(g2) / Math.max(0.15, mean(c));
		})()].concat(perClass(2.45, 5.2)),
		/* The gradient as a correlation, which is the shape of it rather than
		   its endpoints: a model that gets the two extremes right and puts
		   everybody in between on the same number passes both rows above. */
		["corr(height, RPG)", corr(g((p) => p.newRatings.hgt),
			g((p) => p.stats.rpg))].concat(corrBand(0.55, 0.85)),
		["corr(height, APG)", corr(g((p) => p.newRatings.hgt),
			g((p) => p.stats.apg))].concat(corrBand(-0.75, -0.35)),

		/* ABSOLUTE MAXIMA. The share caps are shares of a team pool, so on a
		   low-pool team they bind late; before clipPer40 the class maximum ran
		   17.1 rebounds and 10.9 assists a game against a real 12-13 and 8-9. */
		["RPG max", Math.max.apply(null, g((p) => p.stats.rpg))].concat(extreme(10.5, 13.8)),
		["APG max", Math.max.apply(null, g((p) => p.stats.apg))].concat(extreme(7.0, 9.6)),
		["RPG per 40 max", Math.max.apply(null, all.filter((p) => p.stats.mpg >= 8)
			.map((p) => (p.stats.rpg * 40) / p.stats.mpg))].concat(extreme(11, 15.2)),
		["APG per 40 max", Math.max.apply(null, all.filter((p) => p.stats.mpg >= 8)
			.map((p) => (p.stats.apg * 40) / p.stats.mpg))].concat(extreme(7.5, 10.6)),

		/* THE THREE-POINT WALL.

		   A marginal band on 3P% cannot see a CLAMP, and the median row above
		   is proof: `tpCeil` used to be `clamp(0.435 + 0.08*max(0, 1 -
		   tpa/3.5), 0.435, 0.50)`, a hard wall at exactly .435 for anybody
		   taking three and a half attempts a game, and the median row passed
		   comfortably throughout.

		   The rows are conditioned on FOUR attempts a game, because that is the
		   population the wall was built for; the whole shooting population
		   includes low-volume men whose ceiling floated above it and who
		   therefore hid it. Measured on the old model over sixteen classes: of
		   383 volume shooters, 30.5% finished within a third of a point of the
		   class maximum and the p90-to-max gap was 0.00 to the decimal.

		   Two statistics, because either alone can be gamed by a differently
		   shaped ceiling: the p90-to-max gap, which cannot be zero unless
		   something is pinning the top; and the share of the population sitting
		   on the maximum, which is the wall's own signature. The class maximum
		   sits beside them because a real class has a 45-48% shooter on volume
		   most years and a soft ceiling has to actually reach it. */
		["3P% max (4+ 3PA)", (function () {
			const v = all.filter((p) => p.stats.tpa >= 4).map((p) => p.stats.tpp);
			return v.length ? Math.max.apply(null, v) * 100 : 46;
		})()].concat(extreme(43.8, 50.5)),
		["3P% p90-to-max gap (4+)", (function () {
			const v = all.filter((p) => p.stats.tpa >= 4).map((p) => p.stats.tpp);
			if (v.length < 30) return 1.5;
			return (Math.max.apply(null, v) - pct(v, 0.90)) * 100;
		})()].concat(perClass(0.4, 6)),
		["3P% share pinned at class max", (function () {
			const v = all.filter((p) => p.stats.tpa >= 4).map((p) => p.stats.tpp);
			if (v.length < 30) return 0.02;
			const mx = Math.max.apply(null, v);
			return v.filter((x) => x > mx - 0.003).length / v.length;
		})()].concat(rateBand(0, 0.06)),
		["3P% median (4+ 3PA)", (function () {
			const v = all.filter((p) => p.stats.tpa >= 4).map((p) => p.stats.tpp);
			return v.length >= 30 ? pct(v, 0.50) * 100 : 39.7;
		})()].concat(within(39.7, 1.8)),
		/* And the other side of the same coin: a cohort of shooting
		   specialists should average 38-40% from three, not 43.7%. Removing a
		   wall must not raise the middle. */
		["Shooting-tag cohort 3P%", (function () {
			const tagged = all.filter((p) => p.stats.tpa >= 2 && archTags(p).indexOf("shooting") >= 0)
				.map((p) => p.stats.tpp);
			return tagged.length >= 5 ? mean(tagged) * 100 : 39;
		})(), 36.5, 41.5],

		/* THE ARCHETYPE TAGS, IN THE BOX SCORE.

		   "A specialization you cannot see in the box score is a label" is the
		   archetype table's own standard, and nothing enforced it: builds
		   tagged `rebounding` averaged 8.46 rebounds against 8.65 for bigs
		   WITHOUT the tag, a separation of 0.98x. Each row is the tagged
		   cohort against the untagged cohort of comparable size. */
		["rebounding tag separation", (function () {
			const bigs = all.filter((p) => p.newRatings.hgt >= 55);
			const on = bigs.filter((p) => archTags(p).indexOf("rebounding") >= 0)
				.map((p) => p.stats.rpg);
			const off = bigs.filter((p) => archTags(p).indexOf("rebounding") < 0)
				.map((p) => p.stats.rpg);
			if (on.length < 4 || off.length < 4) return 1.3;
			return mean(on) / Math.max(0.5, mean(off));
		})()].concat(perClass(1.12, 1.70)),
		["playmaking tag separation", (function () {
			const gs = all.filter((p) => p.newRatings.hgt < 45);
			const on = gs.filter((p) => archTags(p).indexOf("playmaking") >= 0)
				.map((p) => p.stats.apg);
			const off = gs.filter((p) => archTags(p).indexOf("playmaking") < 0)
				.map((p) => p.stats.apg);
			if (on.length < 4 || off.length < 4) return 1.5;
			return mean(on) / Math.max(0.3, mean(off));
		})()].concat(perClass(1.15, 2.6)),
		["defense tag separation", (function () {
			const gs = all.filter((p) => p.newRatings.hgt < 45);
			const val = (p) => p.stats.spg + p.stats.bpg;
			const on = gs.filter((p) => archTags(p).indexOf("defense") >= 0).map(val);
			const off = gs.filter((p) => archTags(p).indexOf("defense") < 0).map(val);
			if (on.length < 4 || off.length < 4) return 1.3;
			return mean(on) / Math.max(0.2, mean(off));
		})()].concat(perClass(1.10, 1.9)),

		/* THE POTENTIAL DISTRIBUTION, as an aggregate.

		   POT_BY_ARCHETYPE is 117 hand-tuned constants spanning -6 to +9, and
		   potFactors adds five more terms on top of them. Every one of those is
		   defensible on its own and nothing checked what they came to together:
		   the whole potential model could drift by three points a class, or
		   collapse to a single value, or invert against the source file, and
		   every existing row would still pass. Individual stats are banded; the
		   thing the archetype table is actually FOR was not.

		   Three rows, because a distribution is not one number:

		     - The mean gap, against the file's own mean gap. In "preserve" mode
		       the tool promises not to inflate the class; a potential model that
		       adds four points of ceiling to the average prospect breaks that
		       promise without touching a single ovr.
		     - The spread of the gap, which is what potSpread is for. A class
		       where every prospect has the same ceiling is not a draft board.
		     - The correlation between a build's POT_BY_ARCHETYPE entry and the
		       gap its players actually come out with. This is the row that says
		       the table is DOING something: if it drops toward zero, the
		       archetype signal has been swamped by the five other terms and the
		       97 constants are decoration. */
		["Pot gap mean vs source", mean(g((p) => p.newPot - p.newOvr)) -
			mean(g((p) => p.origPot - p.origOvr))].concat(within(0, 3.2)),
		["Pot gap sd", sd(g((p) => p.newPot - p.newOvr))].concat(within(6.5, 3.0)),
		["corr(archetype potential, gap)",
			corr(g((p) => global.RatingsBuilder.POT_BY_ARCHETYPE[p.archetype] || 0),
				g((p) => p.newPot - p.newOvr))].concat(corrBand(0.12, 0.70)),

	];

	const fieldRows = [
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
	];

	const prospectRows2 = [
		/* The documented per-player share ceilings, measured the way a reader
		   would check them: against the team total, not against the pool. */
		["Max share of team AST", Math.max.apply(null, maxAstShare), 0, 0.621],
		// 0.46 tracks the softened REB_CAP: at 0.40 the cap was binding
		// exactly at the measured maximum, forbidding the tail it documented.
		["Max share of team TRB", Math.max.apply(null, maxRebShare), 0, 0.461],
		["Max share of team BLK", Math.max.apply(null, maxBlkShare), 0, 0.681],

		/* The four things a user expects a draft class to express. None of them
		   is a distribution, so none of them was checked, and two were broken:
		   athleticism drove blocks and not steals, and the documented
		   talent-to-efficiency gradient was exported and never called. */
		/* Tightened from [-0.62, -0.15]. This row was the only one that could
		   see the location bias at all, and at -0.49 to -0.58 it sat one bad
		   commit from the edge of a tolerance drawn wide enough to hide it. */
		/* The upper bound came in from -0.15 to -0.02. The row exists to catch
		   a LOCATION BIAS — where you played deciding how much you scored —
		   and its lower bound is what does that work. Requiring at least 0.15
		   of negative correlation made the harness demand a bias: once a
		   college role stopped being a deterministic function of rating, the
		   residual fell to -0.10 and this row failed for the model getting
		   better. There is a real effect here (a weak team has possessions
		   going spare) and zero would be suspicious, so the bound is not
		   removed, only moved to where it is a check rather than a quota. */
		["corr(conference strength, PPG)",
			corr(g((p) => p.vConfStrength), g((p) => p.stats.ppg))].concat(corrBand(-0.45, -0.02)),
		/* Tightened hard, from [0.30, 0.75]. That band accepted 0.46 and 0.72
		   alike, and on a realistically shaped class the model produced 0.72:
		   college scoring was a near-deterministic ramp on NBA overall, 0.375
		   points per ovr point, which over a 30-point ovr span forces an
		   11-point scoring spread that real basketball does not have. In real
		   draft classes the correlation between draft stock and college
		   scoring is about 0.25-0.35 — Zach Edey outscored every lottery pick
		   in his class, Bronny James averaged 4.8 — because a college role is
		   not an NBA rating. See collegeRole in js/stats.js. */
		["corr(ovr, PPG)", corr(g((p) => p.newOvr), g((p) => p.stats.ppg))].concat(
			corrBand(0.22, 0.52)),
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
		/* Recentered for the realistic fixture. The old [7.8, 14] was measured
		   on a class where the "bottom third" was ovr-40 players; on a real
		   board it is picks 47-70, who average around ten points with a tail
		   below six. The band's job is to catch a collapsed floor — the model
		   used to put a quarter of a realistic class under 9 points a game —
		   not to forbid a late second-rounder having a quiet year. */
		["PPG p10, bottom third of class", pct(bottomThird, 0.10), 6.0, 11.5],
		/* THE MIDDLE OF THE CLASS HAS TO STAY AN ARGUMENT.

		   The 30th and 40th prospects reading as interchangeable is the
		   complaint this row exists to catch, and it is a complaint about a
		   SPREAD, which no per-stat mean or percentile can see: a class whose
		   middle all scores 12.5 passes every other row in this file. Real
		   boards have a ten-point scoring gap among similarly-ranked prospects,
		   which is what makes ranking them a judgment rather than a sort.

		   Measured on the current model the middle runs 8.8 at the 10th
		   percentile to 19.8 at the 90th, so the band is set around that with
		   room either side. Widening ROLE_DRAW_SD and narrowing USG_FLOOR_BAND
		   was the obvious lever and is the wrong one: it moves the whole
		   distribution, so it buys 0.3 points of spread in the middle and puts
		   PPG p95 and the scoring leader outside their own bands, which are
		   fitted against real D-I seasons. The middle is wide because the role
		   draw and the soft floor are already doing their job; this row is what
		   stops that being undone by accident. */
		["Mid-class PPG spread (p90 - p10)",
			pct(midClass, 0.90) - pct(midClass, 0.10)].concat(within(11.0, 3.0)),
		["Mid-class PPG p10", pct(midClass, 0.10)].concat(within(8.8, 2.2)),
		/* Build must not decide scoring the way quality does. At equal overall
		   rating the spread once ran from -4.9 points (Defensive Pest) to +4.9
		   (Score-First Point) — 9.8 points, against 7.0 across the whole
		   ovr 30-60 range. In standard errors, so it means the same thing at
		   every seed count; see archResidual. */
		/* 2.0 points is where this row catches a regression rather than
		   sampling noise. The derived formula measures 1.0-1.8 depending on
		   which classes you draw (a build with seventy seasons in the pooled
		   sample still has a standard error near half a point); the 72
		   hand-fitted constants it replaced measured 1.65 at their best, with
		   twelve of them clipped at the fit boundary. Run tools/rolefit.js for
		   the per-build breakdown when this fails. */
		["archetype PPG bias beyond noise",
			archResidual(all, Math.max(12, Math.round(all.length / 55))), -99, 2.00],

		/* Scoring by size, at equal overall rating. A draft class's guards are
		   its volume scorers; the sim had seven-footers as the highest-scoring
		   group even after matching on quality. */
		/* Recentered and tightened. The intended ordering — stated in this
		   file's own comment and in js/stats.js, and the reason the size tilt
		   exists at all — is guards ahead of bigs at equal overall rating. The
		   band was drawn symmetrically around -0.1 but scaled by matchedK,
		   which at 8 seeds opened it to roughly [-4.9, +4.7]: wide enough to
		   pass a measured +3.1, i.e. wide enough to certify the exact
		   inversion the tilt was raised to remove. The half-width is capped so
		   a noisy subgroup can no longer buy an unlimited amount of slack. */
		["PPG, bigs minus guards (ovr-matched)", bigMinusGuard,
			-0.75 - 1.75 * Math.min(matchedK, 1.6),
			-0.75 + 1.75 * Math.min(matchedK, 1.6)],

	];

	/* Award volume is a statement about THE CLASS — how much of the country's
	   hardware seventy prospects take — so it belongs to the realistic fixture
	   like every other prospect row. Checked on the synthetic class too, these
	   bands had to be wide enough to cover a uniformly ovr-45 field as well,
	   which is how a class that won the national player of the year in 100% of
	   seasons passed. */
	const awardRows = [
		/* Award volume. Prospects are ranked against every returning player in
		   Division I — against their actual simulated seasons rather than a
		   regression on talent — so these are the rows that matter. */
		/* The award bands were all drawn against the N(45, 13) fixture, whose
		   70 prospects were a random sample of good players rather than the
		   best 70 players in the country. A realistically shaped class is the
		   top of a draft board, and the top of a draft board really does win
		   most of the hardware: the five consensus first-team All-Americans in
		   a given year are usually three to five future draft picks. These are
		   widened at the top for that reason and not to make a row pass. */
		["National awards/class", mean(natAwards)].concat(perClass(8, 32)),
		/* The finalist tier: named shortlists a class should land on more often
		   than it wins the trophies themselves, and never so often that being a
		   finalist stops meaning anything. */
		["Finalist honors/class", mean(finalistAwards)].concat(perClass(8, 37)),
		/* Recentered from [0.05, 0.85]. Now that every program in the country is
		   simulated and a prospect's minutes are decided by how good he is
		   rather than by where he plays, the best player in a 70-man draft
		   class is the best player in the country in 57-75% of seasons — which
		   is about right: the national player of the year is usually, but not
		   always, a future draft pick. */
		/* Now that the field contains college stars who are not prospects, the
		   class does NOT win this every year — which is the point: it was 1.00
		   before, and a row whose only passing value is its upper bound is not
		   a check. */
		["POY in class (rate)", mean(poyClasses)].concat(rateBand(0.45, 0.95)),
		["Consensus 1st Team/class", mean(firstTeam)].concat(perClass(1.0, 4.5)),
		["All-conference 1st/class", mean(confFirst)].concat(perClass(11, 30)),
		["All-conference 2nd/class", mean(confSecond)].concat(perClass(3.5, 12)),
		["Defensive awards/class", mean(defAwards)].concat(perClass(4, 16)),
		/* Top raised from 52 for the pro achievement layer: a class's dozen
		   prospects abroad can now win their league's MVP or first team,
		   which honors one or two more players a class. */
		["Honored players/class", mean(honoredCount)].concat(perClass(30, 56)),
		// Dominated by conference honors across ~31 conferences, which future
		// draft picks legitimately win a lot of.
		["Awards/class (all)", mean(awardsCount)].concat(perClass(95, 220)),
	];

	const structureRows = [
		/* Tempo must not buy honors: productionScore is raw counting volume
		   and PROGRAM_STYLES moves possessions by +/-5.5 a game. About the
		   engine, not about the class, so it runs on both fixtures. */
		["Pace of honored minus pace of all",
			(paceOfHonored.length ? mean(paceOfHonored) : 0) -
				(paceOfAll.length ? mean(paceOfAll) : 0), -1.2, 1.2],

		/* Schedule integrity. */
		["Regular-season game spread", Math.max.apply(null, gamesSpread), 0, 1],
		["Champion record includes March", mean(postseasonInRecord), 1, 1],
		["Games logged out of order", outOfOrder.length, 0, 0],

		/* A D-II or professional player winning a Division I national award is
		   a leak in the award model, not a statement about the class. */
		["Non-D1 D-I awards", mean(nonNcaaAwards), 0, 0],

		/* March, against the modern NCAA tournament's own history. Rates are
		   per-class means and widen at low seed counts like every other
		   rate; a 1-v-16 result over sixteen games at four seeds is exactly
		   as noisy as it sounds, which is why the low bound is not 0.99. */
		/* The model sits at 93-96% on this line against a real 99%: what
		   remains is genuine — a 1 seed whose best player is out, a
		   16 seed on a run — and the floor is drawn where the old 92%
		   regresses rather than where reality is. */
		["1 seed beats 16 seed (rate)", lineRate(seedLine["1v16"])].concat(rateBand(0.92, 1.0)),
		["2 seed beats 15 seed (rate)", lineRate(seedLine["2v15"])].concat(rateBand(0.82, 0.98)),
		["5 seed beats 12 seed (rate)", lineRate(seedLine["5v12"])].concat(rateBand(0.50, 0.78)),
		/* 80 games at twenty seeds, so a standard error near 0.055 on a real
		   rate of 0.51 (8 seeds are 79-77 since 1985). The model's 8 seeds
		   sit about two rating points above its 9 seeds on the synthetic
		   class — a committee that seeds on results puts the better team on
		   the higher line, which is right — which is a true rate near 0.56;
		   the top is drawn two errors above THAT rather than above the real
		   figure, or the row fails on the draw alone at this sample size. */
		["8 seed beats 9 seed (rate)", lineRate(seedLine["8v9"])].concat(rateBand(0.36, 0.70)),
		["1 seed wins the title (rate)", mean(champSeedOne)].concat(rateBand(0.28, 0.72)),
		["Seed 5 or worse wins the title (rate)", mean(champSeedDeep)].concat(rateBand(0.0, 0.36)),
		["1 seeds' share of the Final Four", mean(ffOneShare)].concat(rateBand(0.24, 0.56)),
		["Week-1 AP top 10 drawn from preseason top 25", mean(pollWeek1)].concat(rateBand(0.72, 1.0)),
	];

	function lineRate(v) { return v[1] ? v[0] / v[1] : 1; }
	const tag = (list, scope) => list.map((r) => ({
		name: r[0], value: r[1], lo: r[2], hi: r[3], scope,
	}));
	const rows = [].concat(
		tag(prospectRows, "prospect"),
		tag(fieldRows, "field"),
		tag(prospectRows2, "prospect"),
		tag(awardRows, "prospect"),
		tag(structureRows, "structure"),
	);
	return { rows, all, field, leaders, awardsCount };
}

/* The worst mean scoring residual of any archetype against the class's own
   ovr fit — i.e. how much of a player's scoring is decided by his build rather
   than by how good he is — expressed in STANDARD ERRORS of that build's own
   mean.

   It used to be reported in points and banded at 2.4 of them, which is not a
   quantity a fixed band can describe. The row takes a maximum over ~50 builds
   of a mean computed from as few as twelve seasons: at 20 seeds the standard
   error of one of those means is about 0.95 points, so the largest of fifty
   draws from a zero-residual model is about 2.5 points before anything is
   wrong at all. The row therefore failed at 20 seeds and passed at 60 for the
   same model, which is the "the harness disagrees with itself depending on how
   you invoke it" fault the seed-scaling machinery above exists to prevent.

   So the residual is reported in POINTS, less the sampling error that any
   sample of that size carries anyway (1.96 standard errors, the usual 95%
   allowance). A build whose measured bias is entirely explicable as noise
   scores zero here whatever its raw residual; a build with a real bias scores
   what is left over, in points, at every seed count. And the row gets stricter
   with more data — the allowance shrinks as the sample grows — which is the
   right direction: a real 2-point build bias is invisible at 20 seeds and
   unmissable at 200. tools/rolefit.js prints the raw residuals, with names. */
function archResidual(all, minN) {
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
		if (by[k].length < (minN || 12)) continue;
		/* Against the build's DECLARED intent (see ROLE_INTENT in
		   js/ratings.js): a scorer is meant to sit above the line and a
		   stopper below it, and only the part of the bias that is not
		   declared counts. A flat zero target here is what flattened the
		   table. */
		const intent = global.RatingsBuilder.roleIntentOf(k);
		const res = by[k].map((p) => p.stats.ppg - (icpt + slope * p.newOvr) - intent);
		const m = mean(res);
		const v = mean(res.map((x) => (x - m) * (x - m)));
		const se = Math.sqrt(v / res.length);
		if (se <= 0) continue;
		worst = Math.max(worst, Math.abs(m) - 1.96 * se);
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
	/* Which class shapes to check. The realistic one is the default and the
	   only one prospect-facing rows are meaningful on; the synthetic one is
	   run as a second fixture for the whole-field and structural rows, where a
	   class of uniformly good players is a useful second load on the model.
	   `--fixture=realistic` halves the runtime for a quick local check. */
	const fixArg = (args.filter((a) => a.startsWith("--fixture="))[0] || "").slice(10);
	const fixtures = fixArg ? fixArg.split(",") : ["realistic", "synthetic"];

	const perEra = [];
	for (const era of eras) {
		for (const fixture of fixtures) {
			const { rows, all } = collect(nSeeds, { era }, fixture);
			/* Prospect rows describe a draft class, so they are only asked of a
			   fixture shaped like one. Everything else is fixture-independent
			   and is asked of both. */
			const keep = fixture === "realistic"
				? rows
				: rows.filter((r) => r.scope !== "prospect");
			const recon = reconcileError(all);
			const checks = keep.map((r) => ({
				name: r.name, value: r.value, lo: r.lo, hi: r.hi,
				ok: r.value >= r.lo && r.value <= r.hi,
			}));
			checks.push({
				name: "Stat line reconciles", value: recon, lo: 0, hi: 0.02, ok: recon <= 0.02,
			});
			perEra.push({ era, fixture, checks, seasons: all.length });
		}
	}

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

	/* THE SEASON NARRATIVES.

	   Every band above is measured with narratives OFF, because a narrative is
	   a stated deviation and banding the model against a season that has
	   announced itself as unusual measures the wrong thing. These are the
	   checks that matter for the narratives themselves, and they are a
	   different kind of claim: that the storylines MOVE the season (or they
	   are decoration) and that they do not move it out of the sport.

	   Run over sixteen classes, which is enough to draw most of the twelve. */
	{
		const withN = [];
		const withoutN = [];
		const names = new Set();
		let stories = 0;
		for (let s = 0; s < 16; s++) {
			const lf = realisticClass(s, 70);
			const on = global.Engine.run(lf,
				global.Config.make({ seed: "narr" + s }));
			const off = global.Engine.run(lf,
				global.Config.make({ seed: "narr" + s, narrative: false }));
			for (const x of on.narrative || []) { names.add(x.name); stories++; }
			const teamPts = (r) => {
				const ts = Object.values(r.teams).filter((t) => t.teamTotals);
				return ts.reduce((a, t) => a + t.teamTotals.pts, 0) / Math.max(1, ts.length);
			};
			withN.push(teamPts(on));
			withoutN.push(teamPts(off));
		}
		const mn = (a) => a.reduce((x, y) => x + y, 0) / a.length;
		const sdOf = (a) => {
			const m = mn(a);
			return Math.sqrt(a.reduce((x, y) => x + (y - m) * (y - m), 0) / a.length);
		};
		checks.push({
			name: "Narrative: storylines drawn per class",
			value: stories / 16, lo: 1.9, hi: 3.1, ok: stories / 16 >= 1.9 && stories / 16 <= 3.1,
		});
		checks.push({
			name: "Narrative: distinct storylines over 16 classes",
			value: names.size, lo: 7, hi: 12, ok: names.size >= 7 && names.size <= 12,
		});
		/* The point of them: a season with storylines varies more class to
		   class than one without. If this ratio is near 1 the narratives are
		   a label. */
		const ratio = sdOf(withN) / Math.max(0.01, sdOf(withoutN));
		checks.push({
			name: "Narrative: season-to-season spread vs off",
			value: ratio, lo: 1.15, hi: 6, ok: ratio >= 1.15 && ratio <= 6,
		});
		/* And they stay in the sport: no narrative may push a season's team
		   scoring outside what Division I has ever produced. */
		const lo = Math.min.apply(null, withN);
		const hi = Math.max.apply(null, withN);
		checks.push({
			name: "Narrative: team PPG stays in range",
			value: Math.round(lo) + Math.round(hi) / 1000, lo: 0, hi: 1e9,
			ok: lo >= 58 && hi <= 92,
		});
	}

	const fail = perEra.reduce((a, e) => a + e.checks.filter((c) => !c.ok).length, 0) +
		checks.filter((c) => !c.ok).length;
	const fmt = (x) => (Math.abs(x) >= 1000 || Number.isInteger(x) ? String(x) : x.toFixed(2));
	if (asJson) {
		console.log(JSON.stringify({
			seeds: nSeeds, failures: fail, eras: perEra, global: checks,
		}, null, 2));
	} else {
		for (const e of perEra) {
			console.log("Era " + e.era + " · " + e.fixture + " class — " + nSeeds +
				" seeds, " + e.seasons + " NCAA player-seasons\n");
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

module.exports = {
	loadEngine, syntheticClass, realisticClass, makeClass, FIXTURES,
	collect, reconcileError, pct, mean,
};

if (require.main === module) main();
