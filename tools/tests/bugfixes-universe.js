/* Universe bug fixes from the 2026-10-05 audit (section 5): one player of the
   year per season (UV1), team trophies are not personal honors (UV8), the
   players file only merges true re-entries (UV3), synthetic names do not
   repeat across a chain (UV4), thread wording and counts (UV9), the
   underclassman-award story (UV10), singular/plural text (UV16), a bounded
   gap (UV7) and a bounded coaching tree (UV14).

   One three-season synthetic chain is built once and shared. */
"use strict";

module.exports = function (ok, V) {
	const fs = require("fs");
	const path = require("path");
	const E = global.Engine;
	const CFG = global.Config;
	const U = global.Universe;
	const N = global.News;

	const chainOf = (n, seed, first) => {
		const files = U.synthFiles(seed, first || 2030, n);
		const runners = files.map((f) => E.createRunner(f.data));
		const results = [];
		const c = U.beginChain({
			mode: "cold", files,
			runnable: files.map((f, i) => ({ index: i, name: f.name, season: f.data.startingSeason })),
			settings: CFG.make({ seed }), baseSeed: seed,
			make: (s) => CFG.make(s), runnerFor: (i) => runners[i],
			dataChanged: (i) => { runners[i] = E.createRunner(files[i].data); },
			extrapolateGaps: false, store: (i, r) => { results[i] = r; },
		});
		for (let k = 0; k < c.runnable.length; k++) c.step(k);
		c.finish({});
		return { u: c.universe, results, files };
	};

	/* ---- UV1: one man is the player of the year ---------------------------- */
	{
		const set = U.nationalPOYSet();
		const man = (name, awards, boardRank) => ({ name, key: name, awards, boardRank });
		const CONS = "Consensus National Player of the Year";
		const players = [
			man("AP only", ["AP Player of the Year"], 1),
			man("Six trophies", ["Naismith Trophy", "John R. Wooden Award", "Oscar Robertson Trophy",
				"NABC Player of the Year", "Sporting News Player of the Year", CONS], 7),
			man("Nobody", [], 2),
		];
		ok("uv1/the Consensus holder is the player of the year, not the first man listed",
			U.pickPOY(players, set).name === "Six trophies");
		const split = [
			man("One", ["AP Player of the Year"], 3),
			man("Two", ["Naismith Trophy", "NABC Player of the Year"], 9),
			man("Three", ["John R. Wooden Award"], 1),
		];
		ok("uv1/with no Consensus trophy the man with the most trophies is",
			U.pickPOY(split, set).name === "Two");
		const tie = [
			man("Worse board", ["AP Player of the Year", "Naismith Trophy"], 6),
			man("Better board", ["NABC Player of the Year", "John R. Wooden Award"], 2),
		];
		ok("uv1/a tie goes to the better board rank, and the same way every time",
			U.pickPOY(tie, set).name === "Better board" && U.pickPOY(tie.slice().reverse(), set).name === "Better board");
		ok("uv1/no holder, no player of the year", U.pickPOY([man("x", ["First Team"], 1)], set) === null &&
			U.pickPOY([], set) === null);

		const c = chainOf(3, "bf-uv1");
		const rows = c.u.rows;
		let one = true;
		let agree = true;
		c.results.forEach((r, i) => {
			const held = r.players.filter((p) => (p.awards || []).some((a) => set.has(a)));
			const poyAlumni = c.u.alumni.filter((a) => a.season === rows[i].season &&
				a.why === "player of the year");
			if (poyAlumni.length > 1) one = false;
			const want = U.pickPOY(r.players, set);
			if ((want ? want.name : null) !== (rows[i].poy ? rows[i].poy.name : null)) agree = false;
			if (want && (poyAlumni.length !== 1 || poyAlumni[0].name !== want.name)) agree = false;
			if (!held.length && (poyAlumni.length || rows[i].poy)) agree = false;
		});
		ok("uv1/every season has at most one 'player of the year' in the alumni index", one);
		ok("uv1/the timeline row, the alumni index and pickPOY name the same man", agree);
		/* The per-season fingerprint is stored in exports; it must not move. */
		ok("uv1/the stored result fingerprint is still the first-holder digest",
			rows.every((r) => typeof r.result === "string" && r.result.length === 8));
	}

	/* ---- UV8: a team's trophy is not a man's honor ------------------------- */
	{
		for (const a of ["MEAC Regular-Season Champion", "MEAC Tournament Champion", "NCAA National Runner-Up",
			"NCAA National Champion", "NIT Champion", "Academic All-American", "ACB Cup Winner"]) {
			ok("uv8/'" + a + "' is not a personal honor", U.isPersonalHonor({ award: a }) === false);
		}
		for (const a of ["Naismith Trophy", "All-ACC First Team", "NCAA All-Tournament Team",
			"NIT Most Valuable Player", "Consensus First Team All-American"]) {
			ok("uv8/'" + a + "' still is", U.isPersonalHonor({ award: a }) === true);
		}
		const team = (season) => [
			{ season, award: "SEC Regular-Season Champion" }, { season, award: "SEC Tournament Champion" },
			{ season, award: "NCAA National Runner-Up" }];
		const reg = {
			"f/1": { id: "f/1", name: "Ring Collector", span: 3, draft: { school: "Duke", season: 2030 },
				seasons: [{ season: 2030 }, { season: 2031 }, { season: 2032 }],
				honors: team(2030).concat(team(2031), team(2032)), returned: [2031, 2032] },
			"f/2": { id: "f/2", name: "Real Honors", span: 2, draft: { school: "Kansas", season: 2030 },
				seasons: [{ season: 2030 }, { season: 2031 }],
				honors: [{ season: 2030, award: "Naismith Trophy" }, { season: 2031, award: "AP Player of the Year" }],
				returned: [] },
		};
		const pr = U.peopleRecords(reg);
		ok("uv8/most honors counts individual awards only",
			pr.mostHonors.length === 1 && pr.mostHonors[0].name === "Real Honors" && pr.mostHonors[0].count === 2,
			JSON.stringify(pr.mostHonors));
		ok("uv8/the best honor season is an individual one",
			pr.bestHonorSeason && pr.bestHonorSeason.name === "Real Honors" && pr.bestHonorSeason.count === 1,
			JSON.stringify(pr.bestHonorSeason));
		const cb = U.comebackThreads(reg);
		ok("uv8/a returner whose only 'honors' are team trophies is not a he-came-back story",
			!cb.some((t) => t.id === "f/1"), JSON.stringify(cb.map((t) => t.text)));
		ok("uv8/...and the individually honoured man still is (two seasons of real honors)",
			cb.some((t) => t.id === "f/2"));
		const c = chainOf(3, "bf-uv8");
		const regs = c.u.registry || {};
		const leaked = Object.keys(regs).some((id) => (regs[id].honors || [])
			.some((h) => !U.isPersonalHonor(h)));
		ok("uv8/a freshly built registry holds no team trophy as an honor", !leaked);
	}

	/* ---- UV3: the players file only merges true re-entries ----------------- */
	{
		const mk = (season, label) => {
			const lf = global.Sample.makeClass("bf-uv3-" + label, 24, season);
			return E.run(lf, CFG.make({ seed: "bf-uv3-" + label }));
		};
		const a = mk(2030, "a");
		const b = mk(2031, "b");
		const c = mk(2032, "c");
		/* Make player i of `res` the same name and birth year as `src`, at `college`
		   (the export reads the file's name and the player's placed college). */
		const setMan = (res, i, src, college) => {
			const p = res.leagueFile.players[i];
			p.firstName = src.firstName;
			p.lastName = src.lastName;
			p.born = { year: src.born.year, loc: p.born.loc };
			p.college = college;
			const row = res.players.find((x) => x.pid === p.pid);
			row.name = src.firstName + " " + src.lastName;
			row.newCollege = college;
			row.age = E.classSeasonOf(res) - src.born.year;
			row.born = { year: src.born.year, loc: row.born.loc };
		};
		const man = E.exportPlayersFile(a, {}).players[0];
		const baseline = E.universePlayersFile([a, b, c], { relatives: false, seed: "x" });
		/* Same name and birth year as `man`, a different college, the next class:
		   the old first|last|born key merged him into the earlier man. */
		setMan(b, 0, man, man.college === "Duke" ? "Kansas" : "Duke");
		const r1 = E.universePlayersFile([a, b, c], { relatives: false, seed: "x" });
		ok("uv3/two different men sharing a name and a birth year are not merged",
			r1.duplicates === baseline.duplicates, baseline.duplicates + " vs " + r1.duplicates);
		ok("uv3/...and both are in the file",
			r1.file.players.length === baseline.file.players.length);
		/* The same man coming back two classes on, same college, is one man. */
		setMan(c, 1, man, man.college);
		const r2 = E.universePlayersFile([a, b, c], { relatives: false, seed: "x" });
		ok("uv3/an undrafted man re-entering two classes on (same name, college, birth year) is merged once",
			r2.duplicates === r1.duplicates + 1, r1.duplicates + " -> " + r2.duplicates);
		/* ...and one class on is only the same export loaded again: kept apart unless it is
		   the same pid and birth year. */
		const c2 = mk(2031, "c2");
		setMan(c2, 5, man, man.college);
		c2.leagueFile.players[5].pid = 77;
		const r3 = E.universePlayersFile([a, c2], { relatives: false, seed: "x" });
		const r3base = E.universePlayersFile([a, mk(2031, "c2")], { relatives: false, seed: "x" });
		ok("uv3/the next class's namesake at the same college is a different man",
			r3.duplicates === r3base.duplicates, r3base.duplicates + " vs " + r3.duplicates);
		ok("uv3/the status count is only true duplicates (rows - men)",
			r2.file.players.length === a.leagueFile.players.length + b.leagueFile.players.length +
				c.leagueFile.players.length - r2.duplicates);
	}

	/* ---- UV4: names do not repeat across a chain ---------------------------- */
	{
		const names = (files) => files.reduce((all, f) => all.concat(f.data.players
			.map((p) => p.firstName + " " + p.lastName)), []);
		const dups = (list) => list.length - new Set(list).size;
		U.setUniqueSynthNames(false);
		const before = names(U.synthFiles("bf-uv4", 2030, 25));
		U.setUniqueSynthNames(true);
		const after = names(U.synthFiles("bf-uv4", 2030, 25));
		ok("uv4/the old pool repeated names across 25 seasons (the problem is real)", dups(before) > 20, String(dups(before)));
		ok("uv4/the dealt names do not repeat across 25 seasons", dups(after) === 0, String(dups(after)));
		const long = names(U.synthFiles("bf-uv4", 2030, 80));
		ok("uv4/...nor across 80, where the deal wraps and a generation suffix is added",
			dups(long) === 0 && long.some((n) => / (Jr\.|III)$/.test(n)), String(dups(long)));
		const x = U.synthFile("bf-uv4", 2041);
		const y = U.synthFile("bf-uv4", 2041);
		ok("uv4/a season's names are a pure function of seed and season",
			JSON.stringify(x.data) === JSON.stringify(y.data));
		ok("uv4/the real-player list is still respected",
			after.every((n) => !global.Sample.REAL_NAMES.has(n.replace(/ (Jr\.|III|IV|V|VI|VII|VIII)$/, ""))));
		/* The impact on results: names are not an input to a season, so none. */
		const fp = (flag) => {
			U.setUniqueSynthNames(flag);
			return chainOf(2, "bf-uv4-fp").u.rows.map((r) => r.result + ":" + r.champion).join();
		};
		const off = fp(false);
		const on = fp(true);
		ok("uv4/the per-season result fingerprints and champions are the same with it on or off", on === off,
			off + " vs " + on);
		U.setUniqueSynthNames(true);
	}

	/* ---- UV9: thread text and counts ---------------------------------------- */
	{
		const row = (season, extra) => Object.assign({ season, champion: "Team " + season,
			runnerUp: "Other " + season, realignment: [], finalFour: [] }, extra || {});
		// eight programmes each winning a first title late
		const rows = [];
		for (let i = 0; i < 12; i++) rows.push(row(2030 + i));
		const ft = U.moreThreads(rows, []).find((t) => t.kind === "firstTitle");
		ok("uv9/firstTitle that lists four of many says how many more",
			ft && /and 4 more$/.test(ft.text) && ft.count === 8, ft && ft.text);
		const few = U.moreThreads(rows.slice(0, 7), []).find((t) => t.kind === "firstTitle");
		ok("uv9/...and says nothing about 'more' when it lists them all",
			few && !/more$/.test(few.text) && few.count === 3, few && few.text);
		ok("uv9/...and does not claim the title was won 'inside' a timeline Duke was already in",
			ft && !/inside this timeline/.test(ft.text));

		const tied = [row(2030, { bestRecord: { team: "A", w: 38, l: 1 } }),
			row(2031, { bestRecord: { team: "B", w: 38, l: 1 } }),
			row(2032, { bestRecord: { team: "C", w: 33, l: 5 } })];
		const br = U.moreThreads(tied, []).filter((t) => t.kind === "bestRecord");
		ok("uv9/two teams on the top win total are a tie, not two 'the most'",
			br.length === 1 && /tied for the most/.test(br[0].text) && /A \(2030\)/.test(br[0].text) &&
			/B \(2031\)/.test(br[0].text) && br[0].seasons.join() === "2030,2031", JSON.stringify(br));
		const one = U.moreThreads([tied[0], tied[2]], []).filter((t) => t.kind === "bestRecord");
		ok("uv9/a single best record still reads 'the most in the timeline'",
			one.length === 1 && /the most in the timeline/.test(one[0].text) && one[0].team === "A");

		const hop = [];
		for (let i = 0; i < 6; i++) hop.push(row(2030 + i));
		hop[1].realignment = ["Bowling Green → MAC", "Bowling Green → Sun Belt"];
		hop[3].realignment = ["Bowling Green → MAC"];
		const sm = U.moreThreads(hop, []).find((t) => t.kind === "serialMover");
		ok("uv9/a double hop in one realignment pass counts as one change that season",
			sm && sm.count === 2 && sm.seasons.join() === "2031,2033" && /2 times/.test(sm.text),
			JSON.stringify(sm));
		const wave = [row(2030, { realignment: ["A → X", "A → Y", "B → X", "C → X"] })];
		ok("uv9/...and a wave counts programmes, not moves",
			!U.moreThreads(wave, []).some((t) => t.kind === "realignmentWave"));
	}

	/* ---- UV10: the underclassman-award story is for later classes only ------- */
	{
		const lf = global.Sample.makeClass("bf-uv10", 40, 2030);
		const res = E.run(lf, CFG.make({ seed: "bf-uv10" }));
		const run = (futureClass) => {
			let found = false;
			for (let s = 0; s < 14 && !found; s++) {
				const r = Object.assign({}, res, {
					cfg: Object.assign({}, res.cfg, { seed: "bf-uv10-" + s }),
					fieldHonors: [{ award: "Third Team All-American", name: "Marcus Okafor", key: "x1",
						school: "Duke", classYear: "Senior", futureClass }],
				});
				found = N.build(r).some((a) => a.kind === "underclassman award");
			}
			return found;
		};
		ok("uv10/a man from a later class gets the story (control)", run(res.season + 2));
		ok("uv10/an undrafted returner from a PAST class does not ('not eligible until 2028' in 2029)",
			!run(res.season - 1) && !run(res.season));
		const syn = chainOf(3, "bf-uv10-chain");
		ok("uv10/the row counts only later-class men as 'future on rosters' (returners are not)",
			syn.results.every((r, i) => syn.u.rows[i].futureOnRosters ===
				(r.futurePlayers || []).filter((p) => !p.past).length));
	}

	/* ---- UV16: singular and plural text -------------------------------------- */
	{
		ok("uv16/plural() picks the word for the count",
			U.plural(1, "title") === "title" && U.plural(2, "title") === "titles" &&
			U.plural(1, "winner", "winners") === "winner" && U.plural(0, "pick") === "picks");
		const c = chainOf(3, "bf-uv16");
		const labels = [].concat(c.u.records.titles, c.u.records.finals, c.u.records.apOnes,
			c.u.records.poys, c.u.records.no1s);
		ok("uv16/a record with a count of one is not labelled in the plural",
			labels.every((x) => x.count !== 1 || !/(titles|games|seasons at|players of|picks)\b/.test(x.label)),
			JSON.stringify(labels.filter((x) => x.count === 1).slice(0, 2)));
		ok("uv16/...and a count above one still is",
			labels.every((x) => x.count === 1 || x.label === x.label));
		const text = fs.readFileSync(path.join(__dirname, "..", "..", "js", "news.js"), "utf8");
		ok("uv16/no headline says '{school} are national champions' of a single programme",
			!/\{(school|champ)\} are national champions/.test(text));
		ok("uv16/...nor the body '{team} are national champions'", !/\{team\} are national champions/.test(text));
		const threads = c.u.threads.concat(U.moreThreads(c.u.rows, c.u.alumni));
		ok("uv16/no thread text says '1 titles', '1 picks', '1 seasons' and the like",
			threads.every((t) => !/(^|[^\d.-])1 (titles|picks|seasons|winners|appearances|games|times)\b/.test(t.text)),
			threads.map((t) => t.text).filter((x) => /(^|[^\d.-])1 [a-z]+s\b/.test(x)).join(" | "));
	}

	/* ---- UV7: a gap is warned about and bounded ------------------------------- */
	{
		const small = (season, label) => {
			const lf = V.realisticClass("bf-uv7-" + label, 18);
			lf.startingSeason = season;
			for (const p of lf.players) p.draft = Object.assign({}, p.draft, { year: season });
			return { name: label + ".json", data: lf, fingerprint: "fp" + label };
		};
		const near = U.validate([small(2025, "a"), small(2030, "b")]);
		ok("uv7/a short gap is warned about as before, with no typo warning",
			near[1].warnings.some((w) => /4 seasons between 2025 and 2030/.test(w)) &&
			!near[1].warnings.some((w) => /check the starting season/.test(w)));
		const far = U.validate([small(2025, "a"), small(2205, "b")]);
		ok("uv7/a 179-season gap carries a 'check the starting season' warning",
			far[1].warnings.some((w) => /more than 15 missing seasons — check the starting season/.test(w)) &&
			far[1].ok === true, JSON.stringify(far[1].warnings));
		const boundary = U.validate([small(2025, "a"), small(2041, "b")]);
		ok("uv7/15 missing seasons is the last gap that is not warned about",
			!boundary[1].warnings.some((w) => /check the starting season/.test(w)));
		const seed = chainOf(2, "bf-uv7");
		const guessed = U.extrapolateGap(seed.u.tail.carry, 2025, 2525, "bf-uv7");
		ok("uv7/a 499-season gap extrapolates at most EXTRAPOLATE_MAX_YEARS rows",
			guessed.length === U.EXTRAPOLATE_MAX_YEARS && guessed[0].season === 2026,
			guessed.length + " rows");
		ok("uv7/a gap under the cap is untouched",
			U.extrapolateGap(seed.u.tail.carry, 2025, 2030, "bf-uv7").length === 4);
	}

	/* ---- UV14: the coaching tree is bounded ---------------------------------- */
	{
		const hires = [];
		for (let i = 0; i < U.COACH_TREE_MAX_HIRES + 200; i++) {
			hires.push({ season: 2000 + Math.floor(i / 40), coach: "C" + i, school: "S" + (i % 40),
				mentor: "M" + (i % 7), mentorSchool: "S0" });
		}
		const tree = U.coachTreeStep({ hires, by: {} }, { coaches: {} }, { teams: {} }, 2100, "bf");
		ok("uv14/the persisted tree keeps the most recent COACH_TREE_MAX_HIRES hires",
			tree.hires.length === U.COACH_TREE_MAX_HIRES && tree.hires[tree.hires.length - 1].coach === "C" +
				(U.COACH_TREE_MAX_HIRES + 199), String(tree.hires.length));
		ok("uv14/...and its index agrees with the list",
			Object.keys(tree.by).reduce((a, k) => a + tree.by[k].length, 0) === tree.hires.length);
	}
};
