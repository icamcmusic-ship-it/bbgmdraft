#!/usr/bin/env node
/* UNIVERSE HARNESSES.

   The seeds-and-fingerprints export design rests on one property — a chain of
   class files replays into the same world — and nothing in CI guarded it. This
   runs three checks that do:

     DETERMINISM   run the same three-file chain twice and assert the rows are
                   identical, row for row and fingerprint for fingerprint.
     IDEMPOTENCY   export the same universe twice and assert byte equality,
                   which is the property a shareable file actually needs.
     ROUND TRIP    push the merged universe players file through the two BBGM
                   import paths, reimplemented from BBGM's own source, and
                   assert that nothing the universe wrote is dropped or
                   mutated on the path that is supposed to keep it.

   Usage: node tools/universe.js
   Exits non-zero on the first failure. */
"use strict";

const path = require("path");
const V = require(path.join(__dirname, "validate.js"));
V.loadEngine();
const E = global.Engine;
const U = global.Universe;
const CFG = global.Config;

let failures = 0;
let checks = 0;
function ok(what, pass, detail) {
	checks++;
	if (pass) { console.log("  ok   " + what); return; }
	failures++;
	console.log("  FAIL " + what + (detail ? "\n       " + detail : ""));
}

/* Three class files, one per season, in the shape a BBGM export has. */
function files(seasons, size) {
	return seasons.map((season, i) => {
		const lf = V.realisticClass("chain" + i, size || 46);
		lf.startingSeason = season;
		for (const p of lf.players) {
			p.draft = Object.assign({}, p.draft, { year: season });
		}
		return { name: "class-" + season + ".json", data: lf,
			fingerprint: "fp" + season + "-" + i };
	});
}

/* The chain, exactly as js/app.js runs it: one frozen config, a seed keyed on
   file identity, carry-over handed forward, and the carry aged across a gap. */
/* `runners`, when given, is a persistent runner per file — which is what
   js/app.js keeps (state.runners) and what the plain E.run() path below does
   NOT exercise. See the warm-runner section at the bottom of this file: the
   phase cache is only consulted when a runner is reused, so every chain built
   with E.run() is a COLD chain and a whole class of staleness bug was
   invisible to this harness. */
function spec(fileList, over, extra) {
	return Object.assign({
		mode: "cold",
		files: fileList,
		runnable: fileList.map((f, i) => ({ index: i, name: f.name,
			season: f.data.startingSeason })),
		settings: CFG.make(Object.assign({ seed: "harness" }, over || {})),
		baseSeed: "harness",
		make: (st) => CFG.make(st),
		runnerFor: (i) => ({ run: (cfg) => E.run(fileList[i].data, cfg) }),
		/* Off by default so that row i is file i, which the older checks
		   below index on; the gap checks turn it on. */
		extrapolateGaps: false,
	}, extra || {});
}

/* Drive Universe.beginChain the way js/app.js does, synchronously. */
function drive(sp, finishOpts) {
	const results = [];
	if (!sp.store) sp.store = (i, res) => { results[i] = res; };
	const c = U.beginChain(sp);
	for (let k = 0; k < c.runnable.length; k++) c.step(k);
	const out = c.finish(finishOpts || {});
	return { u: c.universe, results, out, chain: c };
}

/* THE CHAIN, EXACTLY AS js/app.js RUNS IT — because it is the same code.
   This used to be a copy of the app's loop, so a fault in the app's copy
   (a resume that did not reproduce the chain, an extension that forgot the
   returners of the seasons it held) could not be seen from here. */
function chain(fileList, over, runners) {
	const d = drive(spec(fileList, over,
		runners ? { runnerFor: (i) => runners[i] } : null));
	return { rows: d.u.rows, results: d.results, alumni: d.u.alumni,
		tree: d.u.coachTree, settings: d.u.settings, u: d.u,
		threads: d.u.threads, records: d.u.records };
}

const clone = (x) => JSON.parse(JSON.stringify(x));

console.log("\nDeterminism");
const fl = files([2025, 2026, 2027]);
const a = chain(fl);
const b = chain(fl);
ok("a three-file chain replays into the same rows",
	JSON.stringify(a.rows) === JSON.stringify(b.rows),
	JSON.stringify(a.rows.map((r) => r.result)) + " vs " +
	JSON.stringify(b.rows.map((r) => r.result)));
ok("every season produced a result fingerprint",
	a.rows.every((r) => typeof r.result === "string" && r.result.length === 8));
ok("two seasons of the same chain are different worlds",
	a.rows[0].result !== a.rows[1].result);
/* The fault the file-identity seed fixes: two files claiming the same season
   used to draw the same seed and therefore the same world. */
const dup = files([2031, 2031]);
const dupRun = chain(dup);
ok("two files claiming the same season are still two different worlds",
	dupRun.rows[0].result !== dupRun.rows[1].result);

/* THE WARM CHAIN HAS TO BE THE COLD CHAIN.

   Everything above builds its chain with E.run(), which creates a fresh
   runner per season — so the staged phase cache is never consulted, and this
   harness could not see the defect it exists to catch. js/app.js keeps one
   runner per file (state.runners) for the life of the session and re-runs the
   whole chain whenever a setting invalidates it.

   The phase cache skips a phase whose declared dependency key is unchanged,
   and the carry-over is a phase input: assignCollege reads it for recruiting
   momentum and buildPrograms reads it for the conference map, the program
   levels, the coaches and the returners. With `carryOver` undeclared, moving
   a setting that only invalidates a LATE phase — March upsets — changed
   season 1's champion while leaving season 2's build and regular keys
   identical, so season 2 was served from cache and replayed against a world
   that no longer existed. Measured, seasons 1 and 2 of a three-file chain both
   came back with different fingerprints from the cold run of the same
   settings.

   So: run a chain warm, change one late-phase setting, run it warm again, and
   assert it equals the cold run of those same settings — season for season. */
{
	const warmRunners = fl.map((f) => E.createRunner(f.data));
	chain(fl, { upsetFactor: 1.0 }, warmRunners);
	const warm = chain(fl, { upsetFactor: 1.8 }, warmRunners);
	const cold = chain(fl, { upsetFactor: 1.8 });
	const same = warm.rows.every((r, i) => r.result === cold.rows[i].result);
	ok("a warm chain reproduces the cold chain after a late-phase change", same,
		JSON.stringify(warm.rows.map((r) => r.result)) + " vs " +
		JSON.stringify(cold.rows.map((r) => r.result)));
	/* And the same for a setting the REGULAR phase owns via the roster, so
	   `universeRoster` is covered too rather than only `carryOver`. */
	const warm2Runners = fl.map((f) => E.createRunner(f.data));
	chain(fl, { coachTurnover: 100 }, warm2Runners);
	const warm2 = chain(fl, { coachTurnover: 175 }, warm2Runners);
	const cold2 = chain(fl, { coachTurnover: 175 });
	ok("a warm chain reproduces the cold chain after a postseason change",
		warm2.rows.every((r, i) => r.result === cold2.rows[i].result),
		JSON.stringify(warm2.rows.map((r) => r.result)) + " vs " +
		JSON.stringify(cold2.rows.map((r) => r.result)));
	/* The dependency lists are the mechanism; name them, so that deleting a
	   key fails here rather than three seasons downstream. */
	const deps = (name) => (E.PHASES || []).filter((p) => p.name === name)[0];
	ok("the build phase declares the carry-over it reads",
		!!deps("build") && deps("build").deps.indexOf("carryOver") !== -1);
	ok("the regular phase declares the carry-over and the roster it reads",
		!!deps("regular") && deps("regular").deps.indexOf("carryOver") !== -1 &&
		deps("regular").deps.indexOf("universeRoster") !== -1);
}

console.log("\nIdempotency");
const exp1 = U.exportUniverse({ rows: a.rows, baseSeed: "harness",
	settings: a.settings, biography: U.biographyOf(a.results, fl),
	createdAt: "fixed" });
const exp2 = U.exportUniverse({ rows: chain(fl).rows, baseSeed: "harness",
	settings: a.settings, biography: U.biographyOf(chain(fl).results, fl),
	createdAt: "fixed" });
ok("exporting the same universe twice is byte-identical",
	JSON.stringify(exp1) === JSON.stringify(exp2));
ok("the export names the engine revision it was built on",
	exp1.engineRev === U.ENGINE_REV);
ok("every season carries its result fingerprint into the file",
	(exp1.seasons || []).every((s) => s.result));

console.log("\nBiographies are read back");
/* The property the biography field exists for: replaying a universe under a
   biography reproduces the same men, not merely the same seeds. */
{
	const bio = U.biographyOf(a.results, fl);
	/* Projected to the file it is about — the map is keyed on a cross-file
	   identity and the engine reads a file's own pids. See biographyForFile. */
	const cfg = CFG.make({ seed: U.seedFor("harness", 0, 2025, fl[0].fingerprint),
		biography: U.biographyForFile(bio, fl[0].fingerprint) });
	const again = E.run(fl[0].data, cfg);
	const before = {};
	for (const p of a.results[0].players) before[p.key] = p.classYear;
	const same = again.players.every((p) => before[p.key] === undefined ||
		before[p.key] === p.classYear);
	ok("class years replay identically under an imported biography", same);
	/* And it is load-bearing: a DIFFERENT biography changes them, or the
	   field is being ignored again the way it was before it was read. */
	const twisted = {};
	const local = U.biographyForFile(bio, fl[0].fingerprint);
	for (const key of Object.keys(local)) {
		twisted[key] = Object.assign({}, local[key], { classYear: "Senior" });
	}
	const forced = E.run(fl[0].data,
		CFG.make({ seed: cfg.seed, biography: twisted }));
	ok("a biography actually decides the class year",
		forced.players.every((p) => /Senior/.test(p.classYear)));
}

console.log("\nOne players file for the whole universe");
const merged = E.universePlayersFile(a.results, {
	stats: true, prior: true, awards: true, seed: "harness",
});
const players = merged.file.players;
ok("every class is in it",
	merged.seasons.length === a.results.length && players.length > 100);
ok("pids are unique across the universe",
	new Set(players.map((p) => p.pid)).size === players.length);
ok("pids are monotonic from zero",
	players.every((p, i) => p.pid === i));
ok("every player carries the draft year of his own class",
	players.every((p) => p.draft && Number.isFinite(p.draft.year)));
ok("no player carries a duplicate {season, type} award",
	players.every((p) => {
		const seen = new Set();
		for (const aw of p.awards || []) {
			const k = aw.season + "|" + aw.type;
			if (seen.has(k)) return false;
			seen.add(k);
		}
		return true;
	}));
ok("a season a man played appears once in his statline",
	players.every((p) => {
		const seen = new Set();
		for (const r of p.stats || []) {
			const k = r.season + "|" + r.tid + "|" + (r.playoffs ? 1 : 0);
			if (seen.has(k)) return false;
			seen.add(k);
		}
		return true;
	}));
ok("some player carries more than one season of stats",
	players.some((p) => (p.stats || []).length > 1));
{
	const byPid = new Map(players.map((p) => [p.pid, p]));
	let linked = 0;
	let broken = 0;
	for (const p of players) {
		for (const rel of p.relatives || []) {
			linked++;
			const other = byPid.get(rel.pid);
			if (!other || !(other.relatives || []).some((r) => r.pid === p.pid)) broken++;
		}
	}
	ok("every relative link points at a player in the same file and back",
		broken === 0, broken + " of " + linked + " links are one-way");
}
/* Second generations need a universe long enough to contain one: 18-32
   seasons between father and son. Three consecutive classes cannot, which is
   why the link check above passes vacuously on them. */
{
	const spread = files([2025, 2050]);
	const long = chain(spread);
	const m2 = E.universePlayersFile(long.results, {
		stats: true, prior: true, awards: true, seed: "harness",
	});
	ok("a 25-year universe produces at least one father/son link",
		m2.relatives > 0, "relatives = " + m2.relatives);
	const byPid = new Map(m2.file.players.map((p) => [p.pid, p]));
	ok("and every one of them names the man on the other end",
		m2.file.players.every((p) => (p.relatives || []).every((rel) => {
			const other = byPid.get(rel.pid);
			return other && rel.name ===
				((other.firstName || "") + " " + (other.lastName || "")).trim();
		})));
	ok("a father is drafted before his son",
		m2.file.players.every((p) => (p.relatives || []).every((rel) => {
			const other = byPid.get(rel.pid);
			if (!other) return false;
			return rel.type === "father"
				? other.draft.year < p.draft.year
				: other.draft.year > p.draft.year;
		})));
	ok("relatives are off when the caller says so",
		E.universePlayersFile(long.results, { relatives: false, seed: "harness" })
			.relatives === 0);
}

ok("the merged file is byte-identical on a second export",
	JSON.stringify(merged.file) === JSON.stringify(E.universePlayersFile(a.results, {
		stats: true, prior: true, awards: true, seed: "harness",
	}).file));

console.log("\nBBGM's own import paths, reimplemented from its source");
/* handleUploadedDraftClass: `delete p.stats` on every uploaded player, then
   the class is merged. So a draft-class import keeps awards and note and
   nothing else — which is exactly why the universe exports a players file.
   importPlayers (Tools -> Import players) builds each player from a fixed
   field list and keeps the statline. Both are reimplemented here so a change
   to what this tool writes is checked against what BBGM will read. */
const DRAFT_CLASS_DROPS = ["stats"];
const IMPORT_PLAYERS_KEEPS = ["born", "college", "contract", "draft", "face",
	"firstName", "lastName", "hgt", "imgURL", "injuries", "ratings", "salaries",
	"srID", "stats", "tid", "weight", "jerseyNumber", "note", "noteBool",
	"relatives", "pid"];
{
	const one = JSON.parse(JSON.stringify(players[0]));
	for (const k of DRAFT_CLASS_DROPS) delete one[k];
	ok("the draft-class path keeps the awards array", Array.isArray(one.awards));
	const kept = {};
	for (const k of IMPORT_PLAYERS_KEEPS) if (players[0][k] !== undefined) kept[k] = players[0][k];
	ok("the Import players path keeps the statline",
		Array.isArray(kept.stats) && kept.stats.length > 0);
	ok("...and the ratings, unmutated",
		JSON.stringify(kept.ratings) === JSON.stringify(players[0].ratings));
	ok("...and the note, which is where honors survive that route",
		typeof kept.note === "string" && kept.note.length > 0);
	ok("...and every relative link",
		players.filter((p) => p.relatives).every((p) =>
			IMPORT_PLAYERS_KEEPS.indexOf("relatives") >= 0));
	/* The 420/420 check, widened from ratings to the whole file: nothing the
	   universe wrote may be dropped on the path that is supposed to keep it. */
	let dropped = 0;
	for (const p of players) {
		for (const k of IMPORT_PLAYERS_KEEPS) {
			if (p[k] !== undefined && JSON.stringify(p[k]) === undefined) dropped++;
		}
	}
	ok("no kept field on any player fails to serialize", dropped === 0);
}

console.log("\nGaps, failures and the carry");
{
	const gapped = files([2025, 2031]);
	const run = chain(gapped);
	ok("a five-year hole is recorded on the row", run.rows[1].gap === 5);
	const diags = U.validate(gapped);
	ok("and the file list warns about it",
		diags.some((d) => d.warnings.some((w) => /with no file/.test(w))));
	const carry = U.harvest(a.results[0], null);
	const aged = U.ageCarry(carry, 5);
	const name = Object.keys(carry.coaches)[0];
	ok("aging the carry ages the coaches",
		!aged.coaches[name].coach || aged.coaches[name].coach.age >= carry.coaches[name].coach.age + 5 ||
		aged.coaches[name].fired);
	ok("aging the carry counts the unplayed seasons", aged.stale === 5);
	/* Toward THIS field's mean, not toward a literal. The target used to be a
	   hardcoded 55, which is the middle of the default field and of no other:
	   a universe run at midMajorLift 12, or one carrying only blue bloods, was
	   dragged across a gap toward a number from a different world. */
	{
		const names = Object.keys(carry.levels);
		const mean = names.reduce((x, n) => x + carry.levels[n], 0) / names.length;
		ok("a program level regresses toward the field's own mean across a gap",
			names.every((n) =>
				Math.abs(aged.levels[n] - mean) <= Math.abs(carry.levels[n] - mean) + 1e-9));
		// And the mean itself is a fixed point: a gap decays the SPREAD, it
		// does not move the field.
		const agedMean = names.reduce((x, n) => x + aged.levels[n], 0) / names.length;
		ok("a gap does not move the field's mean", Math.abs(agedMean - mean) < 1e-6,
			mean.toFixed(3) + " -> " + agedMean.toFixed(3));
	}
}

console.log("\nThe partial-class top-up");
{
	/* The top-up fills the All-America places a thin class file could not.
	   Its shuffle used to run on the already-chosen subset, so a chain of
	   partial files was topped up with the same names every season in a
	   different order — and a comment saying "not always the same five names"
	   sat directly above it. */
	const carry = chain(files([2025])).rows.length
		? U.harvest(chain(files([2025])).results[0], null) : null;
	const mk = (season) => U.topUpPartialSeason(
		{ season, poy: null }, carry, "harness", 0.4);
	const a2 = mk(2031);
	const b2 = mk(2032);
	const names = (row) => (row.allAmerica || []).map((x) => x.name).sort().join("|");
	ok("a partial season is topped up at all",
		(a2.allAmerica || []).length > 0,
		String((a2.allAmerica || []).length) + " added");
	ok("two partial seasons are not topped up with the same men",
		names(a2) !== names(b2), names(a2) + " vs " + names(b2));
	ok("a full class file is not topped up",
		!U.topUpPartialSeason({ season: 2033, poy: null }, carry, "harness", 1).partial);
	/* It replays, like everything else keyed off the universe seed. */
	ok("the top-up replays from the same seed", names(mk(2031)) === names(a2));
}

console.log("\nThe persistent player registry");
{
	/* A class file's key is its pid, which BBGM numbers from zero inside each
	   export — so pid 7 exists in every file and means a different man in
	   each. Every cross-file structure was keyed on it, and biographyOf took
	   the FIRST occurrence: in a chain of real exports that hands one class's
	   biography to another class's player with the same number, inside the map
	   whose whole purpose is to make a replay reproduce the same men. */
	const fl3 = files([2025, 2026, 2027], 74);
	const pids = fl3.map((f) => new Set(f.data.players.map((p) => p.pid)));
	let overlap = 0;
	for (const pid of pids[0]) if (pids[1].has(pid)) overlap++;
	ok("the fixtures really do collide on pid across files, as real exports do",
		overlap > 0, overlap + " shared pids between two files");

	const world = chain(fl3);
	const bio = U.biographyOf(world.results, fl3);
	ok("the biography map is keyed on a cross-file identity",
		bio.__scoped === true);
	ok("...and holds every player of every file, not the first of each pid",
		Object.keys(bio).length - 1 ===
			fl3.reduce((a, f) => a + f.data.players.length, 0),
		(Object.keys(bio).length - 1) + " entries");
	/* And it projects back down to exactly one file's own keys. */
	for (let i = 0; i < fl3.length; i++) {
		const local = U.biographyForFile(bio, fl3[i].fingerprint);
		if (i === 0) {
			ok("a file's slice is that file's own players",
				Object.keys(local).length === fl3[i].data.players.length,
				Object.keys(local).length + " of " + fl3[i].data.players.length);
		}
	}
	ok("a file that is not in the universe gets nothing rather than somebody else's",
		Object.keys(U.biographyForFile(bio, "not-a-file")).length === 0);
	/* A version 1 or 2 export's map is unscoped and has to keep working. */
	ok("an unscoped legacy biography is passed through unchanged",
		U.biographyForFile({ 7: { classYear: "Junior" } }, "fp2025")["7"].classYear ===
			"Junior");

	const reg = U.registryOf(world.results, fl3, world.rows);
	const people = Object.values(reg);
	ok("the registry holds one row per person across every file",
		people.length === fl3.reduce((a, f) => a + f.data.players.length, 0),
		people.length + " people");
	ok("every row has an identity, a name and the seasons it appears in",
		people.every((x) => x.id && x.name && Array.isArray(x.seasons)));
	ok("a row's seasons are in order and its span agrees with them",
		people.every((x) => {
			for (let i = 1; i < x.seasons.length; i++) {
				if (x.seasons[i].season < x.seasons[i - 1].season) return false;
			}
			return !x.seasons.length || x.span ===
				x.seasons[x.seasons.length - 1].season - x.seasons[0].season + 1;
		}));
	/* THE POINT OF IT: a career is more than one season, which is a sentence
	   this tool could not previously say about anybody. */
	const careers = people.filter((x) => x.span >= 2);
	ok("some people appear in more than one season of the world",
		careers.length > 0, careers.length + " multi-season careers");
	ok("every one of those names the season he was drafted out of",
		careers.every((x) => x.draft && Number.isFinite(x.draft.season)));
}

console.log("\nThe reverse roster link");
{
	/* The largest hole in universe mode through three audits: a class file is
	   the men drafted that year, the ones at the back of its board were not
	   drafted at all, and the next season was played without them.

	   SEVENTY MEN, not the forty-six the other fixtures use: a draft is sixty
	   picks, so a forty-six-man class has nobody at the back of its board to
	   go undrafted, and a chain of them correctly produces no returners at
	   all. Which is worth knowing, and is the next check. */
	const small = chain(files([2025, 2026]));
	ok("a class smaller than the draft produces no returners",
		small.results.every((res) =>
			(res.futurePlayers || []).every((p) => !p.past)));
	const fl3 = files([2025, 2026, 2027], 74);
	const world = chain(fl3);
	const back = world.results.map((res) =>
		(res.futurePlayers || []).filter((p) => p.past));
	ok("the first season of a chain has nobody to return to it",
		back[0].length === 0);
	ok("a later season is played with men an earlier class did not get drafted",
		back[1].length > 0 || back[2].length > 0,
		back.map((b) => b.length).join(", ") + " returners by season");
	const all = back[1].concat(back[2]);
	ok("every returner went undrafted", all.every((p) => !p.undraftedFrom ||
		Number.isFinite(p.undraftedFrom)));
	ok("...and came from a season before the one he is playing",
		all.every((p) => p.classSeason < 2028));
	ok("...and plays at a real programme",
		all.every((p) => !!global.Colleges.COLLEGES[p.newCollege]));
	ok("...and has a stat line, like anybody else on a roster",
		all.every((p) => !p.stats || Number.isFinite(p.stats.ppg)));
	/* He is NOT in this file's draft class: he already had his draft. */
	ok("a returner never reaches the draft board of the class he is playing in",
		world.results.every((res, i) =>
			(res.board || []).every((p) => !p.past)));
	/* The arithmetic that builds him has to work in both directions: it used
	   to be Math.pow of a negative base, which is NaN. */
	const E2 = global.Engine;
	const man = { newOvr: 42, talentPot: 56 };
	ok("ovrYearsAgo runs forward as well as backward",
		E2.ovrYearsAgo(man, 0) === 42 &&
		E2.ovrYearsAgo(man, -1) > 42 && Number.isFinite(E2.ovrYearsAgo(man, -2)));
	ok("...and a man does not develop past his own ceiling",
		E2.ovrYearsAgo(man, -6) <= 56);
}

console.log("\nThreads read the alumni index");
{
	/* moreThreads took an `alumni` parameter, threads() passed one argument,
	   and the parameter appeared nowhere else in the file — so every thread
	   the index was meant to support was absent and nothing failed. */
	const long = files([2025, 2026, 2027, 2028, 2029, 2030]);
	const world = chain(long);
	const withIndex = U.threads(world.rows, world.alumni);
	const without = U.threads(world.rows);
	ok("the alumni index adds threads the rows alone cannot support",
		withIndex.length > without.length,
		withIndex.length + " with the index against " + without.length + " without");
	ok("every thread still has the shape the view reads",
		withIndex.every((t) => t && typeof t.kind === "string" &&
			typeof t.text === "string" && Array.isArray(t.seasons)));
	/* The one that is deliberately absent: "he came back" needs an identity
	   that survives a file boundary, and a class file's key is a pid that
	   collides across exports. Asserted so that adding it later is a decision
	   rather than an accident. */
	ok("no thread claims a player returned in a later class",
		!withIndex.some((t) => t.kind === "returned"));
	/* And it must not fire on a world with no index, which is what every
	   caller that has not been updated will hand it. */
	ok("threads() is still callable with no alumni index at all",
		Array.isArray(U.threads(world.rows)) &&
		Array.isArray(U.moreThreads(world.rows)));
}

console.log("\nThreads and the records book");
ok("threads are structured, not sentences",
	a.threads.every((t) => t && typeof t === "object" && typeof t.text === "string"));
ok("the records book names a leader in titles",
	Array.isArray(a.records.titles));
ok("the records book finds the longest run at AP No. 1",
	a.records.longestApRun === null || a.records.longestApRun.length >= 1);
ok("the hall of fame is drawn from the alumni index",
	a.records.hall.every((m) => a.alumni.some((x) => x.key === m.key)));

/* THE FOUR THAT THE CHAIN DID NOT CATCH.

   Each of these guards a defect that shipped and that nothing here could
   see: three of them are about a value that is legitimately zero or a key
   that is legitimately absent, which is precisely the class of fault an
   end-to-end chain test walks past because the chain still runs. */
console.log("\nRegressions this harness used to walk past");
{
	/* An unbeaten regular season was detected with `(regL || l || 0) === 0`,
	   which discards the 0 it exists to find and reads the tournament loss
	   instead. Asserted against the rows the chain actually produced: every
	   team whose frozen regular-season record is spotless has to be named. */
	/* The predicate itself, on a hand-built season, because a chain of
	   fixtures may simply contain no unbeaten team — and a check that can
	   pass by never meeting its own case is not a check. This is the exact
	   shape the bug had: a team that went 31-0 in the regular season and
	   then lost once in March, so regL is 0 and l is 1. */
	{
		const fake = {
			teams: {
				Georgetown: { name: "Georgetown", conf: "Big East", log: [{}],
					regW: 31, regL: 0, w: 33, l: 1 },
				Rutgers: { name: "Rutgers", conf: "Big Ten", log: [{}],
					regW: 14, regL: 17, w: 14, l: 18 },
				/* No frozen snapshot at all — the case the fallback exists
				   for — and beaten, so it must NOT be named either. */
				Hofstra: { name: "Hofstra", conf: "CAA", log: [{}], w: 22, l: 9 },
			},
			players: [], leagueFile: { startingSeason: 2031 },
		};
		const row = U.summarize(fake, "seed", "fake.json");
		ok("a 31-0 team that lost in March is still unbeaten in the regular season",
			(row.unbeaten || []).length === 1 && row.unbeaten[0] === "Georgetown",
			JSON.stringify(row.unbeaten));
	}
	let missed = 0;
	let found = 0;
	a.results.forEach((res, i) => {
		const row = a.rows[i];
		if (!row || row.extrapolated) return;
		const named = new Set(row.unbeaten || []);
		for (const t of Object.values(res.teams || {})) {
			if (!t || !t.name || !t.log) continue;
			const rl = Number.isFinite(t.regL) ? t.regL : t.l;
			const rw = Number.isFinite(t.regW) ? t.regW : t.w;
			if (rl === 0 && rw >= 20) { found++; if (!named.has(t.name)) missed++; }
		}
	});
	ok("an unbeaten regular season reaches the timeline row", missed === 0,
		missed + " of " + found + " unbeaten teams were not named");

	/* One fact, one thread. no1Abroad was emitted from the rows AND from the
	   alumni index, so any timeline with two of them printed both. */
	const kinds = {};
	for (const t of a.threads) kinds[t.kind] = (kinds[t.kind] || 0) + 1;
	ok("no thread kind that describes a whole timeline is emitted twice",
		(kinds.no1Abroad || 0) <= 1,
		"no1Abroad x" + (kinds.no1Abroad || 0));

	/* Alumni rows carry a fingerprint-scoped identity, because a BBGM pid is
	   unique inside one file and meaningless between two. Without it the
	   records book sums two different men into one Hall of Fame row. */
	ok("every alumni row carries a cross-file identity",
		a.alumni.every((x) => typeof x.id === "string" && x.id.indexOf("/") > 0));
	const ids = new Set(a.alumni.map((x) => x.id));
	const keys = new Set(a.alumni.map((x) => x.key));
	ok("the scoped identity separates men the bare pid collided",
		ids.size >= keys.size,
		ids.size + " identities against " + keys.size + " pids");

	/* A man in the Hall of Fame is ONE man: his seasons must all come from
	   entries that share his identity, not merely his pid. */
	ok("no hall-of-fame row is two different people",
		a.records.hall.every((m) => {
			const mine = a.alumni.filter((x) => (x.id || x.key) === m.id);
			return mine.length > 0 &&
				mine.every((x) => x.name === m.name);
		}));
}

console.log("\nOne definition of player of the year");
{
	const set = U.nationalPOYSet();
	let disagree = 0;
	a.results.forEach((res, i) => {
		const row = a.rows[i];
		const fromAlumni = U.alumniOf(res, row.season, row.fingerprint)
			.filter((x) => x.why === "player of the year")[0];
		if (!row.poy && !fromAlumni) return;
		if (!row.poy || !fromAlumni || row.poy.name !== fromAlumni.name) disagree++;
	});
	ok("the timeline column and the alumni index name the same man",
		disagree === 0);
	ok("the definition comes from the awards module", set.size > 2);
}

/* ------------------------------------------------------------------------
   THE CHAIN'S OTHER WAYS IN: resume, extend, re-run, replay.

   Everything above runs a cold chain. The app also resumes a chain from a
   held season, extends a finished one with later classes, re-runs it warm
   after a setting moves, evicts old seasons to bound memory and replays an
   import run by run — and each of those used to reach a different world from
   the one it claimed to reproduce. These run the same Universe.beginChain the
   app runs. */

/* Replay an export the way importUniverse does: Universe.replayPlan, then
   one beginChain per recorded run. */
function replay(json, fileList, finishOpts) {
	const plan = U.replayPlan(json, fileList);
	let u = null;
	let last = null;
	const byFp = new Map(fileList.map((f, i) => [f.fingerprint, i]));
	for (const st of plan.steps) {
		const settings = CFG.make(st.settings || {});
		let runnable;
		let extra = { settings, baseSeed: json.baseSeed };
		if (st.kind === "resume") {
			runnable = u.order.slice(st.from).map((d) => ({ index: d.index, name: d.name, season: d.season }));
			extra = Object.assign(extra, { mode: "resume", from: st.from, universe: u });
		} else {
			const only = st.only ? new Set(st.only) : null;
			const known = st.kind === "extend" ? new Set(u.tail.fingerprints) : new Set();
			runnable = fileList.map((f, i) => ({ index: i, name: f.name, season: f.data.startingSeason, f }))
				.filter((d) => (!only || only.has(d.f.fingerprint)) && !known.has(d.f.fingerprint))
				.sort((a, b) => a.season - b.season || a.index - b.index);
			if (st.kind === "extend") extra = Object.assign(extra, { mode: "extend", universe: u });
		}
		extra.runnable = runnable;
		last = drive(spec(fileList, null, extra), finishOpts);
		u = last.u;
	}
	void byFp;
	return { u, plan };
}

console.log("\nResume reproduces the chain");
{
	const fl4 = files([2025, 2026, 2027, 2028], 74);
	const full = drive(spec(fl4));
	const base = drive(spec(fl4));
	const resumed = drive(spec(fl4, null, {
		mode: "resume", from: 2, universe: base.u,
		runnable: fl4.slice(2).map((f, i) => ({ index: i + 2, name: f.name,
			season: f.data.startingSeason })),
	}));
	ok("a resume with the same settings replays the same seasons, row for row",
		JSON.stringify(full.u.rows) === JSON.stringify(resumed.u.rows),
		JSON.stringify(full.u.rows.map((r) => r.result)) + " vs " +
		JSON.stringify(resumed.u.rows.map((r) => r.result)));
	const pr = (x, i) => (x.u.cfgs[i].pastRoster || []).length;
	ok("...with the held seasons' undrafted men on the resumed rosters",
		pr(resumed, 2) + pr(resumed, 3) > 0 && pr(resumed, 2) === pr(full, 2) &&
		pr(resumed, 3) === pr(full, 3),
		pr(full, 2) + "," + pr(full, 3) + " vs " + pr(resumed, 2) + "," + pr(resumed, 3));
	ok("...ranked in the same recruiting cohorts",
		JSON.stringify(full.u.cfgs[3].universeRecruiting) ===
			JSON.stringify(resumed.u.cfgs[3].universeRecruiting));
	ok("...with the same coaching tree, recorded once",
		JSON.stringify(full.u.coachTree) === JSON.stringify(resumed.u.coachTree),
		full.u.coachTree.hires.length + " vs " + resumed.u.coachTree.hires.length);
	ok("...the same registry and the same tail",
		JSON.stringify(full.u.registry) === JSON.stringify(resumed.u.registry) &&
		JSON.stringify(full.u.tail) === JSON.stringify(resumed.u.tail));
	/* A resume under NEW settings records them for the seasons it re-ran,
	   not for the ones it held. */
	const base2 = drive(spec(fl4));
	const settings0 = JSON.stringify(base2.u.settings);
	const held = clone(base2.u.rows.slice(0, 2));
	const moved = drive(spec(fl4, { upsetFactor: 1.9 }, {
		mode: "resume", from: 2, universe: base2.u,
		runnable: fl4.slice(2).map((f, i) => ({ index: i + 2, name: f.name,
			season: f.data.startingSeason })),
	}));
	ok("a resume under new settings keeps the held rows",
		JSON.stringify(moved.u.rows.slice(0, 2)) === JSON.stringify(held));
	ok("...and does not record the new settings as the held seasons'",
		JSON.stringify(moved.u.settings) === settings0 &&
		moved.u.cfgs[0].settings.upsetFactor !== 1.9 &&
		moved.u.cfgs[3].settings.upsetFactor === 1.9);
	ok("...and records the run as a segment",
		moved.u.segments.length === 2 && moved.u.segments[1].kind === "resume" &&
		moved.u.segments[1].from === 2);
}

console.log("\nExtend is the appended chain");
{
	const fl3 = files([2025, 2026, 2027], 74);
	const idx2 = [{ index: 2, name: fl3[2].name, season: 2027 }];
	const two = drive(spec(fl3.slice(0, 2)));
	const rowsBefore = clone(two.u.rows);
	/* The same two seasons, then saved and reloaded: the tail through JSON,
	   no live configs, exactly what persist() and a page reload leave. */
	const two2 = drive(spec(fl3.slice(0, 2)));
	const reloaded = clone({
		rows: two2.u.rows, alumni: two2.u.alumni, tail: two2.u.tail,
		coachTree: two2.u.coachTree, segments: two2.u.segments,
		order: two2.u.order, settings: two2.u.settings, registry: two2.u.registry,
		baseSeed: two2.u.baseSeed,
	});
	reloaded.cfgs = {};
	const ext = drive(spec(fl3, null, { mode: "extend", universe: two.u, runnable: idx2 }));
	const ext2 = drive(spec(fl3, null, { mode: "extend", universe: reloaded, runnable: idx2 }));
	ok("an extension leaves the played seasons exactly as they were",
		JSON.stringify(ext.u.rows.slice(0, 2)) === JSON.stringify(rowsBefore));
	ok("the extended season is the same whether the tail was live or reloaded",
		JSON.stringify(ext.u.rows[2]) === JSON.stringify(ext2.u.rows[2]),
		ext.u.rows[2].result + " vs " + ext2.u.rows[2].result);
	ok("...and it is handed the held seasons' returners",
		(ext.u.cfgs[2].pastRoster || []).length > 0,
		(ext.u.cfgs[2].pastRoster || []).length + " returners");
	ok("the seed index continues past the held seasons",
		ext.u.tail.count === 3 && ext.u.segments.map((g) => g.kind).join() === "cold,extend");
	/* And an import of it replays run by run into the same world. */
	const json = U.exportUniverse(Object.assign({}, ext.u, { createdAt: "fixed" }));
	const back = replay(json, fl3);
	ok("an exported extension replays run by run",
		back.plan.followed && back.plan.steps.map((x) => x.kind).join() === "cold,extend");
	ok("...into the same world",
		JSON.stringify(back.u.rows.map((r) => r.result)) ===
			JSON.stringify(ext.u.rows.map((r) => r.result)),
		JSON.stringify(back.u.rows.map((r) => r.result)) + " vs " +
		JSON.stringify(ext.u.rows.map((r) => r.result)));
	const cold3 = drive(spec(fl3));
	ok("...which is not the cold chain of the same files (so the plan matters)",
		cold3.u.rows[0].result !== ext.u.rows[0].result ||
		cold3.u.rows[2].result !== ext.u.rows[2].result);
}

console.log("\nStop, then extend");
{
	const fl3 = files([2025, 2026, 2027]);
	const sp = spec(fl3);
	sp.store = () => {};
	const c = U.beginChain(sp);
	c.step(0);
	c.finish({ cancelled: true });
	ok("a stopped chain's tail names only the seasons it played",
		c.universe.tail.fingerprints.length === 1 && c.universe.tail.count === 1 &&
		c.universe.order.length === 1);
	const ext = drive(spec(fl3, null, { mode: "extend", universe: c.universe,
		runnable: fl3.slice(1).map((f, i) => ({ index: i + 1, name: f.name,
			season: f.data.startingSeason })) }));
	ok("...so extending it plays the classes it never reached",
		ext.u.rows.length === 3 && ext.u.rows.every((r) => !r.error && !r.extrapolated));
}

console.log("\nAn awards-only warm re-run keeps the coaching tree");
{
	const fl = files([2025, 2026, 2027]);
	const runners = fl.map((f) => E.createRunner(f.data));
	chain(fl, { awardStrictness: 20 }, runners);
	const warm = chain(fl, { awardStrictness: 80 }, runners);
	const cold = chain(fl, { awardStrictness: 80 });
	ok("the cold chain records hires", cold.tree.hires.length > 0);
	ok("a warm re-run after an awards-only change records the same hires",
		JSON.stringify(warm.tree) === JSON.stringify(cold.tree),
		warm.tree.hires.length + " vs " + cold.tree.hires.length);
	ok("...and the same seasons", JSON.stringify(warm.rows.map((r) => r.result)) ===
		JSON.stringify(cold.rows.map((r) => r.result)));
	ok("pruning the tree to a held season drops the later hires",
		U.pruneCoachTree(cold.tree, 2025).hires.every((h) => h.season <= 2025));
}

console.log("\nMemory is bounded");
{
	/* Heap after a full collection, with the chain's own state still
	   reachable: once with every result dropped by the caller, once with
	   every result kept. If the chain pinned the results itself (it used to,
	   through the returners list) the two would be the same size. WeakRef is
	   no use here: a target stays alive until the end of the synchronous job
	   that created the reference. */
	let gc = null;
	try {
		require("v8").setFlagsFromString("--expose-gc");
		gc = require("vm").runInNewContext("gc");
	} catch (e) { gc = null; }
	const fl6 = files([2025, 2026, 2027, 2028, 2029, 2030], 74);
	const heap = () => { gc(); gc(); return process.memoryUsage().heapUsed; };
	let c = null;
	if (gc) {
		const h0 = heap();
		const sp = spec(fl6);
		sp.store = () => {};
		c = U.beginChain(sp);
		for (let k = 0; k < c.runnable.length; k++) c.step(k);
		c.finish({});
		const dropped = heap() - h0;
		const keep = [];
		const sp2 = spec(fl6);
		sp2.store = (i, res) => { keep.push(res); };
		const c2 = U.beginChain(sp2);
		for (let k = 0; k < c2.runnable.length; k++) c2.step(k);
		c2.finish({});
		const kept = heap() - h0 - dropped;
		ok("the chain pins no finished season (the app's runner release does the rest)",
			dropped < kept * 0.5,
			"chain state " + Math.round(dropped / 1e6) + " MB, with results kept " +
			Math.round(kept / 1e6) + " MB");
		void c2;
		void keep.length;
	} else {
		const sp = spec(fl6);
		sp.store = () => {};
		c = U.beginChain(sp);
		for (let k = 0; k < c.runnable.length; k++) c.step(k);
		c.finish({});
	}
	ok("the returner window is at most four seasons deep",
		c.sources.length <= 4, c.sources.length + " sources");
	const tailBytes = JSON.stringify(c.universe.tail).length;
	ok("the tail is small enough to persist", tailBytes < 600000, tailBytes + " bytes");
	/* The slim source is Engine.pastRosterFor's own input, not a copy of
	   the rule: it must return exactly what the full result would. */
	const res = E.run(fl6[0].data, CFG.make({ seed: "slim" }));
	const src = U.returnerSource(res, 0);
	let same = true;
	for (let a = 1; a <= 3; a++) {
		if (JSON.stringify(E.pastRosterFor(res, res.season + a, 0)) !==
			JSON.stringify(U.pastRosterFrom(src ? [src] : [], res.season + a))) same = false;
	}
	ok("a slim returner source returns exactly the full season's returners", same);
}

console.log("\nNo season twice after extrapolate and extend");
{
	const fl = files([2025, 2026, 2029]);
	const base = drive(spec(fl.slice(0, 2), null, { extrapolateGaps: true }),
		{ extrapolateYears: 4 });
	ok("four years are extrapolated past the last file",
		base.u.rows.filter((r) => r.extrapolated).map((r) => r.season).join() ===
			"2027,2028,2029,2030");
	const ext = drive(spec(fl, null, { mode: "extend", universe: base.u,
		extrapolateGaps: true,
		runnable: [{ index: 2, name: fl[2].name, season: 2029 }] }), { extrapolateYears: 0 });
	const seasons = ext.u.rows.map((r) => r.season);
	ok("every season appears once after extending into the guessed years",
		new Set(seasons).size === seasons.length, seasons.join(","));
	ok("...and the played year is the played one",
		ext.u.rows.filter((r) => r.season === 2029).every((r) => !r.extrapolated));
	ok("...and no guessed alumni outlive their rows",
		ext.u.alumni.filter((a) => a.extrapolated).every((a) => a.season < 2029));
}

console.log("\nImport keeps what the file knows");
{
	const fl3 = files([2025, 2026, 2027], 74);
	const w = drive(spec(fl3));
	const json = U.exportUniverse(Object.assign({}, w.u, { createdAt: "fixed" }));
	ok("the export carries the registry",
		json.registry && Object.keys(json.registry).length > 0);
	ok("...and the whole alumni index", json.alumni.length === w.u.alumni.length);
	/* The 2026 file is not loaded. */
	const partial = fl3.filter((_, i) => i !== 1);
	const plan = U.replayPlan(json, partial);
	const run = drive(spec(partial, null, { extrapolateGaps: true }));
	void plan;
	ok("the partial replay guessed the missing year",
		run.u.rows.some((r) => r.season === 2026 && r.extrapolated));
	const imported = { rows: json.timeline, alumni: json.alumni,
		registry: json.registry, tail: json.tail };
	run.u.registry = null;
	const out = U.restoreImported(run.u, imported, []);
	const r26 = run.u.rows.filter((r) => r.season === 2026);
	ok("a season whose class file is missing is the file's row, not a guess",
		out.missing === 1 && r26.length === 1 && !r26[0].extrapolated &&
		r26[0].missingFile && r26[0].champion === w.u.rows[1].champion);
	ok("the import restores the registry",
		run.u.registry && Object.keys(json.registry).every((id) => run.u.registry[id]));
	ok("the alumni index is merged, not replaced",
		run.u.alumni.some((a) => a.season === 2026) &&
		run.u.alumni.some((a) => a.season === 2027));
	const view = U.viewOnlyUniverse(json);
	ok("with no class files at all, the file is still a readable world",
		view.rows.length === json.timeline.length && view.registry && view.tail &&
		view.records && view.viewOnly);
	/* Two files claiming one season are two rows, and a divergence names
	   the one that diverged. */
	const keys = U.rowKeys([{ season: 2031, fingerprint: "a" }, { season: 2031, fingerprint: "b" },
		{ season: 2031, fingerprint: "a" }, { season: 2032, extrapolated: true }]);
	ok("rows are keyed per file and occurrence, not per season",
		new Set(keys).size === 4, keys.join(" "));
}

console.log("\nThe carry: gaps, guesses, levels, the carousel");
{
	const fl6 = files([2025, 2026, 2027, 2028, 2029, 2030], 60);
	const w = drive(spec(fl6));
	const res0 = w.results[0];
	const carry0 = U.harvest(res0, null);
	ok("a gap clears last season's champion but keeps his banner",
		carry0.champion && U.ageCarry(carry0, 1).champion === null &&
		U.ageCarry(carry0, 1).titles[carry0.champion] === carry0.titles[carry0.champion]);
	/* The carried level is the programme's, not the coached one. */
	let checked = 0;
	let wrong = 0;
	for (const t of Object.values(res0.teams)) {
		if (!t || !t.log || !t.coach || !t.coach.levelAdj) continue;
		const want = t.level - t.coach.levelAdj + U.PRESTIGE_CAP * 0 +
			(0.62 / 0.38) * carry0.prestigeDelta[t.name];
		if (want < 5 || want > 99) continue;
		checked++;
		if (Math.abs(carry0.levels[t.name] - want) > 1e-9) wrong++;
	}
	ok("the carried level excludes the coach's situation adjustment",
		checked > 0 && wrong === 0, wrong + " of " + checked);
	const tail = w.u.tail.carry;
	ok("prestige drift is bounded",
		Object.values(tail.prestigeDelta).every((d) => Math.abs(d) <= U.PRESTIGE_CAP));
	ok("prestige drift moves somebody", Object.values(tail.prestigeDelta)
		.some((d) => Math.abs(d) >= 2));
	/* Guessed titles are credited in the guessed world. */
	const gap = U.extrapolateGap(tail, 2030, 2045, "harness");
	const counts = {};
	for (const r of gap) counts[r.champion] = (counts[r.champion] || 0) + 1;
	ok("fourteen guessed seasons credit their champions",
		gap.every((r) => !r.champion || Number.isFinite(r.titlesAfter)));
	const rec = U.records(w.u.rows.concat(gap), w.u.alumni);
	ok("the records book says which titles were guessed",
		rec.titles.some((x) => x.extrapolated > 0));
	/* The carousel moves men. */
	let moved = 0;
	let arrived = 0;
	for (let i = 0; i + 1 < w.results.length; i++) {
		const c = U.harvest(w.results[i], null);
		for (const school of Object.keys(c.coaches)) {
			const rec2 = c.coaches[school];
			if (rec2.reason !== "hired") continue;
			moved++;
			const t = w.results[i + 1].teams[school];
			if (t && t.coach && t.coach.name === rec2.coach.name) arrived++;
		}
	}
	ok("a coach hired away arrives at the programme that hired him",
		moved === 0 || arrived === moved, arrived + " of " + moved);
	ok("the rivalry book fills from the bracket",
		Object.keys(tail.rivalries).length > 0 &&
		Object.keys(tail.rivalries).length <= U.RIVALRY_MAX);
	const book = { "Duke|North Carolina": { a: "Duke", b: "North Carolina", games: 14,
		aw: 9, bw: 5, march: [2027, 2029, 2031] } };
	const riv = U.rivalryThreads(book);
	ok("three March meetings in five years is a thread",
		riv.length === 1 && /met in March 3 times in 5 years/.test(riv[0].text), riv[0] && riv[0].text);
	ok("threads() reads the rivalry book",
		U.threads(w.u.rows, w.u.alumni, { rivalries: book }).some((t) => t.kind === "rivalry"));
	const hist = U.programHistory(w.u, "Duke");
	ok("a programme has a history row for every played season",
		hist.length === 6 && hist.every((h) => h.coach && h.conf && Number.isFinite(h.level)));
	ok("...with a running title count",
		Object.values(U.programHistory(w.u)).every((list) =>
			list.every((h, i) => h.titles === list.slice(0, i + 1).filter((x) => x.title).length)));
	ok("the records book has a page for people",
		w.u.records.people && Array.isArray(w.u.records.people.mostSeasons) &&
		w.u.records.people.mostSeasons.length > 0);
}

console.log("\nFile checks and the merged players file");
{
	const fl = files([2025, 2026, 2026, 2031]);
	const diags = U.validate(fl);
	ok("two different classes of the same size are not called duplicates",
		diags.every((d) => d.warnings.every((w) => !/same players/.test(w))));
	const twin = { name: "copy.json", fingerprint: "other",
		data: clone(fl[0].data) };
	ok("the same class loaded twice still is",
		U.validate([fl[0], twin])[1].warnings.some((w) => /same players/.test(w)));
	/* The same men in two files: one player each, in one season list. */
	const a1 = files([2025])[0];
	const a2 = { name: "again.json", fingerprint: "again", data: clone(a1.data) };
	a2.data.startingSeason = 2026;
	for (const p of a2.data.players) p.draft = Object.assign({}, p.draft, { year: 2026 });
	const dupWorld = drive(spec([a1, a2]));
	const merged2 = E.universePlayersFile(dupWorld.results, { stats: true, prior: true,
		awards: true, seed: "harness" });
	ok("a man in two files is merged", merged2.duplicates > 0, merged2.duplicates + " merged");
	ok("...and sits in exactly one season list",
		merged2.seasons.reduce((x, f) => x + f.players, 0) === merged2.file.players.length);
	ok("...with his awards deduped",
		merged2.file.players.every((p) => {
			const seen = new Set();
			for (const aw of p.awards || []) {
				const k = aw.season + "|" + aw.type;
				if (seen.has(k)) return false;
				seen.add(k);
			}
			return true;
		}));
}

console.log("\n" + (failures ? failures + " of " + checks + " checks FAILED"
	: "all " + checks + " checks passed") + "\n");
process.exit(failures ? 1 : 0);
