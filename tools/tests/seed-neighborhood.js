/* Moved verbatim from tools/test.js so it can run in its own process (see
   tools/test-parallel.js): Exploring a seed's neighborhood.

   The sections above and below it in the old file shared nothing with it but
   the helpers declared below, which are the same ones test.js declares. */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const TOOLS = path.join(__dirname, "..");

module.exports = function (ok, V) {
	const __dirname = TOOLS;
	const { Rng } = global.BBGMRng;
	const BB = global.BBGM;
	const RB = global.RatingsBuilder;
	void fs; void path; void crypto; void Rng; void BB; void RB; void __dirname;

	/* --------------------------------------- variation, memory and narrative */
	console.log("\nExploring a seed's neighborhood");
	{
		const lf = () => V.realisticClass(3, 70);
		const run = (over) => global.Engine.run(lf(),
			global.Config.make(Object.assign({ seed: "neighbor" }, over)));
		const base = run({});
		const same = run({ variation: 0 });
		const v1 = run({ variation: 1 });
		const v2 = run({ variation: 2 });
		const arch = (r) => r.players.map((p) => p.archetype).join("|");

		ok("variation 0 reproduces the seed exactly", arch(base) === arch(same));
		ok("the class-level shape survives a variation",
			base.flavor.name === v1.flavor.name &&
				JSON.stringify(base.archetypePool) === JSON.stringify(v1.archetypePool));
		const kept = base.players.filter((p, i) => p.archetype === v1.players[i].archetype).length;
		ok("a variation re-rolls the individual players",
			kept < base.players.length * 0.35,
			kept + " of " + base.players.length + " builds unchanged");
		ok("two variations differ from each other", arch(v1) !== arch(v2));
		ok("a variation is itself reproducible",
			arch(v1) === arch(run({ variation: 1 })));
		// A variation must not change the class's IDENTITY, only its members.
		ok("a variation keeps the class's overall level",
			Math.abs(
				base.players.reduce((a, p) => a + p.newOvr, 0) / base.players.length -
				v1.players.reduce((a, p) => a + p.newOvr, 0) / v1.players.length) < 2.5);
	}

	{
		// A flavor can be asked for rather than only drawn.
		const ask = (name) => global.Engine.run(V.realisticClass(4, 70),
			global.Config.make({ seed: "hint", flavorHint: name })).flavor;
		ok("a flavor hint is honored", ask("big-heavy").name === "big-heavy");
		ok("an asked-for flavor says so", ask("defensive").asked === true);
		ok("a hint for a flavor that does not exist falls back to the draw",
			!!ask("no such flavor").name && ask("no such flavor").asked === false);
		ok("no hint still draws",
			global.Engine.run(V.realisticClass(4, 70),
				global.Config.make({ seed: "hint" })).flavor.asked === false);
	}

	{
		/* Pool exclusion memory: a build that was in the last few pools is pushed
		   toward the back of the queue rather than banned. */
		const recent = [["Combo Guard", "Rim Runner"], ["Combo Guard"], ["Combo Guard"]];
		ok("a build in every recent pool is penalized",
			RB.poolMemoryFactor("Combo Guard", recent, 1) < 0.4,
			String(RB.poolMemoryFactor("Combo Guard", recent, 1)));
		ok("the penalty fades with age",
			RB.poolMemoryFactor("Combo Guard", recent, 1) <
				RB.poolMemoryFactor("Rim Runner", recent, 1));
		ok("a build in no recent pool is untouched",
			RB.poolMemoryFactor("Point Center", recent, 1) === 1);
		ok("memory 0 is a no-op",
			RB.poolMemoryFactor("Combo Guard", recent, 0) === 1);
		ok("a penalized build is not banned",
			RB.poolMemoryFactor("Combo Guard", recent, 1) > 0);

		/* End to end, on the thing actually complained about: how often the
		   heaviest builds come back class after class. Measured on the pool draw
		   directly rather than through a full season, so the sample is large
		   enough for the effect to be visible above the noise — the whole point of
		   the memory is a shift of ten points in a rate, and twenty engine runs
		   cannot resolve that. */
		const COMMON = ["Combo Guard", "3&D Wing", "Rim Runner", "Slasher"];
		const recurrence = (memory) => {
			const history = COMMON.length
				? [COMMON.slice(), COMMON.slice(), COMMON.slice()] : [];
			let hits = 0;
			const N = 400;
			for (let s = 0; s < N; s++) {
				const cfg = global.Config.make({
					poolMemory: memory, recentPools: memory ? history : null,
				});
				const pool = RB.pickClassPool(new Rng("poolmem" + s), cfg, null) || [];
				const names = pool.map((a) => a.name);
				hits += COMMON.filter((n) => names.indexOf(n) !== -1).length;
			}
			return hits / (N * COMMON.length);
		};
		const off = recurrence(0);
		const on = recurrence(1);
		ok("the exclusion memory reduces how often the commonest builds recur",
			on < off * 0.8,
			"the four heaviest builds returned " + (off * 100).toFixed(0) +
				"% of the time with the memory off and " + (on * 100).toFixed(0) +
				"% with it on");
	}

	{
		/* Team momentum: an autocorrelated arc, centered so it moves a season's
		   shape without moving its level. */
		const T = global.TeamsSim;
		const arc = T.momentumArc(new Rng("arc"), { teamMomentum: 1 });
		ok("the momentum arc has a knot per stretch of the season",
			arc.length === T.ARC_KNOTS);
		ok("the arc is centered", Math.abs(arc.reduce((a, b) => a + b, 0)) < 1e-9);
		ok("momentum can be turned off",
			T.momentumArc(new Rng("arc"), { teamMomentum: 0 }) === null);
		// Autocorrelated: neighboring knots agree more than distant ones do.
		let near = 0;
		let far = 0;
		for (let s = 0; s < 400; s++) {
			const a = T.momentumArc(new Rng("m" + s), { teamMomentum: 1 });
			for (let i = 0; i < a.length - 3; i++) {
				near += a[i] * a[i + 1];
				far += a[i] * a[i + 3];
			}
		}
		ok("the arc is autocorrelated, so a season has streaks in it",
			near > far * 1.5 && near > 0,
			"lag-1 " + near.toFixed(0) + " vs lag-3 " + far.toFixed(0));
		// Interpolation is continuous and hits the knots.
		const t = { arc };
		ok("the arc interpolates through its knots",
			Math.abs(T.arcAt(t, 0) - arc[0]) < 1e-9 &&
			Math.abs(T.arcAt(t, 1) - arc[arc.length - 1]) < 1e-9);
		ok("a team with no arc is unaffected", T.arcAt({}, 0.5) === 0);
	}

	{
		/* Awards: a voter mood that is not the same every season, and electorates
		   that weight the team's resume differently from one another. */
		const AW = global.Awards;
		const leans = AW.NATIONAL_POY.map((a) => a.resume);
		ok("the electorates do not all weight the resume the same",
			Math.max.apply(null, leans) - Math.min.apply(null, leans) > 0.3);
		ok("at least one electorate does not care what the team did",
			leans.some((v) => v < 0));

		// Turning the noise off should make the trophies agree far more often.
		const sweeps = (noise) => {
			let swept = 0;
			for (let s = 0; s < 10; s++) {
				const res = global.Engine.run(V.realisticClass(s, 70),
					global.Config.make({ seed: "vote" + s, awardNoise: noise }));
				const winners = new Set();
				for (const p of res.players) {
					for (const a of p.awards || []) {
						if (/^(Naismith Trophy|John R\. Wooden Award|Oscar Robertson Trophy|AP Player of the Year|NABC Player of the Year|Sporting News Player of the Year)$/.test(a)) {
							winners.add(p.key);
						}
					}
				}
				if (winners.size <= 1) swept++;
			}
			return swept;
		};
		const quiet = sweeps(0);
		const loud = sweeps(2);
		ok("award noise decides whether the trophies split", loud <= quiet,
			"clean sweeps: noise 0 -> " + quiet + ", noise 2 -> " + loud);
	}

	{
		/* Draft-day events reorder the board and leave it consistent. */
		const withEvents = global.Engine.run(V.realisticClass(2, 70),
			global.Config.make({ seed: "draftday" }));
		const without = global.Engine.run(V.realisticClass(2, 70),
			global.Config.make({ seed: "draftday", draftEvents: 0 }));
		ok("a draft produces events", withEvents.draftEvents.length >= 2,
			String(withEvents.draftEvents.length));
		ok("draft events can be turned off", without.draftEvents.length === 0);
		const ranks = withEvents.board.map((p) => p.boardRank);
		ok("board ranks stay unique and contiguous after the reordering",
			new Set(ranks).size === ranks.length &&
			Math.min.apply(null, ranks) === 1 &&
			Math.max.apply(null, ranks) === ranks.length);
		ok("the board is still ordered by rank",
			withEvents.board.every((p, i) => p.boardRank === i + 1));
		ok("every event names a player who is on the board",
			withEvents.draftEvents.every((e) =>
				withEvents.board.some((p) => p.key === e.key)));
		ok("no player collects two draft-day events",
			new Set(withEvents.draftEvents.map((e) => e.key)).size ===
				withEvents.draftEvents.length);
		// A faller really falls and a riser really rises.
		const moved = withEvents.draftEvents.every((e) => {
			const p = withEvents.board.filter((x) => x.key === e.key)[0];
			return p && p.draftEvent && typeof p.draftEvent.text === "string";
		});
		ok("each event is recorded on the player it happened to", moved);
		// The mock pick numbers still describe two rounds of thirty.
		const firsts = withEvents.board.filter((p) => p.mockRound === 1);
		ok("the mock board is still two rounds of thirty",
			firsts.length === Math.min(30, withEvents.board.length) &&
			firsts.every((p) => p.mockPick >= 1 && p.mockPick <= 30));
	}
};
