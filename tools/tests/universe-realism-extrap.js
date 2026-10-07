/* Universe model realism, extrapolated seasons (audit 2026-10-05, section 5):

   UV5  a guessed year past the first used to have no player of the year, no
        All-Americans, no No. 1 pick, a Final Four of two teams, no coach
        changes and no realignment. Every guessed year now has all of them,
        the men the carry cannot name are invented (deterministically, with
        names that never repeat) and every invented man stays flagged so the
        records, the threads and the Hall keep ignoring him.
   UV6  guessed champions were flatter than simulated ones (23 different
        champions in 30 years, nobody above two titles, a median champion
        ranked 28th by level). The guessed draw is calibrated to the
        simulated seasons and this file re-measures that against a fresh
        simulated world; a program can no longer show more titles than title
        games.

   The simulated reference is built here (three 12-season synthetic worlds)
   rather than hard-coded, so a later change to the season model that moves
   the simulated concentration moves the reference with it and the guessed
   years are held to it. Nothing here pins a golden hash. */
"use strict";

module.exports = function (ok, V) {
	const E = global.Engine;
	const CFG = global.Config;
	const U = global.Universe;

	/* A synthetic chain over `seasons`, driven the way js/app.js drives it.
	   `results[i]` is kept so the simulated seasons can be measured. */
	const chainOf = (seed, seasons, over) => {
		over = over || {};
		const files = seasons.map((s) => U.synthFile(seed, s));
		const runners = files.map((f) => E.createRunner(f.data));
		const results = [];
		const c = U.beginChain({
			mode: "cold", files,
			runnable: files.map((f, i) => ({ index: i, name: f.name, season: f.data.startingSeason })),
			settings: CFG.make({ seed }), baseSeed: seed, make: (s) => CFG.make(s),
			runnerFor: (i) => runners[i],
			dataChanged: (i) => { runners[i] = E.createRunner(files[i].data); },
			extrapolateGaps: over.gaps !== false, store: (i, r) => { results[i] = r; },
		});
		for (let k = 0; k < c.runnable.length; k++) c.step(k);
		const fin = c.finish({ extrapolateYears: over.years || 0 });
		return { u: c.universe, results, files, fin };
	};
	const run = (n, first) => { const a = []; for (let i = 0; i < n; i++) a.push(first + i); return a; };
	const guessedOf = (u) => u.rows.filter((r) => r && r.extrapolated);
	const playedOf = (u) => u.rows.filter((r) => r && !r.extrapolated && !r.error);
	const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
	const median = (a) => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[b.length >> 1] : 0; };
	/* Concentration of a list of champions: how many different programs and
	   how much of the run the top three share. */
	const concentration = (champs) => {
		const t = {};
		for (const c of champs) t[c] = (t[c] || 0) + 1;
		const counts = Object.keys(t).map((k) => t[k]).sort((a, b) => b - a);
		return { distinct: counts.length, max: counts[0] || 0,
			top3: ((counts[0] || 0) + (counts[1] || 0) + (counts[2] || 0)) / Math.max(1, champs.length) };
	};

	/* ---- UV5: a guessed year has everything a played one has ---------------- */
	const X = chainOf("ex-uv5", run(3, 2030), { years: 12 });
	const guessed = guessedOf(X.u);
	const mensNames = (r) => [r.poy.name, r.no1.name].concat(r.allAmerica.map((a) => a.name));
	{
		ok("uv5/twelve guessed years follow three real files", guessed.length === 12 &&
			guessed.every((r, i) => r.season === 2033 + i) && playedOf(X.u).length === 3);
		ok("uv5/every guessed year has a player of the year, a No. 1 pick and a poll No. 1",
			guessed.every((r) => r.poy && r.poy.name && r.poy.school && r.no1 && r.no1.name &&
				r.no1.school && r.apOne));
		ok("uv5/every guessed year has five distinct All-Americans (the old rows had 0 after the first)",
			guessed.every((r) => r.allAmerica.length === 5 &&
				new Set(r.allAmerica.map((a) => a.name)).size === 5 &&
				r.allAmerica.every((a) => a.school && a.name !== r.poy.name)));
		ok("uv5/every guessed Final Four is four different teams, champion and runner-up among them",
			guessed.every((r) => r.finalFour.length === 4 && new Set(r.finalFour).size === 4 &&
				r.finalFour.indexOf(r.champion) !== -1 && r.finalFour.indexOf(r.runnerUp) !== -1 &&
				r.champion !== r.runnerUp));
		ok("uv5/the awards list matches: one player of the year, five All-Americans, a champion",
			guessed.every((r) => r.awards.filter((a) => /Player of the Year/.test(a.award)).length === 1 &&
				r.awards.filter((a) => /All-American/.test(a.award)).length === 5 &&
				r.awards.some((a) => a.award === "National Champion") &&
				r.awards.every((a) => a.extrapolated === true)));
		ok("uv5/every guessed year has coach changes, split into reasons that add up",
			guessed.every((r) => r.coachChanges > 0 &&
				r.coachFired + r.coachRetired + r.coachHiredAway <= r.coachChanges));
		ok("uv5/the carousel is the simulated size (30-70 jobs a year, not 0)",
			mean(guessed.map((r) => r.coachChanges)) >= 30 && mean(guessed.map((r) => r.coachChanges)) <= 70,
			"mean " + mean(guessed.map((r) => r.coachChanges)));
		ok("uv5/the conference fields are filled in for the champion and the stars",
			guessed.every((r) => r.champConf && r.runnerUpConf && r.poyConf && r.no1Conf));
		const names = [].concat(...guessed.map(mensNames));
		ok("uv5/no guessed man shares a name with another (" + names.length + " men)",
			new Set(names).size === names.length);
		const played = new Set();
		for (const res of X.results) for (const p of res.players || []) played.add(p.name);
		ok("uv5/...or with a man in a played class", names.every((n) => !played.has(n)));
		const all = new Set();
		for (const f of X.files) for (const p of f.data.players) all.add(p.firstName + " " + p.lastName);
		ok("uv5/...or with a man in any synthetic class file of the chain",
			names.every((n) => !all.has(n)));
	}

	/* ---- the contract: an invented man is never a real one ------------------ */
	{
		const inv = [];
		for (const r of guessed) {
			for (const m of [r.poy, r.no1].concat(r.allAmerica)) if (m.invented) inv.push(m.name);
		}
		const names = new Set(inv);
		ok("contract/most guessed men are invented, and flagged on the row (" + inv.length + ")",
			inv.length >= 12 * 6 - 12);
		ok("contract/no No. 1 pick is a carried returner (a prospect has no past)",
			guessed.every((r) => r.no1.invented === true));
		const carryNames = new Set();
		const tailCarry = X.u.tail.carry || {};
		for (const school of Object.keys(tailCarry.returners || {})) {
			for (const p of tailCarry.returners[school]) carryNames.add(p.name);
		}
		ok("contract/a man who is not flagged invented is one the carry named; one who is flagged is not",
			guessed.every((r) => [r.poy].concat(r.allAmerica).every((m) =>
				m.invented === true ? !carryNames.has(m.name) : carryNames.has(m.name))));
		const reg = new Set(Object.keys(X.u.registry || {}).map((id) => X.u.registry[id].name));
		ok("contract/an invented man has no registry entry and no career page",
			inv.every((n) => !reg.has(n)));
		const alumni = U.extrapolatedAlumni(guessed);
		ok("contract/the guessed alumni are all flagged and keyed apart from any pid",
			alumni.length === guessed.length &&
			alumni.every((a) => a.extrapolated === true && /^extrap:/.test(a.id) && a.key === a.id));
		const rec = U.records(X.u.rows, X.u.alumni, X.u.registry);
		const playedRec = U.records(playedOf(X.u), X.u.alumni.filter((a) => !a.extrapolated), X.u.registry);
		const j = (x) => JSON.stringify(x);
		ok("contract/players of the year, No. 1 picks, AP No. 1s and the AP run ignore guessed years",
			j(rec.poys) === j(playedRec.poys) && j(rec.no1s) === j(playedRec.no1s) &&
			j(rec.apOnes) === j(playedRec.apOnes) && j(rec.longestApRun) === j(playedRec.longestApRun) &&
			j(rec.bestSeason) === j(playedRec.bestSeason));
		ok("contract/the Hall of Fame and the players of the decade hold no invented man",
			rec.hall.every((m) => !/^extrap:/.test(m.id) && !names.has(m.name)) &&
			rec.playersOfTheDecade.every((d) => !names.has(d.player.name)));
		const threads = U.threads(X.u.rows, X.u.alumni, { registry: X.u.registry });
		ok("contract/no thread names an invented man",
			threads.every((t) => ![...names].some((n) => String(t.text).indexOf(n) !== -1)));
		ok("contract/a thread about titles still counts played seasons only",
			threads.filter((t) => t.kind === "titles").every((t) =>
				t.seasons.every((s) => s <= 2032)));
		ok("contract/the extrapolated thread says how many seasons were guessed",
			threads.some((t) => t.kind === "extrapolated" && t.count === 12));
	}

	/* ---- a gap in the files, with a played season after it ------------------ */
	{
		const files = [2030, 2031, 2037].map((s) => U.synthFile("ex-gap", s));
		const runners = files.map((f) => E.createRunner(f.data));
		const c = U.beginChain({
			mode: "cold", files,
			runnable: files.map((f, i) => ({ index: i, name: f.name, season: f.data.startingSeason })),
			settings: CFG.make({ seed: "ex-gap" }), baseSeed: "ex-gap", make: (s) => CFG.make(s),
			runnerFor: (i) => runners[i],
			dataChanged: (i) => { runners[i] = E.createRunner(files[i].data); },
			extrapolateGaps: true, store: () => {},
		});
		for (let k = 0; k < c.runnable.length; k++) c.step(k);
		c.finish({});
		const g = guessedOf(c.universe);
		ok("uv5/a five-year gap gives five full rows (not a champion, a runner-up and a poll)",
			g.length === 5 && g.every((r) => r.poy && r.no1 && r.allAmerica.length === 5 &&
				r.finalFour.length === 4 && r.coachChanges > 0));
		ok("uv5/...in season order between the played seasons",
			c.universe.rows.map((r) => r.season).join() === "2030,2031,2032,2033,2034,2035,2036,2037");
	}

	/* ---- more years than the first one: 30 guessed seasons ------------------ */
	const tail = X.u.tail.carry;
	const settings = X.u.settings;
	const gap30 = U.extrapolateGap(tail, 2032, 2032 + 31, "ex-30", { settings });
	{
		ok("uv5/thirty guessed years are all full rows",
			gap30.length === 30 && gap30.every((r) => r.poy && r.no1 && r.allAmerica.length === 5 &&
				r.finalFour.length === 4 && r.coachChanges > 0 && r.apOne && r.runnerUp));
		ok("uv5/realignment happens in the guessed years (a move in a third to two thirds of them)",
			(() => {
				const withMove = gap30.filter((r) => r.realignment.length).length;
				return withMove >= 6 && withMove <= 24;
			})(), gap30.filter((r) => r.realignment.length).length + " of 30");
		ok("uv5/a realignment line has the played rows' own shape (\"school → conference\")",
			gap30.filter((r) => r.realignment.length).every((r) =>
				r.realignment.every((m) => / → /.test(m))));
		const none = U.extrapolateGap(tail, 2032, 2032 + 21, "ex-30", {
			settings: Object.assign({}, settings, { realignmentRate: 0, coachTurnover: 0 }) });
		ok("uv5/the chain's own settings apply: no realignment and no turnover when both are off",
			none.every((r) => r.realignment.length === 0 && r.coachChanges === 0));
		ok("uv5/guessed names stay unique over thirty years",
			(() => {
				const names = [].concat(...gap30.map(mensNames));
				return new Set(names).size === names.length;
			})());
		ok("uv5/the guessed Final Four is not just the favourites: over thirty years 20+ different programs reach it",
			new Set([].concat(...gap30.map((r) => r.finalFour))).size >= 20);
		const again = U.extrapolateGap(tail, 2032, 2032 + 31, "ex-30", { settings });
		ok("uv5/determinism: the same carry and seed give the same thirty years",
			JSON.stringify(again) === JSON.stringify(gap30));
		const other = U.extrapolateGap(tail, 2032, 2032 + 31, "ex-31", { settings });
		ok("uv5/...and another seed gives different ones",
			JSON.stringify(other.map((r) => r.champion)) !== JSON.stringify(gap30.map((r) => r.champion)));
	}

	/* ---- UV6: records never show more titles than title games --------------- */
	{
		const rows = X.u.rows.concat(gap30.filter((r) => r.season > 2044));
		const rec = U.records(rows, X.u.alumni, null);
		const finalsOf = {};
		const titlesOf = {};
		for (const r of rows) {
			if (!r || r.error) continue;
			if (r.champion) { titlesOf[r.champion] = (titlesOf[r.champion] || 0) + 1; }
			for (const n of [r.champion, r.runnerUp]) if (n) finalsOf[n] = (finalsOf[n] || 0) + 1;
		}
		ok("uv6/every program has at least as many title games as titles (from the rows)",
			Object.keys(titlesOf).every((n) => (finalsOf[n] || 0) >= titlesOf[n]));
		const lastFinal = rec.finals.length ? rec.finals[rec.finals.length - 1].count : 0;
		ok("uv6/...and in the records book: every title leader is in title games with as many",
			rec.titles.every((t) => {
				const f = rec.finals.find((x) => x.team === t.team);
				return f ? f.count >= t.count : lastFinal >= t.count;
			}));
		ok("uv6/the guessed title games are flagged apart, like the guessed titles",
			rec.finals.some((x) => x.extrapolated > 0) && rec.titles.some((x) => x.extrapolated > 0) &&
			rec.finals.every((x) => x.extrapolated <= x.count));
		const big = U.records(X.u.rows.concat(gap30), X.u.alumni, null);
		ok("uv6/...and over thirty guessed years too",
			big.titles.every((t) => {
				const f = big.finals.find((x) => x.team === t.team);
				return f ? f.count >= t.count : big.finals[big.finals.length - 1].count >= t.count;
			}));
		ok("uv6/creditGuess still stamps the banner count on every guessed champion",
			gap30.every((r) => Number.isFinite(r.titlesAfter) && r.titlesAfter >= 1));
	}

	/* ---- UV6: guessed champions are as concentrated as simulated ones -------- */
	{
		/* The simulated reference: three 12-season worlds. Rank is by the
		   season's own level (res.teams[].level), pooled over seasons and
		   seeds. The guessed side reads the guessed world's own levels the
		   same way (onYear), from each simulated world's own tail, over eight
		   draws of the guessed seed so its estimate is tight. */
		const seeds = (process.env.UV_EXTRAP_SEEDS || "ex-a,ex-b,ex-c").split(",");
		const sim = { champs: [], ranks: [], per: [] };
		const gs = { ranks: [], per: [] };
		const tails = [];
		for (const seed of seeds) {
			const w = chainOf(seed, run(12, 2030));
			const champs = [];
			w.u.rows.forEach((r, i) => {
				champs.push(r.champion);
				sim.champs.push(r.champion);
				const teams = Object.values(w.results[i].teams).map((t) => t.level).sort((a, b) => b - a);
				sim.ranks.push(teams.indexOf(w.results[i].teams[r.champion].level) + 1);
			});
			sim.per.push(concentration(champs));
			tails.push({ carry: w.u.tail.carry, settings: w.u.settings });
			for (let rep = 0; rep < 8; rep++) {
				const champs2 = [];
				U.extrapolateGap(w.u.tail.carry, 2041, 2041 + 13, seed + "-g" + rep, {
					settings: w.u.settings,
					onYear: (world, row) => {
						if (!row) return;
						const lv = world.levels;
						const order = Object.keys(lv).sort((a, b) => lv[b] - lv[a] || (a < b ? -1 : 1));
						gs.ranks.push(order.indexOf(row.champion) + 1);
						champs2.push(row.champion);
					},
				});
				gs.per.push(concentration(champs2));
			}
		}
		const simDistinct = mean(sim.per.map((p) => p.distinct));
		const guessDistinct = mean(gs.per.map((p) => p.distinct));
		const simTop3 = mean(sim.per.map((p) => p.top3));
		const guessTop3 = mean(gs.per.map((p) => p.top3));
		const simMax = mean(sim.per.map((p) => p.max));
		const guessMax = mean(gs.per.map((p) => p.max));
		const simRank = median(sim.ranks);
		const guessRank = median(gs.ranks);
		if (process.env.UV_EXTRAP_VERBOSE) {
			console.log("   sim   distinct " + simDistinct.toFixed(2) + " max " + simMax.toFixed(2) +
				" top3 " + simTop3.toFixed(2) + " median rank " + simRank);
			console.log("   guess distinct " + guessDistinct.toFixed(2) + " max " + guessMax.toFixed(2) +
				" top3 " + guessTop3.toFixed(2) + " median rank " + guessRank);
		}
		/* THE WINDOWS. Thirty-six simulated seasons are a noisy reference: over
		   twelve seeds the mean number of different champions in 12 seasons
		   ran 8.0-10.7 and the top-three share 0.36-0.58, so those two and the
		   most titles one program won are held to about 2.5 standard errors
		   (the guessed side is averaged over 24 draws and is tight). The
		   champion's rank in the level order is the sharp one: the old guess
		   put the median champion 28th where the simulated seasons put him
		   9th-16th. */
		ok("uv6/guessed years have as many different champions as simulated ones (" +
			guessDistinct.toFixed(1) + " against " + simDistinct.toFixed(1) + " in 12)",
			Math.abs(guessDistinct - simDistinct) <= 2.8);
		ok("uv6/...and the top three programs take as large a share of the titles (" +
			guessTop3.toFixed(2) + " against " + simTop3.toFixed(2) + ")",
			Math.abs(guessTop3 - simTop3) <= 0.22);
		ok("uv6/...and the most titles one program wins is as large (" +
			guessMax.toFixed(1) + " against " + simMax.toFixed(1) + ")",
			Math.abs(guessMax - simMax) <= 1.6);
		/* The rank checks are one-sided: the guess must not be FLATTER than the
		   simulated seasons (the old guess put the median champion 28th). It
		   may sit higher in the level order than they do, because the guessed
		   odds weigh a program's prestige as well as the season's level (a
		   blue blood recruits like one in a down year; see GUESS_ODDS) and the
		   simulated champion's rank is measured in a noisier level (the
		   coached level of the season). */
		ok("uv6/...and the champion sits as high in the level order (median rank " +
			guessRank + " against " + simRank + "; the old guess was 28)",
			guessRank <= simRank + 6 && guessRank <= 16 && guessRank >= 2);
		ok("uv6/the guessed champion is a top-ten level program at least about as often as a simulated one is",
			(() => {
				const f = (a) => a.filter((r) => r <= 10).length / Math.max(1, a.length);
				return f(gs.ranks) >= f(sim.ranks) - 0.2;
			})());
		/* THIRTY YEARS, which is where the old model was flattest: 23 different
		   champions and nobody above two titles. Simulated 30-season worlds
		   (measured offline: four seeds) gave 15-19 different champions and
		   one program with 6-7 titles. Averaged over eighteen guessed runs
		   the bounds are clear of the old values and of the simulated ones (a
		   twelve-season tail runs flatter than a twenty-season one: 20 against
		   17 different champions). */
		const long = { distinct: [], max: [] };
		for (const tl of tails) {
			for (let rep = 0; rep < 6; rep++) {
				const lc = concentration(U.extrapolateGap(tl.carry, 2041, 2041 + 31, "long" + rep,
					{ settings: tl.settings }).map((r) => r.champion));
				long.distinct.push(lc.distinct);
				long.max.push(lc.max);
			}
		}
		ok("uv6/thirty guessed years have fewer than 22 different champions (the old model gave 23; mean " +
			mean(long.distinct).toFixed(1) + ")", mean(long.distinct) <= 22 && mean(long.distinct) >= 12);
		ok("uv6/...and a dynasty is possible: the most titles one program wins averages over 3.6 (the old model: 2; mean " +
			mean(long.max).toFixed(1) + ")", mean(long.max) >= 3.6 && mean(long.max) <= 12);
		ok("uv6/...in every run some program wins at least three",
			long.max.every((m) => m >= 3));
		ok("uv6/twelve guessed years: a program wins three or more in a fifth of draws or more (the claim creditGuess makes)",
			(() => {
				const f = gs.per.filter((p) => p.max >= 3).length / gs.per.length;
				return f >= 0.2;
			})());
	}

	/* ---- the simulated seasons did not move --------------------------------- */
	{
		/* Extrapolation reads the carry and feeds nothing back: the played
		   rows of a chain are the same with the guessed years switched on or
		   off, and the same on every run. The fingerprint of each played
		   season (champion, player of the year, the board, the carousel
		   size) is what a stored export compares against. */
		const a = chainOf("ex-fp", run(3, 2030), { gaps: false });
		const b = chainOf("ex-fp", run(3, 2030), { gaps: true, years: 12 });
		const c = chainOf("ex-fp", run(3, 2030), { gaps: true, years: 12 });
		const sig = (u) => playedOf(u).map((r) => [r.season, r.champion, r.runnerUp, r.poy && r.poy.name,
			r.no1 && r.no1.name, r.apOne, r.result, r.coachChanges, r.realignment.join(";")].join("|"));
		ok("fingerprints/a chain with no gap has the same per-season result fingerprints with the guessed years on or off",
			sig(a.u).join("\n") === sig(b.u).join("\n"));
		ok("fingerprints/...every one of them present", playedOf(a.u).every((r) => /^[0-9a-f]{8}$/.test(r.result)));
		ok("fingerprints/a chain with no guessed year has no extrapolated row",
			guessedOf(a.u).length === 0);
		ok("determinism/the same chain twice gives the same world, guessed rows included",
			JSON.stringify(b.u.rows) === JSON.stringify(c.u.rows) &&
			JSON.stringify(b.u.alumni) === JSON.stringify(c.u.alumni));
		const gapOn = chainOf("ex-fp2", [2030, 2031, 2034], { gaps: true });
		const gapOff = chainOf("ex-fp2", [2030, 2031, 2034], { gaps: false });
		ok("fingerprints/across a gap the played seasons keep their fingerprints too (nothing is fed back)",
			sig(gapOn.u).join("\n") === sig(gapOff.u).join("\n"));
	}
};
