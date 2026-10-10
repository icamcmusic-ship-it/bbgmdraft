/* The 2026-10-10 audit's replayability section (R1-R12) and quick wins
   (Q1-Q32): the pure halves, read off a handful of real classes. */
"use strict";

module.exports = function (ok, V) {
	const E = global.Engine;
	const CFG = global.Config;
	const RM = global.ReplayMeta;
	const P = global.Play;
	const Pro = global.Pro;
	const TT = global.Tournament;
	const U = global.Universe;
	const RB = global.RatingsBuilder;

	const lf = V.realisticClass(90, 70);
	const res = E.run(lf, CFG.make({ seed: "audit-r" }));

	/* --- R8: storylines ------------------------------------------------ */
	{
		ok("every storyline carries held and a label",
			res.narrative.every((s) => "held" in s && typeof s.label === "string"));
		const bad = [["a dominant favourite", "a wide-open year"], ["a wide-open year", "chalk all the way"],
			["a scoring explosion", "a defensive slog"]];
		let clash = 0;
		for (const seed of ["n1", "n2", "n3"]) {
			const r = E.run(lf, CFG.make({ seed, narrative: true }));
			const names = r.narrative.map((x) => x.name);
			if (bad.some(([a, b]) => names.indexOf(a) !== -1 && names.indexOf(b) !== -1)) clash++;
		}
		ok("contradictory storylines are not drawn together", clash === 0);
		ok("recentNarratives is a build-phase input (so a reroll's memory takes)",
			CFG.DEFAULTS.recentNarratives === null && CFG.DEFAULTS.recentTemplates === null);
	}

	/* --- R1: strength in preserve mode, the two mutators ---------------- */
	{
		const weak = E.run(lf, CFG.make({ seed: "r1", flavorHint: "weak" }));
		ok("a strength flavor bends potential in preserve mode",
			weak.effectiveCfg.potBias < 0, String(weak.effectiveCfg.potBias));
		const own = E.run(lf, CFG.make({ seed: "r1", flavorHint: "weak", potBias: 1 }));
		ok("...but never a potBias the user set", own.effectiveCfg.potBias === 1);
		const loaded = RM.applyMutators(CFG.make({}), ["loaded"], RB);
		ok("Loaded class switches the curve on", loaded.ovrMode === "curve" && loaded.potBias > 0);
		const down = RM.applyMutators(CFG.make({}), ["down-year"], RB);
		ok("Down year too", down.ovrMode === "curve" && down.potBias < 0);
		const tf = RM.applyMutators(CFG.make({}), ["transfer-frenzy"], RB);
		ok("Transfer frenzy redraws the colleges (R2)", tf.collegeSource === "rewrite");
	}

	/* --- R4: mutator keys count ---------------------------------------- */
	{
		const k = RM.mutatorKeys(["chaos-march", "one-and-done"], CFG.make({}), RB);
		ok("a mutator's settings are what a challenge counts",
			k.indexOf("upsetFactor") !== -1 && k.indexOf("freshmanShare") !== -1 &&
			k.indexOf("transferShare") !== -1 && k.length === 3, k.join());
	}

	/* --- R2: file gravity ---------------------------------------------- */
	{
		const pl = [
			{ name: "A", origCollege: "Minnesota", origOvr: 60 }, { name: "B", origCollege: "Duke", origOvr: 59 },
			{ name: "C", origCollege: "Minnesota", origOvr: 58 }, { name: "D", origCollege: "UCLA", origOvr: 57 },
			{ name: "E", origCollege: "Kansas", origOvr: 56 }, { name: "F", origCollege: "Duke", origOvr: 40 }];
		const g = RM.fileGravity(pl);
		ok("one program with two of the file's top five is gravity", g && g.college === "Minnesota" && g.count === 2);
		ok("...and a spread file has none", RM.fileGravity(pl.map((p, i) =>
			Object.assign({}, p, { origCollege: "S" + i }))) === null);
	}

	/* --- R9: bingo and rarity ------------------------------------------ */
	{
		const kinds = RM.bingoKinds(res, E.strangeness(res));
		const known = new Set(RM.BINGO_KINDS.map((b) => b.kind).concat(RM.RETIRED_KINDS));
		ok("every kind a run marks is a square or retired", kinds.every((k) => known.has(k)), kinds.join());
		ok("the absolute cut-offs are no longer squares",
			!RM.BINGO_KINDS.some((b) => ["starStudded", "noStars", "smallTop5"].indexOf(b.kind) !== -1));
		ok("every achievement has a measured rarity and a tier",
			RM.ACHIEVEMENTS.every((a) => Number.isFinite(RM.RARITY[a.id]) && a.tier));
		ok("unlocks are gated on silver or gold feats only",
			RM.UNLOCKS.every((u) => RM.tierOf(u.requires) !== "bronze"));
		ok("the bloodlines unlock no longer rides on the perfect season",
			RM.lockFor("flavor", "bloodlines").requires !== "unbeaten-champ");
	}

	/* --- R11: the build collection -------------------------------------- */
	{
		const ledger = {};
		const fresh = RM.collectBuilds(ledger, res, "2026-10-10");
		ok("a run collects its top ten's builds", fresh.length >= 1 && fresh.length <= 10 &&
			fresh.every((b) => ledger[b].seed === String(res.seed)));
		ok("...once", RM.collectBuilds(ledger, res, "x").length === 0);
		const prog = RM.collectionProgress(ledger, RB);
		ok("progress counts by tier", prog.have === fresh.length &&
			prog.by.rare[1] + prog.by.uncommon[1] + prog.by.common[1] === prog.total);
		const boy = RM.buildOfTheYear(res, RB);
		ok("a build of the year is a rare build or nothing",
			boy === null || RM.buildTiers(RB)[boy.build] === "rare");
	}

	/* --- R10: text variety -------------------------------------------- */
	{
		ok("the draft-night table has eighteen kinds", E.DRAFT_EVENTS.length === 18);
		ok("season events carry their template", res.seasonEvents.every((e) => typeof e.tpl === "string"),
			JSON.stringify(res.seasonEvents.filter((e) => !e.tpl).map((e) => e.kind)));
		const tpls = res.seasonEvents.map((e) => e.tpl);
		const again = E.run(lf, CFG.make({ seed: "audit-r", recentTemplates: [tpls] }));
		const overlap = again.seasonEvents.filter((e) => tpls.indexOf(e.tpl) !== -1).length;
		ok("the phrase memory moves templates the last class used",
			overlap < tpls.length, overlap + " of " + tpls.length);
		const openers = res.players.map((p) => String(p.note || "").split("\n")[0]);
		const aOpen = openers.filter((l) => /^An? \d'/.test(l)).length / Math.max(1, openers.length);
		ok("most notes no longer open \"A 6'10\"…\"", aOpen < 0.6, Math.round(100 * aOpen) + "%");
		const scouts = res.players.map((p) => String(p.note || "")).filter((n) => /Scouts note /.test(n)).length;
		const traits = res.players.filter((p) => p.traits && p.traits.length).length;
		ok("\"Scouts note\" is one attribution of several", scouts < traits, scouts + " of " + traits);
	}

	/* --- Q21: the new predicates --------------------------------------- */
	{
		const keys = ["sixteenOverOne", "fifteenOverTwo", "freshmanPoy", "midMajorPoy", "leftyNo1",
			"unbeatenChamp", "allOneSeedsFF"];
		ok("the seven new reroll predicates parse", keys.every((k) => E.parseRerollClause(k)));
		let threw = false;
		for (const k of keys) {
			try { E.parseRerollClause(k).test({}); E.parseRerollClause(k).test(res); } catch (e) { threw = true; }
		}
		ok("...and never throw", !threw);
		ok("...and agree with the achievements",
			E.parseRerollClause("fifteenOverTwo").test(res) === RM.detect(res, E.strangeness(res)).indexOf("fifteen-over-two") >= 0);
	}

	/* --- Q1-Q3, Q5, R12.1: the mock and the draft game ------------------ */
	{
		const projections = Pro.projectClass(res);
		const base = Pro.mockDraft(res, { projections });
		const pick3 = base.picks[2];
		const want = base.picks[10].key;
		const forced = Pro.mockDraft(res, { projections, forced: { 3: want } });
		ok("a forced pick takes the named man (Q1)", forced.picks[2].key === want && forced.picks[2].forced);
		ok("...and the picks before it are unchanged", forced.picks[0].key === base.picks[0].key &&
			forced.picks[1].key === base.picks[1].key);
		ok("...and the rest re-runs around it", forced.picks.slice(3).some((k) => k.key === pick3.key) ||
			forced.undrafted.indexOf(pick3.key) !== -1);
		ok("an unforced mock carries no forced flag", base.picks.every((k) => !("forced" in k)));
		const range = Pro.mockRange(res, { k: 6, projections });
		ok("a range covers the drafted and orders by mean pick (Q2)", range.rows.length >= base.picks.length &&
			range.rows.every((r, i, a) => i === 0 || a[i - 1].mean <= r.mean) &&
			range.rows.every((r) => r.min <= r.mean && r.mean <= r.max));
		const grades = Pro.gradeMock(base, range.expectedPeak);
		ok("every team with a pick gets a letter (Q3)", Object.values(grades).length > 0 &&
			Object.values(grades).every((g) => /^[A-F]$/.test(g.grade)));
		const frail = Pro.careerMods({ traitInjuryMult: 2.5, availability: { injury: true, games: 20 }, archetype: null });
		ok("the medical file shortens careers (Q5)", frail.injury > 0 &&
			Pro.careerMods({ traitInjuryMult: 1 }).injury === 0);
		const p0 = res.board[0];
		const iron = Pro.project(Object.assign({}, p0, { traitInjuryMult: 1, availability: null }), res.season, res.seed);
		const glass = Pro.project(Object.assign({}, p0, { traitInjuryMult: 3, availability: { injury: true, games: 30 } }),
			res.season, res.seed);
		ok("...an injury-prone talent lasts fewer seasons than an iron man", glass.years <= iron.years,
			glass.years + " vs " + iron.years);
		const game = Pro.draftGame(res, "1");
		ok("the draft game holds a lottery team's picks", game && game.slots.length >= 1 && game.slots[0] <= 14);
		const picks = {};
		game.slots.forEach((n) => { picks[n] = base.picks[n - 1].key; });
		const g = Pro.gradeDraftGame(res, game, picks);
		ok("taking what the computer took grades even", g.delta === 0, String(g.delta));
	}

	/* --- Q8, Q9: the line and the odds --------------------------------- */
	{
		const teams = Object.values(res.teams).filter((t) => t && t.log && t.log.length);
		const a = teams[0], b = teams[1];
		const ab = TT.winChance(a, b, 0, res.effectiveCfg, 0.5, false);
		const ba = TT.winChance(b, a, 0, res.effectiveCfg, 0.5, false);
		ok("a neutral line is symmetric (Q8)", Math.abs(ab.p + ba.p - 1) < 1e-9);
		ok("...and a home floor helps", TT.winChance(a, b, 1, res.effectiveCfg, 0.5, false).p > ab.p);
		const odds = TT.titleOdds(res.tourney, res.effectiveCfg);
		const sum = (k) => odds.reduce((x, o) => x + o.rounds[k], 0);
		ok("title odds sum to one and each round to its survivors (Q9)", odds.length === 64 &&
			Math.abs(sum(5) - 1) < 1e-9 && Math.abs(sum(3) - 4) < 1e-9 && Math.abs(sum(0) - 32) < 1e-9);
	}

	/* --- Q10, Q23, R3: the Play games ---------------------------------- */
	{
		const base = P.bracketBase(res.tourney);
		const truth = P.bracketTruth(res.tourney, base);
		const pool = P.bracketPool(res, base, truth);
		ok("the pool has Chalk, the Coin-flipper and The model (Q10)",
			pool.map((x) => x.name).join() === "Chalk,Coin-flipper,The model");
		const ans = P.predictionAnswers(res);
		const bl = P.baselinePrediction(res);
		ok("the baseline names a champion and a No. 1 pick (R3)", !!bl.champion && !!bl.no1);
		const adv = P.gradeAdvanced({ ff: ans.finalFour.slice(), foy: ans.foy[0] || "none", ones: String(ans.onesInFF),
			story: ans.stories.map((x) => (x.held ? "yes" : "no")) }, ans);
		ok("a perfect advanced card scores its max (Q23)", adv.points === adv.max, adv.points + "/" + adv.max);
		const store = {};
		const prev = global.localStorage;
		global.localStorage = { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = v; } };
		P.saveRecord("predict", 6, 11, "s1", { fp: "f", base: 4 });
		const again = P.saveRecord("predict", 11, 11, "s1", { fp: "f", base: 4 });
		ok("a second reveal of the same class is not counted (R3)", again.repeat && again.played === 1 &&
			again.best.points === 6);
		const third = P.saveRecord("predict", 9, 11, "s2", { fp: "g", base: 4 });
		ok("...a new class is, and the above-baseline streak grows", third.played === 2 && third.streak === 2 &&
			third.above === 7);
		global.localStorage = prev;
	}

	/* --- Q15, Q16, Q20 -------------------------------------------------- */
	{
		const p = res.board[0];
		const m = global.Traits.measurables(p);
		ok("measurables are deterministic", JSON.stringify(m) === JSON.stringify(global.Traits.measurables(p)));
		const long = global.Traits.measurables(Object.assign({}, p, { traits: [{ name: "plus wingspan" }] }));
		ok("a plus wingspan measures +5 or more (Q15)", long.wingspan - p.newHgtInches >= 5);
		ok("...short arms measure short", global.Traits.measurables(Object.assign({}, p,
			{ traits: [{ name: "short arms" }] })).wingspan - p.newHgtInches <= 1);
		const rows = [global.BatchStats.summarize(res), global.BatchStats.summarize(
			E.run(lf, CFG.make({ seed: "audit-b" })))];
		const ranges = global.BatchStats.prospectRanges(rows);
		ok("batch ranges are one row a prospect (Q20)", ranges.length === res.players.length &&
			ranges.every((r) => r.classes === 2 && r.boardP10 <= r.boardP90));
	}

	/* --- Q19: ratings history ------------------------------------------ */
	{
		const plain = E.exportFile(res, {});
		const hist = E.exportFile(res, { ratingsHistory: true });
		const who = res.players.findIndex((p) => p.priorSeasons && p.priorSeasons.some((s) => Number.isFinite(s.ovr) && s.season < res.season));
		ok("ratings history adds a row a prior season, the draft row last",
			who >= 0 && hist.players[who].ratings.length > plain.players[who].ratings.length &&
			hist.players[who].ratings[hist.players[who].ratings.length - 1].ovr === res.players[who].newOvr);
		ok("...and is off by default", plain.players.every((p) => p.ratings.length === 1 ||
			p.ratings.length === lf.players[0].ratings.length));
	}

	/* --- Q4, Q25-Q28, Q30: the universe --------------------------------- */
	{
		const reg = {
			"f/1": { id: "f/1", name: "Al One", honors: [{ season: 2031, award: "Consensus National Player of the Year" }],
				seasons: [{ season: 2031, school: "Duke" }], draft: { season: 2031, school: "Duke", ovr: 55, pot: 66,
					classYear: "Freshman", slot: 1 } },
			"f/2": { id: "f/2", name: "Bo Two", honors: [], seasons: [{ season: 2032, school: "Iona" }],
				draft: { season: 2032, school: "Iona", ovr: 44, pot: 60, classYear: "Senior", slot: 45 } },
		};
		const o = U.proOutcome(reg["f/1"]);
		ok("the universe's pro tail is Pro.project's model (Q4)", o && Number.isFinite(o.peak) && !!o.tier);
		ok("careers CSV lists everyone (Q25)", U.careersTable(reg).length === 3);
		ok("search finds by name and by school", U.searchRegistry(reg, "bo")[0].id === "f/2" &&
			U.searchRegistry(reg, "duke")[0].id === "f/1");
		const dec = U.allDecadeTeams(reg);
		ok("all-decade teams weight a player of the year (Q27)", dec.length === 1 && dec[0].decade === 2030 &&
			dec[0].team[0].name === "Al One");
		const h = U.hindsight(reg);
		ok("a hindsight redraft per class (Q28)", h.classes.length === 2 && h.classes[0].top5[0].redraft === 1);
		ok("linkCareers is shared with the command line (Q30)", typeof U.linkCareers === "function");
		const md = global.Almanac.universeMarkdown({ name: "W", baseSeed: "b", rows: [], records: null,
			threads: [], registry: reg });
		ok("a universe almanac (Q26)", /^# W/.test(md) && /All-decade teams/.test(md));
	}

	/* --- R6: a redrawn daily ------------------------------------------- */
	{
		const R = global.Replay;
		const d0 = R.dailyChallenge("2026-10-10"), d1 = R.dailyChallenge("2026-10-10#1");
		ok("a redrawn daily keeps its class and seed and changes its key",
			d1.key === "daily-2026-10-10#1" && d1.date === "2026-10-10" && d1.seed === d0.seed &&
			d1.classSeed === d0.classSeed);
	}

	/* --- Q29, Q31: the command line ------------------------------------ */
	{
		const cp = require("child_process");
		const os = require("os");
		const path = require("path");
		const fs = require("fs");
		const file = path.join(os.tmpdir(), "bbgm-audit-cli.json");
		fs.writeFileSync(file, JSON.stringify(V.realisticClass(92, 40)));
		const bin = path.join(__dirname, "..", "..", "bin", "bbgmdraft.js");
		const run = (args) => cp.execFileSync(process.execPath, [bin].concat(args), { encoding: "utf8",
			maxBuffer: 64 << 20 });
		const news = run(["news", file, "--seed", "c1", "-q"]);
		ok("bbgmdraft news prints the paper (Q31)", /^\[[^\]]+\] \(/.test(news) && news.split("\n\n").length > 20);
		const md = run(["news", file, "--seed", "c1", "--md", "-q"]);
		const kind = (/\(([^)]+)\) /.exec(news) || [])[1];
		const one = run(["news", file, "--seed", "c1", "--kind", kind, "-q"]);
		ok("...as Markdown, or one kind", /^## /.test(md) && one.trim().split("\n\n")
			.every((a) => a.indexOf("(" + kind + ")") !== -1), kind);
		ok("bbgmdraft almanac prints the almanac (Q29)", /^# The \d{4} season/.test(run(["almanac", file, "--seed", "c1", "-q"])));
		ok("...and site the static site", /^<!doctype html>/i.test(run(["site", file, "--seed", "c1", "-q"])));
	}
};
