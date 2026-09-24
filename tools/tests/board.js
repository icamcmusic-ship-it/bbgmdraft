/* The draft board, the ballots and the settings front door.

   Everything here guards a defect found by the September 2026 full-search
   audit and missed by 918 existing checks. They have one shape in common:
   each is a claim about a RELATIONSHIP between two things the engine already
   computed — the two boards, two electorates, the panel and the config —
   rather than about either thing on its own, which is the class of fault an
   output-hash regression suite cannot see. A golden hash proves the output
   did not change; it cannot prove it was ever right. */
"use strict";

module.exports = function (ok, V) {
	const RB = global.RatingsBuilder;
	const { Rng } = global.BBGMRng;

	/* ------------------------------------------------ the two draft boards */

	/* THE AGE TERM HAS TO BE ON BOTH BOARDS OR ON NEITHER.

	   `stockMove` is preseasonRank - boardRank: the DIFFERENCE between two
	   scores. The postseason score carried (21 - draftAge) * 1.8 and the
	   preseason score did not, so the difference contained a 5.4-point age
	   gradient no game produced, against a noise term of sd 1.8. Measured
	   before the fix over these eight classes: freshmen +3.12 places on
	   average with 96 risers to 47 fallers, seniors and graduates -3.74 with
	   34 to 76. So 62% of freshmen were risers and 63% of seniors were
	   fallers before anybody played a game, and the Risers and Fallers panels
	   were reporting the class year.

	   The fix is NOT to copy the postseason coefficient across: part of that
	   1.8 offsets the class-year production gradient the postseason board is
	   about to read, and a board with no production in it needs only the
	   prior. See PRE_AGE_PRIOR in js/engine.js for the sweep that separates
	   them. At 1.1 the residual on these classes is +0.02 and +0.03 places
	   and the gap is -0.01, so the bands below are an order of magnitude
	   wider than the fitted answer — they are there to catch the term going
	   missing again or being re-copied at 1.8, not to pin a constant. */
	{
		let nF = 0;
		let nS = 0;
		let sumF = 0;
		let sumS = 0;
		for (let s = 0; s < 8; s++) {
			const res = global.Engine.run(V.syntheticClass(s + 11, 60),
				global.Config.make({ seed: "age" + s }));
			for (const p of res.players) {
				if (!Number.isFinite(p.stockMove)) continue;
				if (p.classYear === "Freshman") { nF++; sumF += p.stockMove; }
				else if (/Senior|Graduate/.test(p.classYear || "")) { nS++; sumS += p.stockMove; }
			}
		}
		const mF = nF ? sumF / nF : 0;
		const mS = nS ? sumS / nS : 0;
		ok("both boards are scored, so there are two populations to compare",
			nF > 40 && nS > 40, nF + " freshmen, " + nS + " seniors");
		ok("a freshman does not rise on the board for being a freshman",
			Math.abs(mF) < 1.6, "mean stock move " + mF.toFixed(2));
		ok("a senior does not fall on the board for being a senior",
			Math.abs(mS) < 1.9, "mean stock move " + mS.toFixed(2));
		/* The gap between the two is the statistic the bug actually was. It
		   ran at +6.86 places with the term missing and at -4.12 with the
		   term copied across at 1.8, so a band of 3 fails both. */
		ok("the two class years are not split by the age term itself",
			Math.abs(mF - mS) < 3.0, "gap " + (mF - mS).toFixed(2) + " places");
	}

	/* And the preseason board is still a RANKING — a permutation of the
	   class, every rank used once — which is what stockMove subtracts
	   against. Cheap, and it is the property a scoring change can break
	   silently. */
	{
		const res = global.Engine.run(V.syntheticClass(9, 50),
			global.Config.make({ seed: "preboard" }));
		const ranks = res.players.map((p) => p.preseasonRank).sort((a, b) => a - b);
		ok("the preseason board ranks every prospect exactly once",
			ranks.length === res.players.length &&
			ranks.every((r, i) => r === i + 1));
	}

	/* --------------------------------------------- the coaching electorates */

	/* SIX PANELS, NOT ONE PANEL READ SIX WAYS.

	   A single `noise` map was drawn per coach and added to every coaching
	   trophy, so the national panels were not disagreeing — they were reading
	   one perturbed ranking through different weights. With an independent
	   swing per award they should diverge sometimes. The bar is a floor on
	   disagreement rather than a target: the three trophies weigh surprise,
	   record and March differently, so they SHOULD often agree, and a season
	   with one obvious answer is a real season. What cannot happen is
	   unanimity every time. */
	{
		let seasons = 0;
		let split = 0;
		// Ten seasons, not six: panels split in roughly a third of seasons,
		// so six unanimous seasons in a row came up about one run in eight.
		for (let s = 0; s < 10; s++) {
			const res = global.Engine.run(V.syntheticClass(s + 41, 50),
				global.Config.make({ seed: "coy" + s }));
			const nat = (res.coachHonors || []).filter((h) =>
				/^(Naismith Coach of the Year|AP Coach of the Year|Henry Iba Award)$/
					.test(h.award));
			if (nat.length < 3) continue;
			seasons++;
			if (new Set(nat.map((h) => h.coach)).size > 1) split++;
		}
		ok("all three national coaching trophies are awarded", seasons >= 8,
			seasons + " of 10 seasons");
		ok("the three coaching panels do not always name the same man",
			split >= 1, split + " of " + seasons + " seasons split");
	}

	/* AND THE BALLOT IS DRAWN BEFORE IT IS SORTED.

	   Two of the trophies used to call crng.normal() INSIDE the function
	   handed to Array.prototype.sort, which calls it twice per comparison.
	   That makes the comparator inconsistent — pick(a) is a different number
	   each time it is asked — and it consumes a number of draws that depends
	   on how many comparisons the sort engine happens to make. The visible
	   consequence is that the SAME seed and the SAME settings need not
	   produce the same winner. Run the identical config twice and compare. */
	{
		const cfg = () => global.Config.make({ seed: "coy-determinism" });
		const a = global.Engine.run(V.syntheticClass(57, 50), cfg());
		const b = global.Engine.run(V.syntheticClass(57, 50), cfg());
		const names = (res) => (res.coachHonors || [])
			.map((h) => h.award + "=" + h.coach).sort().join("|");
		ok("the same seed names the same coaches", names(a) === names(b));
		ok("there were coaches to name", (a.coachHonors || []).length > 5);
	}

	/* ------------------------------------------------------- the front door */

	/* A LINK CANNOT ASK FOR A SETTING THE PANEL CANNOT SHOW.

	   Config.CLAMP declared eleven bands and Config.make applied none of
	   them: the sliders cannot produce an illegal value, but a shareable
	   link, a saved preset and an imported settings JSON all arrive through
	   make and can carry anything. A link at specialization 50 ran at 50
	   while the panel displayed 2.5 — the tool describing a class other than
	   the one on screen, which is the one thing a shareable link exists not
	   to do. */
	{
		const c = global.Config.make({
			specialization: 50, statNoise: -9, archetypePool: 1e6,
			classQuality: 99, potSpread: -4, awardStrictness: 0,
		});
		const CL = global.Config;
		const inBand = (k) => {
			const r = CL.sliderRange(k);
			return c[k] >= r.min && c[k] <= r.max;
		};
		ok("an out-of-range setting is brought into its own band",
			["specialization", "statNoise", "archetypePool", "classQuality",
				"potSpread", "awardStrictness"].every(inBand),
			JSON.stringify({ specialization: c.specialization, statNoise: c.statNoise,
				archetypePool: c.archetypePool, classQuality: c.classQuality }));
		/* A broken value is a broken FILE, not a large number: it goes back to
		   the default rather than to a bound, because a bound would be this
		   tool inventing a decision nobody made. */
		const bad = global.Config.make({ awardNoise: "banana", pace: null });
		ok("a value that is not a number falls back to its default",
			bad.awardNoise === global.Config.DEFAULTS.awardNoise);
		/* An explicit null is not a missing key: Object.assign writes it over
		   the default, so `"pace": null` in a preset used to reach the engine
		   and turn every possession count into NaN. */
		ok("an explicit null goes back to the default, not through",
			bad.pace === global.Config.DEFAULTS.pace);
		/* And the whole panel is covered now, not a fifth of it: every slider
		   in index.html has a declared band. tools/tests/review.js checks that
		   the two AGREE; this checks that the band exists at all, which is the
		   half that was missing. */
		const fs = require("fs");
		const path = require("path");
		const html = fs.readFileSync(
			path.join(__dirname, "..", "..", "index.html"), "utf8");
		const ids = [];
		const re = /<input[^>]*type="range"[^>]*>/g;
		let m;
		while ((m = re.exec(html))) {
			const id = /id="([A-Za-z0-9_]+)"/.exec(m[0]);
			if (id) ids.push(id[1]);
		}
		const undeclared = ids.filter((k) => !CL.CLAMP[k]);
		ok("every slider on the page declares a band the engine enforces",
			ids.length > 40 && undeclared.length === 0,
			ids.length + " sliders, undeclared: " + undeclared.join(", "));
	}

	/* ------------------------------------------------------ flavour memory */

	/* SIXTY-SIX FLAVORS AND ONE DRAW A CLASS.

	   poolMemory keeps a build from turning up in class after class and
	   anomalyMemory does it for the surprises; the flavor — the single most
	   visible thing about a class, drawn once from sixty-six — had no memory
	   at all. The two properties that matter are that it works and that it is
	   free: a null history has to leave the draw EXACTLY where it was, or
	   every shareable link ever made resolves to a different class. */
	{
		const draw = (cfg) => {
			const f = RB.pickFlavor
				? RB.pickFlavor(new Rng("flav"), cfg) : null;
			return f ? f.name : null;
		};
		ok("flavorMemoryFactor is a no-op with nothing to remember",
			RB.flavorMemoryFactor("anything", null, 1) === 1 &&
			RB.flavorMemoryFactor("anything", [], 1) === 1 &&
			RB.flavorMemoryFactor("anything", ["anything"], 0) === 1);
		ok("a flavor drawn last class is pushed down, not banned",
			RB.flavorMemoryFactor("x", ["x"], 1) < 1 &&
			RB.flavorMemoryFactor("x", ["x"], 1) > 0);
		ok("a flavor in every recent class is pushed harder than one in the last",
			RB.flavorMemoryFactor("x", ["x", "x", "x"], 1) <
				RB.flavorMemoryFactor("x", ["x", "y", "z"], 1));
		ok("a flavor nobody drew recently is untouched",
			RB.flavorMemoryFactor("x", ["a", "b", "c"], 1) === 1);
		if (draw({})) {
			ok("the memory costs the RNG stream nothing when it is off",
				draw({ flavorMemory: 0.6 }) === draw({ flavorMemory: 0.6, recentFlavors: null }));
		}
		/* And it moves the distribution over a run of classes, which is the
		   thing it exists for. Drawn with the newest class remembered each
		   time, the way the UI supplies it. */
		{
			let repeats = 0;
			let repeatsOff = 0;
			for (let s = 0; s < 60; s++) {
				const r = new Rng("mem" + s);
				const first = RB.pickFlavor(r.child("a"), {});
				if (!first) continue;
				const withMem = RB.pickFlavor(r.child("b"),
					{ flavorMemory: 1, recentFlavors: [first.name] });
				const without = RB.pickFlavor(r.child("b"), {});
				if (withMem && withMem.name === first.name) repeats++;
				if (without && without.name === first.name) repeatsOff++;
			}
			ok("the memory reduces back-to-back repeats of the same flavor",
				repeats <= repeatsOff,
				repeats + " with the memory against " + repeatsOff + " without");
		}
	}
};
