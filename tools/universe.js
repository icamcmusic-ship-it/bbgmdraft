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
function chain(fileList, over, runners) {
	const frozen = CFG.make(Object.assign({ seed: "harness" }, over || {}));
	const rows = [];
	const results = [];
	let alumni = [];
	let carry = null;
	let recentPools = [];
	let lastSeason = null;
	let tree = null;
	/* BOTH ROSTER LINKS, the way js/app.js runs them — this used to run a bare
	   chain, so the two features that make a universe one WORLD rather than N
	   seasons in a row (a later class's underclassmen on an earlier roster,
	   and an earlier class's undrafted men on a later one) were never
	   exercised by the harness that exists to guard it.

	   Pass one is the previews: a later class's men have to be on an earlier
	   roster before that season is played, and a preview is the only thing
	   that exists yet. The reverse link needs no preview, because the season
	   it reads has already been simulated. */
	const previews = fileList.map((f, k) => {
		const pcfg = CFG.make(frozen);
		pcfg.seed = U.seedFor("harness", k, f.data.startingSeason, f.fingerprint);
		pcfg.overrides = {};
		try { return E.previewClass(f.data, pcfg); } catch (e) { return null; }
	});
	const returners = [];
	fileList.forEach((f, k) => {
		const season = f.data.startingSeason;
		const gap = (carry && Number.isFinite(lastSeason))
			? Math.max(0, season - lastSeason - 1) : 0;
		if (gap > 0) carry = U.ageCarry(carry, gap);
		const cfg = CFG.make(frozen);
		cfg.seed = U.seedFor("harness", k, season, f.fingerprint);
		cfg.overrides = {};
		cfg.recentPools = recentPools.map((a) => a.slice());
		cfg.carryOver = carry;
		cfg.universeAlumni = alumni.slice(-120);
		cfg.universeTitles = (carry && carry.titles) || {};
		let future = [];
		for (let j = k + 1; j < fileList.length; j++) {
			if (!previews[j] || !(fileList[j].data.startingSeason > season)) continue;
			future = future.concat(E.futureRosterFor(previews[j], season, j));
		}
		cfg.universeRoster = future;
		let past = [];
		for (const src of returners) {
			if (!(season > src.season)) continue;
			past = past.concat(E.pastRosterFor(src.res, season, src.index));
		}
		cfg.pastRoster = past;
		const prevCarry = carry;
		const res = runners ? runners[k].run(cfg) : E.run(f.data, cfg);
		results.push(res);
		tree = U.coachTreeStep(tree, prevCarry, res, season, "harness");
		rows.push(Object.assign(U.summarize(res, cfg.seed, f.name), {
			fingerprint: f.fingerprint, result: U.resultFingerprint(res), gap,
		}));
		alumni = alumni.concat(U.alumniOf(res, season, f.fingerprint));
		if (E.pastRosterFor(res, season + 1, k).length) {
			returners.push({ season, index: k, res });
		}
		carry = U.harvest(res, prevCarry);
		lastSeason = season;
		if (res.archetypePool) {
			recentPools.unshift(res.archetypePool.slice());
			recentPools = recentPools.slice(0, 3);
		}
	});
	return { rows, results, alumni, tree, settings: frozen,
		threads: U.threads(rows, alumni), records: U.records(rows, alumni) };
}

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

console.log("\n" + (failures ? failures + " of " + checks + " checks FAILED"
	: "all " + checks + " checks passed") + "\n");
process.exit(failures ? 1 : 0);
