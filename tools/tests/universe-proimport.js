/* Universe pro history (audit 2026-10-10, section 7): UV12 — a BBGM league's
   last four drafted classes brought into the universe as played history with
   their real draft order and pro careers — plus the quick wins UV2 (POY from a
   later class), UV4 (name epoch), UV9 (honor weights), UV11 (program alumni)
   and UV13 (per-year recipes). The league is built here, from nothing. */
"use strict";

module.exports = function (ok, V) {
	const E = global.Engine;
	const CFG = global.Config;
	const U = global.Universe;

	const SCHOOLS = ["Duke", "Kentucky", "Kansas", "Gonzaga", "Villanova", "Arizona",
		"Michigan State", "North Carolina", "UCLA", "Baylor"];
	const SEASON = 2026;
	const TEAMS = 30;

	/* A league in its 2026 regular season: 30 teams, four drafted classes
	   (2022-25: 40 drafted, 4 undrafted-and-signed each), and a 2026 class of
	   prospects still to come. */
	function makeLeague() {
		const teams = [];
		for (let t = 0; t < TEAMS; t++) teams.push({ tid: t, abbrev: "T" + t, region: "City" + t, name: "Team" + t });
		const players = [];
		let pid = 0;
		for (let year = SEASON - 4; year < SEASON; year++) {
			const tpl = V.realisticClass("pro" + year, 44).players;
			tpl.forEach((src, i) => {
				const drafted = i < 40;
				const round = drafted ? (i < TEAMS ? 1 : 2) : 0;
				const pick = drafted ? (i < TEAMS ? i + 1 : i - TEAMS + 1) : 0;
				const base = src.ratings[0];
				const ratingRows = [];
				for (let s = year - 1; s <= SEASON; s++) {
					ratingRows.push(Object.assign({}, base, { season: s,
						ovr: base.ovr + (s - year) * 2, pot: base.pot }));
				}
				const stats = [];
				for (let s = year + 1; s <= SEASON - 1; s++) {
					stats.push({ season: s, tid: i % TEAMS, playoffs: false, gp: 60, pts: 60 * (5 + (i % 7)) });
					stats.push({ season: s, tid: i % TEAMS, playoffs: true, gp: 5, pts: 50 });
				}
				const awards = [];
				if (i === 0 && year < SEASON - 2) awards.push({ season: year + 1, type: "All-Star" });
				players.push({
					pid: pid++, firstName: "Pro" + year, lastName: "Man" + i,
					born: { year: year - 19 - (i % 4), loc: "USA" },
					hgt: src.hgt, weight: src.weight,
					college: drafted ? SCHOOLS[i % SCHOOLS.length] : "Nowhere Tech",
					tid: i % 11 === 10 ? -3 : drafted ? i % TEAMS : -1,
					draft: { year, round, pick, tid: drafted ? (pick - 1) % TEAMS : -1,
						originalTid: drafted ? (pick - 1) % TEAMS : -1 },
					ratings: ratingRows, stats, awards,
					contract: { amount: 1000, exp: SEASON + 1 },
				});
			});
		}
		for (const src of V.realisticClass("future", 30).players) {
			players.push(Object.assign({}, src, { pid: pid++, tid: -2,
				draft: { year: SEASON, round: 0, pick: 0, tid: -1, originalTid: -1 },
				ratings: src.ratings.map((r) => Object.assign({}, r, { season: SEASON })) }));
		}
		return {
			version: 60, startingSeason: 2015, meta: { name: "Proimport Test League" },
			gameAttributes: { season: SEASON, phase: 1, numDraftPicksPerRound: TEAMS, lid: 7 },
			teams, players,
		};
	}

	const league = makeLeague();

	/* --- detection ------------------------------------------------------ */
	const past = E.pastClassesIn(league);
	ok("uv12/pastClassesIn finds the last four drafted classes",
		past.map((c) => c.year).join() === "2022,2023,2024,2025", JSON.stringify(past));
	ok("uv12/...counting drafted and undrafted-signed men apart",
		past.every((c) => c.drafted === 40 && c.undrafted === 4 && c.ours === false), JSON.stringify(past[0]));
	ok("uv12/draftClassesIn still sees only the class to come",
		E.draftClassesIn(league).map((c) => c.year).join() === "2026");
	{
		const after = JSON.parse(JSON.stringify(league));
		after.gameAttributes.phase = 5;
		ok("uv12/once this season's draft is held, the window ends at it",
			E.pastClassesIn(after).map((c) => c.year)[0] === 2023);
		ok("uv12/a plain class file has no pro history",
			E.pastClassesIn(V.realisticClass(1, 30)).length === 0);
	}

	/* --- extraction ----------------------------------------------------- */
	const cls = past.map((c) => E.extractPastClass(league, c.year));
	{
		const c0 = cls[0];
		const pp = E.pastProOf(c0);
		const man = c0.players[0];
		const src = league.players.filter((p) => p.pid === man.pid)[0];
		ok("uv12/an extracted man is a prospect again (tid -2, undrafted row)",
			c0.players.every((p) => p.tid === -2 && p.draft.round === 0));
		ok("uv12/...on his ratings as of draft night",
			man.ratings.length === 1 && man.ratings[0].ovr ===
				src.ratings.filter((r) => r.season === 2022)[0].ovr);
		ok("uv12/...with his pro stats stripped",
			c0.players.every((p) => !(p.stats || []).some((s) => s.tid >= 0)));
		ok("uv12/the real draft order rides beside the class",
			pp && pp.truth[String(man.pid)].slot === 1 &&
			pp.truth[String(c0.players[35].pid)].slot === 36 &&
			pp.truth[String(c0.players[41].pid)].slot === null);
		ok("uv12/...with his real school and a class year from his age",
			pp.bio[String(man.pid)].college === "Duke" &&
			pp.bio[String(man.pid)].classYear === "Freshman");
		const car = pp.careers[String(man.pid)];
		ok("uv12/...and his real pro career (regular season only)",
			car.real && car.seasons === 3 && car.gp === 180 && car.ppg === 5 &&
			car.awards.length === 1, JSON.stringify(car));
		ok("uv12/the league itself is not touched",
			league.players[0].tid !== -2 && league.players[0].stats.length > 0);
	}

	/* --- played as the world's first seasons ---------------------------- */
	const future = E.extractDraftClass(league, SEASON);
	future.startingSeason = E.validateLeagueFile(future).season;
	const files = cls.map((c, i) => ({ name: "past" + i, data: c, pastPro: true }))
		.concat([{ name: "future", data: future }]);
	files.forEach((f) => { f.fingerprint = U.fileFingerprint(f); });
	const runners = files.map((f) => E.createRunner(f.data));
	const chain = U.beginChain({
		mode: "cold", files,
		runnable: files.map((f, i) => ({ index: i, name: f.name, season: f.data.startingSeason })),
		settings: CFG.make({ seed: "proimp" }), baseSeed: "proimp",
		make: (s) => CFG.make(s), runnerFor: (i) => runners[i],
		store: (i, res) => { results[i] = res; },
		extrapolateGaps: false,
	});
	const results = [];
	// Season one phase by phase (UV1), the rest in one call.
	{
		const it = chain.stepPhased(0);
		let n = 0;
		while (!it.next()) n++;
		ok("uv1/a season can be played one engine phase per call", n >= 5 && it.result, String(n));
	}
	for (let k = 1; k < chain.runnable.length; k++) chain.step(k);
	chain.finish({});
	const u = chain.universe;
	{
		const res = results[0];
		const pp = E.pastProOf(files[0].data);
		const wrong = res.players.filter((p) => {
			const t = pp.truth[p.key];
			return t && t.slot && p.draftSlot !== t.slot;
		});
		ok("uv12/every drafted man goes at his real pick", wrong.length === 0,
			wrong.slice(0, 3).map((p) => p.name + " " + p.draftSlot).join());
		ok("uv12/...the undrafted men after them",
			res.players.filter((p) => !pp.truth[p.key].slot).every((p) => p.draftSlot > 40));
		const duke = res.players.filter((p) => p.key === String(cls[0].players[0].pid))[0];
		ok("uv12/...at his real school, in his class year",
			duke && duke.newCollege === "Duke" && duke.classYear === "Freshman",
			duke && duke.newCollege + " " + duke.classYear);
		ok("uv12/the season has stats and awards like any other",
			duke && duke.stats && Number.isFinite(duke.stats.ppg) &&
			res.players.some((p) => (p.awards || []).length));
		ok("uv12/no draft-night event describes a move that did not happen",
			(res.draftEvents || []).every((e) => {
				const p = res.players.filter((x) => x.key === e.key)[0];
				return p && pp.truth[p.key] && !pp.truth[p.key].slot || p.draftSlot === pp.truth[p.key].slot;
			}));
		ok("uv12/the timeline rows of those seasons are marked pro history",
			u.rows.filter((r) => r.proHistory).length === 4 &&
			u.rows.filter((r) => r.proHistory).every((r) => !r.error), u.rows.map((r) => r.error).join());
	}
	const lgEntries = Object.keys(u.registry).map((id) => u.registry[id]).filter((x) => x.pro && x.pro.real);
	ok("uv12/every drafted man of the four classes has a registry entry with his real career",
		lgEntries.filter((x) => x.draft && x.draft.slot).length === 160, String(lgEntries.length));
	{
		const x = lgEntries.filter((e) => e.draft && e.draft.slot === 1 && e.draft.season === 2022)[0];
		ok("uv12/...linked to his program, his real slot and team",
			x && x.draft.school === "Duke" && x.draft.team === "T0" && x.league && /^lg/.test(x.league.id));
		const o = U.proOutcome(x);
		ok("uv12/proOutcome reads the real career, not the seeded one",
			o && o.real && o.allStars === 1 && /real/.test(U.proText(o)));
		const al = u.alumni.filter((a) => a.imported);
		ok("uv12/alumni rows say who drafted him",
			al.length === 160 && al.some((a) => a.why === "drafted No. 1 by T0"), String(al.length));
		const dukeAlumni = U.programAlumni(u, "Duke");
		ok("uv11/programAlumni lists the men a program sent to the draft",
			dukeAlumni.filter((a) => a.drafted && a.proReal).length === 16 &&
			dukeAlumni.every((a) => a.school === "Duke" || !a.drafted), String(dukeAlumni.length));
		ok("uv11/...filterable by draft year",
			U.programAlumni(u, "Duke", { draftYear: 2023 }).every((a) => a.draftSeason === 2023) &&
			U.programAlumni(u, "Duke", { draftYear: 2023 }).length >= 4);
	}

	/* --- UV2: the POY row is never empty when a trophy was minted ------- */
	{
		const POY = U.nationalPOYSet();
		let minted = 0;
		let missing = 0;
		results.forEach((res, i) => {
			if (!res) return;
			const any = (res.players || []).concat(res.futurePlayers || [])
				.some((p) => (p.awards || []).some((a) => POY.has(a)));
			if (!any) return;
			minted++;
			const row = u.rows.filter((r) => r.position === i)[0];
			if (!row || !row.poy) missing++;
		});
		ok("uv2/row.poy is set whenever a national POY trophy was minted",
			minted > 0 && missing === 0, minted + " minted, " + missing + " missing");
	}

	/* --- UV5/UV7/UV8: what the carry hands the next season --------------- */
	{
		const res = results[4];
		const prev = u.cfgs[4].carryOver;
		const c = U.harvest(res, prev);
		const coaches = Object.keys(c.coaches).map((n) => c.coaches[n]);
		const ladder = coaches.filter((x) => x.ladder);
		ok("uv7/sitting coaches climb the ladder into open jobs",
			ladder.length >= 5 && ladder.every((x) => x.coach && x.coach.movedFrom === x.from &&
				c.coaches[x.from] && (c.coaches[x.from].hiredBy || c.coaches[x.from].ladder ||
					c.coaches[x.from].retread || c.coaches[x.from].reason === "hired")),
			String(ladder.length));
		ok("uv7/fired men wait in a retread pool", Array.isArray(c.coachPool) && c.coachPool.length > 0);
		ok("uv8/the season-one ladder shape rides the carry",
			Array.isArray(c.levelRef) && c.levelRef.length >= 300 &&
			JSON.stringify(c.levelRef) === JSON.stringify(prev.levelRef),
			(prev.levelRef || []).length + " " + Object.keys(prev.levels || {}).length + " " +
			Object.keys(c.levels).length);
		ok("uv5/the champion's title streak is kept",
			c.streak && c.streak.school === c.champion && c.streak.n >= 1);
		const again = U.harvest(res, prev);
		ok("uv5/uv7/...and all of it is deterministic",
			JSON.stringify(again) === JSON.stringify(c));
	}

	/* --- exports never write these men back ----------------------------- */
	{
		let threw = false;
		try { E.exportPlayersFile(results[0], {}); } catch (e) { threw = /pro history/.test(e.message); }
		ok("uv12/a players file of a pro-history class is refused", threw);
		threw = false;
		try { E.mergeIntoLeague(results[0], JSON.parse(JSON.stringify(league)), {}); }
		catch (e) { threw = /pro history/.test(e.message); }
		ok("uv12/...and so is merging it into the league", threw);
		const merged = E.mergeManyIntoLeague(results.filter(Boolean), JSON.parse(JSON.stringify(league)), {});
		ok("uv12/a merge of every season writes only the class to come",
			merged.seasons.join() === String(SEASON), merged.seasons.join());
		const pf = E.universePlayersFile(results.filter(Boolean), {});
		const names = new Set(pf.file.players.map((p) => p.firstName));
		ok("uv12/the universe players file leaves them out",
			![...names].some((n) => /^Pro20/.test(n)), [...names].slice(0, 5).join());
	}

	/* --- the ledger import, for a world already built ------------------- */
	{
		const w = { rows: [{ season: 2030 }], alumni: [], registry: {} };
		const a = U.importProHistory(w, cls);
		const ids1 = Object.keys(w.registry).sort().join();
		const al1 = w.alumni.length;
		const b = U.importProHistory(w, cls);
		ok("uv12/the ledger import adds every man of the four classes",
			a.added === 176 && Object.keys(w.registry).every((id) => /^lg:lg[0-9a-f]{8}\/\d+$/.test(id)),
			String(a.added));
		ok("uv12/...and a re-import is idempotent (same lg: ids, no duplicate alumni)",
			b.added === 176 && Object.keys(w.registry).sort().join() === ids1 && w.alumni.length === al1);
		ok("uv12/...with real careers the storage bound keeps (UV9)",
			Object.keys(w.registry).every((id) => U.registryKeepScore(w.registry[id]) >= 40));
		// A world that played them already: the ledger does not duplicate them.
		const before = Object.keys(u.registry).length;
		U.importProHistory(u, cls);
		ok("uv12/...and it does not duplicate men the world already played",
			Object.keys(u.registry).length - before === 0, String(Object.keys(u.registry).length - before));
	}

	/* --- UV4: names counted from the world's own first season ----------- */
	{
		const names = (list) => list.reduce((all, f) => all.concat(f.data.players
			.map((p) => p.firstName + " " + p.lastName)), []);
		const v2 = names(U.synthFiles("pi-uv4", 2040, 30, undefined, 2040));
		ok("uv4/a versioned world's names carry no generation suffix for decades",
			!v2.some((n) => / (Jr\.|III|IV)$/.test(n)) && new Set(v2).size === v2.length);
		const legacy = U.synthFile("pi-uv4", 2040);
		ok("uv4/...and an unversioned file is exactly the old one",
			legacy.fingerprint === U.synthFingerprint("pi-uv4", 2040) && !legacy.synthetic.epoch);
		const f = U.synthFile("pi-uv4", 2041, undefined, 2040);
		const back = U.synthFromOrder({ fingerprint: f.fingerprint, synth: f.synthetic });
		ok("uv4/...a versioned file regenerates from its order entry",
			back && JSON.stringify(back.data) === JSON.stringify(f.data));
	}

	/* --- UV9 / UV13 ----------------------------------------------------- */
	ok("uv9/honors are weighted by tier",
		U.honorWeight("Naismith Trophy") === 5 && U.honorWeight("Consensus First Team All-American") === 3 &&
		U.honorWeight("Naismith Trophy Watch List") === 0 && U.honorWeight("All-Tournament Team") === 0 &&
		U.honorWeight("NCAA National Champion") === 0);
	ok("uv9/a one-season No. 1 pick outranks a long anonymous career for storage",
		U.registryKeepScore({ id: "a", span: 1, draft: { slot: 1 }, honors: [] }) >
		U.registryKeepScore({ id: "b", span: 4, draft: { slot: null }, honors: [] }));
	ok("uv13/readRecipe prefers the year's own recipe",
		E.readRecipe({ bbgmdraft: { recipe: { v: 99 }, recipes: { 2030: { v: 99 } } } }, 2030) === null &&
		E.readRecipe({ bbgmdraft: {} }, 2030) === null);
};
