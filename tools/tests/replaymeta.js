/* The replay layer (js/replaymeta.js): strangeness bingo, mutators, the
   achievements ledger, unlocks and the chaos draft's anomaly picks. */
"use strict";

module.exports = function (ok, V) {
	const E = global.Engine;
	const CFG = global.Config;
	const RM = global.ReplayMeta;
	const RB = global.RatingsBuilder;
	const fs = require("fs");
	const path = require("path");

	/* --- strangeness kinds and the bingo card --------------------------- */
	{
		const lf = V.realisticClass(3, 60);
		const known = new Set(RM.BINGO_KINDS.map((k) => k.kind));
		let allKnown = true;
		let parallel = true;
		for (const seed of ["b1", "b2", "b3", "b4"]) {
			const sc = E.strangeness(E.run(lf, CFG.make({ seed, weirdness: 3 })));
			if (sc.kinds.length !== sc.reasons.length) parallel = false;
			if (!sc.kinds.every((k) => known.has(k))) allKnown = false;
		}
		ok("strangeness returns one kind per reason", parallel);
		ok("...and every kind is a bingo square", allKnown);

		const a = RM.drawCard("card-1");
		ok("a bingo card is nine distinct kinds",
			a.squares.length === 9 && new Set(a.squares).size === 9 &&
			a.squares.every((k) => known.has(k)));
		ok("...deterministic for its seed",
			JSON.stringify(a) === JSON.stringify(RM.drawCard("card-1")));
		const seen = new Set();
		for (let i = 0; i < 8; i++) seen.add(RM.drawCard("c" + i).squares.join());
		ok("...and different across seeds", seen.size >= 6, String(seen.size));

		const c = RM.drawCard("line");
		ok("a fresh card has no line", RM.cardLines(c) === 0 && !RM.cardFull(c));
		const fresh = RM.markCard(c, [c.squares[0], c.squares[4], "nope"]);
		ok("marking covers only the kinds the run had", fresh.join() === "0,4");
		ok("...and marking again adds nothing", RM.markCard(c, [c.squares[0]]).length === 0);
		RM.markCard(c, [c.squares[8]]);
		ok("a diagonal is a line", RM.cardLines(c) === 1);
		RM.markCard(c, c.squares);
		ok("every square is a blackout and eight lines", RM.cardFull(c) && RM.cardLines(c) === 8);
		ok("a stored card round-trips", JSON.stringify(RM.validCard(JSON.parse(JSON.stringify(c)))) ===
			JSON.stringify(c));
		ok("a broken stored card is refused",
			RM.validCard({ squares: [1, 2], marked: [] }) === null && RM.validCard(null) === null &&
			RM.validCard({ squares: new Array(9).fill("x"), marked: new Array(9).fill(0) }) === null);
	}

	/* --- mutators ------------------------------------------------------- */
	{
		ok("mutators are cleaned to known ids, no repeats, three at most",
			RM.cleanMutators(["chaos-march", "bogus", "chaos-march", "no-bigs", "grind", "loaded"])
				.join() === "chaos-march,no-bigs,grind");
		ok("...and a non-list is no mutators", RM.cleanMutators("chaos-march").length === 0);

		const cfg = RM.applyMutators(CFG.make({ seed: "m" }), ["chaos-march", "no-bigs"], RB);
		ok("Chaos March is the maximum upset factor", cfg.upsetFactor === 2);
		const bigs = RB.ARCHETYPES.filter((x) => x.t.indexOf("big") !== -1);
		ok("No bigs zeroes every big build",
			bigs.length > 5 && bigs.every((x) => cfg.archetypeWeights[x.name] === 0));
		ok("the result carries its mutators", cfg.mutators.join() === "chaos-march,no-bigs");
		ok("the label names them", RM.mutatorLabel(cfg.mutators) === "Chaos March + No bigs");

		// Every patch stays inside the setting's own bounds.
		let inBounds = true;
		for (const m of RM.MUTATORS) {
			const p = m.patch(CFG.make(), RB);
			for (const k of Object.keys(p)) {
				if (!(k in CFG.DEFAULTS)) inBounds = false;
				if (typeof p[k] === "number") {
					const c2 = CFG.make({ [k]: p[k] });
					if (c2[k] !== p[k]) inBounds = false;
				}
			}
		}
		ok("every mutator patches existing settings, inside their bounds", inBounds);

		const d = RM.applyMutators(CFG.make(), ["track-meet", "grind"], RB);
		ok("a later mutator wins a clash", d.pace === 60 && d.scoringEnv === -3);

		// No bigs: nobody in the class is built into a big.
		const lf = V.realisticClass(5, 60);
		const res = E.run(lf, RM.applyMutators(CFG.make({ seed: "nb" }), ["no-bigs"], RB));
		const bigNames = new Set(bigs.map((x) => x.name));
		const nBig = res.players.filter((p) => bigNames.has(p.archetype)).length;
		const plain = E.run(lf, CFG.make({ seed: "nb" }));
		const nBigPlain = plain.players.filter((p) => bigNames.has(p.archetype)).length;
		ok("No bigs leaves far fewer big builds", nBig < nBigPlain / 2, nBig + " vs " + nBigPlain);

		/* Composition with flavors: the portal flavor bends transferShare.
		   Under the Portal era mutator the mutator's value survives, because
		   a flavor only moves settings left alone. */
		const pc = RM.applyMutators(CFG.make({ seed: "fl", flavorHint: "portal" }),
			["portal-era"], RB);
		const pr = E.run(lf, pc);
		const bare = E.run(lf, CFG.make({ seed: "fl", flavorHint: "portal" }));
		ok("...the portal flavor does bend it when nothing else set it",
			bare.effectiveCfg.transferShare !== CFG.DEFAULTS.transferShare &&
			bare.effectiveCfg.transferShare !== 75, String(bare.effectiveCfg.transferShare));
		ok("a flavor leaves a mutator's setting alone",
			pr.effectiveCfg.transferShare === 75, String(pr.effectiveCfg.transferShare));
		ok("the same mutated config replays the same class",
			JSON.stringify(E.run(lf, RM.applyMutators(CFG.make({ seed: "fl", flavorHint: "portal" }),
				["portal-era"], RB)).board.slice(0, 5).map((p) => p.key)) ===
				JSON.stringify(pr.board.slice(0, 5).map((p) => p.key)));
	}

	/* --- achievements --------------------------------------------------- */
	{
		ok("between 15 and 20 achievements, unique ids",
			RM.ACHIEVEMENTS.length >= 15 && RM.ACHIEVEMENTS.length <= 20 &&
			new Set(RM.ACHIEVEMENTS.map((a) => a.id)).size === RM.ACHIEVEMENTS.length);
		const team = (seed, w, l) => ({ seed, team: { name: "T" + seed, w, l } });
		const g = (a, b, winA) => ({ a, b, winner: winA ? a : b });
		const fake = {
			board: [{ newHgtInches: 89, preseasonRank: 70, nonNcaa: false, classYear: "Senior" }],
			players: [],
			surprises: [],
			tourney: {
				regions: { East: { rounds: [[g(team(1, 30, 2), team(16, 20, 12), false)]] } },
				semis: [], final: null,
				champion: team(12, 35, 0),
				finalFour: [{ seed: 12 }, { seed: 1 }, { seed: 2 }, { seed: 3 }],
			},
		};
		const got = RM.detect(fake, { score: 72, kinds: ["unbeaten"] });
		for (const id of ["sixteen-over-one", "unbeaten-champ", "giant-no1", "double-digit-champ",
			"cinderella-ff", "nowhere-no1", "senior-no1", "strange-50", "strange-70",
			"unbeaten-regular"]) {
			ok("detects " + id, got.indexOf(id) !== -1, got.join());
		}
		ok("...and not what did not happen",
			got.indexOf("fifteen-over-two") === -1 && got.indexOf("all-ones") === -1 &&
			got.indexOf("small-no1") === -1);
		ok("bingo achievements are not detected from a result",
			got.indexOf("bingo-line") === -1);
		ok("an empty result detects nothing and does not throw",
			RM.detect({}, null).length === 0 && RM.detect(null, null).length === 0);

		// A real result: the tournament games are found where detect reads them.
		const res = E.run(V.realisticClass(2, 60), CFG.make({ seed: "ach" }));
		ok("a real bracket yields 63 games", RM.tourneyGames(res).length === 63,
			String(RM.tourneyGames(res).length));
		const r1 = RM.detect(res, E.strangeness(res));
		ok("detection is deterministic",
			r1.join() === RM.detect(res, E.strangeness(res)).join());
	}

	/* --- unlocks -------------------------------------------------------- */
	{
		const CAL = global.Calibration;
		const era = RM.UNLOCKS.filter((u) => u.kind === "era")[0];
		ok("the unlockable era is the unfitted one in the table",
			era && CAL.ERAS[era.name] && CAL.ERAS[era.name].unfitted &&
			CAL.fittedEras().indexOf(era.name) === -1);
		const names = new Set(RB.CLASS_FLAVORS.map((f) => f.name));
		ok("every unlockable flavor exists",
			RM.UNLOCKS.filter((u) => u.kind === "flavor").every((u) => names.has(u.name)));
		ok("every unlock names a real achievement",
			RM.UNLOCKS.every((u) => RM.ACH_BY_ID[u.requires]));
		ok("locked until earned", !RM.isUnlocked("era", era.name, {}, false));
		ok("...open once earned", RM.isUnlocked("era", era.name, { [era.requires]: {} }, false) &&
			RM.isUnlocked("era", era.name, new Set([era.requires]), false));
		ok("...open with show-everything", RM.isUnlocked("era", era.name, {}, true));
		ok("an ungated flavor is always open", RM.isUnlocked("flavor", "guard-heavy", {}, false));
		const res = E.run(V.realisticClass(1, 50), CFG.make({ seed: "90s", era: era.name }));
		ok("the unlocked era runs", res && res.board.length > 0);
	}

	/* --- chaos draft ---------------------------------------------------- */
	{
		const S = E.SURPRISES;
		const sl = S.slice(0, 6).map((s) => ({ name: s.name, label: s.label }));
		const picks = RM.chaosPicks(sl, 3, S);
		const rank = (n) => 1 / S.filter((s) => s.name === n)[0].w;
		ok("chaos picks the rarest candidates",
			picks.length === 3 && sl.every((c) => picks.indexOf(c.name) !== -1 ||
				picks.every((p) => rank(p) >= rank(c.name))), picks.join());
		ok("...deterministically", picks.join() === RM.chaosPicks(sl.slice().reverse(), 3, S).join());

		const lf = V.realisticClass(4, 60);
		const first = E.run(lf, CFG.make({ seed: "chaos", anomalyChoices: 4 }));
		const shortlist = first.surprises.shortlist;
		const n = Math.max(1, shortlist.length - 4);
		const want = RM.chaosPicks(shortlist, n, S);
		const second = E.run(lf, CFG.make({ seed: "chaos", anomalyChoices: 4, anomalyPicks: want }));
		ok("the chaos picks are the anomalies the class gets",
			second.surprises.map((x) => x.name).sort().join() === want.slice().sort().join(),
			want.join());
	}

	/* --- wiring --------------------------------------------------------- */
	{
		const ROOT = path.join(__dirname, "..", "..");
		const app = fs.readFileSync(path.join(ROOT, "js", "app.js"), "utf8");
		const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
		ok("the page loads js/replaymeta.js before app.js",
			html.indexOf("js/replaymeta.js") !== -1 &&
			html.indexOf("js/replaymeta.js") < html.indexOf("src=\"js/app.js"));
		ok("the replay store is read and written inside try/catch",
			/try \{ saved = JSON\.parse\(localStorage\.getItem\(REPLAY_KEY\)/.test(app) &&
			/try \{ localStorage\.setItem\(REPLAY_KEY/.test(app));
		ok("mutators ride in the link", /out\.mu = state\.mutators/.test(app) &&
			/cleanMutators\(payload\.mu\)/.test(app));
	}
};
