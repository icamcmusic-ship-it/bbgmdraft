/* Regression checks for the 2026-10-01 audit's bug list (AUDIT-2026-10-01.md,
   section 1). One check per defect that was reproduced, written so that each
   fails on the code it was found in. The notes-template defects are in
   tools/tests/notes.js. */
"use strict";

const fs = require("fs");
const path = require("path");

module.exports = function (ok, V) {
	const E = global.Engine;
	const C = global.Config;
	const U = global.Universe;
	const ROOT = path.join(__dirname, "..", "..");
	const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

	/* ---- the script list is written once, and the page agrees with it ----- */
	{
		const M = require("../../js/manifest.js");
		const sw = read("sw.js");
		const html = read("index.html");
		const scripts = Array.from(html.matchAll(/<script[^>]*\bsrc="js\/([^"]+)\.js"/g)).map((m) => m[1]);
		ok("manifest/index.html loads exactly the manifest's scripts, in its order",
			scripts.join() === M.page.join(),
			"html: " + scripts.join() + "\nmanifest: " + M.page.join());
		const gone = M.page.filter((f) => !fs.existsSync(path.join(ROOT, "js", f + ".js")));
		ok("manifest/every listed script exists", gone.length === 0, gone.join(", "));
		const unlisted = fs.readdirSync(path.join(ROOT, "js")).filter((f) => f.endsWith(".js"))
			.map((f) => f.replace(/\.js$/, ""))
			.filter((f) => ["manifest", "worker"].indexOf(f) === -1 && M.page.indexOf(f) === -1);
		ok("manifest/no script in js/ is missing from it", unlisted.length === 0, unlisted.join(", "));
		ok("manifest/the worker and the node harness are subsets of the page, in page order",
			[M.worker, M.node].every((list) => list.every((f, i) =>
				M.page.indexOf(f) !== -1 && (i === 0 || M.page.indexOf(list[i - 1]) < M.page.indexOf(f)))));
		ok("manifest/the engine's own dependencies are all in the worker list",
			["text", "rng", "bbgm", "config", "ratings", "engine", "batch", "universe"]
				.every((f) => M.worker.indexOf(f) !== -1));
		const worker = read("js/worker.js");
		ok("manifest/the worker imports the list instead of repeating it",
			/importScripts\("manifest\.js"\)/.test(worker) && !/"bbgmstats\.js"/.test(worker));
		ok("sw/the service worker precaches the manifest's scripts, the worker and the stylesheet",
			/importScripts\("js\/manifest\.js"\)/.test(sw) && /BBGMManifest\.page/.test(sw) &&
			/"js\/worker\.js"/.test(sw) && /"css\/style\.css"/.test(sw) && /"js\/manifest\.js"/.test(sw));
		ok("sw/a failed script or stylesheet is not answered with index.html",
			/req\.mode === "navigate"/.test(sw));
		ok("sw/the cache name was bumped past v1", /bbgm-draft-workshop-v([2-9]|\d\d)/.test(sw));
		ok("manifest/the harness loaded everything on the node list",
			!!global.Engine && !!global.Universe && !!global.Play && !!global.ReplayMeta && !!global.SeasonSite && !!global.Sample && !!global.BatchStats);
	}

	/* ---- a seed is text -------------------------------------------------- */
	{
		ok("config/a numeric seed becomes its digits", C.make({ seed: 12345 }).seed === "12345",
			JSON.stringify(C.make({ seed: 12345 }).seed));
		ok("config/an object or null seed becomes no seed",
			C.make({ seed: {} }).seed === "" && C.make({ seed: null }).seed === "" &&
			C.make({ seed: NaN }).seed === "");
		ok("config/a text seed is left alone", C.make({ seed: "abc" }).seed === "abc");
	}

	/* ---- a phase that throws does not poison the runner ------------------ */
	{
		const lf = V.realisticClass("throw", 20);
		const runner = E.createRunner(lf);
		const A = C.make({ seed: "throw" });
		const first = runner.run(A);
		const sig = (r) => JSON.stringify(r.players.map((p) => [p.key, p.note, (p.awards || []).length]));
		const before = sig(first);
		const phase = E.PHASES.find((p) => p.name === "awards");
		const real = phase.run;
		phase.run = (state) => {
			state.players.forEach((p) => { p.awards = ["half written"]; });
			throw new Error("boom");
		};
		let threw = false;
		try { runner.run(C.make({ seed: "throw", awardStrictness: 2.6 })); } catch (e) { threw = true; }
		phase.run = real;
		ok("runner/the injected failure reached the caller", threw);
		const again = runner.run(A);
		ok("runner/reverting after a failed run returns the real class, not the half-written one",
			sig(again) === before && !again.players.some((p) => (p.awards || []).indexOf("half written") !== -1),
			"phasesRun " + JSON.stringify(again.phasesRun));
	}

	/* ---- a warm re-run of the stats phase equals a cold one -------------- */
	{
		const lf = V.realisticClass("warm", 24);
		const B = C.make({ seed: "warm", statNoise: 1.6 });
		const warm = E.createRunner(lf);
		warm.run(C.make({ seed: "warm" }));
		const w = warm.run(B);
		const cold = E.run(lf, B);
		const sig = (r) => JSON.stringify(r.players.map((p) => p.stats && [p.stats.pm, p.stats.onOff]));
		ok("stats/the plus-minus impact survives a warm re-run (warm equals cold)",
			w.phasesRun.indexOf("stats") !== -1 && sig(w) === sig(cold),
			"phasesRun " + JSON.stringify(w.phasesRun));
	}

	/* ---- a null is a missing value, not a zero --------------------------- */
	{
		const lf = V.realisticClass("nulls", 12);
		const big = lf.players.findIndex((p) => p.ratings[p.ratings.length - 1].hgt >= 70);
		lf.players[big].hgt = null;
		lf.players[big].weight = "";
		const res = E.run(lf, C.make({ seed: "nulls" }));
		const p = res.players[big];
		ok("export/a null height is derived from the rating, not read as 0 (4'10\")",
			p.newHgtInches > 70, "got " + p.newHgtInches + " in");
		ok("export/a blank weight is derived, not read as 0 lb", p.newWeight > 150,
			"got " + p.newWeight + " lb");
		const lf2 = V.realisticClass("nulls2", 6);
		lf2.players[0].tid = null;
		const out = E.exportFile(E.run(lf2, C.make({ seed: "nulls2" })), {});
		ok("export/a null tid is not written as team 0", out.players[0].tid !== 0,
			"tid " + out.players[0].tid);
		const lf3 = V.realisticClass("nulls3", 6);
		lf3.players[1].born.year = null;
		let msg = "";
		try { E.validateLeagueFile(lf3); } catch (e) { msg = e.message; }
		ok("validate/a null born.year is rejected as missing", /born\.year/.test(msg), msg);
		const lf4 = V.realisticClass("nulls4", 6);
		lf4.players[0].college = 5;
		let threw = null;
		try { E.run(lf4, C.make({ seed: "nulls4" })); } catch (e) { threw = e; }
		ok("export/a non-string college does not throw", !threw, threw && threw.message);
	}

	/* ---- universe threads and records say what was played ---------------- */
	{
		const row = (season, champion, extra) => Object.assign(
			{ season, champion, runnerUp: "Zed", apOne: champion, finalFour: [champion],
				poy: { school: champion, nonNcaa: false }, no1: null }, extra || {});
		const rows = [
			row(2026, "Duke"), row(2027, "Duke"),
			row(2028, "Kansas", { extrapolated: true }), row(2029, "Kansas", { extrapolated: true }),
			row(2030, "Kansas"),
		];
		const th = U.threads(rows, [], {});
		const kansasTitles = th.find((t) => t.kind === "titles" && t.team === "Kansas");
		ok("universe/a team with one played title and two guessed ones has no 'won N titles' thread",
			!kansasTitles, kansasTitles && kansasTitles.text);
		ok("universe/a repeat across two extrapolated seasons is not reported",
			!th.some((t) => t.kind === "repeat" && t.team === "Kansas"),
			JSON.stringify(th.filter((t) => t.kind === "repeat")));
		ok("universe/two consecutive played titles are one repeat",
			th.filter((t) => t.kind === "repeat" && t.team === "Duke").length === 1);

		const gap = [row(2026, "Duke"), row(2029, "Duke")];
		ok("universe/champions three seasons apart are not 'back to back'",
			!U.threads(gap, [], {}).some((t) => t.kind === "repeat" || t.kind === "poyRepeat"));

		const streak = [2026, 2027, 2028, 2029, 2030].map((s) => row(s, "Duke"));
		const sthreads = U.threads(streak, [], {});
		ok("universe/a five-year streak is not four separate repeat threads",
			sthreads.filter((t) => t.kind === "repeat").length === 0,
			JSON.stringify(sthreads.filter((t) => t.kind === "repeat").map((t) => t.text)));

		const rec = U.records(rows, [], null, null);
		ok("universe/records count title games and AP No. 1s from played seasons only",
			(rec.apOnes.find((x) => x.team === "Kansas") || { count: 0 }).count === 1 &&
			(rec.titles.find((x) => x.team === "Kansas") || {}).count === 3 &&
			(rec.titles.find((x) => x.team === "Kansas") || {}).extrapolated === 2,
			JSON.stringify(rec.apOnes) + " " + JSON.stringify(rec.titles));
		const hall = U.records(rows, [
			{ id: "x:1", key: 1, name: "Invented Man", school: "Kansas", season: 2028,
				why: "player of the year", extrapolated: true },
			{ id: "x:2", key: 2, name: "Real Man", school: "Duke", season: 2026,
				why: "player of the year" },
		], null, null);
		ok("universe/an invented player of the year is not a Hall of Fame row",
			hall.hall.every((m) => m.name !== "Invented Man") && hall.hall.some((m) => m.name === "Real Man"),
			JSON.stringify(hall.hall.map((m) => m.name)));
	}

	/* ---- tie-breaks that feed the simulation do not use the locale ------- */
	{
		const src = ["awards", "universe", "engine", "news"].map((f) => read("js/" + f + ".js")).join("\n");
		ok("determinism/no localeCompare in the simulation modules", !/\.localeCompare\(/.test(src));
	}

	/* ---- the page itself ------------------------------------------------- */
	{
		const css = read("css/style.css");
		ok("ui/the error banner and the program pennant are different classes",
			/\.pennant\s*\{/.test(css) && !/(^|\n)\.banner\s*\{[^}]*clip-path/.test(css));
		const html = read("index.html");
		ok("ui/the error banner sits above the drop box",
			html.indexOf('id="errBanner"') < html.indexOf('id="empty"'));
	}

	/* ---- the file's own schema version is read, not assumed --------------- */
	{
		const w = (version) => {
			const lf = V.realisticClass("ver" + version, 8);
			if (version === null) delete lf.version; else lf.version = version;
			return E.validateLeagueFile(lf).warnings.filter((x) => /schema version/.test(x));
		};
		ok("version/an old schema is warned about before BBGM migrates it", w(23).length === 1 && w(32).length === 1,
			JSON.stringify(w(23)));
		ok("version/the current schema is not", w(global.BBGM.LEAGUE_DATABASE_VERSION).length === 0 && w(40).length === 0);
		ok("version/a schema newer than the tool's is warned about",
			w(global.BBGM.LEAGUE_DATABASE_VERSION + 1).length === 1);
		ok("version/no version at all is left to the export to stamp", w(null).length === 0);
	}
};
