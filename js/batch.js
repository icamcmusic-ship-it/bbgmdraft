/* What a batch run records for each generated class.

   Shared between the worker and the main-thread fallback so both produce
   exactly the same table — there is one definition of "what a batch measures",
   not two that drift. */
(function (global) {
	"use strict";

	const mean = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
	const maxOf = (v) => (v.length ? Math.max.apply(null, v) : 0);

	function summarise(res) {
		const withStats = res.players.filter((p) => p.stats);
		const ncaa = withStats.filter((p) => !p.nonNcaa);
		const teams = Object.values(res.teams).filter((t) => t.teamTotals);
		return {
			seed: res.seed,
			flavor: res.flavor ? res.flavor.label : null,
			ovr: mean(res.players.map((p) => p.newOvr)),
			pot: mean(res.players.map((p) => p.newPot)),
			mpg: mean(withStats.map((p) => p.stats.mpg)),
			ppg: mean(withStats.map((p) => p.stats.ppg)),
			rpg: mean(withStats.map((p) => p.stats.rpg)),
			apg: mean(withStats.map((p) => p.stats.apg)),
			usg: mean(withStats.map((p) => p.stats.usg)) * 100,
			ts: mean(withStats.map((p) => p.stats.ts)) * 100,
			topPpg: maxOf(ncaa.map((p) => p.stats.ppg)),
			topApg: maxOf(ncaa.map((p) => p.stats.apg)),
			topBpg: maxOf(ncaa.map((p) => p.stats.bpg)),
			awards: res.players.reduce((a, p) => a + (p.awards || []).length, 0),
			honoured: res.players.filter((p) => (p.awards || []).length).length,
			teamPpg: mean(teams.map((t) => t.teamTotals.pts)),
			teamAst: mean(teams.map((t) => t.teamTotals.ast)),
			archetypes: new Set(res.players.map((p) => p.archetype)).size,
			champion: res.tourney ? res.tourney.champion.team.name : null,
		};
	}

	global.BatchStats = { summarise, mean, maxOf };
})(typeof window !== "undefined" ? window : self);
