/* What a batch run records for each generated class.

   Shared between the worker and the main-thread fallback so both produce
   exactly the same table — there is one definition of "what a batch measures",
   not two that drift. */
(function (global) {
	"use strict";

	const mean = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
	const maxOf = (v) => (v.length ? Math.max.apply(null, v) : 0);

	/* A batch's seed. Without one every class in the batch drew Math.random(),
	   so nothing about a batch could be reproduced. Derived from the run's own
	   seed when it has one, and otherwise minted once and reported back. */
	function batchSeed(cfg, given) {
		if (given) return String(given);
		if (cfg && cfg.seed) return String(cfg.seed);
		return "batch" + Math.floor(Math.random() * 1e9).toString(36);
	}

	function summarise(res) {
		const withStats = res.players.filter((p) => p.stats);
		/* NCAA only for the per-player rows. They used to be averaged over
		   `withStats`, which includes the prospects playing abroad — a
		   EuroLeague teenager on a 22-minute cap averages 10.0 points against a
		   D-I prospect's 15.0 — while the ovr/pot rows were averaged over
		   everybody. So the batch panel read a full point below the Prospects
		   tab for the same class, with nothing on screen to explain it. Both
		   populations are reported now, and the panel says which is which. */
		const ncaa = withStats.filter((p) => !p.nonNcaa);
		const abroad = withStats.filter((p) => p.nonNcaa);
		const teams = Object.values(res.teams).filter((t) => t.teamTotals);
		return {
			seed: res.seed,
			flavor: res.flavor ? res.flavor.label : null,
			ovr: mean(res.players.map((p) => p.newOvr)),
			pot: mean(res.players.map((p) => p.newPot)),
			nNcaa: ncaa.length,
			nAbroad: abroad.length,
			mpg: mean(ncaa.map((p) => p.stats.mpg)),
			ppg: mean(ncaa.map((p) => p.stats.ppg)),
			rpg: mean(ncaa.map((p) => p.stats.rpg)),
			apg: mean(ncaa.map((p) => p.stats.apg)),
			usg: mean(ncaa.map((p) => p.stats.usg)) * 100,
			ts: mean(ncaa.map((p) => p.stats.ts)) * 100,
			abroadPpg: mean(abroad.map((p) => p.stats.ppg)),
			topPpg: maxOf(ncaa.map((p) => p.stats.ppg)),
			topApg: maxOf(ncaa.map((p) => p.stats.apg)),
			topBpg: maxOf(ncaa.map((p) => p.stats.bpg)),
			awards: res.players.reduce((a, p) => a + (p.awards || []).length, 0),
			honoured: res.players.filter((p) => (p.awards || []).length).length,
			teamPpg: mean(teams.map((t) => t.teamTotals.pts)),
			teamAst: mean(teams.map((t) => t.teamTotals.ast)),
			archetypes: new Set(res.players.map((p) => p.archetype)).size,
			champion: res.tourney ? res.tourney.champion.team.name : null,
			/* The tournament's shape, so a batch can show whether March
			   is calibrated rather than only whether the box scores are. */
			champSeed: res.tourney && res.tourney.champion ? res.tourney.champion.seed : null,
			ffOneSeeds: res.tourney && res.tourney.finalFour
				? res.tourney.finalFour.filter((x) => x.seed === 1).length : null,
			r64Upsets: r64Upsets(res.tourney),
		};
	}

	function r64Upsets(t) {
		if (!t || !t.regions) return null;
		let n = 0;
		for (const r of Object.keys(t.regions)) {
			for (const g of t.regions[r].rounds[0] || []) {
				const loser = g.winner === g.a ? g.b : g.a;
				if (g.winner.seed - loser.seed >= 5) n++;
			}
		}
		return n;
	}

	/* Percentiles, so a batch of fifty classes shows a distribution and not one
	   row of averages: the whole reason to run fifty is to see the spread. */
	function pct(vals, p) {
		if (!vals.length) return 0;
		const s = vals.slice().sort((a, b) => a - b);
		const i = (s.length - 1) * p;
		const lo = Math.floor(i);
		const hi = Math.ceil(i);
		return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo);
	}

	global.BatchStats = { summarise, batchSeed, mean, maxOf, pct };
})(typeof window !== "undefined" ? window : self);
