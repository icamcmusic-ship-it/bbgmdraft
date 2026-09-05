/* Regression checks for the import / validate / export / merge routes.

   One check per bug that got out of here: a duplicate pid that killed the
   run, a missing schema version that sent BBGM down its pre-versioning
   migration path, a height map with the wrong span, numeric strings that
   exported as null, a year-ahead class dated to the wrong season, a merge
   that overwrote a league player's contract, a class file BBGM's draft
   import silently dropped, and physicals nobody range-checked. */
"use strict";

module.exports = function (ok, V) {
	const E = global.Engine;
	const C = global.Config;
	const BB = global.BBGM;
	const OPTS = {
		stats: true, prior: true, highs: true, awards: true,
		injuries: true, moodTraits: true, jerseys: true,
	};
	const run = (lf, seed) => E.run(lf, C.make({ seed: seed || "export-test" }));

	/* ---- height maps onto BBGM's own 66-93 span ------------------------ */
	{
		// heightToRating.ts: rating = 100 * (inches - 66) / (93 - 66).
		const exact = (r) => Math.round(66 + (r / 100) * 27);
		let worst = 0;
		for (let r = 0; r <= 100; r++) {
			worst = Math.max(worst, Math.abs(E.inchesFromHgtRating(r) - exact(r)));
		}
		ok("export/height matches BBGM's 66-93 map", worst === 0,
			"largest disagreement " + worst + " inches");
		ok("export/height 0 and 100 are BBGM's endpoints",
			E.inchesFromHgtRating(0) === 66 && E.inchesFromHgtRating(100) === 93,
			E.inchesFromHgtRating(0) + " / " + E.inchesFromHgtRating(100));
	}

	/* ---- the schema version is always written -------------------------- */
	{
		const lf = V.realisticClass("ver", 12);
		delete lf.version;
		const res = run(lf, "ver");
		const file = E.exportFile(res, OPTS);
		ok("export/stamps LEAGUE_DATABASE_VERSION when the source has none",
			file.version === BB.LEAGUE_DATABASE_VERSION,
			"got " + file.version);
		ok("export/players file carries the version too",
			E.exportPlayersFile(res, OPTS).version === BB.LEAGUE_DATABASE_VERSION);
		const lf2 = V.realisticClass("ver2", 8);
		lf2.version = 55;
		ok("export/an existing version is left alone",
			E.exportFile(run(lf2, "ver2"), OPTS).version === 55);
	}

	/* ---- a duplicate pid does not collapse the class ------------------- */
	{
		const lf = V.realisticClass("dup", 20);
		lf.players[7].pid = lf.players[3].pid;
		const check = E.validateLeagueFile(lf);
		ok("export/duplicate pid is warned about",
			check.warnings.some((w) => /pid/.test(w)), JSON.stringify(check.warnings));
		let res = null;
		let threw = null;
		try { res = run(lf, "dup"); } catch (e) { threw = e; }
		ok("export/a duplicate pid does not throw", !threw, threw && threw.message);
		if (res) {
			const keys = res.players.map((p) => p.key);
			ok("export/every player key is unique", new Set(keys).size === keys.length,
				keys.length - new Set(keys).size + " collisions");
			ok("export/the duplicate's SECOND row is the one that is renamed",
				keys[3] === String(lf.players[3].pid) && keys[7] !== keys[3],
				keys[3] + " / " + keys[7]);
			const file = E.exportFile(res, OPTS);
			ok("export/a duplicate-pid file still exports every row",
				file.players.length === lf.players.length);
			const built = res.players.filter((p) => p.newRatings);
			ok("export/the duplicated pids are built differently",
				built.length === lf.players.length &&
				JSON.stringify(res.players[3].newRatings) !==
					JSON.stringify(res.players[7].newRatings));
		}
	}
	{
		// A well-formed file keys exactly as it always did.
		const lf = V.realisticClass("stable", 10);
		const keys = lf.players.map((p, i) => E.playerKey(p, i, new Set()));
		ok("export/keys are unchanged for a well-formed file",
			keys.every((k, i) => k === String(lf.players[i].pid)), keys.slice(0, 3).join(","));
	}

	/* ---- numeric strings ----------------------------------------------- */
	{
		const lf = V.realisticClass("str", 10);
		const p = lf.players[0];
		p.hgt = String(p.hgt);
		p.weight = String(p.weight);
		p.born.year = String(p.born.year);
		p.draft.year = String(p.draft.year);
		const r = p.ratings[0];
		for (const k of BB.RATING_KEYS.concat(["season", "fuzz", "ovr", "pot"])) {
			if (r[k] !== undefined) r[k] = String(r[k]);
		}
		const out = E.exportFile(run(lf, "str"), OPTS).players[0];
		const last = out.ratings[out.ratings.length - 1];
		const numeric = BB.RATING_KEYS.concat(["ovr", "pot", "season"])
			.every((k) => typeof last[k] === "number" && Number.isFinite(last[k]));
		ok("export/string ratings export as finite numbers", numeric,
			JSON.stringify({ ovr: last.ovr, hgt: last.hgt }));
		ok("export/string hgt/weight/born export as numbers",
			typeof out.hgt === "number" && typeof out.weight === "number" &&
			typeof out.born.year === "number" && typeof out.draft.year === "number",
			typeof out.hgt + "/" + typeof out.weight + "/" + typeof out.born.year);
	}

	/* ---- implausible physicals ----------------------------------------- */
	{
		const lf = V.realisticClass("phys", 10);
		lf.players[0].hgt = -5;
		lf.players[1].hgt = 120;
		lf.players[2].weight = 0;
		lf.players[3].ratings[0].stre = 250;
		const check = E.validateLeagueFile(lf);
		ok("export/implausible physicals are warned about",
			check.warnings.some((w) => /outside the range/.test(w)),
			JSON.stringify(check.warnings));
		const out = E.exportFile(run(lf, "phys"), OPTS).players;
		ok("export/implausible physicals are clamped, not exported verbatim",
			out[0].hgt >= 58 && out[1].hgt <= 96 && out[2].weight >= 120,
			out[0].hgt + " / " + out[1].hgt + " / " + out[2].weight);
	}

	/* ---- a `name` field instead of firstName/lastName ------------------ */
	{
		const lf = V.realisticClass("name", 8);
		const p = lf.players[2];
		p.name = "Marcus Van Der Berg";
		delete p.firstName;
		delete p.lastName;
		const out = E.exportFile(run(lf, "name"), OPTS).players[2];
		ok("export/a single `name` field is split into first and last",
			out.firstName === "Marcus" && out.lastName === "Van Der Berg",
			out.firstName + " | " + out.lastName);
	}

	/* ---- everyone is an undrafted prospect ----------------------------- */
	{
		const lf = V.realisticClass("tid", 12);
		for (const p of lf.players) p.tid = 7;   // as if pulled out of a league
		const file = E.exportFile(run(lf, "tid"), OPTS);
		ok("export/the class file forces tid -2 (BBGM's draft import filter)",
			file.players.every((p) => p.tid === -2),
			file.players.filter((p) => p.tid !== -2).length + " rows are not -2");
	}

	/* ---- injury and birthplace ------------------------------------------ */
	{
		const lf = V.realisticClass("inj", 12);
		for (const p of lf.players) { delete p.injury; delete p.born.loc; }
		const file = E.exportFile(run(lf, "inj"), OPTS);
		ok("export/every player gets an injury object",
			file.players.every((p) => p.injury && p.injury.type === "Healthy" &&
				p.injury.gamesRemaining === 0));
		ok("export/born.loc is written when the source has none",
			file.players.every((p) => String(p.born.loc || "").trim()),
			file.players.filter((p) => !p.born.loc).length + " without one");
	}

	/* ---- a class a year ahead of its league ---------------------------- */
	{
		const lf = V.realisticClass("ahead", 40);
		lf.startingSeason = 2026;
		for (const p of lf.players) {
			p.draft.year = 2027;
			p.ratings[0].season = 2026;
		}
		const res = run(lf, "ahead");
		const file = E.exportFile(res, OPTS);
		const bad = [];
		for (const p of file.players) {
			const last = p.ratings[p.ratings.length - 1];
			if (Number(last.season) !== 2027) bad.push("ratings " + last.season);
			for (const a of p.awards || []) {
				if (Number(a.season) > 2027 || Number(a.season) < 2022) bad.push("award " + a.season);
			}
			for (const r of p.stats || []) {
				if (Number(r.season) > 2027) bad.push("stats " + r.season);
			}
		}
		ok("export/a year-ahead class is dated to its own draft year",
			bad.length === 0, bad.slice(0, 4).join("; "));
		const withStats = file.players.filter((p) => (p.stats || []).length);
		ok("export/the final college season is the draft year",
			withStats.length > 0 && withStats.every((p) =>
				Math.max.apply(null, p.stats.map((r) => Number(r.season))) === 2027),
			withStats.length + " players with stats");
		const ages = file.players.map((p) => 2027 - Number(p.born.year));
		ok("export/born.year is measured from the draft year",
			ages.every((a) => a >= 17 && a <= 26),
			"ages " + Math.min.apply(null, ages) + "-" + Math.max.apply(null, ages));
	}

	/* ---- the league merge overlays, it does not overwrite --------------- */
	{
		const lf = V.realisticClass("merge", 20);
		for (const p of lf.players) p.draft.year = 2026;
		const res = run(lf, "merge");
		const league = {
			version: BB.LEAGUE_DATABASE_VERSION,
			startingSeason: 2026,
			gameAttributes: { season: 2026 },
			players: lf.players.map((p) => {
				const q = JSON.parse(JSON.stringify(p));
				q.tid = -2;
				q.contract = { amount: 1500, exp: 2030 };
				q.value = 48;
				q.valueFuzz = 47;
				q.relatives = [{ type: "brother", pid: 999 }];
				q.hgt = 79;
				q.weight = 222;
				q.born = { year: 2006, loc: "Chicago, USA" };
				q.injury = { type: "Sprained ankle", gamesRemaining: 5 };
				q.face = { head: { id: "h" } };
				q.awards = [{ season: 2015, type: "Old thing" }];
				return q;
			}),
		};
		const merged = E.mergeIntoLeague(res, league, OPTS);
		const p = merged.file.players[0];
		ok("merge/every league player survives",
			merged.file.players.length === league.players.length);
		ok("merge/replaces rather than appends", merged.replaced === 20 && merged.added === 0,
			merged.replaced + " replaced, " + merged.added + " added");
		ok("merge/the league's contract is not overwritten",
			p.contract && p.contract.amount === 1500, JSON.stringify(p.contract));
		ok("merge/the league's value / relatives / face survive",
			p.value === 48 && p.valueFuzz === 47 && p.relatives && p.face &&
			p.face.head.id === "h");
		ok("merge/the league's own size and birth year survive",
			p.hgt === 79 && p.weight === 222 && p.born.year === 2006 &&
			p.born.loc === "Chicago, USA",
			p.hgt + "/" + p.weight + "/" + p.born.year);
		ok("merge/the league's injury is not overwritten by the class file",
			p.injury && p.injury.type === "Sprained ankle", JSON.stringify(p.injury));
		ok("merge/what the tool DOES produce is written",
			typeof p.college === "string" && p.college.length > 0 &&
			p.draft && Number.isFinite(p.draft.ovr) &&
			(p.awards || []).some((a) => Number(a.season) === 2026),
			p.college + " ovr " + (p.draft && p.draft.ovr));
		ok("merge/an old honor outside the tool's window is kept",
			(p.awards || []).some((a) => Number(a.season) === 2015));
		ok("merge/exactly one ratings row for the class season",
			p.ratings.filter((r) => Number(r.season) === 2026).length === 1,
			p.ratings.map((r) => r.season).join(","));
	}

	/* ---- the college table -------------------------------------------- */
	{
		const CO = global.Colleges;
		ok("colleges/UC Davis is in the Mountain West",
			CO.conferenceOf("UC Davis") === "Mountain West", CO.conferenceOf("UC Davis"));
		ok("colleges/Louisiana Tech is in the Sun Belt",
			CO.conferenceOf("Louisiana Tech") === "Sun Belt", CO.conferenceOf("Louisiana Tech"));
		ok("colleges/New Haven is in the table", !!CO.COLLEGES["New Haven"]);
		ok("colleges/St. Francis (PA) has left Division I", !CO.COLLEGES["St. Francis (PA)"]);
		const aliasPairs = [["Dixie State", "Utah Tech"], ["UMKC", "Kansas City"],
			["IPFW", "Purdue Fort Wayne"], ["College of Charleston", "Charleston"],
			["Central Florida", "UCF"], ["Southern Mississippi", "Southern Miss"],
			["Miami", "Miami (FL)"], ["UConn", "Connecticut"],
			["Mississippi", "Ole Miss"], ["Penn", "Pennsylvania"]];
		const wrong = aliasPairs.filter(([from, to]) =>
			CO.canonical(from) !== to || !CO.COLLEGES[to]);
		ok("colleges/the reverse aliases all resolve to a real program",
			wrong.length === 0, JSON.stringify(wrong));
		const abbrevs = [["Illinois-Chicago", "UIC"], ["Miami (OH)", "M-OH"],
			["IU Indianapolis", "IUI"], ["West Georgia", "UWG"],
			["Grand Canyon", "GCU"], ["Texas A&M-CC", "TAMUCC"], ["St. Peter's", "SPU"]];
		const badAb = abbrevs.filter(([n, a]) => CO.abbrev(n) !== a);
		ok("colleges/the hand-named abbreviations are the real ones",
			badAb.length === 0, JSON.stringify(badAb.map(([n]) => n + "=" + CO.abbrev(n))));
		const seen = {};
		const dup = [];
		for (const name of Object.keys(CO.COLLEGES)) {
			const a = CO.abbrev(name);
			if (seen[a]) dup.push(a + ": " + name + " / " + seen[a]);
			seen[a] = name;
		}
		ok("colleges/no two programs share an abbreviation", dup.length === 0,
			dup.slice(0, 3).join("; "));
		// One club, one name — in its own league and in every continental one.
		const clubDup = [];
		for (const lg of Object.keys(CO.PRO_CLUBS)) {
			const names = CO.PRO_CLUBS[lg].map((c) => c[0]);
			if (new Set(names).size !== names.length) clubDup.push(lg);
		}
		ok("colleges/no league lists the same club twice", clubDup.length === 0,
			clubDup.join(", "));
		const alt = [["Trento", "Dolomiti Energia Trento"], ["Aris", "Aris Midea"],
			["Cholet", "Cholet Basket"], ["Tenerife", "La Laguna Tenerife"],
			["Wolves Vilnius", "Wolves Twinsbet"], ["Hamburg Towers", "Veolia Towers Hamburg"]];
		const stale = [];
		for (const lg of Object.keys(CO.PRO_CLUBS)) {
			for (const [c] of CO.PRO_CLUBS[lg]) {
				if (alt.some(([bad]) => c === bad)) stale.push(lg + ": " + c);
			}
		}
		ok("colleges/a club has the same name in every competition",
			stale.length === 0, stale.join("; "));
		ok("colleges/a British birthplace reads as European",
			CO.region("London, United Kingdom") === "europe",
			CO.region("London, United Kingdom"));
		for (const list of ["EURO_HINTS", "LATAM_HINTS"]) {
			const arr = CO[list];
			if (!arr) continue;
			ok("colleges/" + list + " has no duplicated entry",
				new Set(arr).size === arr.length,
				arr.length - new Set(arr).size + " duplicates");
		}
	}

	/* ---- the international preset names every league -------------------- */
	{
		const preset = C.PRESETS && C.PRESETS["International class"];
		if (preset) {
			const built = C.defaultLeagueWeights();
			const missing = Object.keys(built)
				.filter((k) => preset.leagueWeights[k] === undefined);
			ok("config/the International class preset names every league",
				missing.length === 0, missing.join(", "));
		}
	}

	/* ---- the name pools ------------------------------------------------ */
	{
		const T = global.TeamsSim;
		if (T && T.PLAYER_FIRST) {
			ok("teams/the filler name pools are big enough to not repeat visibly",
				T.PLAYER_FIRST.length >= 120 && T.PLAYER_LAST.length >= 120,
				T.PLAYER_FIRST.length + " x " + T.PLAYER_LAST.length);
			for (const key of ["PLAYER_FIRST", "PLAYER_LAST", "COACH_FIRST", "COACH_LAST"]) {
				const arr = T[key];
				if (!arr) continue;
				ok("teams/" + key + " has no duplicate", new Set(arr).size === arr.length,
					arr.length - new Set(arr).size + " duplicates");
			}
		}
	}
};
