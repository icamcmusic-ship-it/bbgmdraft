/* The Universe tab's quick wins (audit section 6): the world name, export
   file names, the timeline and records CSV tables, the threads filter, the
   jump-link keys on a row and the chain's render throttle. */
"use strict";

module.exports = function (ok, V) {
	const fs = require("fs");
	const path = require("path");
	const E = global.Engine;
	const CFG = global.Config;
	const U = global.Universe;

	/* --- the world name ------------------------------------------------ */
	{
		const schools = ["Duke", "Kansas", "Gonzaga"];
		const flavors = ["no strong flavor", "guard-heavy", "big-heavy"];
		const a = U.randomName("s|1", schools, flavors);
		ok("a world name is deterministic for one seed",
			a === U.randomName("s|1", schools, flavors) && a.length > 3, a);
		const seen = new Set();
		for (let i = 0; i < 12; i++) seen.add(U.randomName("s|" + i, schools, flavors));
		ok("...and varies across draws", seen.size >= 4, Array.from(seen).join(" | "));
		ok("...and never uses the no-flavor label",
			Array.from(seen).every((n) => !/No strong|no strong/.test(n)));
		ok("an empty list still names the world",
			typeof U.randomName("x", [], []) === "string");
	}

	/* --- export file names --------------------------------------------- */
	{
		const n = U.exportBaseName({ name: "The ../Duke: Years!", baseSeed: "My Seed/1",
			rows: [{ season: 2025 }, { season: 2026 }, { season: 2031 }] });
		ok("the export name carries name, season range and seed",
			n === "universe_the-duke-years_2025-2031_my-seed-1", n);
		ok("...sanitized to a safe file name", /^[a-z0-9_-]+$/.test(n));
		ok("the default name is not repeated",
			U.exportBaseName({ name: "Universe", baseSeed: "x", rows: [{ season: 2030 }] }) ===
				"universe_2030_x");
	}

	/* --- a real two-season timeline: rows, CSV tables, filter ---------- */
	{
		const a = E.run(V.realisticClass(1, 60), CFG.make({ seed: "qw-a" }));
		const b = E.run(V.realisticClass(2, 60), CFG.make({ seed: "qw-b" }));
		const rows = [U.summarize(a, "u1", "a.json"), U.summarize(b, "u2", "b.json")];
		ok("a row records the POY's and No. 1 pick's key for the jump links",
			rows.every((r) => (!r.poy || r.poy.key !== undefined) && r.no1 && r.no1.key !== undefined));
		const t = U.timelineTable(rows);
		ok("the timeline table has a header and one line per season",
			t.length === 3 && t[0][0] === "season" && t[1][3] === rows[0].champion);
		ok("...every line as wide as the header", t.every((r) => r.length === t[0].length));
		const rec = U.records(rows, [], null);
		const rt = U.recordsTable(rec);
		ok("the records table lists the title holders",
			rt.some((r) => r[0] === "National titles" && r[2] === rows[0].champion), JSON.stringify(rt.slice(0, 3)));
		ok("an empty records book is just a header", U.recordsTable(null).length === 1);
		const threads = [
			{ kind: "titles", team: "Duke", text: "Duke won 2" },
			{ kind: "rivalry", team: "Kansas", other: "Duke", text: "Kansas and Duke met" },
			{ kind: "gap", team: null, text: "a gap" },
			"an old string thread",
		];
		ok("threads filter by kind", U.filterThreads(threads, "rivalry", "").length === 1);
		ok("threads filter by program, either side of a rivalry",
			U.filterThreads(threads, "", "Duke").length === 2);
		ok("no filter keeps everything", U.filterThreads(threads, "", "").length === 4);
	}

	/* --- the app wiring (source checks; the UI smoke drives it) --------- */
	{
		const app = fs.readFileSync(path.join(__dirname, "..", "..", "js", "app.js"), "utf8");
		ok("the chain renders at most once per 300ms",
			/UNIVERSE_RENDER_MS = 300/.test(app) &&
			/Date\.now\(\) - lastRender >= UNIVERSE_RENDER_MS/.test(app));
		ok("the universe CSVs go through esc() and its formula guard",
			/r\.map\(esc\)\.join/.test(app));
		ok("the universe exports are named by Universe.exportBaseName",
			!/"universe\.json"|"universe-players\.json"/.test(app) &&
			/exportBaseName\(u\)/.test(app));
		ok("a rebuild keeps the world's name",
			/state\.universe\.name \|\| null/.test(app));
	}
};
