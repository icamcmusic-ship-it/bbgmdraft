/* Moved verbatim from tools/test.js so it can run in its own process (see
   tools/test-parallel.js): Staying fresh: anomaly memory, narratives, style drift, flavor reach.

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

	console.log("\nStaying fresh: anomaly memory, narratives, style drift, flavor reach");
	{
		/* ANOMALY MEMORY. The same mechanism the build pool has, one layer down:
		   thirty-two kinds and about four draws a class meant the same eight or
		   ten turned up in most classes. */
		{
			const draw = (recent, memory) => global.Engine.run(
				V.realisticClass(2, 70),
				global.Config.make({ seed: "anom", recentAnomalies: recent,
					anomalyMemory: memory, narrative: false }))
				.surprises.map((sp) => sp.name);
			const base = draw([], 1);
			ok("a class draws anomalies", base.length >= 2, base.join(", "));
			/* With the same seed and the same class, telling the engine that these
			   exact kinds ran last class has to change the draw. */
			const avoided = draw([base], 1);
			const overlap = avoided.filter((n) => base.indexOf(n) !== -1).length;
			ok("an anomaly used last class is pushed down the queue",
				overlap < base.length, overlap + " of " + base.length + " repeated");
			ok("anomalyMemory 0 restores the memoryless draw",
				draw([base], 0).join("|") === base.join("|"));
			/* And the memory decays: two classes ago should bite less than one. */
			let repeatNear = 0;
			let repeatFar = 0;
			for (let s = 0; s < 8; s++) {
				const first = global.Engine.run(V.realisticClass(s, 70),
					global.Config.make({ seed: "am" + s, narrative: false }))
					.surprises.map((sp) => sp.name);
				const near = global.Engine.run(V.realisticClass(s, 70),
					global.Config.make({ seed: "am2-" + s, recentAnomalies: [first],
						anomalyMemory: 1, narrative: false })).surprises.map((sp) => sp.name);
				const far = global.Engine.run(V.realisticClass(s, 70),
					global.Config.make({ seed: "am2-" + s, recentAnomalies: [[], [], first],
						anomalyMemory: 1, narrative: false })).surprises.map((sp) => sp.name);
				repeatNear += near.filter((n) => first.indexOf(n) !== -1).length;
				repeatFar += far.filter((n) => first.indexOf(n) !== -1).length;
			}
			ok("and the memory decays with age",
				repeatNear <= repeatFar, repeatNear + " vs " + repeatFar);
		}

		/* SEASON NARRATIVES. */
		{
			const res = global.Engine.run(V.realisticClass(4, 70),
				global.Config.make({ seed: "narr" }));
			ok("a class draws two or three season storylines",
				res.narrative.length >= 2 && res.narrative.length <= 3,
				res.narrative.map((x) => x.name).join(" + "));
			ok("each storyline names itself and says what it means",
				res.narrative.every((x) => x.name && x.blurb));
			const off = global.Engine.run(V.realisticClass(4, 70),
				global.Config.make({ seed: "narr", narrative: false }));
			ok("narrative:false draws none", off.narrative.length === 0);
			/* A storyline that bends nothing is a label, so the settings the
			   season actually ran under have to differ. */
			/* Read off `effectiveCfg`, which is what the season was actually
			   simulated at — `cfg` is what the user asked for, and the bends by
			   design do not appear there. */
			const KEYS = ["upsetFactor", "teamMomentum", "injuryRate", "pace",
				"midMajorLift", "bluebloodDownYears", "coachTurnover", "realignmentRate",
				"efficiencyEnv", "scoringEnv", "statNoise", "seasonEvents"];
			const moved = KEYS.filter((k) => res.effectiveCfg[k] !== off.effectiveCfg[k]);
			ok("and a storyline changes the settings the season ran at",
				moved.length >= 2, moved.join(", "));
			/* And that reaches the season, not only the config. */
			ok("which reaches the simulation",
				res.coachingCarousel.length !== off.coachingCarousel.length ||
				res.seasonEvents.length !== off.seasonEvents.length ||
				res.tourney.champion.team.name !== off.tourney.champion.team.name,
				res.coachingCarousel.length + " vs " + off.coachingCarousel.length);
			/* A user's own setting still wins, at the default reach of 0. */
			const pinned = global.Engine.run(V.realisticClass(4, 70),
				global.Config.make({ seed: "narr", upsetFactor: 0.77 }));
			ok("a storyline never overrules a setting the user changed",
				pinned.effectiveCfg.upsetFactor === 0.77,
				String(pinned.effectiveCfg.upsetFactor) + " with " +
					pinned.narrative.map((x) => x.name).join(" + "));
			/* Every bend key is a real setting. A typo here is silent. */
			const D = global.Config.DEFAULTS;
			const unknown = [];
			for (const n of global.Engine.NARRATIVES) {
				// paceShift is a delta on `pace`; see applyNarrative.
				for (const k of Object.keys(n.bend)) if (!(k in D) && k !== "paceShift") unknown.push(n.name + "." + k);
			}
			ok("every storyline bends a setting that exists", unknown.length === 0,
				unknown.join("; "));
		}

		/* FLAVOR REACH. */
		{
			/* A flavor whose bend the user has already customised does nothing at
			   reach 0 and something at reach 100. injuryRate is the clearest case:
			   "the year everybody got hurt" bends it and nothing else does. */
			const cfgFor = (reach) => global.Config.make({
				seed: "reach", flavorHint: "injury year", classFlavor: 1,
				injuryRate: 1.15, flavorReach: reach, narrative: false,
			});
			const at0 = global.Engine.run(V.realisticClass(3, 70), cfgFor(0));
			const at100 = global.Engine.run(V.realisticClass(3, 70), cfgFor(100));
			ok("the named flavor was drawn", at0.flavor && at0.flavor.name === "injury year",
				at0.flavor && at0.flavor.name);
			ok("at reach 0 a flavor leaves a changed setting exactly alone",
				at0.effectiveCfg.injuryRate === 1.15, String(at0.effectiveCfg.injuryRate));
			ok("at reach 100 it moves it, and only part of the way",
				at100.effectiveCfg.injuryRate > 1.15 &&
				at100.effectiveCfg.injuryRate < 2,
				String(at100.effectiveCfg.injuryRate));

			/* THE LEGACY DESTINATION SLIDERS FOLD IN ON BOTH BRANCHES.

			   Config.make folds wEuroLeague / wGLeague / wNBL into leagueWeights —
			   which is what assignCollege actually reads — and it does so BEFORE a
			   flavor bend runs, so applyFlavorConfig has to fold them again. It
			   did, on the branch for settings the user had left alone, and on the
			   reach branch it tested `k === "leagueWeights"` — a test gated behind
			   `typeof bend[k] === "number"`, which an object can never satisfy. So
			   a flavor that bends wEuroLeague on a config the user had touched
			   wrote a number nothing reads: the exact fault the fold exists to
			   fix, surviving in one of the two branches. */
			const euroCfg = (reach) => global.Config.make({
				seed: "reach2", flavorHint: "overseas year",
				classFlavor: 1, wEuroLeague: 20, flavorReach: reach, narrative: false,
			});
			const eu0 = global.Engine.run(V.realisticClass(3, 70), euroCfg(0));
			const eu100 = global.Engine.run(V.realisticClass(3, 70), euroCfg(100));
			const bendsEuro = global.RatingsBuilder
				.flavorConfig(eu0.flavor) &&
				Number.isFinite(global.RatingsBuilder.flavorConfig(eu0.flavor).wEuroLeague);
			ok("the overseas flavor still bends the legacy EuroLeague weight",
				!!bendsEuro);
			ok("at reach 0 a touched legacy slider reaches the destination table",
				eu0.effectiveCfg.leagueWeights.EuroLeague === 20,
				String(eu0.effectiveCfg.leagueWeights.EuroLeague));
			ok("at reach 100 the bend reaches the table the engine actually reads",
				eu100.effectiveCfg.wEuroLeague > 20 &&
				eu100.effectiveCfg.leagueWeights.EuroLeague === eu100.effectiveCfg.wEuroLeague,
				eu100.effectiveCfg.wEuroLeague + " vs table " +
					eu100.effectiveCfg.leagueWeights.EuroLeague);
		}

		/* STYLE DRIFT. */
		{
			const res = global.Engine.run(V.realisticClass(1, 70),
				global.Config.make({ seed: "drift", narrative: false }));
			const byName = {};
			for (const t of Object.values(res.teams)) {
				if (!t.style) continue;
				(byName[t.style.name] = byName[t.style.name] || []).push(t.style.three);
			}
			const biggest = Object.keys(byName).sort((a, b) => byName[b].length - byName[a].length)[0];
			ok("two teams playing the same style do not play identical numbers",
				new Set(byName[biggest]).size === byName[biggest].length,
				biggest + ": " + new Set(byName[biggest]).size + " distinct of " +
					byName[biggest].length);
			/* And it is a drift, not a redraw: the style's own identity survives. */
			const spread = Math.max.apply(null, byName[biggest]) -
				Math.min.apply(null, byName[biggest]);
			ok("but the drift is smaller than the gap between styles",
				spread < 0.14, spread.toFixed(3));
			const off = global.Engine.run(V.realisticClass(1, 70),
				global.Config.make({ seed: "drift", styleDrift: 0, narrative: false }));
			const offBy = Object.values(off.teams).filter(
				(t) => t.style && t.style.name === biggest).map((t) => t.style.three);
			ok("styleDrift 0 restores the fixed enum exactly",
				new Set(offBy).size === 1, String(new Set(offBy).size));
			/* The drift must not shift any other random stream — an earlier
			   version drew a per-coach seed from the coach's own rng and moved
			   every coach's development number, which moved the tournament. */
			/* What "changes nothing but the styles" means, now that a style
			   reaches the scoreboard.

			   The check used to be that the national champion was the same man
			   with the drift off, which held only while a program's tempo was
			   decorative: PROGRAM_STYLES moved possessions in the STAT model and
			   the scoreboard ignored it, so a run-and-gun team and a pack-line
			   team produced identical final scores. teamPace in js/teams.js reads
			   it now, so turning the drift off legitimately changes every score
			   in the country — which is the whole point of the change.

			   The invariant that still holds, and the one this check was written
			   for, is that the drift must not reach into any other random
			   stream: the CLASS must be untouched, player for player. */
			const classPrint = (r) => r.players.map((p) => p.key + ":" + p.archetype +
				":" + p.newCollege + ":" + p.newOvr + ":" + p.classYear).join("|");
			ok("and turning it off changes nothing about the class itself",
				classPrint(off) === classPrint(res),
				"the drift moved a stream it does not own");
		}
	}
};
