/* Moved verbatim from tools/test.js so it can run in its own process (see
   tools/test-parallel.js): Warm re-runs, Warm re-runs from every phase.

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

	/* ------------------------------------------- warm re-runs and stale state */
	console.log("\nWarm re-runs");
	{
		/* A staged (warm) re-run has to produce the same class a cold one does.
		   applyDraftEvents skips a player who already carries a draftEvent so two
		   events cannot land on one man — and only phaseBuild re-creates the player
		   objects, so a warm run that starts at `stock` was handed last run's flags
		   and drew its events from a pool that excluded them. Moving the award
		   strictness slider, which has nothing to do with the draft board, rewrote
		   every draft-day event. */
		const names = (res) => res.draftEvents
			.map((e) => e.name + "/" + e.player).join(", ");
		const runner = global.Engine.createRunner(V.syntheticClass(5, 60));
		runner.run(global.Config.make({ seed: "warm" }));
		const warm = runner.run(global.Config.make({ seed: "warm", awardStrictness: 1.5 }));
		const cold = global.Engine.createRunner(V.syntheticClass(5, 60))
			.run(global.Config.make({ seed: "warm", awardStrictness: 1.5 }));
		ok("a warm re-run gives the same draft-day events as a cold one",
			names(warm) === names(cold),
			"warm [" + names(warm) + "] vs cold [" + names(cold) + "]");
		ok("no player carries a draft-day flag from a previous run",
			warm.players.filter((p) => p.draftEvent).length === warm.draftEvents.length);

		// Turning the events off must not leave the flags behind, or the players
		// who had them are permanently ineligible once it is turned back on.
		const off = runner.run(global.Config.make({ seed: "warm", draftEvents: 0 }));
		ok("turning draft events off clears the flags",
			off.players.filter((p) => p.draftEvent).length === 0);
		const back = runner.run(global.Config.make({ seed: "warm" }));
		const coldAgain = global.Engine.createRunner(V.syntheticClass(5, 60))
			.run(global.Config.make({ seed: "warm" }));
		ok("and turning them back on reproduces the cold run",
			names(back) === names(coldAgain));

		/* A re-run from the REGULAR phase (a pace change skips the build) read
		   the pot phase's displayed potential as each prospect's college talent,
		   which a cold run has not computed yet, so every team's season differed
		   between the two. */
		{
			const sig = (res) => JSON.stringify(res.players.map((p) =>
				[p.key, p.stats && p.stats.ppg, p.awards, p.note]));
			const r2 = global.Engine.createRunner(V.realisticClass(2, 70));
			r2.run(global.Config.make({ seed: "regwarm" }));
			const w2 = r2.run(global.Config.make({ seed: "regwarm", pace: 72 }));
			const c2 = global.Engine.run(V.realisticClass(2, 70),
				global.Config.make({ seed: "regwarm", pace: 72 }));
			ok("a warm re-run from the regular phase matches a cold run",
				w2.phasesRun.indexOf("build") === -1 && sig(w2) === sig(c2),
				"ran " + w2.phasesRun.join(","));
		}

		/* Each event's sentence describes where the player actually ended up. A
		   later event's move() shifts everyone it passes by one, so a text written
		   when the event fired disagreed with the rank printed beside it.

		   The rank it has to agree with is `draftSlot` — where he was taken on the
		   night. `boardRank` is the mock the events then moved him off, and while
		   the two were one number a slide's sentence and the board's own ranking
		   were the same field read twice. */
		let mismatched = 0;
		for (let s = 0; s < 12; s++) {
			const res = global.Engine.run(V.realisticClass(s % 5, 70),
				global.Config.make({ seed: "detext" + s }));
			for (const e of res.draftEvents) {
				const p = res.board.filter((x) => x.key === e.key)[0];
				const m = /until pick (\d+)/.exec(e.text);
				if (m && Number(m[1]) !== p.draftSlot) mismatched++;
			}
		}
		ok("a draft-day sentence agrees with the rank printed beside it",
			mismatched === 0, mismatched + " disagreed");
	}

	{
		/* awardNoise 0 has to mean what the slider says it means: every trophy to
		   whoever the production model ranks first. The season's voter mood scaled
		   only its random half, so the resume lean stayed at 0.55 of full strength
		   and the two electorates that weight the resume most still split away. */
		const POY = /^(Naismith Trophy|John R\. Wooden Award|Oscar Robertson Trophy|AP Player of the Year|NABC Player of the Year|Sporting News Player of the Year)$/;
		const splits = (noise) => {
			let split = 0;
			let seen = 0;
			for (let s = 0; s < 24; s++) {
				const res = global.Engine.run(V.realisticClass(s % 6, 70),
					global.Config.make({ seed: "poy" + s, awardNoise: noise }));
				const winners = new Set();
				for (const p of res.players) {
					for (const a of p.awards || []) if (POY.test(a)) winners.add(p.key);
				}
				if (winners.size) { seen++; if (winners.size > 1) split++; }
			}
			return { split, seen };
		};
		const quiet = splits(0);
		ok("at award noise 0 the six trophies never disagree",
			quiet.split === 0,
			quiet.split + " of " + quiet.seen + " classes split");
		const loud = splits(2);
		ok("and at 2 they regularly do", loud.split > 0,
			loud.split + " of " + loud.seen + " classes split");
	}

	{
		// A season event never names one program as both sides of a game.
		let dup = 0;
		let total = 0;
		for (let s = 0; s < 30; s++) {
			const res = global.Engine.run(V.realisticClass(s % 6, 70),
				global.Config.make({ seed: "dup" + s, seasonEvents: 14 }));
			for (const e of res.seasonEvents) {
				total++;
				if (e.teams && e.teams.length === 2 && e.teams[0] === e.teams[1]) dup++;
			}
		}
		ok("no season event names the same program twice", dup === 0,
			dup + " of " + total);
	}

	{
		// The forced-availability windows are measured against the real schedule
		// length, not a hard-coded 32.
		let bad = 0;
		for (let s = 0; s < 20; s++) {
			const res = global.Engine.run(V.realisticClass(s % 5, 70),
				global.Config.make({ seed: "avail" + s, surpriseBudget: 6 }));
			for (const p of res.players) {
				const av = p.availability;
				if (!av || av.from === null || av.from === undefined) continue;
				if (av.to > 1.0001 || av.from < -1e-9 || av.to < av.from) bad++;
			}
		}
		ok("every absence window lies inside the season", bad === 0, String(bad));
	}

	console.log("\nWarm re-runs from every phase");
	{
		/* THE COUPLING THIS EXISTS TO CATCH.

		   The awards phase used to hand three extra results back by writing
		   `__`-prefixed keys onto the TEAM MAP, which the caller then lifted off.
		   That works exactly as long as every key is remembered at both ends —
		   and the stats phase iterates the team map with Object.keys, so a key
		   left behind is a "team" with no members. Adding a fourth key and
		   forgetting the matching delete is a one-line change whose failure
		   appears three phases away, on one slider, in the browser only.

		   So: run cold, then re-run warm through every setting the phase table
		   declares, one at a time. Any phase that leaves the state unfit for a
		   later phase to re-enter shows up here rather than in a user's tab. */
		const PROBES = [
			["era", "2009-2021"], ["pace", 72], ["scoringEnv", 1.5],
			["efficiencyEnv", 1], ["statNoise", 1.4], ["upsetFactor", 1.6],
			["injuryRate", 1.6], ["awardStrictness", 1.5], ["confAwardStrictness", 1.4],
			["awardNoise", 2], ["potBias", 1.5], ["potSpread", 9],
			["draftEvents", 6], ["noteLines", ["summary", "stats"]],
			["seasonEvents", 11], ["teamMomentum", 1.8], ["priorSeasons", "reconstruct"],
			["coachTurnover", 160], ["styleDrift", 2], ["traitCount", 5],
			["realignmentRate", 0.9], ["midMajorLift", 6], ["starReturners", 200],
		];
		const runner = global.Engine.createRunner(V.realisticClass(6, 70));
		const base = { seed: "warm", narrative: false };
		let ok0 = true;
		try { runner.run(global.Config.make(base)); } catch (e) { ok0 = false; }
		ok("a cold run succeeds", ok0);
		const broke = [];
		for (const [key, value] of PROBES) {
			const cfg = global.Config.make(Object.assign({}, base));
			cfg[key] = value;
			try {
				const res = runner.run(cfg);
				if (!res.players || !res.players.length) broke.push(key + ": empty");
			} catch (e) {
				broke.push(key + ": " + (e && e.message ? e.message : String(e)));
			}
		}
		ok("every setting can be changed on a warm runner",
			broke.length === 0, broke.slice(0, 4).join("; "));
		/* And back again, in the other order, because a phase can also be left
		   unfit by the WARM path rather than by the cold one. */
		const back = [];
		for (let i = PROBES.length - 1; i >= 0; i--) {
			const cfg = global.Config.make(Object.assign({}, base));
			cfg[PROBES[i][0]] = PROBES[i][1];
			try { runner.run(cfg); } catch (e) {
				back.push(PROBES[i][0] + ": " + (e && e.message ? e.message : String(e)));
			}
		}
		ok("and in the reverse order", back.length === 0, back.slice(0, 4).join("; "));
		/* The specific invariant: nothing may be left on the team map that is not
		   a team, because the stats phase iterates it by key. */
		{
			const res = runner.run(global.Config.make(base));
			const bad = Object.keys(res.teams).filter((k) => !res.teams[k] ||
				!Array.isArray(res.teams[k].members));
			ok("the team map contains nothing but teams", bad.length === 0, bad.join(", "));
		}
		/* The ballots survive a warm re-run of the awards phase, which is the
		   thing that broke. */
		{
			const a = runner.run(global.Config.make(Object.assign({}, base)));
			const b = runner.run(global.Config.make(
				Object.assign({}, base, { awardStrictness: 1.4 })));
			ok("the player-of-the-year ballots survive a warm awards re-run",
				(a.poyBallots || []).length === 6 && (b.poyBallots || []).length === 6,
				(a.poyBallots || []).length + " / " + (b.poyBallots || []).length);
			ok("and each ballot names five candidates with margins",
				b.poyBallots.every((x) => x.top.length === 5 && x.top[0].behind === 0 &&
					x.top.every((r) => Number.isFinite(r.behind) && r.name)),
				JSON.stringify(b.poyBallots[0] && b.poyBallots[0].top[1]));
		}
	}
};
