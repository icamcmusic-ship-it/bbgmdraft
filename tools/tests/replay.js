/* Regression checks for the replayability layer added in the September-2026
   full audit: the weirdness meta-dial, the anomaly shortlist, the strangeness
   readout and the reroll-until clause grammar.

   Everything here is guarding one of two promises. The first is that a feature
   which is OFF is off — every one of these adds a setting, and a tool whose
   whole design rests on "the same seed reproduces the same class" cannot
   afford a new dial that perturbs a class at its default. The second is that a
   feature which is ON does the thing its label claims, measured rather than
   asserted. */
"use strict";

module.exports = function (ok, V) {
	const E = global.Engine;
	const CFG = global.Config;
	const U = global.Universe;

	/* --- the weirdness dial ------------------------------------------- */
	{
		const lf = V.realisticClass(1, 60);
		const plain = E.run(lf, CFG.make({ seed: "weird" }));
		const zero = E.run(lf, CFG.make({ seed: "weird", weirdness: 0 }));
		ok("weirdness 0 is byte-for-byte the class that was always there",
			U.resultFingerprint(plain) === U.resultFingerprint(zero) &&
			JSON.stringify(plain.players.map((p) => [p.key, p.newOvr, p.newPot, p.archetype])) ===
			JSON.stringify(zero.players.map((p) => [p.key, p.newOvr, p.newPot, p.archetype])));

		const quiet = E.run(lf, CFG.make({ seed: "weird", weirdness: -2 }));
		const loud = E.run(lf, CFG.make({ seed: "weird", weirdness: 3 }));
		ok("a louder world draws more anomalies than a quieter one",
			(loud.surprises || []).length > (quiet.surprises || []).length,
			(quiet.surprises || []).length + " against " + (loud.surprises || []).length);
		ok("...and leans its flavor harder",
			loud.effectiveCfg.classFlavor > quiet.effectiveCfg.classFlavor);
		ok("...and lets March misbehave",
			loud.effectiveCfg.upsetFactor > quiet.effectiveCfg.upsetFactor);
		/* THE RULE THAT MAKES IT SAFE TO SHIP: a setting the user has moved is
		   the user's, exactly as it is for a class flavor. Without this the
		   dial would be a second, invisible owner of five controls. */
		const held = E.run(lf, CFG.make({
			seed: "weird", weirdness: 3, upsetFactor: 0.4, surpriseBudget: 2,
		}));
		ok("weirdness never overrules a setting the user changed",
			held.effectiveCfg.upsetFactor === 0.4 &&
			(held.surprises || []).length <= 3,
			"upset " + held.effectiveCfg.upsetFactor + ", " +
				(held.surprises || []).length + " anomalies");
		/* And it has to be a declared phase input, or a warm re-run serves the
		   previous world — the same fault the carry-over had. */
		const deps = (name) => (E.PHASES || []).filter((p) => p.name === name)[0];
		ok("every phase that reads a weirdness-bent setting declares it",
			["build", "regular", "postseason"].every((n) =>
				deps(n) && deps(n).deps.indexOf("weirdness") !== -1));
		/* A warm runner has to agree with a cold one across the dial, which is
		   what those declarations buy. */
		const runner = E.createRunner(lf);
		runner.run(CFG.make({ seed: "weird", weirdness: 0 }));
		const warm = runner.run(CFG.make({ seed: "weird", weirdness: 2 }));
		const cold = E.createRunner(lf).run(CFG.make({ seed: "weird", weirdness: 2 }));
		ok("a warm re-run across the weirdness dial matches a cold one",
			U.resultFingerprint(warm) === U.resultFingerprint(cold));
	}

	/* --- the anomaly shortlist ---------------------------------------- */
	{
		const lf = V.realisticClass(2, 60);
		const base = E.run(lf, CFG.make({ seed: "short" }));
		const names = (res) => (res.surprises || []).map((x) => x.name);
		/* At zero the draw must be the one that was always here — including
		   the ORDER kinds are applied in, because an anomaly can change who is
		   eligible for the next one. */
		const off = E.run(lf, CFG.make({ seed: "short", anomalyChoices: 0 }));
		ok("anomalyChoices 0 draws exactly the anomalies it always drew",
			JSON.stringify(names(base)) === JSON.stringify(names(off)),
			names(base).join(", ") + " | " + names(off).join(", "));

		const wide = E.run(lf, CFG.make({ seed: "short", anomalyChoices: 4 }));
		const list = (wide.surprises || []).shortlist || [];
		ok("a shortlist is offered, longer than the class keeps",
			list.length > names(base).length, list.length + " candidates");
		ok("every candidate names the prospect it would land on",
			list.every((c) => c.name && c.label && c.player && c.key));
		ok("no two candidates land on the same prospect",
			new Set(list.map((c) => c.key)).size === list.length);
		/* The picks decide, and only the picks. */
		const want = list.slice(-2).map((c) => c.name);
		const picked = E.run(lf, CFG.make({
			seed: "short", anomalyChoices: 4, anomalyPicks: want,
		}));
		ok("the class takes the anomalies that were picked",
			JSON.stringify(names(picked)) === JSON.stringify(want),
			names(picked).join(", ") + " against " + want.join(", "));
		/* An unanswered shortlist is not an empty class. */
		const none = E.run(lf, CFG.make({
			seed: "short", anomalyChoices: 4, anomalyPicks: [],
		}));
		ok("an unanswered shortlist still gives the class its anomalies",
			(none.surprises || []).length > 0);
		/* And a stale pick from another class does not silently empty it. */
		const stale = E.run(lf, CFG.make({
			seed: "short", anomalyChoices: 4, anomalyPicks: ["a kind that does not exist"],
		}));
		ok("picks that match nothing fall back rather than emptying the class",
			(stale.surprises || []).length > 0);
		ok("the shortlist replays from the same seed",
			JSON.stringify(list.map((c) => c.name)) ===
			JSON.stringify(((E.run(lf, CFG.make({ seed: "short", anomalyChoices: 4 }))
				.surprises || []).shortlist || []).map((c) => c.name)));
	}

	/* --- the strangeness readout -------------------------------------- */
	{
		const lf = V.realisticClass(3, 60);
		const res = E.run(lf, CFG.make({ seed: "str" }));
		const sc = E.strangeness(res);
		ok("strangeness returns a bounded score with its reasons",
			sc && sc.score >= 0 && sc.score <= 100 && Array.isArray(sc.reasons));
		ok("every reason is a sentence, not a key",
			sc.reasons.every((r) => typeof r === "string" && r.length > 8));
		/* A score with no ingredients is a number nobody can act on, so a
		   non-zero score must always be able to say why. */
		ok("a score above zero always has a reason behind it",
			sc.score === 0 || sc.reasons.length > 0);
		ok("strangeness survives a result with nothing on it",
			E.strangeness(null) === null &&
			!!E.strangeness({ players: [], board: [], teams: {} }));
	}

	/* --- the reroll-until clause grammar ------------------------------ */
	{
		const lf = V.realisticClass(4, 60);
		const res = E.run(lf, CFG.make({ seed: "clause" }));
		ok("the predicates live in the engine, so the worker and the UI share them",
			Array.isArray(E.REROLL_PREDICATES) && E.REROLL_PREDICATES.length > 0 &&
			typeof E.parseRerollClause === "function");
		ok("every predicate has a key, a label and a test",
			E.REROLL_PREDICATES.every((p) => p.key && p.label && typeof p.test === "function"));
		ok("no two predicates share a key",
			new Set(E.REROLL_PREDICATES.map((p) => p.key)).size === E.REROLL_PREDICATES.length);
		/* Every predicate has to be safe on any class, including one that has
		   no tournament or no board: a search that throws is a search that
		   silently skips candidates. */
		let threw = 0;
		for (const p of E.REROLL_PREDICATES) {
			for (const r of [res, { players: [], board: [] }, {}]) {
				try { p.test(r); } catch (e) { threw++; }
			}
		}
		ok("no predicate throws on a degenerate result", threw === 0, threw + " threw");
		/* The negation. */
		const first = E.REROLL_PREDICATES[0];
		const yes = E.parseRerollClause(first.key);
		const no = E.parseRerollClause("!" + first.key);
		ok("a clause and its negation disagree about the same class",
			!!yes && !!no && yes.test(res) !== no.test(res));
		ok("a negated clause says so in its label", /^NOT /.test(no.label));
		ok("an unknown clause is null rather than a throw",
			E.parseRerollClause("nope") === null &&
			E.parseRerollClause("!nope") === null);
	}
};
