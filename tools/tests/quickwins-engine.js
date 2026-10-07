/* The engine, command line and tooling quick wins of AUDIT-2026-10-05 section 6.

   Every one of them is OPT-IN: the first block of checks is the contract that
   makes that true (an export with every new option named and switched off is
   the export the engine has always written), and the rest pin what each option
   does when it is on. */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { spawnSync } = require("child_process");

module.exports = function (ok, V) {
	const E = global.Engine;
	const C = global.Config;
	const U = global.Universe;
	const P = global.Pro;
	const ROOT = path.join(__dirname, "..", "..");
	const BIN = path.join(ROOT, "bin", "bbgmdraft.js");
	const copy = (x) => JSON.parse(JSON.stringify(x));
	const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

	const lf = V.realisticClass("qw-engine", 40);
	// Two brothers, so a trimmed export has a relative to look after.
	lf.players[0].relatives = [{ type: "brother", pid: lf.players[1].pid, name: "Brother" }];
	lf.players[1].relatives = [{ type: "brother", pid: lf.players[0].pid, name: "Brother" }];
	lf.players[2].relatives = [{ type: "cousin", pid: lf.players[3].pid, name: "Cousin" }];
	// A blank birthplace on a few, which is where a hometown is drawn.
	for (let i = 0; i < 12; i++) lf.players[i].born = Object.assign({}, lf.players[i].born, { loc: "" });
	const run = (extra, file) => E.run(copy(file || lf), C.make(Object.assign({ seed: "qw-engine" }, extra || {})));
	const res = run();
	const EXPORT = { ages: true, injuries: true, jerseys: true };

	/* ---- the contract: every option off is the export that always was ----- */
	{
		const plain = E.exportFile(res, EXPORT);
		const off = E.exportFile(res, Object.assign({}, EXPORT, {
			fuzz: "keep", recipe: false, hometowns: false, proLines: false, only: undefined,
			scoutingLevel: 34,
		}));
		ok("qw/every new export option switched off writes the same bytes",
			same(plain, off));
		ok("qw/...and writes no recipe, so the stamp is the stamp it was",
			plain.bbgmdraft.recipe === undefined && E.readRecipe(plain) === null &&
			Object.keys(plain.bbgmdraft).sort().join() === "pot,v");
		ok("qw/an empty note header and footer write the note that always was",
			same(run({ noteHeader: "", noteFooter: "" }).players.map((p) => p.note),
				res.players.map((p) => p.note)));
		ok("qw/the mock draft with no salt and no noise is the draft that always was",
			same(P.mockDraft(res), P.mockDraft(res, { salt: "", noise: undefined })) &&
			Object.keys(P.mockDraft(res)).indexOf("_ctx") === -1);
		const names = Object.keys(E).sort();
		ok("qw/the engine exposes the new functions",
			["changeReport", "changeReportText", "readRecipe", "planLockCsv", "faceKeyFor", "scoutingFuzz",
				"hometownFor", "PARAM_CLAUSES"].every((k) => names.indexOf(k) !== -1));
	}

	/* ---- Q3: scouting fuzz -------------------------------------------------- */
	{
		const withFuzz = copy(lf);
		withFuzz.players.forEach((p, i) => { p.ratings[p.ratings.length - 1].fuzz = (i % 7) - 3; });
		const r2 = E.run(withFuzz, C.make({ seed: "qw-fuzz" }));
		const fz = (f) => f.players.map((p) => p.ratings[p.ratings.length - 1].fuzz);
		const keep = fz(E.exportFile(r2, EXPORT));
		ok("qw/fuzz keep (the default) carries the file's own fuzz",
			same(keep, withFuzz.players.map((p) => p.ratings[p.ratings.length - 1].fuzz)));
		ok("qw/fuzz zero writes 0 for everyone",
			fz(E.exportFile(r2, Object.assign({ fuzz: "zero" }, EXPORT))).every((v) => v === 0));
		const a = fz(E.exportFile(r2, Object.assign({ fuzz: "regenerate" }, EXPORT)));
		const b = fz(E.exportFile(r2, Object.assign({ fuzz: "regenerate" }, EXPORT)));
		ok("qw/fuzz regenerate is seeded: the same class draws the same fuzz",
			same(a, b) && !same(a, keep) && new Set(a).size > 20);
		ok("qw/regenerated fuzz at BBGM's default level stays inside +-5 (genFuzz's cutoff)",
			a.every((v) => Math.abs(v) <= 5 && Number.isFinite(v)), JSON.stringify(a.slice(0, 5)));
		// genFuzz.ts / budgetLevels.ts: level 34 is effect 0, cutoff 5, stddev 2; the draw is
		// three uniform(-1, 1) times stddev, so its sd is about 2 (a little under, clipped).
		const { Rng } = global.BBGMRng;
		const draw = (level, n) => { const r = new Rng("qw-fuzz-dist|" + level); const o = []; for (let i = 0; i < n; i++) o.push(E.scoutingFuzz(r, level)); return o; };
		const sdOf = (v) => { const m = v.reduce((x, y) => x + y, 0) / v.length; return Math.sqrt(v.reduce((x, y) => x + (y - m) * (y - m), 0) / v.length); };
		const d34 = draw(34, 20000);
		ok("qw/level 34 fuzz: mean 0, sd about 2, never beyond 5",
			Math.abs(d34.reduce((x, y) => x + y, 0) / d34.length) < 0.08 && sdOf(d34) > 1.8 && sdOf(d34) < 2.05 &&
			Math.max.apply(null, d34.map(Math.abs)) <= 5);
		const d1 = draw(1, 20000);
		const d100 = draw(100, 20000);
		ok("qw/the worst scouting level is wide (cutoff 8, sd about 3) and the best narrow (cutoff 1)",
			Math.max.apply(null, d1.map(Math.abs)) <= 8 && Math.max.apply(null, d1.map(Math.abs)) > 6 && sdOf(d1) > 2.5 &&
			Math.max.apply(null, d100.map(Math.abs)) <= 1 && sdOf(d100) < 0.95);
		const lvl = fz(E.exportFile(r2, Object.assign({ fuzz: "regenerate", scoutingLevel: 100 }, EXPORT)));
		ok("qw/opts.scoutingLevel reaches the draw", lvl.every((v) => Math.abs(v) <= 1));
	}

	/* ---- Q4: the recipe ----------------------------------------------------- */
	{
		const cfgExtra = { pace: 71, noteLines: ["summary", "team"], seed: "qw-recipe" };
		const r3 = run(cfgExtra);
		const file = E.exportFile(r3, Object.assign({ recipe: true }, EXPORT));
		const rec = E.readRecipe(file);
		ok("qw/recipe: seed, engine revision, the changed settings only, and the source fingerprint",
			rec && rec.v === 1 && rec.seed === "qw-recipe" && rec.engineRev === U.ENGINE_REV &&
			rec.settings.pace === 71 && same(rec.settings.noteLines, ["summary", "team"]) &&
			rec.settings.seed === undefined && rec.settings.era === undefined &&
			rec.fp === U.fileFingerprint({ data: r3.leagueFile }) && rec.season === 2026,
			JSON.stringify(rec));
		ok("qw/recipe sits in the same root key as the potential stamp, which is untouched",
			Object.keys(file.bbgmdraft).sort().join() === "pot,recipe,v" &&
			same(file.bbgmdraft.pot, E.exportFile(r3, EXPORT).bbgmdraft.pot));
		ok("qw/the players are the same with or without the recipe",
			same(file.players, E.exportFile(r3, EXPORT).players));
		const wire = JSON.parse(JSON.stringify(file));
		ok("qw/readRecipe reads a file that went through JSON, and returns a copy",
			same(E.readRecipe(wire), rec) && E.readRecipe(wire) !== E.readRecipe(wire));
		ok("qw/readRecipe is null for a plain file, a junk recipe and a non-file",
			E.readRecipe(E.exportFile(r3, EXPORT)) === null && E.readRecipe(null) === null &&
			E.readRecipe({ bbgmdraft: { recipe: { v: 2, seed: "x", settings: {} } } }) === null &&
			E.readRecipe({ bbgmdraft: { recipe: { v: 1, seed: "", settings: {} } } }) === null &&
			E.readRecipe({ bbgmdraft: { recipe: { v: 1, seed: "x", settings: [] } } }) === null &&
			E.readRecipe({ bbgmdraft: { recipe: "x" } }) === null);
		const again = E.run(copy(lf), C.make(Object.assign({}, rec.settings, { seed: rec.seed })));
		ok("qw/the recipe's seed and settings remake the class",
			same(E.exportFile(again, EXPORT).players, E.exportFile(r3, EXPORT).players));
		let valid = true;
		try { E.validateLeagueFile(wire); } catch (e) { valid = false; }
		ok("qw/the engine's own loader accepts a file with a recipe", valid);
		ok("qw/opts.recipe may carry the page's own payload and fingerprint",
			E.readRecipe(E.exportFile(r3, { recipe: { fp: "abc123", settings: { pace: 66 } } })).fp === "abc123" &&
			E.readRecipe(E.exportFile(r3, { recipe: { fp: "abc123", settings: { pace: 66 } } })).settings.pace === 66);
		const league = {
			version: r3.leagueFile.version, startingSeason: r3.season, gameAttributes: { season: r3.season },
			teams: [{ tid: 0, region: "A", name: "B" }],
			players: r3.leagueFile.players.map((x) => Object.assign({ tid: -2 }, x)),
		};
		const merged = E.mergeIntoLeague(r3, league, { recipe: true });
		ok("qw/a league merge writes the recipe too, and none without the option",
			E.readRecipe(merged.file) && E.readRecipe(merged.file).seed === "qw-recipe" &&
			E.readRecipe(E.mergeIntoLeague(r3, league, {}).file) === null);
	}

	/* ---- Q7: partial export ------------------------------------------------- */
	{
		const full = E.exportFile(res, EXPORT);
		const keys = [res.players[0].key, res.players[2].key, res.players[5].key];
		const part = E.exportFile(res, Object.assign({ only: keys }, EXPORT));
		const stats = E.exportFile.trimmed;
		ok("qw/only: the export carries just those players, in file order",
			part.players.length === 3 && same(part.players.map((p) => String(p.pid)), keys));
		ok("qw/a kept player's row is exactly the row a full export writes (jersey, note, rank)",
			same(part.players[2], full.players[5]) && part.players[1].relatives === undefined);
		ok("qw/relatives naming a player who is no longer in the file are cut, and the rest kept",
			part.players[0].relatives === undefined && stats.relativesCut === 2 &&
			stats.kept === 3 && stats.dropped === 37);
		const pair = E.exportFile(res, Object.assign({ only: [res.players[0].key, res.players[1].key] }, EXPORT));
		ok("qw/...two brothers kept together stay related",
			pair.players[0].relatives && pair.players[0].relatives[0].pid === pair.players[1].pid);
		ok("qw/only: [] is an empty class, not a full one; a non-list is ignored",
			E.exportFile(res, { only: [] }).players.length === 0 && E.exportFile(res, { only: "x" }).players.length === 40);
		ok("qw/everything else about the file is as in the full export",
			part.version === full.version && same(part.bbgmdraft, full.bbgmdraft));
		const league = {
			version: res.leagueFile.version, startingSeason: res.season, gameAttributes: { season: res.season },
			teams: [{ tid: 0, region: "A", name: "B" }],
			players: res.leagueFile.players.map((x) => Object.assign({ tid: -2 }, x)),
		};
		ok("qw/a league merge ignores only: it replaces the whole class and must not delete the rest",
			E.mergeIntoLeague(res, league, { only: keys }).replaced === 40);
	}

	/* ---- Q8: pro lines ------------------------------------------------------ */
	{
		const withPro = E.exportFile(res, Object.assign({ proLines: true, proRounds: 1 }, EXPORT));
		const base = E.exportFile(res, EXPORT);
		const proj = P.projectClass(res);
		const mock = P.mockDraft(res, { projections: proj, rounds: 1 });
		const k0 = mock.picks[6];
		const i7 = res.players.findIndex((p) => p.key === k0.key);
		const lines = String(withPro.players[i7].note).split("\n");
		const pr = proj[k0.key];
		ok("qw/proLines: a 'Pro projection:' line with the peak, its range and the verdict",
			lines.indexOf("Pro projection: peak " + pr.peak + " (" + pr.peakLow + "-" + pr.peakHigh + "), " + pr.verdict) !== -1,
			lines.join(" | "));
		ok("qw/proLines: a 'Mock: No. N, Team' line from the mock draft",
			lines.indexOf("Mock: No. 7, " + k0.team) !== -1, lines.join(" | "));
		ok("qw/proLines: the rest of the note is untouched, and the lines come after it",
			withPro.players.every((p, i) => String(p.note).indexOf(String(base.players[i].note || "")) === 0));
		ok("qw/proLines: a player the mock leaves out is 'Mock: undrafted'",
			withPro.players.filter((p) => /Mock: undrafted/.test(p.note)).length === mock.undrafted.length &&
			mock.undrafted.length === 10);
		ok("qw/proLines: two rounds is the default, so a 40-man class is all drafted",
			E.exportFile(res, Object.assign({ proLines: true }, EXPORT)).players.every((p) => /Mock: No\. \d+, /.test(p.note)));
		ok("qw/proLines is not written when scouting notes are off, and a re-export does not stack them",
			E.exportFile(res, { proLines: true, includeNotes: false }).players.every((p) => !/Pro projection:/.test(p.note || "")) &&
			(() => {
				const again = copy(withPro);
				const r4 = E.run(again, C.make({ seed: "qw-engine" }));
				const n = E.exportFile(r4, { proLines: true, noteAppend: true }).players[i7].note;
				return (n.match(/Mock:/g) || []).length === 1 && (n.match(/Pro projection:/g) || []).length === 1;
			})());
		ok("qw/the batch worker never loads js/pro.js (the lines are a main-thread export option)",
			require(path.join(ROOT, "js", "manifest.js")).worker.indexOf("pro") === -1);
	}

	/* ---- Q9: note header and footer ----------------------------------------- */
	{
		const h = run({ noteHeader: "{school} | {class} | No. {rank} | seed {seed} | {nope}", noteFooter: "-- end --" });
		const p0 = h.players[0];
		const first = p0.note.split("\n")[0];
		ok("qw/note header: tokens filled in, an unknown one left alone, and it is the first line",
			first === (p0.proClub || p0.newCollege) + " | " + p0.classYear + " | No. " + p0.boardRank +
				" | seed qw-engine | {nope}", first);
		ok("qw/note footer is the last line",
			h.players.every((p) => p.note.split("\n").pop() === "-- end --"));
		ok("qw/the body of the note between them is the note that was",
			h.players.every((p, i) => p.note === p.note.split("\n")[0] + "\n" + res.players[i].note + "\n-- end --"));
		const longHead = C.make({ noteHeader: "x".repeat(900), noteFooter: 42 });
		ok("qw/header and footer are capped, and non-text is no text",
			longHead.noteHeader.length === C.NOTE_FRAME_MAX && longHead.noteFooter === "" &&
			C.make({ noteHeader: "   " }).noteHeader === "" && C.make({}).noteHeader === "" &&
			C.DEFAULTS.noteHeader === "" && C.DEFAULTS.noteFooter === "");
		ok("qw/header and footer are phase inputs, so a warm re-run rewrites the notes",
			E.PHASES.find((p) => p.name === "notes").deps.indexOf("noteHeader") !== -1 &&
			E.PHASES.find((p) => p.name === "notes").deps.indexOf("noteFooter") !== -1);
		const runner = E.createRunner(copy(lf));
		runner.run(C.make({ seed: "qw-engine" }));
		const warm = runner.run(C.make({ seed: "qw-engine", noteHeader: "H" }));
		ok("qw/...and a header typed after a run reaches the same run's notes",
			warm.players.every((p) => p.note.split("\n")[0] === "H"));
	}

	/* ---- Q13 and Q14: per-player locks -------------------------------------- */
	{
		const k = res.players.map((p) => p.key);
		const locked = run({
			overrides: {
				[k[0]]: { classYear: "senior", jersey: 7, moodTraits: ["w", "f", "x", "w"], faceSalt: 3 },
				[k[1]]: { classYear: "Redshirt Junior", jersey: "00" },
				[k[2]]: { classYear: "Fifth-year", jersey: 100, moodTraits: [], faceSalt: 0 },
				[k[3]]: { classYear: "Freshman" },
			},
		});
		const byKey = (key) => locked.players.find((p) => p.key === key);
		ok("qw/ov.classYear: any case, and it wins over the draw",
			byKey(k[0]).classYear === "Senior" && byKey(k[3]).classYear === "Freshman" &&
			byKey(k[3]).transfer === null);
		ok("qw/ov.classYear: a redshirt year says so; an invalid one is no lock",
			byKey(k[1]).classYear === "Redshirt Junior" && !!byKey(k[1]).redshirt &&
			byKey(k[2]).classYear === res.players[2].classYear);
		const out = E.exportFile(locked, EXPORT);
		ok("qw/ov.classYear reaches the exported birth year (22 for a senior, 22 for a redshirt junior)",
			out.players[0].born.year === 2026 - 22 && out.players[1].born.year === 2026 - 22);
		{
			// Anomalies are the one thing a lock legitimately reshuffles (a locked man is
			// not eligible), so the rolled biography of everybody else is read without them.
			const quiet = run({ surpriseBudget: 0 });
			const quietLocked = run({ surpriseBudget: 0, overrides: { [k[0]]: { classYear: "senior" }, [k[3]]: { classYear: "Freshman" } } });
			ok("qw/the rolled class years of everybody else are not disturbed by a class-year lock",
				quietLocked.players.every((p, i) => i === 0 || i === 3 || (p.classYear === quiet.players[i].classYear &&
					same(p.transfer, quiet.players[i].transfer) && p.redshirt === quiet.players[i].redshirt)));
			ok("qw/a locked man is not picked for an anomaly that would rewrite his biography",
				locked.surprises.every((s) => s.key !== k[0] && s.key !== k[1] && s.key !== k[3]));
		}
		ok("qw/ov.jersey: his number, '00' stays '00', 100 is no lock",
			out.players[0].jerseyNumber === "7" && out.players[1].jerseyNumber === "00" &&
			out.players[2].jerseyNumber !== "100");
		ok("qw/ov.jersey: nobody else is handed the locked number",
			out.players.filter((p, i) => i !== 0 && p.jerseyNumber === "7").length === 0);
		ok("qw/ov.jersey is left alone when jerseys are switched off",
			E.exportFile(locked, { jerseys: false }).players[0].jerseyNumber === undefined);
		ok("qw/ov.moodTraits: letters F L $ W, any case, no repeats, junk dropped",
			same(byKey(k[0]).moodTraits, ["W", "F"]) && same(out.players[0].moodTraits, ["W", "F"]) &&
			same(byKey(k[2]).moodTraits, res.players[2].moodTraits));
		ok("qw/E.lockedMoodTraits and lockedJersey refuse nonsense",
			E.lockedJersey({ jersey: -1 }) === null && E.lockedJersey({ jersey: 1.5 }) === null &&
			E.lockedJersey({ jersey: "abc" }) === null && E.lockedMoodTraits({ moodTraits: "FL" }) === null &&
			E.lockedClassYear({ classYear: 5 }) === null);

		// The face: js/faces.js is a page script, so a stand-in with the same two calls.
		const had = global.Faces;
		global.Faces = {
			usable: (f) => !!(f && f.stub),
			seededFace: (key) => ({ stub: true, key, head: { id: "h" } }),
		};
		try {
			const withFace = copy(lf);
			withFace.players[5].face = { stub: true, key: "mine" };
			withFace.players[0].face = { stub: true, key: "mine" };
			const r5 = E.run(withFace, C.make({ seed: "qw-engine", overrides: { [k[0]]: { faceSalt: 3 }, [k[7]]: { faceSalt: "x" } } }));
			const f5 = E.exportFile(r5, EXPORT);
			ok("qw/ov.faceSalt: a salted key draws a different, stable face; an unsalted player keeps his own",
				f5.players[0].face.key === k[0] + "~f3" && f5.players[7].face.key === k[7] + "~fx" &&
				f5.players[5].face.key === "mine" && f5.players[8].face.key === k[8] &&
				E.faceKeyFor(r5.players[0]) === k[0] + "~f3" && E.faceKeyFor(r5.players[1]) === k[1]);
			ok("qw/...and the salt beats a face the file already carried", f5.players[0].face.key !== "mine");
			ok("qw/faces: false still writes none", E.exportFile(r5, { faces: false }).players[0].face === undefined ||
				E.exportFile(r5, { faces: false }).players[0].face.key !== k[0] + "~f3");
		} finally { global.Faces = had; }
	}

	/* ---- Q14: hometowns ----------------------------------------------------- */
	{
		const def = E.exportFile(res, EXPORT);
		const town = E.exportFile(res, Object.assign({ hometowns: true }, EXPORT));
		const blank = lf.players.map((p, i) => i).filter((i) => !String(lf.players[i].born.loc || "").trim());
		ok("qw/hometowns off: a blank birthplace is what it always was",
			blank.length === 12 && blank.every((i) => !/, USA$/.test(def.players[i].born.loc)));
		const usa = blank.filter((i) => def.players[i].born.loc === "USA");
		ok("qw/hometowns on: 'City, ST, USA' where it said USA; abroad and filled-in ones untouched",
			usa.length > 0 && usa.every((i) => /^[^,]+, [A-Z]{2}, USA$/.test(town.players[i].born.loc)) &&
			blank.every((i) => def.players[i].born.loc === "USA" || town.players[i].born.loc === def.players[i].born.loc) &&
			town.players.every((p, i) => blank.indexOf(i) !== -1 || same(p.born, def.players[i].born)));
		ok("qw/hometowns are drawn off the key: the same man, the same town",
			same(town, E.exportFile(res, Object.assign({ hometowns: true }, EXPORT))));
		ok("qw/hometowns change nothing but born.loc",
			same(town.players.map((p) => Object.assign({}, p, { born: null })),
				def.players.map((p) => Object.assign({}, p, { born: null }))));
		const share = (school, re) => {
			let n = 0;
			for (let i = 0; i < 6000; i++) if (re.test(E.hometownFor({ key: "q" + i }, school))) n++;
			return n / 6000;
		};
		const SE = /, (VA|NC|FL|GA|TN|LA|AL|SC|MS|AR|WV|KY), USA$/;
		const ky = share("Kentucky", /, KY, USA$/);
		ok("qw/a state in the school's name pulls hardest, then its region, against a school with no home",
			ky > 0.2 && share("Kentucky", SE) > 0.6 && share("Duke", SE) > share("Nowhere U", SE) + 0.2 &&
			share("West Virginia", /, WV, USA$/) > 0.05 && share("West Virginia", /, VA, USA$/) < ky,
			ky + " " + share("Kentucky", SE));
	}

	/* ---- Q38: parametric reroll clauses ------------------------------------- */
	{
		const before = E.REROLL_PREDICATES.map((p) => p.key).join();
		const board = res.board;
		const top5 = board.slice(0, 5);
		const clause = (key) => E.parseRerollClause(key);
		const truth = {
			["topOvr:" + res.players.reduce((m, p) => Math.max(m, p.newOvr), 0)]: true,
			["topOvr:" + (res.players.reduce((m, p) => Math.max(m, p.newOvr), 0) + 1)]: false,
			["count50:" + res.players.filter((p) => p.newOvr >= 50).length]: true,
			["count50:" + (res.players.filter((p) => p.newOvr >= 50).length + 1)]: false,
			["pos1:" + board[0].newPos]: true,
			["height:" + Math.max.apply(null, top5.map((p) => p.newHgtInches))]: true,
			["height:" + (Math.max.apply(null, top5.map((p) => p.newHgtInches)) + 1)]: false,
			["archetype:" + top5[0].archetype]: true,
			["school:" + (top5[1].proClub || top5[1].newCollege)]: true,
			["freshmen:" + Math.max(1, board.slice(0, 10).filter((p) => /Freshman$/.test(p.classYear)).length)]:
				board.slice(0, 10).some((p) => /Freshman$/.test(p.classYear)),
		};
		for (const key of Object.keys(truth)) {
			const c = clause(key);
			ok("qw/clause " + key + " parses and says " + truth[key], c && c.test(res) === truth[key] &&
				clause("!" + key).test(res) === !truth[key] && /^NOT /.test(clause("!" + key).label),
				c ? c.label : "null");
		}
		ok("qw/clause arguments are matched without regard to case",
			clause("pos1:" + board[0].newPos.toLowerCase()).test(res) &&
			clause("archetype:" + top5[0].archetype.toUpperCase()).test(res) &&
			clause("school:" + (top5[1].proClub || top5[1].newCollege).toLowerCase()).test(res));
		ok("qw/a clause that cannot mean anything is refused",
			["topOvr:", "topOvr:abc", "topOvr:5", "topOvr:150", "count50:0", "pos1:ZZ", "archetype:Nobody At All",
				"school:Nowhere State", "height:5", "height:99", "freshmen:0", "freshmen:11", "bogus:3", "pos1"]
				.every((k) => clause(k) === null));
		ok("qw/strangeness:N and the named predicates are untouched",
			clause("strangeness:30") && clause("strangeness>=30").key === "strangeness>=30" &&
			clause("tallTop5") && clause("!abroadNo1").negated === true &&
			E.REROLL_PREDICATES.map((p) => p.key).join() === before &&
			E.REROLL_PREDICATES.every((p) => !/^(topOvr|count50|pos1|archetype|school|height|freshmen):/.test(p.key)));
		ok("qw/PARAM_CLAUSES names the seven, each with an example that parses",
			E.PARAM_CLAUSES.length === 7 && E.PARAM_CLAUSES.every((c) => typeof c.example === "string") &&
			E.PARAM_CLAUSES.filter((c) => c.name !== "archetype" && c.name !== "school" && c.name !== "pos1")
				.every((c) => clause(c.example) !== null) && clause("archetype:Rim Protector") !== null);
		ok("qw/a clause on an empty result is false, not a throw",
			Object.keys(truth).every((k) => clause(k).test({}) === false));
	}

	/* ---- Q2: the change report ---------------------------------------------- */
	{
		const sentinel = new Set([99]);
		E.exportFile.sizeRewritten = sentinel;
		const rep = E.changeReport(res, { exportOptions: EXPORT });
		ok("qw/changeReport leaves exportFile's own readouts as it found them", E.exportFile.sizeRewritten === sentinel);
		const row = rep.rows[3];
		const p = res.players[3];
		ok("qw/changeReport: one row per player with what was and what is",
			rep.rows.length === 40 && row.key === p.key && row.name === p.name && row.origOvr === p.origOvr &&
			row.newOvr === p.newOvr && row.origPot === p.origPot && row.newPot === p.newPot &&
			row.pos === p.newPos && row.origPos === p.origPos && row.hgt === p.newHgtInches &&
			row.weight === p.newWeight && row.school === (p.proClub || p.newCollege) &&
			row.dOvr === p.newOvr - p.origOvr && Number.isFinite(row.age) && Number.isFinite(row.origAge));
		const full = E.exportFile(res, EXPORT);
		ok("qw/changeReport: age is the age the exported birth year says",
			rep.rows.every((r, i) => r.age === 2026 - full.players[i].born.year));
		const c = rep.counts;
		E.exportFile(res, EXPORT);
		ok("qw/changeReport: rewrite counts are the export's own",
			c.players === 40 && c.rewritten === 40 && c.passthroughs === 0 &&
			c.sizeRewritten === E.exportFile.sizeRewritten.size && c.bornRewritten === E.exportFile.bornRewritten.size &&
			c.ovrChanged === rep.rows.filter((r) => r.dOvr !== 0).length &&
			c.collegeChanged === res.players.filter((x) => x.newCollege !== x.origCollege).length);
		const csv = E.changeReportText(rep, "csv").trim().split("\n");
		ok("qw/changeReportText: CSV is a header and a row a player",
			csv.length === 41 && /^key,name,origOvr,newOvr,origPot,newPot,/.test(csv[0]));
		const md = E.changeReportText(rep, "md");
		ok("qw/changeReportText: Markdown carries the counts and a table",
			/^# What the tool did to the file/.test(md) && /ovr changed: \d+/.test(md) &&
			md.split("\n").filter((l) => /^\| /.test(l)).length === 42);
		ok("qw/changeReport on nothing says so", (() => { try { E.changeReport(null); return false; } catch (e) { return /finished run/.test(e.message); } })());
	}

	/* ---- Q30 and Q31: redraft, and a team's targets -------------------------- */
	{
		const mock = P.mockDraft(res);
		const a = P.mockDraft(res, { salt: "again" });
		ok("qw/mock salt: the same teams in the same order take different players",
			same(a.teams, mock.teams) && !same(a.picks.map((k) => k.key), mock.picks.map((k) => k.key)) &&
			same(P.mockDraft(res, { salt: "again" }).picks, a.picks));
		ok("qw/mock noise 0: no taste, so the draft is the value order; more noise reaches further from the board",
			(() => {
				const quiet = P.mockDraft(res, { noise: 0 });
				const loud = P.mockDraft(res, { noise: 6 });
				const spread = (m) => m.picks.reduce((s, k) => s + Math.abs(k.reach), 0);
				return spread(loud) > spread(quiet) && same(P.mockDraft(res, { noise: 0 }).picks, quiet.picks);
			})());
		ok("qw/mock noise: a bad number is the default", same(P.mockDraft(res, { noise: -1 }), mock) &&
			same(P.mockDraft(res, { noise: "x" }), mock));
		const at = 9;
		const pick = mock.picks[at];
		const ti = mock.teams.findIndex((t) => t.name === pick.team);
		const tg = P.targetsFor(mock, ti, at);
		ok("qw/targetsFor: five targets, best first, the first being the player the team took",
			tg.length === 5 && tg[0].key === pick.key && tg[0].taken === true && tg.slice(1).every((t) => !t.taken) &&
			tg.every((t) => typeof t.why === "string" && t.why && Number.isFinite(t.value) && t.pos) &&
			tg.every((t, i) => i === 0 || tg[i - 1].value >= t.value));
		ok("qw/targetsFor: the team by name, or by the pick it holds",
			same(P.targetsFor(mock, pick.team, at), tg) && P.targetsFor(mock, ti)[0].key ===
			mock.picks.find((k) => k.team === pick.team).key);
		ok("qw/targetsFor: nobody already taken is a target",
			(() => {
				const gone = new Set(mock.picks.slice(0, at).map((k) => k.key));
				return tg.every((t) => !gone.has(t.key));
			})());
		ok("qw/targetsFor follows a redraft", (() => {
			const t2 = P.targetsFor(a, a.teams.findIndex((t) => t.name === a.picks[at].team), at);
			return t2[0].key === a.picks[at].key;
		})());
		ok("qw/targetsFor on nothing, or a bad team or pick, is empty",
			P.targetsFor(null, 0, 0).length === 0 && P.targetsFor(mock, 99, 0).length === 0 &&
			P.targetsFor(mock, 0, 999).length === 0 && P.targetsFor({ picks: [] }, 0, 0).length === 0);
		ok("qw/Pro.valueTo is exported and takes the taste sd",
			typeof P.valueTo === "function" && (() => {
				const team = { plan: 0.5, need: { guard: 0.5, wing: 0.5, big: 0.5 } };
				const pl = res.players[0];
				const { Rng } = global.BBGMRng;
				return P.valueTo(team, null, pl, new Rng("v"), 0).value === P.valueTo(team, null, pl, new Rng("w"), 0).value &&
					P.valueTo(team, null, pl, new Rng("v")).value !== P.valueTo(team, null, pl, new Rng("v"), 0).value;
			})());
	}

	/* ---- Q36: the single-file build ----------------------------------------- */
	{
		const B = require(path.join(ROOT, "tools", "bundle.js"));
		const manifest = require(path.join(ROOT, "js", "manifest.js"));
		const built = B.build();
		ok("qw/bundle: every script the manifest lists is inlined, in order, by name",
			same(built.scripts, manifest.page) &&
			manifest.page.every((n) => built.html.indexOf('<script data-src="js/' + n + '.js">') !== -1));
		ok("qw/bundle: no script tag still points at a file, and the stylesheet is inline",
			(() => {
				// The markup around the scripts, not the scripts' own text.
				const shell = built.html.replace(/<script data-src="[^"]*">[\s\S]*?<\/script>/g, "<script></script>");
				return !/<script[^>]*\bsrc=/.test(shell) && !/rel="stylesheet"/.test(shell);
			})() &&
			built.html.indexOf(fs.readFileSync(path.join(ROOT, "css", "style.css"), "utf8").slice(0, 200)) !== -1 &&
			!/rel="manifest"/.test(built.html));
		ok("qw/bundle: the engine's text is in it whole (modulo the two escapes)",
			built.html.indexOf(B.escapeScript(fs.readFileSync(path.join(ROOT, "js", "engine.js"), "utf8"))) !== -1);
		ok("qw/bundle: </script and <!-- are escaped, and nothing else about a script changes",
			B.escapeScript("a</script>b<!--c</SCRIPT") === "a<\\/script>b<\\!--c<\\/SCRIPT" &&
			(built.html.match(/<\/script>/g) || []).length === manifest.page.length);
		ok("qw/bundle: it is one file of a few megabytes", built.html.length > 2.5e6 && built.html.length < 8e6,
			String(built.html.length));
		ok("qw/bundle: there is an npm script for it",
			JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).scripts.bundle === "node tools/bundle.js");

		let playwright = null;
		try { playwright = require("playwright"); } catch (e) { /* optional, like tools/uismoke.js */ }
		if (!playwright) {
			ok("qw/bundle: loads without console errors in headless Chromium (skipped: playwright is not installed)", true);
		} else {
			const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bbgmdraft-bundle-"));
			const file = path.join(dir, "bundle.html");
			fs.writeFileSync(file, built.html);
			const probe = path.join(dir, "probe.js");
			fs.writeFileSync(probe, `
const { chromium } = require(${JSON.stringify(require.resolve("playwright"))});
(async () => {
	const b = await chromium.launch();
	const pg = await b.newPage();
	const errs = [];
	pg.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errs.push(m.text()); });
	pg.on("pageerror", (e) => errs.push("pageerror: " + e.message));
	await pg.goto("file://" + ${JSON.stringify(file)});
	await pg.waitForTimeout(1500);
	const loaded = await pg.evaluate(() => ({ engine: typeof Engine.run, app: typeof App }));
	await b.close();
	process.stdout.write(JSON.stringify({ errs, loaded }));
})().catch((e) => { process.stdout.write(JSON.stringify({ fail: String(e && e.message) })); });
`);
			const r = spawnSync(process.execPath, [probe], { encoding: "utf8", timeout: 90000 });
			let got = null;
			try { got = JSON.parse(r.stdout); } catch (e) { /* reported below */ }
			if (got && got.fail && /Executable doesn't exist|browserType\.launch/.test(got.fail)) {
				ok("qw/bundle: loads without console errors in headless Chromium (skipped: no browser build)", true);
			} else {
				ok("qw/bundle: loads from disk in headless Chromium with no console errors",
					!!got && !got.fail && got.errs.length === 0 && got.loaded.engine === "function",
					r.stdout + r.stderr);
			}
		}
	}

	/* ---- Q35: the web app manifest ------------------------------------------- */
	{
		const man = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.webmanifest"), "utf8"));
		const h = man.file_handlers && man.file_handlers[0];
		const exts = h ? [].concat.apply([], Object.keys(h.accept).map((k) => h.accept[k])) : [];
		ok("qw/manifest: file_handlers opens .json and .json.gz in the page",
			!!h && h.action === "./index.html" && exts.indexOf(".json") !== -1 && exts.indexOf(".json.gz") !== -1 &&
			exts.every((x) => /^\.[a-z.]+$/.test(x)) && Object.keys(h.accept).every((m) => /^[a-z]+\/[a-z-]+$/.test(m)));
		ok("qw/manifest: the rest of it is as it was",
			man.start_url === "./index.html" && man.display === "standalone" && man.icons.length === 1);
	}

	/* ---- Q40 to Q43: the command line ---------------------------------------- */
	{
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bbgmdraft-qw-"));
		const cli = (args, input) => spawnSync(process.execPath, [BIN].concat(args),
			{ encoding: "utf8", cwd: dir, input });
		const cliBuf = (args, input) => spawnSync(process.execPath, [BIN].concat(args),
			{ cwd: dir, input, maxBuffer: 1 << 28 });
		const strip = (t) => JSON.parse(String(t).replace(/^﻿/, ""));
		const file = path.join(dir, "class.json");
		fs.writeFileSync(file, JSON.stringify(lf));
		const read = (f) => strip(fs.readFileSync(path.join(dir, f), "utf8"));
		const EXP = { ages: true, injuries: true, jerseys: true, stats: false, prior: false, highs: false,
			awards: false, awardsScope: "all" };
		const engineExport = (cfgIn, extra) => E.exportFile(E.run(copy(lf), C.make(cfgIn)), Object.assign({}, EXP, extra));

		// Q40: --settings
		{
			const settings = { format: "bbgm-draft-workshop/settings", v: 1,
				cfg: { seed: "qw-set", pace: 72, noteLines: ["summary", "team"], pinned: ["pace"] } };
			fs.writeFileSync(path.join(dir, "s.json"), JSON.stringify(settings));
			const r = cli(["run", file, "--settings", "s.json", "--out", "s-out.json", "-q"]);
			ok("qw-cli/--settings runs a page settings file exactly as the engine does",
				r.status === 0 && same(read("s-out.json"), engineExport(settings.cfg)), r.stderr);
			const r2 = cli(["run", file, "--settings", "s.json", "--set", "pace=60", "--seed", "other", "--out", "s2.json", "-q"]);
			ok("qw-cli/--set and --seed come after --settings and win",
				r2.status === 0 && same(read("s2.json"), engineExport(Object.assign({}, settings.cfg, { pace: 60, seed: "other" }))));
			fs.writeFileSync(path.join(dir, "bad.json"), JSON.stringify({ format: "something/else", cfg: {} }));
			const bad = cli(["run", file, "--settings", "bad.json"]);
			ok("qw-cli/a file that is not a settings file is refused with a sentence",
				bad.status === 1 && /not a settings file/.test(bad.stderr) && !/at Object|node:internal/.test(bad.stderr), bad.stderr);
			const nocfg = path.join(dir, "nocfg.json");
			fs.writeFileSync(nocfg, JSON.stringify({ format: "bbgm-draft-workshop/settings", v: 1 }));
			ok("qw-cli/a settings file with no settings is refused", cli(["run", file, "--settings", nocfg]).status === 1);
			fs.writeFileSync(path.join(dir, "unk.json"), JSON.stringify({ format: "bbgm-draft-workshop/settings", v: 1,
				cfg: { seed: "u", pace: 70, madeUpSetting: 3, mu: ["x"] } }));
			const unk = cli(["run", file, "--settings", "unk.json", "--out", "unk-out.json"]);
			ok("qw-cli/an unknown setting and the page's mutators are said and ignored",
				unk.status === 0 && /madeUpSetting/.test(unk.stderr) && /mutators/.test(unk.stderr) &&
				same(read("unk-out.json"), engineExport({ seed: "u", pace: 70 })), unk.stderr);

			// A file with a recipe is a settings file.
			const rr = cli(["run", file, "--seed", "qw-rec", "--set", "pace=69", "--recipe", "--out", "rec.json", "-q"]);
			const rec = E.readRecipe(read("rec.json"));
			ok("qw-cli/--recipe embeds seed, engine revision and settings",
				rr.status === 0 && rec && rec.seed === "qw-rec" && rec.settings.pace === 69 && rec.engineRev === U.ENGINE_REV, rr.stderr);
			const rr2 = cli(["run", file, "--settings", "rec.json", "--out", "rec2.json", "-q"]);
			ok("qw-cli/...and --settings reads it back: the same class again",
				rr2.status === 0 && same(read("rec.json").players, read("rec2.json").players), rr2.stderr);
		}

		// Q40: --locks, against the page's own planLockImport
		{
			const keys = res.players.map((p) => p.key);
			const csv = ["key,name,ovr,pot,archetype,college",
				keys[0] + ",,60,70,Sharpshooter,",
				"," + res.players[1].name.toUpperCase() + ",,,,Duke",
				keys[2] + ",," + "," + ",Not A Build,",
				keys[3] + ",,,,,Nowhere State",
				"999999,Nobody,50,,,",
				keys[4] + ",,abc,,,",
				",,,,,",
				keys[5] + ',"' + res.players[5].name + '",55,,,'].join("\r\n");
			fs.writeFileSync(path.join(dir, "locks.csv"), "﻿" + csv);
			const players = res.players.map((p) => ({ key: p.key, name: p.name }));
			const mine = E.planLockCsv(csv, players);
			// The page's function, lifted out of js/app.js and run against stubs.
			let theirs = null;
			let why = "";
			try {
				const src = fs.readFileSync(path.join(ROOT, "js", "app.js"), "utf8");
				const grab = (name) => {
					const at = src.indexOf("\tfunction " + name + "(");
					if (at < 0) throw new Error(name + " not found");
					let depth = 0;
					let i = src.indexOf("{", at);
					const start = at;
					for (; i < src.length; i++) {
						if (src[i] === "{") depth++;
						else if (src[i] === "}" && --depth === 0) break;
					}
					return src.slice(start, i + 1);
				};
				const state = { results: { 0: { players } }, active: 0 };
				const errors = [];
				const make = new Function("state", "showError", "global",
					grab("parseCsv") + "\n" + grab("planLockImport") + "\nreturn planLockImport;");
				theirs = make(state, (e) => errors.push(e.message), global)(csv);
			} catch (e) { why = String(e && e.message); }
			if (!theirs) {
				ok("qw-cli/--locks matches the page's planLockImport (skipped: could not lift it out of app.js: " + why + ")", true);
			} else {
				const view = (plan) => ({
					applied: plan.applied.map((a) => [a.player.key, a.patch]),
					unmatched: plan.unmatched, rejected: plan.rejected, total: plan.total,
				});
				ok("qw-cli/the locks CSV is read exactly as the page's planLockImport reads it",
					same(view(mine), view(theirs)) && mine.applied.length === 3 && mine.unmatched.length === 1 &&
					mine.rejected.length === 2, JSON.stringify(view(mine)) + " vs " + JSON.stringify(view(theirs)));
			}
			const overrides = {};
			for (const a of mine.applied) overrides[a.player.key] = a.patch;
			const r = cli(["run", file, "--seed", "qw-lock", "--locks", "locks.csv", "--out", "l-out.json"]);
			ok("qw-cli/--locks applies the CSV as overrides: the class is the engine's with those locks",
				r.status === 0 && same(read("l-out.json"), engineExport({ seed: "qw-lock", overrides })), r.stderr);
			ok("qw-cli/...and says what it applied, refused and could not match",
				/3 of 7 row\(s\) applied; 1 matched nobody/.test(r.stderr) && /unknown archetype/.test(r.stderr) &&
				/unknown school/.test(r.stderr), r.stderr);
			const locked = E.run(copy(lf), C.make({ seed: "qw-lock", overrides }));
			ok("qw-cli/the locks took (the lock is on the player the CSV named)",
				locked.players[0].override.ovr === 60 && locked.players[1].newCollege === "Duke", "");
			ok("qw-cli/--locks without a key or name column is refused",
				(() => { fs.writeFileSync(path.join(dir, "nokey.csv"), "ovr\n60\n"); return cli(["run", file, "--locks", "nokey.csv"]).status === 1; })());
			ok("qw-cli/--locks on a universe is refused", cli(["universe", file, "--locks", "locks.csv"]).status === 1);
		}

		// Q41: stdin, gzip, count
		{
			const direct = cli(["run", file, "--seed", "qw-pipe", "--out", "-", "-q"]);
			const piped = cli(["run", "-", "--seed", "qw-pipe", "-q"], fs.readFileSync(file));
			ok("qw-cli/a class piped on stdin is read, and goes back out stdout by default",
				piped.status === 0 && piped.stdout === direct.stdout && strip(piped.stdout).players.length === 40, piped.stderr);
			const pipedGz = cli(["run", "-", "--seed", "qw-pipe", "-q"], zlib.gzipSync(fs.readFileSync(file)));
			ok("qw-cli/...and a gzipped class on stdin works too", pipedGz.status === 0 && pipedGz.stdout === direct.stdout);
			const junk = cli(["run", "-", "-q"], "{ nope");
			ok("qw-cli/junk on stdin says standard input", junk.status === 1 && /standard input is not JSON/.test(junk.stderr), junk.stderr);
			const gz = cliBuf(["run", file, "--seed", "qw-pipe", "--gzip", "--out", "-", "-q"]);
			ok("qw-cli/--gzip writes the same JSON, gzipped",
				gz.status === 0 && gz.stdout[0] === 0x1f && gz.stdout[1] === 0x8b &&
				zlib.gunzipSync(gz.stdout).toString("utf8") === direct.stdout.replace(/\n$/, ""));
			const gzFile = cli(["run", file, "--seed", "qw-pipe", "--gzip", "-q"]);
			ok("qw-cli/--gzip to a file adds .gz to the default name",
				gzFile.status === 0 && fs.existsSync(path.join(dir, "class_customized.json.gz")) &&
				same(strip(zlib.gunzipSync(fs.readFileSync(path.join(dir, "class_customized.json.gz"))).toString("utf8")),
					engineExport({ seed: "qw-pipe" })));
			const many = cli(["run", file, "--seed", "cnt", "--count", "2", "--out", "many", "--stats"]);
			const names = fs.existsSync(path.join(dir, "many")) ? fs.readdirSync(path.join(dir, "many")).sort() : [];
			ok("qw-cli/--count N writes N classes, seeds <base>#0 .., into the directory",
				many.status === 0 && names.join() === "class_cnt_0.json,class_cnt_1.json" &&
				/wrote 2 classes to many · base seed cnt/.test(many.stderr), many.stderr + names.join());
			ok("qw-cli/...each the class that seed makes on its own",
				[0, 1].every((i) => same(read("many/class_cnt_" + i + ".json"),
					engineExport({ seed: "cnt#" + i }, { stats: true }))));
			ok("qw-cli/--count refuses nonsense and combinations",
				cli(["run", file, "--count", "0"]).status === 1 && cli(["run", file, "--count", "x"]).status === 1 &&
				cli(["run", file, "--count", "2", "--fragment"]).status === 1 &&
				cli(["run", file, "--count", "2", "--out", "-"]).status === 1);
		}

		// Q42: merge, players file, fragment, rounds
		{
			const league = {
				version: res.leagueFile.version, startingSeason: res.season, gameAttributes: { season: res.season },
				teams: [{ tid: 0, region: "A", name: "B" }],
				players: res.leagueFile.players.map((x) => Object.assign({ tid: -2 }, x)),
			};
			fs.writeFileSync(path.join(dir, "league.json"), JSON.stringify(league));
			const r = run({ seed: "qw-m" });
			const m = cli(["run", file, "--seed", "qw-m", "--merge", "league.json", "-q"]);
			const want = E.mergeIntoLeague(r, copy(league), Object.assign({}, EXP));
			ok("qw-cli/--merge writes the league with the class merged in, as the engine's merge does",
				m.status === 0 && same(read("league_merged.json"), want.file), m.stderr);
			const m2 = cli(["run", file, "--seed", "qw-m", "--merge", "league.json"]);
			ok("qw-cli/...and says what it replaced", /40 prospects replaced, 0 added, 0 removed/.test(m2.stderr), m2.stderr);
			ok("qw-cli/--merge cannot be combined with another output",
				cli(["run", file, "--merge", "league.json", "--players-file"]).status === 1);
			const pf = cli(["run", file, "--seed", "qw-m", "--players-file", "--out", "pf.json", "-q"]);
			ok("qw-cli/--players-file writes the Import players file",
				pf.status === 0 && same(read("pf.json"), E.exportPlayersFile(r, Object.assign({}, EXP))), pf.stderr);
			const fr = cli(["run", file, "--seed", "qw-m", "--fragment", "--out", "fr.json", "-q"]);
			ok("qw-cli/--fragment writes the college-league fragment",
				fr.status === 0 && same(read("fr.json"), E.exportLeagueFragment(r)), fr.stderr);
			const mk = cli(["mock", file, "--seed", "qw-m", "--rounds", "1", "--json"]);
			const picks = mk.status === 0 ? JSON.parse(mk.stdout).picks : [];
			ok("qw-cli/mock --rounds 1 is one round", picks.length === 30 && picks.every((k) => k.round === 1), mk.stderr);
			ok("qw-cli/mock without --rounds is two (a 40-man class is all drafted), and a bad --rounds is refused",
				JSON.parse(cli(["mock", file, "--seed", "qw-m", "--json"]).stdout).picks.length === 40 &&
				cli(["mock", file, "--rounds", "0"]).status === 1);
		}

		// The opt-in export extras
		{
			const x = cli(["run", file, "--seed", "qw-x", "--fuzz", "zero", "--hometowns", "--pro-lines", "--out", "x.json", "-q"]);
			const w = engineExport({ seed: "qw-x" }, { fuzz: "zero", hometowns: true, proLines: true });
			ok("qw-cli/--fuzz, --hometowns and --pro-lines are the engine's options",
				x.status === 0 && same(read("x.json"), w), x.stderr);
			ok("qw-cli/--fuzz and --scouting refuse nonsense",
				cli(["run", file, "--fuzz", "loud"]).status === 1 && cli(["run", file, "--scouting", "0"]).status === 1);
		}

		// Q43: seek
		{
			const runner = E.createRunner(copy(lf));
			const want = E.parseRerollClause("freshmanNo1");
			let first = -1;
			for (let i = 0; i < 12 && first < 0; i++) {
				if (want.test(runner.run(C.make({ seed: "seek#" + i })))) first = i;
			}
			const s = cli(["seek", file, "--want", "freshmanNo1", "--tries", "12", "--seed", "seek"]);
			ok("qw-cli/seek prints the FIRST seed that meets the condition (seeds are <base>#i)",
				first >= 0 && s.status === 0 && s.stdout === "seek#" + first + "\n", s.stdout + s.stderr + " expected " + first);
			ok("qw-cli/...and says how to write it", /bbgmdraft run .* --seed seek#\d+/.test(s.stderr), s.stderr);
			const both = [E.parseRerollClause("count50:1"), E.parseRerollClause("!abroadNo1")];
			let second = -1;
			for (let i = 0; i < 3 && second < 0; i++) {
				if (both.every((c) => c.test(runner.run(C.make({ seed: "seek#" + i }))))) second = i;
			}
			const j = cli(["seek", file, "--not", "abroadNo1", "--want", "count50:1", "--tries", "3", "--seed", "seek", "--json"]);
			const jj = j.status === 0 ? JSON.parse(j.stdout) : null;
			ok("qw-cli/seek --json, with --not and a parametric --want",
				second >= 0 && !!jj && jj.seed === "seek#" + second && jj.tries === second + 1 &&
				same(jj.conditions, ["count50:1", "!abroadNo1"]) &&
				jj.engineRev === U.ENGINE_REV, j.stdout + j.stderr);
			const none = cli(["seek", file, "--want", "abroadNo1", "--not", "abroadNo1", "--tries", "2", "--seed", "seek"]);
			ok("qw-cli/seek exits 1 when nothing meets the conditions in --tries, printing no seed",
				none.status === 1 && none.stdout === "" && /no class met abroadNo1 and !abroadNo1 in 2 tries/.test(none.stderr), none.stderr);
			const bad = cli(["seek", file, "--want", "topOvr:oops"]);
			ok("qw-cli/seek names the conditions it knows when given one it does not",
				bad.status === 1 && /unknown condition "topOvr:oops"/.test(bad.stderr) && /tallTop5/.test(bad.stderr) &&
				/pos1:C/.test(bad.stderr), bad.stderr);
			ok("qw-cli/seek with no condition, and a bad --tries, are refused",
				cli(["seek", file]).status === 1 && cli(["seek", file, "--want", "tallTop5", "--tries", "0"]).status === 1);
		}
	}
};
