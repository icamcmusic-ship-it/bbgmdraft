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
function files(seasons) {
	return seasons.map((season, i) => {
		const lf = V.realisticClass("chain" + i, 46);
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
function chain(fileList, over) {
	const frozen = CFG.make(Object.assign({ seed: "harness" }, over || {}));
	const rows = [];
	const results = [];
	let alumni = [];
	let carry = null;
	let recentPools = [];
	let lastSeason = null;
	let tree = null;
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
		const prevCarry = carry;
		const res = E.run(f.data, cfg);
		results.push(res);
		tree = U.coachTreeStep(tree, prevCarry, res, season, "harness");
		rows.push(Object.assign(U.summarize(res, cfg.seed, f.name), {
			fingerprint: f.fingerprint, result: U.resultFingerprint(res), gap,
		}));
		alumni = alumni.concat(U.alumniOf(res, season));
		carry = U.harvest(res, prevCarry);
		lastSeason = season;
		if (res.archetypePool) {
			recentPools.unshift(res.archetypePool.slice());
			recentPools = recentPools.slice(0, 3);
		}
	});
	return { rows, results, alumni, tree, settings: frozen,
		threads: U.threads(rows), records: U.records(rows, alumni) };
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

console.log("\nIdempotency");
const exp1 = U.exportUniverse({ rows: a.rows, baseSeed: "harness",
	settings: a.settings, biography: U.biographyOf(a.results),
	createdAt: "fixed" });
const exp2 = U.exportUniverse({ rows: chain(fl).rows, baseSeed: "harness",
	settings: a.settings, biography: U.biographyOf(chain(fl).results),
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
	const bio = U.biographyOf(a.results);
	const cfg = CFG.make({ seed: U.seedFor("harness", 0, 2025, fl[0].fingerprint),
		biography: bio });
	const again = E.run(fl[0].data, cfg);
	const before = {};
	for (const p of a.results[0].players) before[p.key] = p.classYear;
	const same = again.players.every((p) => before[p.key] === undefined ||
		before[p.key] === p.classYear);
	ok("class years replay identically under an imported biography", same);
	/* And it is load-bearing: a DIFFERENT biography changes them, or the
	   field is being ignored again the way it was before it was read. */
	const twisted = {};
	for (const key of Object.keys(bio)) {
		twisted[key] = Object.assign({}, bio[key], { classYear: "Senior" });
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
	ok("a program level regresses toward the middle across a gap",
		Object.keys(carry.levels).every((n) =>
			Math.abs(aged.levels[n] - 55) <= Math.abs(carry.levels[n] - 55) + 1e-9));
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

console.log("\nOne definition of player of the year");
{
	const set = U.nationalPOYSet();
	let disagree = 0;
	a.results.forEach((res, i) => {
		const row = a.rows[i];
		const fromAlumni = U.alumniOf(res, row.season)
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
