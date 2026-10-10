/* Replayability (audit section 4, ideas 1, 2, 3, 7, 12, 13): the daily
   challenge, par and score, the campaign, share codes, the find-the-settings
   puzzle and the ghost rival — the pure half, in js/replay.js. */
"use strict";

module.exports = function (ok, V) {
	const E = global.Engine;
	const CFG = global.Config;
	const R = global.Replay;

	/* --- daily challenge ----------------------------------------------- */
	{
		const a = R.dailyChallenge("2026-09-25");
		ok("a daily challenge is keyed and seeded by its date",
			a.key === "daily-2026-09-25" && a.seed === "daily-2026-09-25");
		ok("...and is deterministic",
			JSON.stringify(a) === JSON.stringify(R.dailyChallenge("2026-09-25")));
		ok("a malformed date is no challenge", R.dailyChallenge("tomorrow") === null);
		let allValid = true, budgetsOk = true;
		const combos = new Set();
		for (let d = 1; d <= 28; d++) {
			const ch = R.dailyChallenge("2027-02-" + (d < 10 ? "0" : "") + d);
			if (!ch.goals.every((k) => E.parseRerollClause(k))) allValid = false;
			if (ch.budget < 3 || ch.budget > 5) budgetsOk = false;
			combos.add(ch.goals.join("+"));
		}
		ok("every daily goal is a reroll predicate", allValid);
		ok("every daily budget is 3 to 5", budgetsOk);
		ok("the goals vary from day to day", combos.size >= 5, combos.size + " combos");
		/* Plausibly solvable on the CANONICAL class (audit 2026-10-10, R5):
		   the stretch goal's lever plus a variation within budget clears it.
		   Not every date is (the goals are drawn blind), so this scans eight
		   and asks that most are, and that every stretch lever is a real
		   setting. */
		const D = CFG.DEFAULTS;
		ok("every stretch lever names real settings",
			R.DAILY_STRETCH.every((g) => Object.keys(g.lever).every((k) => k in D)));
		ok("every daily names its canonical class and a weekly theme",
			R.dailyChallenge("2026-10-02").classSeed === "daily-2026-10-02" &&
			R.WEEKLY_THEMES.some((t) => t.key === R.dailyChallenge("2026-10-02").theme));
		let solvable = 0;
		const tried = [];
		for (const date of ["2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"]) {
			const ch = R.dailyChallenge(date);
			const lf = global.Sample.makeClass(ch.classSeed, 70, ch.classYear);
			const preds = ch.goals.map(E.parseRerollClause);
			let solved = null;
			for (let v = 0; v <= 4 && solved === null; v++) {
				const cfg = Object.assign({ seed: ch.seed, variation: v }, ch.lever);
				if (preds.every((p) => p.test(E.run(lf, CFG.make(cfg))))) solved = v;
			}
			const dials = Object.keys(ch.lever).length + (solved ? 1 : 0);
			if (solved !== null && dials <= ch.budget) solvable++;
			tried.push(date + ": " + ch.goals.join(", ") + " -> " + solved);
		}
		ok("most dailies are solvable with their lever on the canonical class", solvable >= 2,
			tried.join(" | "));
	}

	/* --- streaks, ladder, share line, packs (R6, Q22, R12) -------------- */
	{
		const h = { "2026-10-07": 110, "2026-10-08": 100, "2026-10-09": 95, "2026-10-01": 80 };
		const st = R.dailyStreak(h, "2026-10-10");
		ok("a streak counts back from yesterday when today is not played yet",
			st.current === 3 && st.longest === 3 && st.strip.length === 30, JSON.stringify(st.current));
		ok("...and from today once it is", R.dailyStreak(Object.assign({ "2026-10-10": 1 }, h), "2026-10-10").current === 4);
		ok("a gap breaks it", R.dailyStreak({ "2026-10-08": 1 }, "2026-10-10").current === 0);
		const lad = R.weeklyLadder(h, "2026-10-09");
		ok("the weekly ladder sums Monday to Sunday", lad.week === "2026-10-05" && lad.total === 305 &&
			R.decodeCode(lad.code).wk === "2026-10-05", JSON.stringify(lad));
		const ch = R.dailyChallenge("2026-10-02");
		const line = R.shareLine(ch, { goals: [{ met: true }, { met: false }], solved: false,
			moved: ["upsetFactor"], budget: 3 }, 4, { current: 5 });
		ok("the share line is spoiler-free", line.indexOf("upsetFactor") === -1 &&
			/1\/3 dials/.test(line) && /4 runs/.test(line) && /streak 5/.test(line), line);
		const code = R.encodePack("my pack", [{ key: "a", name: "A", seed: "s1", goals: ["unbeaten"], budget: 2 },
			{ key: "bad", seed: "s2", goals: ["notAPredicate"], budget: 1 }]);
		const pk = R.decodePack(code, E.parseRerollClause);
		ok("a scenario pack round-trips and drops a challenge whose goals do not parse",
			pk && pk.list.length === 1 && pk.list[0].key === "pack:mypack:a" && pk.list[0].classSeed === "pack-s1");
		ok("a non-pack code is no pack", R.decodePack(R.encodeCode({ x: 1 })) === null);
		const rc = R.readResult(R.makeResult({ seed: "x" }, { fp: "abc123" }));
		ok("a result code carries the class fingerprint", rc && rc.fp === "abc123");
	}

	/* --- puzzle (R7) ---------------------------------------------------- */
	{
		ok("the puzzle dials drop variation and classQuality",
			!("variation" in R.PUZZLE_DIALS) && !("classQuality" in R.PUZZLE_DIALS));
		const p0 = R.puzzle("x"), p1 = R.puzzle("x", 1);
		ok("a redrawn puzzle keeps its seed and changes its dials",
			p0.seed === p1.seed && JSON.stringify(p0.hidden) !== JSON.stringify(p1.hidden));
		const t = { champion: "A", poy: "B", no1: "C", flavor: "D" };
		ok("a puzzle the defaults half-solve is rejected",
			R.puzzleRejected(Object.assign({}, t, { flavor: "E", no1: "F" }), t) &&
			!R.puzzleRejected({ champion: "A", poy: "Z", no1: "Y", flavor: "X" }, t));
		ok("a hint names a section", /^One hidden setting is in /.test(R.puzzleHint(p0, 0)) &&
			R.puzzleHint(p0, 9) === null);
	}

	/* --- par and score ------------------------------------------------- */
	{
		ok("par: one dial under a budget of 3 on the first run scores 120",
			R.parScore(2, 3, 1) === 110 && R.parScore(1, 3, 1) === 120);
		ok("reruns cost one each after the first", R.parScore(3, 3, 6) === 95);
		ok("the score never goes negative", R.parScore(40, 3, 900) === 0);
		ok("a best is a higher score", R.betterScore(90, 80) && !R.betterScore(80, 90) &&
			R.betterScore(1, undefined));
	}

	/* --- campaign ------------------------------------------------------ */
	{
		const list = [{ key: "a", name: "A", goals: [], budget: 3 },
			{ key: "b", name: "B", goals: [], budget: 3, forbid: ["x"] },
			{ key: "c", name: "C", goals: [], budget: 3 }];
		const none = { cleared: {} };
		ok("the first tier is open", R.campaignTier(list, 0, none).key === "campaign:a");
		ok("the second is locked until the first is cleared",
			R.campaignTier(list, 1, none) === null && R.campaignUnlocked(list, none) === 1);
		const one = { cleared: { a: ["upsetFactor", "x"] } };
		const t1 = R.campaignTier(list, 1, one);
		ok("clearing a tier opens the next and forbids the dials that cleared it",
			t1 && t1.forbid.join(",") === "x,upsetFactor" && t1.baseKey === "b",
			t1 && t1.forbid.join(","));
		ok("...and the unlocked count follows", R.campaignUnlocked(list, one) === 2);
	}

	/* --- share codes --------------------------------------------------- */
	{
		const payload = { seed: "daily-2026-09-25", variation: 3, upsetFactor: 1.35,
			leagueWeights: { NBL: 0.4 }, noteLines: ["Café “ünïcode” ✓"] };
		const code = R.makeResult(payload, { challenge: "daily-2026-09-25",
			moved: ["variation", "upsetFactor"], score: 110, solved: true });
		ok("a code is base32 in groups", /^BB1-([0-9A-HJKMNP-TV-Z]{1,5}-)*[0-9A-HJKMNP-TV-Z]{1,5}$/.test(code), code);
		const back = R.readResult(code);
		ok("a code round-trips exactly",
			JSON.stringify(back.payload) === JSON.stringify(payload) &&
			back.challenge === "daily-2026-09-25" && back.score === 110 && back.solved &&
			back.moved.join() === "variation,upsetFactor");
		ok("...case-blind and without the dashes",
			JSON.stringify(R.readResult(code.toLowerCase().replace(/-/g, "")).payload) ===
				JSON.stringify(payload));
		const bad = code.slice(0, -1) + (code.slice(-1) === "0" ? "1" : "0");
		ok("a mistyped code is refused, not misread", R.readResult(bad) === null);
		ok("junk is refused", R.readResult("hello") === null && R.readResult("") === null);
		// Every config the panel can make round-trips through the config.
		const cfg = CFG.make({ seed: "s", variation: 7, freshmanShare: 12 });
		const again = CFG.make(R.readResult(R.makeResult({ seed: "s", variation: 7,
			freshmanShare: 12 })).payload);
		ok("a decoded payload makes the same config",
			JSON.stringify(cfg) === JSON.stringify(again));
	}

	/* --- find the settings --------------------------------------------- */
	{
		const p = R.puzzle("2026-09-25");
		const dials = Object.keys(p.hidden);
		ok("a puzzle hides two or three dials, all off their defaults",
			dials.length >= 2 && dials.length <= 3 && p.budget === 3 &&
			dials.every((k) => p.hidden[k] !== CFG.DEFAULTS[k]), JSON.stringify(p.hidden));
		ok("...deterministically",
			JSON.stringify(p) === JSON.stringify(R.puzzle("2026-09-25")));
		const lf = V.realisticClass(90, 70);
		const target = R.headlines(E.run(lf,
			CFG.make(Object.assign({}, p.hidden, { seed: p.seed }))));
		ok("the target has a champion and a No. 1 pick",
			!!target.champion && !!target.no1, JSON.stringify(target));
		const goals = R.puzzleGoals(target);
		const answer = E.run(lf, CFG.make(Object.assign({}, p.hidden, { seed: p.seed })));
		ok("the hidden settings meet every headline goal", goals.every((g) => g.test(answer)));
		const plain = E.run(lf, CFG.make({ seed: p.seed }));
		ok("the defaults do not (the puzzle is not already solved)",
			!goals.every((g) => g.test(plain)));
	}

	/* --- ghost rival --------------------------------------------------- */
	{
		const c = R.ghostCompare(["a", "b"], ["b", "c"]);
		ok("a rival's dials split into shared, only mine and only theirs",
			c.shared.join() === "b" && c.onlyMine.join() === "a" && c.onlyTheirs.join() === "c");
	}
};
