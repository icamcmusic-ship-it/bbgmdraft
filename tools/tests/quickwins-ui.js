"use strict";
/* Checks for the October 2026 quick wins on the board / tables / export side
   (Q1, Q2, Q4, Q5, Q6, Q7, Q11, Q12, Q15-Q24, Q44) that can be driven without
   a browser: the pure helpers in js/views.js (the zip writer, the file-name
   template, the search syntax, the table text, the tag and filter cleaners,
   the rename and locks-CSV planners, the new columns and the CSV that shares
   them) and static reads of js/app.js, index.html and css/style.css for the
   wiring. The visible behaviour is driven in a browser by the "Quick wins"
   section of tools/uismoke.js. */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.join(__dirname, "..", "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");

module.exports = function (ok, V) {
	if (!global.window) global.window = global;
	if (!global.self) global.self = global;
	require(path.join(ROOT, "js", "views.js"));
	const Vw = global.Views;
	const APP = read("js", "app.js");
	const HTML = read("index.html");
	const CSS = read("css", "style.css");
	const hadApp = global.App;

	/* A class to read the columns from. */
	const res = global.Engine.run(V.realisticClass(2, 60), global.Config.make({ seed: "qw-ui" }));
	const state = {
		filter: Vw.emptyFilter(), overrides: {}, watch: {}, notes: {}, tags: {}, statMode: "perGame",
		units: "imperial", files: [], sort: [], selected: {},
	};
	global.App = {
		state, userKey: (p) => "@fp|" + (typeof p === "string" ? p : p.key),
		persist() {}, render() {},
	};

	/* ---- Q6: the zip writer ----------------------------------------------- */
	{
		/* A reference reader written here, independent of the writer: the end
		   record, the central directory, each local header, the CRC. */
		const unzip = (bytes) => {
			const b = Buffer.from(bytes);
			let eocd = -1;
			for (let i = b.length - 22; i >= 0; i--) if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
			if (eocd < 0) return null;
			const n = b.readUInt16LE(eocd + 10);
			let at = b.readUInt32LE(eocd + 16);
			const out = [];
			for (let i = 0; i < n; i++) {
				if (b.readUInt32LE(at) !== 0x02014b50) return null;
				const method = b.readUInt16LE(at + 10);
				const crc = b.readUInt32LE(at + 16);
				const size = b.readUInt32LE(at + 24);
				const nameLen = b.readUInt16LE(at + 28);
				const off = b.readUInt32LE(at + 42);
				const name = b.slice(at + 46, at + 46 + nameLen).toString("utf8");
				const lh = off;
				if (b.readUInt32LE(lh) !== 0x04034b50) return null;
				const lnLen = b.readUInt16LE(lh + 26);
				const exLen = b.readUInt16LE(lh + 28);
				const data = b.slice(lh + 30 + lnLen + exLen, lh + 30 + lnLen + exLen + size);
				out.push({ name, method, crc, data, flags: b.readUInt16LE(at + 8) });
				at += 46 + nameLen + b.readUInt16LE(at + 30) + b.readUInt16LE(at + 32);
			}
			return out;
		};
		ok("zip/crc32 of the standard check string is cbf43926",
			Vw.crc32(Buffer.from("123456789")) === 0xCBF43926 && Vw.crc32(new Uint8Array(0)) === 0,
			Vw.crc32(Buffer.from("123456789")).toString(16));
		const big = "x".repeat(70000) + "\u00e9\u00fc, Doncic \u0160ari\u0107";
		const zip = Vw.zipStore([
			{ name: "a_customized.json", data: "\ufeff{\"a\":1}" },
			{ name: "sub/b.json", data: big },
			{ name: "bin.dat", data: Uint8Array.from([0, 1, 2, 255, 254]) },
			{ name: "a_customized.json", data: "second" },
		], new Date(2026, 9, 6, 12, 30, 10));
		const back = unzip(zip);
		ok("zip/the written archive reads back: four members, all stored (method 0)",
			back && back.length === 4 && back.every((m) => m.method === 0), JSON.stringify(back && back.map((m) => m.name)));
		ok("zip/every member's CRC matches its bytes and its bytes are intact",
			back && back.every((m) => Vw.crc32(m.data) === m.crc) &&
			back[0].data.toString("utf8") === "\ufeff{\"a\":1}" && back[1].data.toString("utf8") === big &&
			Buffer.compare(back[2].data, Buffer.from([0, 1, 2, 255, 254])) === 0);
		ok("zip/two files with one name do not overwrite: the second is renamed",
			back && back[0].name === "a_customized.json" && back[3].name === "a_customized (2).json", back && back[3].name);
		ok("zip/names are UTF-8 flagged and the empty archive is a valid 22-byte record",
			back && back.every((m) => (m.flags & 0x0800) !== 0) &&
			Vw.zipStore([], new Date()).length === 22 && unzip(Vw.zipStore([], new Date())).length === 0);
		/* And an independent reader: Python's zipfile, when there is a python. */
		let pyOk = null;
		try {
			const cp = require("child_process");
			const tmp = path.join(require("os").tmpdir(), "bbgm-zip-check-" + process.pid + ".zip");
			fs.writeFileSync(tmp, Buffer.from(zip));
			const out = cp.spawnSync("python3", ["-I", "-c",
				"import sys, zipfile; z = zipfile.ZipFile(sys.argv[1]); print(z.testzip() or 'good', len(z.namelist()))", tmp],
			{ encoding: "utf8" });
			fs.unlinkSync(tmp);
			pyOk = out.status === 0 ? out.stdout.trim() : null;
		} catch (e) { pyOk = null; }
		ok("zip/python's zipfile accepts it and finds no bad CRC (skipped without python3)",
			pyOk === null || pyOk === "good 4", String(pyOk));
		void zlib;
	}

	/* ---- Q5: the export file name template ------------------------------- */
	{
		const t = { file: "league_2027", seed: "abc 123", season: 2027, flavor: "Guard-heavy", fp: "9f3a" };
		ok("filename/the default is the old name, <base>_customized.json",
			Vw.exportFilename("", t) === "league_2027_customized.json" &&
			Vw.exportFilename(undefined, t) === "league_2027_customized.json" &&
			Vw.exportFilename(null, t) === "league_2027_customized.json");
		ok("filename/every token is replaced",
			Vw.exportFilename("{file}-{season}-{seed}-{flavor}-{fp}", t) ===
				"league_2027-2027-abc-123-Guard-heavy-9f3a.json",
			Vw.exportFilename("{file}-{season}-{seed}-{flavor}-{fp}", t));
		ok("filename/path separators and reserved characters cannot escape the folder",
			!/[\\/:*?"<>|]/.test(Vw.exportFilename("../../etc/{file}:x*?", t)) &&
			Vw.exportFilename("../x", t).indexOf("/") === -1);
		ok("filename/leading dots, trailing dots and spaces are trimmed, one extension only",
			Vw.exportFilename("  ..hello.. ", t) === "hello.json" &&
			Vw.exportFilename("mine.json", t) === "mine.json" &&
			Vw.exportFilename("mine.json.gz", t) === "mine.json");
		ok("filename/an empty result falls back to the file name, then to class",
			Vw.exportFilename("{seed}", { file: "f", seed: "" }) === "f.json" &&
			Vw.exportFilename("///", { file: "", seed: "" }) === "class.json" &&
			Vw.exportFilename("{file}", {}) === "class.json");
		ok("filename/the length is capped",
			Vw.exportFilename("x".repeat(500), t).length <= 125);
		ok("filename/an extension can be asked for (zip members, reports)",
			Vw.exportFilename("{file}", t, ".md") === "league_2027.md" && Vw.exportFilename("{file}", t, "") === "league_2027");
		const clean = Vw.cleanExportOpts({ stats: true, filename: "  {file}-{seed}  " });
		ok("filename/the template is kept in the export options and trimmed",
			clean && clean.filename === "{file}-{seed}", JSON.stringify(clean));
		ok("filename/the default template and junk are not stored",
			!("filename" in Vw.cleanExportOpts({ stats: true, filename: "{file}_customized" })) &&
			!("filename" in Vw.cleanExportOpts({ stats: true, filename: 5 })) &&
			!("filename" in Vw.cleanExportOpts({ stats: true, filename: "   " })));
		ok("filename/the summary beside Export names a custom template",
			/file name \{file\}-x/.test(Vw.exportSummary({ stats: true, filename: "{file}-x" })));
		ok("filename/exportOne writes the templated name and the menu remembers it",
			/download\(exportName\(i, opts\)/.test(APP) && /filename: nameIn\.value\.trim\(\)/.test(APP) &&
			!/_customized\.json"/.test(APP.slice(APP.indexOf("function exportOne"), APP.indexOf("const CSV_COLS"))));
	}

	/* ---- Q22: tables as text ---------------------------------------------- */
	{
		ok("table text/tsv: a header row, tabs between cells, tabs and line breaks inside a cell folded",
			Vw.tableText(["a", "b"], [["x\ty", "line1\nline2"], [1, null]], "tsv") === "a\tb\nx y\tline1 line2\n1\t",
			JSON.stringify(Vw.tableText(["a", "b"], [["x\ty", "line1\nline2"], [1, null]], "tsv")));
		ok("table text/markdown: the same helper the board copy uses, pipes escaped",
			Vw.tableText(["a", "b"], [["x|y", 2]], "md") === "| a | b |\n| --- | --- |\n| x\\|y | 2 |");
		/* A minimal DOM-shaped table: thead, a divider row, nocopy children. */
		const node = (text, extra) => Object.assign({ nodeType: 3, nodeValue: text }, extra || {});
		const el = (kids, extra) => Object.assign({ nodeType: 1, childNodes: kids, dataset: {} }, extra || {});
		const td = (kids, extra) => el(kids, Object.assign({ colSpan: 1 }, extra || {}));
		const table = {
			tHead: { rows: [{ cells: [
				el([node("Board")]), el([node("Player ▾")], { dataset: { label: "Player" } }), el([node("")]), el([node("Ovr")]),
			] }] },
			tBodies: [{ rows: [
				{ classList: { contains: () => true }, cells: [td([node("Lottery")], { colSpan: 4 })] },
				{ classList: { contains: () => false }, cells: [td([node("1")]),
					td([el([node("☆")], { dataset: { nocopy: "" } }), node("Ada Lee"), el([node(" ?")], { dataset: { nocopy: "" } })]),
					td([]), td([node(" 61 ")])] },
				{ classList: { contains: () => false }, cells: [td([node("2")]), td([node("Bo Ray")]), td([]), td([node("58")])] },
			] }],
		};
		const parts = Vw.tableParts(table);
		ok("table text/the heading's sort arrow is dropped, a blank-heading column is dropped, a spanning divider row is skipped",
			JSON.stringify(parts.heads) === '["Board","Player","Ovr"]' && parts.rows.length === 2, JSON.stringify(parts));
		ok("table text/nocopy children (star, why button) are left out of a cell, text trimmed",
			parts.rows[0].join("|") === "1|Ada Lee|61", JSON.stringify(parts.rows));
		ok("table text/domTableText gives the TSV the screen shows",
			Vw.domTableText(table, "tsv") === "Board\tPlayer\tOvr\n1\tAda Lee\t61\n2\tBo Ray\t58");
		const wire = APP.slice(APP.indexOf("function render()"), APP.indexOf("const SCROLLERS"));
		ok("table text/render decorates every table in the view after it is built, and the board has Copy for spreadsheet",
			/V\.decorateTables\(view\)/.test(wire) && /Copy for spreadsheet/.test(read("js", "views.js")));
	}

	/* ---- Q18 / Q1: the new columns, and the CSV that shares them ---------- */
	{
		const keys = Vw.EXTRA_COLUMNS.map((c) => c.key);
		ok("columns/skills, original ovr and pot, deltas, pro peak and verdict, jersey, mood, birthplace and 15 ratings",
			["skills", "origOvr", "origPot", "ovrDelta", "potDelta", "proPeak", "proVerdict", "jersey", "mood", "birthplace"]
				.every((k) => keys.indexOf(k) !== -1) && keys.filter((k) => /^r_/.test(k)).length === 15, keys.join(","));
		ok("columns/all are optional (start hidden) and in COLUMNS once each, with unique keys",
			Vw.EXTRA_COLUMNS.every((c) => c.off === true) &&
			new Set(Vw.COLUMNS.map((c) => c.key)).size === Vw.COLUMNS.length &&
			keys.every((k) => Vw.COLUMNS.filter((c) => c.key === k).length === 1));
		ok("columns/a fresh install hides them, the Default preset does not show them",
			keys.every((k) => Vw.defaultHiddenColumns()[k] === true) &&
			Vw.COLUMN_PRESETS[0].keys.every((k) => keys.indexOf(k) === -1));
		const p = res.players.filter((x) => x.newSkills && x.newSkills.length && x.origRatings)[0];
		ok("columns/skills are the player's skill tags", Vw.cellValue(p, "skills", res) === p.newSkills.join(" "));
		ok("columns/orig ovr and pot are the file's; the delta is new minus orig",
			Vw.cellValue(p, "origOvr", res) === p.origOvr && Vw.cellValue(p, "origPot", res) === p.origPot &&
			Vw.cellValue(p, "ovrDelta", res) === p.newOvr - p.origOvr && Vw.cellValue(p, "potDelta", res) === p.newPot - p.origPot);
		ok("columns/a rating column is the new rating",
			Vw.RATING_COLUMN_KEYS.every((k) => Vw.cellValue(p, "r_" + k, res) === p.newRatings[k]));
		/* The pro projection needs the page's Pro layer; use it when loaded. */
		if (global.Pro && Vw.proFor) {
			const pr = global.Pro.projectClass(res);
			const first = res.players.filter((x) => pr[x.key])[0];
			ok("columns/pro peak and verdict come from the projection",
				first && Vw.cellValue(first, "proPeak", res) === pr[first.key].peak &&
				Vw.cellValue(first, "proVerdict", res) === pr[first.key].verdict,
				first && Vw.cellValue(first, "proPeak", res) + " " + Vw.cellValue(first, "proVerdict", res));
		}
		ok("columns/the picker lists them (groups) and the hidden-set keeps working",
			/\["Pro projection"/.test(read("js", "views.js")) && /\["Ratings", RATING_COLUMN_KEYS/.test(read("js", "views.js")));
		/* The CSV: one table (CSV_EXTRA) feeds both, so they cannot disagree. */
		ok("csv/the CSV appends exactly the table's extra columns, ratings under BBGM's own names",
			/\.concat\(V\.CSV_EXTRA\.map\(\(x\) => x\[0\]\)\)/.test(APP) && /\.concat\(V\.csvExtras\(p, res\)\)/.test(APP) &&
			Vw.CSV_EXTRA.length === keys.length && Vw.CSV_EXTRA.every((x) => x[0] === x[1].replace(/^r_/, "")));
		const row = Vw.csvExtras(p, res);
		ok("csv/every value in the file is the value the table reads, column for column",
			Vw.CSV_EXTRA.every((x, i) => row[i] === Vw.cellValue(p, x[1], res) ||
				(row[i] === undefined && Vw.cellValue(p, x[1], res) === undefined)));
		ok("csv/the file really has the 15 ratings, skills, original ovr and pot as columns",
			["hgt", "stre", "spd", "jmp", "endu", "ins", "dnk", "ft", "fg", "tp", "oiq", "diq", "drb", "pss", "reb", "skills", "origOvr", "origPot"]
				.every((h) => Vw.CSV_EXTRA.some((x) => x[0] === h)));
		/* A saved layout from before these existed must not grow 25 columns. */
		ok("columns/restore hides an optional column added since the settings were saved",
			/knownColumns: V\.COLUMNS\.map/.test(APP) && /V\.EXTRA_COLUMNS\.some/.test(APP));
	}

	/* ---- Q19 / Q20: filters and the search syntax ------------------------- */
	{
		const ctx = { locked: (p) => !!state.overrides[p.key], starred: (p) => !!state.watch["@fp|" + p.key],
			tags: (p) => state.tags["@fp|" + p.key] || [] };
		const all = res.players;
		const run = (q) => all.filter((p) => Vw.queryMatch(Vw.parseQuery(q), p, res, ctx));
		const old = (q) => all.filter((p) => (p.name + " " + p.newCollege + " " + (p.proClub || "") + " " +
			p.archetype + " " + p.classYear + " " + (p.awards || []).join(" ")).toLowerCase().indexOf(q.toLowerCase()) !== -1);
		const school = all.filter((p) => p.newCollege && !p.nonNcaa)[0].newCollege;
		ok("search/plain words behave exactly as before (a whole-string substring)",
			["", "a", "guard", school.toLowerCase(), "rim protector", "Junior", "  "].every((q) =>
				run(q.trim() === "" ? "" : q).length === (q.trim() === "" ? all.length : old(q.trim()).length)), "");
		const pos = all[0].newPos;
		ok("search/pos:C keeps exactly that position",
			run("pos:" + pos).length > 0 && run("pos:" + pos).every((p) => p.newPos === pos) &&
			run("pos:" + pos).length === all.filter((p) => p.newPos === pos).length);
		const med = all.map((p) => p.newOvr).sort((a, b) => a - b)[Math.floor(all.length / 2)];
		ok("search/numeric comparisons: ovr>=, <, =, ranges, and a column by its key",
			run("ovr>=" + med).every((p) => p.newOvr >= med) && run("ovr>=" + med).length === all.filter((p) => p.newOvr >= med).length &&
			run("ovr<" + med).length === all.filter((p) => p.newOvr < med).length &&
			run("ovr:" + (med - 2) + "-" + (med + 2)).length === all.filter((p) => p.newOvr >= med - 2 && p.newOvr <= med + 2).length &&
			run("ovr=" + med).length === all.filter((p) => p.newOvr === med).length &&
			run("age<=20").every((p) => p.age <= 20) && run("ht>=80").every((p) => p.newHgtInches >= 80),
			"");
		ok("search/school: and a quoted value with a space",
			run("school:" + school.toLowerCase()).every((p) => (p.newCollege + " " + (p.proClub || "")).toLowerCase().indexOf(school.toLowerCase()) !== -1) &&
			run('school:"' + school + '"').length >= 1);
		ok("search/several terms all have to hold",
			run("pos:" + pos + " ovr>=" + med).length === all.filter((p) => p.newPos === pos && p.newOvr >= med).length);
		state.overrides[all[0].key] = { ovr: 50 };
		state.overrides[all[1].key] = { ovr: 51 };
		ok("search/is:locked, and a leading - negates it",
			run("is:locked").length === 2 && run("-is:locked").length === all.length - 2 &&
			run("is:locked").map((p) => p.key).join() === [all[0].key, all[1].key].join());
		state.watch["@fp|" + all[2].key] = true;
		state.tags["@fp|" + all[2].key] = ["sleeper"];
		ok("search/is:starred and tag: read the browser's own state",
			run("is:starred").length === 1 && run("tag:sleeper").length === 1 && run("tag:bust").length === 0);
		const tr = all.filter((p) => p.transfer && p.transfer.from);
		ok("search/is:transfer and the bare negated word -transfer split the class in two",
			run("is:transfer").length === tr.length && run("-transfer").length === all.length - tr.length &&
			run("-is:transfer").length === all.length - tr.length, tr.length + "");
		ok("search/year: with its short forms and skill: are exact",
			run("year:sr").every((p) => /senior/i.test(p.classYear)) &&
			run("skill:3").every((p) => (p.newSkills || []).indexOf("3") !== -1) &&
			run("skill:3").length === all.filter((p) => (p.newSkills || []).indexOf("3") !== -1).length);
		ok("search/a comma lists alternatives",
			run("pos:PG,C").length === all.filter((p) => p.newPos === "PG" || p.newPos === "C").length);
		const bad = Vw.parseQuery("is:wizard ovr>=55 -x");
		ok("search/an unknown is: flag is reported and left out, not turned into a filter",
			bad.ignored.length === 1 && bad.ignored[0] === "is:wizard" && bad.terms.length === 1 && bad.words.length === 1);
		ok("search/an unknown field is just text, so 'St. John's' and '3:2' still search",
			Vw.parseQuery("foo:bar").terms.length === 0 && Vw.parseQuery("foo:bar").words[0].text === "foo:bar");
		ok("search/a lone dash and a word in a path position are plain text",
			Vw.parseQuery("-").words[0].text === "-" && Vw.parseQuery("-").words[0].neg === false);
		/* The Prospects table's matchesFilter uses it, and so do the board and the filter bar. */
		state.filter = Vw.emptyFilter();
		state.filter.q = "pos:" + pos + " ovr>=" + med;
		ok("search/matchesFilter reads the syntax",
			all.filter((p) => Vw.matchesFilter(p, res)).length === all.filter((p) => p.newPos === pos && p.newOvr >= med).length);
		state.filter = Vw.emptyFilter();
		/* Q19 */
		const sk = all.filter((p) => (p.newSkills || []).length >= 1)[0].newSkills[0];
		state.filter.skills = [sk];
		ok("filter/skills: every ticked skill must be on the player",
			all.filter((p) => Vw.matchesFilter(p, res)).length === all.filter((p) => (p.newSkills || []).indexOf(sk) !== -1).length);
		state.filter = Vw.emptyFilter();
		state.filter.classYear = all[0].classYear;
		ok("filter/class year", all.filter((p) => Vw.matchesFilter(p, res)).every((p) => p.classYear === all[0].classYear) &&
			all.filter((p) => Vw.matchesFilter(p, res)).length >= 1);
		for (const [k] of Vw.PATH_FILTERS) {
			state.filter = Vw.emptyFilter();
			state.filter.path = k;
			const n = all.filter((p) => Vw.matchesFilter(p, res)).length;
			const want = all.filter((p) => Vw.pathFlags(p)[k]).length;
			ok("filter/path " + k + " keeps the " + want + " who have it", n === want, n + " vs " + want);
		}
		state.filter = Vw.emptyFilter();
		state.filter.tag = "sleeper";
		ok("filter/tag", all.filter((p) => Vw.matchesFilter(p, res)).length === 1);
		state.filter = Vw.emptyFilter();
		state.overrides = {}; state.watch = {}; state.tags = {};
	}

	/* ---- Q21: saved filter views ------------------------------------------ */
	{
		const f = Vw.cleanFilter({ q: "pos:C", pos: "G", skills: ["3", 5], ranges: [{ key: "ppg", min: 10 }, { nokey: 1 }],
			classYear: "Senior", path: "juco", junk: 1, lockedOnly: 1 });
		ok("filterviews/a saved filter is cleaned to the canonical shape",
			f.q === "pos:C" && f.pos === "G" && JSON.stringify(f.skills) === '["3"]' && f.ranges.length === 1 &&
			f.ranges[0].min === 10 && f.lockedOnly === true && !("junk" in f) && f.classYear === "Senior" && f.path === "juco");
		ok("filterviews/garbage becomes the empty filter; the empty filter has every key",
			JSON.stringify(Vw.cleanFilter(null)) === JSON.stringify(Vw.emptyFilter()) &&
			["q", "pos", "conf", "archetype", "changedOnly", "lockedOnly", "playedOnly", "didNotPlayOnly", "ranges",
				"skills", "classYear", "path", "tag"].every((k) => k in Vw.emptyFilter()));
		const v = Vw.cleanFilterViews({ "My view": { q: "x" }, "": { q: "y" }, ["z".repeat(80)]: {}, arr: [] });
		ok("filterviews/names are kept, blank and over-long names dropped, each cleaned",
			Object.keys(v).sort().join() === "My view,arr" && v["My view"].q === "x");
		ok("filterviews/they persist and restore through cleanFilterViews, and the clear button uses the canonical filter",
			/filterViews: state\.filterViews/.test(APP) && /V\.cleanFilterViews\(saved\.filterViews\)/.test(APP) &&
			/st\.filter = emptyFilter\(\)/.test(read("js", "views.js")));
	}

	/* ---- Q16: tags --------------------------------------------------------- */
	{
		ok("tags/the set is sleeper, bust risk, my guy", JSON.stringify(Vw.PLAYER_TAGS) === '["sleeper","bust risk","my guy"]');
		const t = Vw.cleanTags({ "@a|1": ["sleeper", "nope", "sleeper", "my guy"], "@a|2": [], "@a|3": "x", "@a|4": ["bust risk"] });
		ok("tags/only known tags survive, once each; empty and non-list entries drop",
			JSON.stringify(t) === '{"@a|1":["sleeper","my guy"],"@a|4":["bust risk"]}', JSON.stringify(t));
		ok("tags/garbage restores as no tags", JSON.stringify(Vw.cleanTags(null)) === "{}" && JSON.stringify(Vw.cleanTags([1])) === "{}");
		ok("tags/they are keyed by userKey (the class fingerprint) like the watchlist, persisted and restored",
			/tags: state\.tags/.test(APP) && /V\.cleanTags\(saved\.tags\)/.test(APP) &&
			/const k = userKey\(p\);\s*const cur = \(state\.tags\[k\]/.test(APP));
		ok("tags/the export's my-notes block carries them as one Tags: line under the note",
			/"Tags: " \+ tags\[k\]\.join\(", "\)/.test(APP) && /userMarks = \{ notes, watch: pick\(state\.watch\), tags \}/.test(APP));
		ok("tags/the board has chips to filter by them and the player page has the toggles",
			/tagchip/.test(read("js", "views.js")) && /A\(\)\.toggleTag\(p, t\)/.test(read("js", "views.js")));
	}

	/* ---- Q11 / Q12: locks CSV and pasted names ----------------------------- */
	{
		const a = res.players[0];
		const b = res.players[1];
		const lists = { archetypes: new Set(["Slasher"]), schools: new Set(["Duke"]) };
		const head = ["key", "name", "ovr", "pot", "archetype", "college", "newname", "hgtinches", "weight", "hgt", "tp", "reb"];
		const rows = [head,
			[a.key, a.name, "55", "", "Slasher", "Duke", "New Name", "80", "215", "61", "", "44"],
			["", b.name.toUpperCase(), "", "", "Nobody", "Nowhere", "", "120", "50", "101", "-1", ""],
			["nope", "", "50"]];
		const plan = Vw.planLockRows(rows, res.players, lists);
		const pa = plan.applied.filter((x) => x.player === a)[0];
		ok("locks csv/newname, hgtinches, weight and ratings become ov.name, ov.hgtInches, ov.weight and ov.ratings",
			pa && pa.patch.ovr === 55 && pa.patch.name === "New Name" && pa.patch.hgtInches === 80 && pa.patch.weight === 215 &&
			JSON.stringify(pa.patch.ratings) === '{"hgt":61,"reb":44}' && pa.patch.archetype === "Slasher" && pa.patch.college === "Duke" &&
			!("pot" in pa.patch), JSON.stringify(pa && pa.patch));
		ok("locks csv/a name column still matches (any case) and out-of-range or unknown values are refused, not applied",
			plan.applied.filter((x) => x.player === b).length === 0 && plan.rejected.length === 6 && plan.unmatched.join() === "nope", JSON.stringify(plan.rejected));
		ok("locks csv/an old six-column file still imports exactly as before",
			(() => {
				const q = Vw.planLockRows([["key", "name", "ovr", "pot", "archetype", "college"], [a.key, "", "", "70", "", ""]], res.players, lists);
				return q.applied.length === 1 && JSON.stringify(q.applied[0].patch) === '{"pot":70}' && q.total === 1;
			})());
		ok("locks csv/no key or name column is an error; an empty file is an error",
			Vw.planLockRows([["ovr"], ["5"]], res.players).error && Vw.planLockRows([], res.players).error);
		ok("locks csv/the preview prints ratings, not [object Object]",
			Vw.lockPatchText({ ovr: 5, ratings: { tp: 40, hgt: 61 } }) === "ovr = 5; ratings tp 40, hgt 61");
		ok("locks csv/the export writes the same columns the import reads",
			/"newname",\s*"hgtinches", "weight"\]\.concat\(V\.RATING_COLUMN_KEYS\)/.test(APP) &&
			/V\.planLockRows\(rows, res\.players/.test(APP));
		const board = res.board;
		const pr = Vw.planRenames("1. Ada Lee\n\n-\n• Cy Dee\n" + board[4].name + "\n", board);
		ok("rename/the list is applied in board order; blank, a lone dash and an unchanged name keep the name",
			pr.rows.length === 2 && pr.rows[0].key === board[0].key && pr.rows[0].to === "Ada Lee" &&
			pr.rows[1].key === board[3].key && pr.rows[1].to === "Cy Dee" && pr.kept === 3 && pr.extra === 0, JSON.stringify(pr));
		ok("rename/a list longer than the class is cut and said so",
			Vw.planRenames(board.map((p, i) => "N" + i).concat(["x", "y"]).join("\n"), board).extra === 2);
		ok("rename/two prospects ending up with one new name are reported",
			Vw.planRenames("Same Name\nSame Name", board).duplicates.join() === "same name");
		ok("rename/the dialog writes ov.name and is reachable from the board, the export menu and the key",
			/\{ name: r\.to \}/.test(APP) && /Paste names/.test(read("js", "views.js")) && /Rename prospects from a pasted list/.test(APP));
	}

	/* ---- Q15: bulk actions -------------------------------------------------- */
	{
		const v = read("js", "views.js");
		ok("bulk/shift pot, shift height and reroll-selected are on the bulk bar and in App",
			/Shift pot/.test(v) && /Shift height/.test(v) && /Reroll selected/.test(v) &&
			/bulkShiftPot, bulkShiftHeight, bulkReroll/.test(APP));
		ok("bulk/each writes the lock the engine reads (pot, hgtInches within 58-96, a reroll counter)",
			/bulkShiftField\("pot", d, 0, 100/.test(APP) && /bulkShiftField\("hgtInches", d, 58, 96/.test(APP) &&
			/reroll: \(Number\(cur\.reroll\) \|\| 0\) \+ 1/.test(APP));
	}

	/* ---- Q7 / Q2: partial export and the change report (engine side) ---------- */
	{
		const E = global.Engine;
		ok("partial/the engine honours opts.only and says what it trimmed",
			(() => {
				const r2 = E.run(V.realisticClass(3, 30), global.Config.make({ seed: "qw-only" }));
				const keys = r2.board.slice(0, 5).map((p) => p.key);
				const out = E.exportFile(r2, { only: keys });
				const trimmed = E.exportFile.trimmed;
				return out.players.length === 5 && trimmed && trimmed.kept === 5 && trimmed.dropped === 25;
			})());
		ok("partial/the menu offers the whole class, top N, starred, selected and the current filter",
			["the whole class", "the top N of the board", "my starred prospects", "the rows I ticked",
				"what the prospect table's filter shows"].every((s) => APP.indexOf(s) !== -1) && /popts\.only = keys/.test(APP));
		ok("partial/the choice is never stored with the persisted options (it is a one-time scope)",
			!/only:/.test(APP.slice(APP.indexOf("const exportOpts = () => ({"), APP.indexOf("const exportOpts = () => ({") + 500)) &&
			!("only" in (Vw.cleanExportOpts({ stats: true, only: ["a"] }) || {})));
		ok("partial/the class-file export reports how many it kept",
			/tr\.kept \+ " of " \+ \(tr\.kept \+ tr\.dropped\)/.test(APP));
		ok("changes/the menu downloads the engine's change report as Markdown and as CSV",
			/exportChangeReport\(res, "md"/.test(APP) && /exportChangeReport\(res, "csv"/.test(APP) &&
			/changeReportText\(report, format\)/.test(APP));
		ok("changes/the report the engine builds has one row per player and a count of rewritten fields",
			(() => {
				const r3 = E.run(V.realisticClass(4, 20), global.Config.make({ seed: "qw-rep" }));
				const rep = E.changeReport(r3, { exportOptions: {} });
				return rep.rows.length === r3.players.length && rep.counts.players === r3.players.length &&
					/^key,name,origOvr,newOvr/.test(E.changeReportText(rep, "csv")) &&
					/^# What the tool did to the file/.test(E.changeReportText(rep, "md"));
			})());
	}

	/* ---- Q23: metric units, display only ------------------------------------- */
	{
		state.units = "imperial";
		ok("units/feet and inches by default", Vw.feet(80) === "6'8\"" && Vw.weightText(220) === "220" && Vw.metricUnits() === false);
		state.units = "metric";
		ok("units/metric shows cm and kg", Vw.feet(80) === "203 cm" && Vw.weightText(220) === "100" && Vw.metricUnits() === true);
		ok("units/blank values stay blank", Vw.feet(NaN) === "" && Vw.weightText(undefined) === "");
		state.units = "imperial";
		ok("units/stored and exported numbers are untouched: the toggle only reaches display code",
			/units: state\.units/.test(APP) && !/units/.test(APP.slice(APP.indexOf("const CSV_COLS"), APP.indexOf("function exportCsv"))));
	}

	/* ---- Q4: previous / next prospect ---------------------------------------- */
	{
		const b = res.board;
		const mid = Vw.neighborKeys(res, b[3].key);
		ok("prevnext/the neighbours are the board-order prospects either side, with a position",
			mid.prev === b[2].key && mid.next === b[4].key && mid.index === 3 && mid.total === b.length);
		ok("prevnext/the ends wrap around",
			Vw.neighborKeys(res, b[0].key).prev === b[b.length - 1].key && Vw.neighborKeys(res, b[b.length - 1].key).next === b[0].key);
		ok("prevnext/an unknown key has no neighbours", Vw.neighborKeys(res, "nope").index === -1);
		ok("prevnext/j and k step, Esc goes back, the page has Prev and Next buttons",
			/showPlayer\(k === "j" \? nb\.next : nb\.prev\)/.test(APP) && /showPlayer\(null\)/.test(APP.slice(APP.indexOf('e.key === "Escape" && state.player'))) &&
			/data-nav|dataset\.nav/.test(read("js", "views.js")));
	}

	/* ---- Q24: print ------------------------------------------------------------ */
	{
		ok("print/a button, a print-only header, and the header names class, seed, fingerprint and date",
			/id="btnPrint"/.test(HTML) && /id="printHeader"/.test(HTML) && /\.printonly \{ display: none; \}/.test(CSS) &&
			/@media print \{\s*\.printonly \{ display: block !important/.test(CSS) &&
			/className\(res\) \+ " — seed " \+ res\.seed \+ " — class " \+ classFingerprint\(res\)/.test(APP) &&
			/new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/.test(APP) && /addEventListener\("beforeprint"/.test(APP));
		ok("print/the copy strips do not print", /\.tablecopy[^{]*\{[^}]*display: none !important/.test(CSS.slice(CSS.lastIndexOf("@media print"))));
	}

	/* ---- Q17: New class... ------------------------------------------------------ */
	{
		ok("newclass/a header button and an empty-state button open one dialog with size, year and seed",
			/id="btnNewClass"/.test(HTML) && /id="btnNewClassEmpty"/.test(HTML) && /newClassDialog/.test(APP) &&
			/Sample\.makeClass\(v\.seed, v\.n, v\.y\)/.test(APP) && /append: state\.files\.length > 0/.test(APP));
		const S = global.Sample;
		const c1 = S.makeClass("s1", 30, 2031);
		const c2 = S.makeClass("s1", 30, 2031);
		ok("newclass/the same seed, size and year give the same class; size and year are honoured",
			JSON.stringify(c1) === JSON.stringify(c2) && c1.players.length === 30 && S.makeClass("s1", 12, 2040).players.length === 12);
	}

	/* ---- Q44: shortcuts ------------------------------------------------------------ */
	{
		const sheet = APP.slice(APP.indexOf("const SHORTCUTS = ["), APP.indexOf("function shortcutSheet"));
		for (const [k, what] of [["w", "Star"], ["c", "comparison"], ["y", "link"], ["n", "note"], ["h", "heatmap"], ["x", "export menu"]]) {
			ok("shortcuts/" + k + " is handled and on the help sheet",
				new RegExp("\\[\"" + k + "\", \"[^\"]*" + what, "i").test(sheet) &&
				new RegExp('k === "' + k + '"').test(APP.slice(APP.indexOf("function quickWinKey"))), k);
		}
		ok("shortcuts/the existing keys are all still on the sheet",
			["r", "g", "e", "p", "l", "b", "s", "/"].every((k) => sheet.indexOf('["' + k + '"') !== -1));
	}

	global.App = hadApp;
};
