#!/usr/bin/env node
/* BBGM Draft Class Workshop, without the browser.

   The same engine the page runs, loaded the way the test harness loads it
   (js/manifest.js), so a class made here is the class the page makes for the
   same file, seed and settings — which is the point: the engine is
   deterministic, and a commissioner can script it.

     bbgmdraft run   <file> [options]   generate a class and write the customized file
     bbgmdraft batch <file> [options]   generate many and print the distribution
     bbgmdraft universe <file>... [options]  chain several seasons into one world
     bbgmdraft mock  <file> [options]   a two-round mock draft with pro projections
     bbgmdraft check <file>             validate a file and list what is wrong with it
     bbgmdraft settings [name]          the settings, their defaults and ranges; the presets
     bbgmdraft help

   Experimental: the options and the output format may change. Nothing here is
   uploaded anywhere; it reads one file and writes one file. */
"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

/* ------------------------------------------------------------ the engine */

function loadEngine() {
	if (!global.window) global.window = global;
	if (global.Engine) return;
	for (const f of require("../js/manifest.js").node) {
		require(path.join(__dirname, "..", "js", f + ".js"));
	}
}

/* ----------------------------------------------------------- the options */

const NOTE_PRESETS = {
	none: [],
	short: ["summary", "team", "stats"],
	forum: ["summary", "team", "traits", "awards", "stock"],
	standard: null, // the default template, filled in once the engine is loaded
	stat: ["summary", "team", "stats", "shooting", "advanced", "defense", "playmaking",
		"highs", "ranks"],
	all: null,
};

const FLAGS = {
	// name: takes a value?
	"--seed": true, "--preset": true, "--set": true, "--year": true, "--notes": true,
	"--out": true, "-n": true, "--stats": false, "--prior": false, "--highs": false,
	"--awards": false, "--awards-major": false, "--no-ages": false, "--no-jerseys": false,
	"--no-injuries": false, "--csv": false, "--json": false,
	"--quiet": false, "-q": false, "--no-gaps": false, "--help": false, "-h": false,
};

function parseArgs(argv) {
	const out = { positional: [], set: [], flags: {} };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a.indexOf("--") === 0 && a.indexOf("=") > 0) {
			const eq = a.indexOf("=");
			argv.splice(i, 1, a.slice(0, eq), a.slice(eq + 1));
			i--;
			continue;
		}
		if (a[0] !== "-" || a === "-") { out.positional.push(a); continue; }
		if (!(a in FLAGS)) throw new Error("unknown option " + a + " (try: bbgmdraft help)");
		if (FLAGS[a]) {
			if (i + 1 >= argv.length) throw new Error(a + " needs a value");
			const v = argv[++i];
			if (a === "--set") out.set.push(v); else out.flags[a] = v;
		} else out.flags[a] = true;
	}
	return out;
}

/* ------------------------------------------------------------ the files */

function readClassFile(file, year) {
	if (!file) throw new Error("no file given");
	let buf = fs.readFileSync(file);
	if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
	const text = buf.toString("utf8").replace(/^﻿/, "");
	let data;
	try { data = JSON.parse(text); } catch (e) {
		throw new Error(file + " is not JSON: " + e.message);
	}
	const E = global.Engine;
	// A league export holds a class per future draft year; pick one.
	if (E.isLeagueFile(data)) {
		const found = E.draftClassesIn(data);
		if (!found.length) throw new Error("no draft class found in the league file " + file);
		if (year === undefined) {
			if (found.length === 1) year = found[0].year;
			else throw new Error(file + " is a league with " + found.length + " draft classes (" +
				found.map((c) => c.year).join(", ") + "); choose one with --year");
		}
		return { data: E.extractDraftClass(data, Number(year)), league: true };
	}
	return { data, league: false };
}

/* ---------------------------------------------------------- the settings */

function coerce(key, raw) {
	const D = global.Config.DEFAULTS;
	if (!(key in D)) {
		const near = Object.keys(D).filter((k) => k.toLowerCase().indexOf(key.toLowerCase()) !== -1 ||
			key.toLowerCase().indexOf(k.toLowerCase()) !== -1).slice(0, 5);
		throw new Error("unknown setting \"" + key + "\"" +
			(near.length ? " — did you mean " + near.join(", ") + "?" : " (try: bbgmdraft settings)"));
	}
	const t = typeof D[key];
	if (t === "number") {
		const n = Number(raw);
		if (raw === "" || !Number.isFinite(n)) throw new Error(key + " takes a number, not \"" + raw + "\"");
		return n;
	}
	if (t === "boolean") {
		if (/^(true|1|yes|on)$/i.test(raw)) return true;
		if (/^(false|0|no|off)$/i.test(raw)) return false;
		throw new Error(key + " takes true or false, not \"" + raw + "\"");
	}
	if (t === "string" || D[key] === null) return raw;
	throw new Error(key + " cannot be set from the command line (use a preset, or --notes for the note template)");
}

function buildConfig(args) {
	const C = global.Config;
	const f = args.flags;
	const cfg = {};
	if (f["--preset"]) {
		const names = Object.keys(C.PRESETS);
		const name = names.find((n) => n.toLowerCase() === String(f["--preset"]).toLowerCase());
		if (!name) throw new Error("unknown preset \"" + f["--preset"] + "\". Presets: " + names.join(", "));
		Object.assign(cfg, C.PRESETS[name]);
	}
	for (const s of args.set) {
		const eq = s.indexOf("=");
		if (eq < 1) throw new Error("--set takes key=value, not \"" + s + "\"");
		cfg[s.slice(0, eq)] = coerce(s.slice(0, eq), s.slice(eq + 1));
	}
	if (f["--notes"] !== undefined) {
		const all = global.Engine.NOTE_LINES.map((x) => x[0]);
		const v = String(f["--notes"]);
		const named = v.toLowerCase();
		if (named in NOTE_PRESETS) {
			cfg.noteLines = NOTE_PRESETS[named] || (named === "all" ? all : C.DEFAULTS.noteLines.slice());
		} else {
			const lines = v.split(",").map((x) => x.trim()).filter(Boolean);
			const bad = lines.filter((x) => all.indexOf(x) === -1);
			if (bad.length) throw new Error("unknown note line " + bad.join(", ") + ". Lines: " + all.join(", "));
			cfg.noteLines = lines;
		}
	}
	if (f["--seed"] !== undefined) cfg.seed = String(f["--seed"]);
	return C.make(cfg);
}

function exportOptions(args) {
	const f = args.flags;
	return {
		ages: !f["--no-ages"], injuries: !f["--no-injuries"], jerseys: !f["--no-jerseys"],
		stats: !!f["--stats"], prior: !!f["--prior"], highs: !!f["--highs"],
		awards: !!f["--awards"] || !!f["--awards-major"],
		awardsScope: f["--awards-major"] ? "major" : "all",
	};
}

/* --------------------------------------------------------------- output */

function say(args, text) {
	if (!args.flags["--quiet"] && !args.flags["-q"]) process.stderr.write(text + "\n");
}

function table(rows) {
	const w = rows[0].map((_, i) => Math.max.apply(null, rows.map((r) => String(r[i]).length)));
	return rows.map((r) => r.map((c, i) => String(c).padEnd(w[i])).join("  ").trimEnd()).join("\n");
}

function csvCell(v) {
	if (v === null || v === undefined) return "";
	const s = String(v);
	return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/* ------------------------------------------------------------- commands */

function cmdRun(args) {
	const file = args.positional[1];
	const { data } = readClassFile(file, args.flags["--year"]);
	const cfg = buildConfig(args);
	const res = global.Engine.run(data, cfg);
	const out = global.Engine.exportFile(res, exportOptions(args));
	const base = path.basename(file).replace(/\.json(\.gz)?$|\.gz$/i, "");
	const dest = args.flags["--out"] || path.join(path.dirname(file), base + "_customized.json");
	const body = "﻿" + JSON.stringify(out, null, 2);
	if (dest === "-") process.stdout.write(body + "\n");
	else fs.writeFileSync(dest, body);
	const top = (res.board || []).slice(0, 5);
	if (args.flags["--json"]) {
		process.stderr.write(JSON.stringify({
			seed: res.seed, season: res.season, flavor: res.flavor ? res.flavor.label : null,
			players: res.players.length, written: dest === "-" ? null : dest,
			champion: res.tourney && res.tourney.champion && res.tourney.champion.team
				? res.tourney.champion.team.name : null,
			top: top.map((p) => ({ name: p.name, pos: p.newPos, ovr: p.newOvr, pot: p.newPot,
				school: p.proClub || p.newCollege })),
			engineRev: global.Universe.ENGINE_REV,
		}, null, 2) + "\n");
	} else {
		say(args, "seed " + res.seed + " · " + res.season + " · " + res.players.length + " players" +
			(res.flavor && res.flavor.label ? " · " + res.flavor.label : "") +
			" · engine rev " + global.Universe.ENGINE_REV);
		if (res.tourney && res.tourney.champion && res.tourney.champion.team) {
			say(args, "champion: " + res.tourney.champion.team.name);
		}
		say(args, table([["#", "name", "pos", "ovr", "pot", "school"]].concat(top.map((p, i) =>
			[i + 1, p.name, p.newPos, p.newOvr, p.newPot, p.proClub || p.newCollege]))));
		if (dest !== "-") say(args, "wrote " + dest);
	}
}

function cmdBatch(args) {
	const file = args.positional[1];
	const { data } = readClassFile(file, args.flags["--year"]);
	const cfg = buildConfig(args);
	const n = Math.max(1, Math.round(Number(args.flags["-n"] || 10)));
	const B = global.BatchStats;
	const base = B.batchSeed(cfg, cfg.seed);
	const runner = global.Engine.createRunner(data);
	const rows = [];
	for (let i = 0; i < n; i++) {
		const c = global.Config.make(cfg);
		c.seed = base + "#" + i;
		rows.push(B.summarize(runner.run(c)));
		if (process.stderr.isTTY && !args.flags["--quiet"]) process.stderr.write("\r  " + (i + 1) + "/" + n);
	}
	if (process.stderr.isTTY && !args.flags["--quiet"]) process.stderr.write("\r          \r");
	const cols = ["seed", "flavor", "ovr", "pot", "ppg", "usg", "ts", "topPpg", "awards",
		"archetypes", "champion", "champSeed", "teamPpg"];
	if (args.flags["--json"]) {
		process.stdout.write(JSON.stringify({ baseSeed: base, engineRev: global.Universe.ENGINE_REV, rows }, null, 2) + "\n");
	} else if (args.flags["--csv"]) {
		process.stdout.write(cols.join(",") + "\n" +
			rows.map((r) => cols.map((c) => csvCell(typeof r[c] === "number" ? +r[c].toFixed(3) : r[c])).join(",")).join("\n") + "\n");
	} else {
		const f1 = (v) => (typeof v === "number" ? v.toFixed(1) : v === null || v === undefined ? "" : v);
		process.stdout.write(table([["seed", "flavor", "ovr", "ppg", "topPpg", "ts%", "champion", "seed#"]]
			.concat(rows.map((r) => [r.seed, r.flavor || "", f1(r.ovr), f1(r.ppg), f1(r.topPpg),
				f1(r.ts), r.champion || "", r.champSeed === null ? "" : r.champSeed]))) + "\n");
		const m = (k) => f1(B.mean(rows.map((r) => r[k])));
		say(args, "mean over " + n + ": ovr " + m("ovr") + " · ppg " + m("ppg") + " · usg " + m("usg") +
			" · ts " + m("ts") + " · base seed " + base);
	}
}

/* A UNIVERSE, the way js/app.js's runUniverse builds one: the files in season
   order, one chain, each season handing its world to the next. Prints the
   timeline and writes the universe export (seeds, fingerprints, the rows and
   the records), which the page's Universe tab imports. The players file is
   not written here: it needs the career links the page adds after the chain
   (js/app.js linkCareers), and that step is not yet shared. */
function cmdUniverse(args) {
	const U = global.Universe;
	const files = args.positional.slice(1);
	if (files.length < 1) throw new Error("universe needs one or more class files");
	const loaded = [];
	for (const name of files) {
		const { data } = readClassFile(name, args.flags["--year"]);
		loaded.push({ name: path.basename(name), data });
	}
	loaded.forEach((f) => { f.fingerprint = U.fileFingerprint(f); });
	const cfg = buildConfig(args);
	const frozen = global.Config.make(cfg);
	frozen.biography = null;
	const baseSeed = cfg.seed && cfg.seed.trim() ? cfg.seed.trim()
		: "universe-" + Math.floor(Math.random() * 1e9).toString(36);
	const runners = loaded.map((f) => global.Engine.createRunner(f.data));
	const diags = U.validate(loaded);
	const runnable = diags.filter((d) => d.ok)
		.sort((a, b) => (a.season || 0) - (b.season || 0) || a.index - b.index);
	for (const d of diags.filter((x) => !x.ok)) say(args, "skipped " + d.name + ": " + d.errors.join("; "));
	if (!runnable.length) throw new Error("no runnable files");
	const chain = U.beginChain({
		mode: "cold", files: loaded, runnable, settings: frozen, baseSeed, diags,
		name: null, createdAt: null,
		make: (st) => global.Config.make(st),
		runnerFor: (i) => runners[i],
		store: () => {},
		dataChanged: (i) => { runners[i] = global.Engine.createRunner(loaded[i].data); },
		biographyFor: () => null,
		extrapolateGaps: !args.flags["--no-gaps"] && cfg.extrapolateGaps !== false,
		fullClass: U.FULL_CLASS,
		anomalyHistory: global.Engine.ANOMALY_MEMORY_DEPTH || 3,
	});
	for (let k = 0; k < chain.runnable.length; k++) {
		chain.step(k);
		if (process.stderr.isTTY && !args.flags["--quiet"]) {
			process.stderr.write("\r  season " + (k + 1) + " of " + chain.runnable.length);
		}
	}
	chain.finish({ cancelled: false, extrapolateYears: cfg.extrapolateYears || 0 });
	if (process.stderr.isTTY && !args.flags["--quiet"]) process.stderr.write("\r                         \r");
	const u = chain.universe;
	const name = (x) => (x && x.name) || "";
	if (args.flags["--json"]) {
		process.stdout.write(JSON.stringify({ baseSeed, engineRev: U.ENGINE_REV,
			rows: u.rows, threads: u.threads }, null, 2) + "\n");
	} else {
		process.stdout.write(table([["season", "champion", "runner-up", "player of the year", "No. 1 pick", ""]]
			.concat(u.rows.map((r) => [r.season, r.champion || "", r.runnerUp || "",
				name(r.poy), name(r.no1), r.extrapolated ? "extrapolated" : r.error ? "FAILED" : ""]))) + "\n");
		say(args, u.rows.length + " seasons · " + u.threads.length + " threads · base seed " +
			baseSeed + " · engine rev " + U.ENGINE_REV);
	}
	if (args.flags["--out"]) {
		fs.writeFileSync(args.flags["--out"], JSON.stringify(U.exportUniverse(u), null, 1));
		say(args, "wrote " + args.flags["--out"]);
	}
	if (u.broken) process.exitCode = 1;
}

/* The mock draft and the pro projections (js/pro.js), derived from the class
   the same file, seed and settings make. Nothing is written but the table. */
function cmdMock(args) {
	const { data } = readClassFile(args.positional[1], args.flags["--year"]);
	const res = global.Engine.run(data, buildConfig(args));
	const projections = global.Pro.projectClass(res);
	const mock = global.Pro.mockDraft(res, { projections });
	if (args.flags["--json"]) {
		process.stdout.write(JSON.stringify({ seed: res.seed, engineRev: global.Universe.ENGINE_REV,
			teams: mock.teams, picks: mock.picks, undrafted: mock.undrafted }, null, 2) + "\n");
		return;
	}
	const rows = mock.picks.map((k) => [k.pick, k.team, k.name, k.pos, k.ovr + "/" + k.pot,
		k.consensus || "", k.projection ? k.projection.peak + " (" + k.projection.peakLow + "-" +
			k.projection.peakHigh + ")" : "", k.projection ? k.projection.verdict : "", k.why]);
	const heads = ["pick", "team", "player", "pos", "ovr/pot", "board", "peak", "verdict", "why"];
	if (args.flags["--csv"]) {
		process.stdout.write(heads.join(",") + "\n" + rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n");
	} else {
		process.stdout.write(table([heads].concat(rows)) + "\n");
		say(args, "seed " + res.seed + " · " + mock.picks.length + " picks · " +
			mock.undrafted.length + " undrafted");
	}
}

function cmdCheck(args) {
	const { data, league } = readClassFile(args.positional[1], args.flags["--year"]);
	let v;
	try { v = global.Engine.validateLeagueFile(data); } catch (e) {
		process.stdout.write("REJECTED: " + e.message + "\n");
		process.exitCode = 1;
		return;
	}
	process.stdout.write((league ? "league file, class of " + data.startingSeason : "class file") +
		": " + data.players.length + " players, season " + v.season + ", schema " +
		(data.version === undefined ? "none" : data.version) + "\n");
	if (!v.warnings.length) process.stdout.write("no warnings\n");
	for (const w of v.warnings) process.stdout.write("warning: " + w + "\n");
}

function cmdSettings(args) {
	const C = global.Config;
	const name = args.positional[1];
	if (name === "presets") {
		for (const p of Object.keys(C.PRESETS)) {
			process.stdout.write(p + ": " + JSON.stringify(C.PRESETS[p]) + "\n");
		}
		return;
	}
	const rows = [["setting", "default", "min", "max"]];
	for (const k of Object.keys(C.DEFAULTS)) {
		if (name && k.toLowerCase().indexOf(name.toLowerCase()) === -1) continue;
		const d = C.DEFAULTS[k];
		if (d !== null && typeof d === "object") continue;
		const r = C.sliderRange(k);
		rows.push([k, JSON.stringify(d), r ? r.min : "", r ? r.max : ""]);
	}
	process.stdout.write(table(rows) + "\n");
	if (!name) process.stdout.write("\nbbgmdraft settings presets  lists the presets\n");
}

const HELP = `BBGM Draft Class Workshop (command line, experimental)

  bbgmdraft run   <file> [options]    write a customized class file
  bbgmdraft batch <file> [options]    run many seeds, print a table
  bbgmdraft universe <file>... [opts] run the classes as one continuous world
  bbgmdraft mock  <file> [options]    mock draft and pro career projections
  bbgmdraft check <file>              validate a file
  bbgmdraft settings [name|presets]   settings, defaults, ranges; presets

<file> is a BBGM draft class (.json or .json.gz) or a league export; for a league
with several draft classes choose one with --year.

Options (run, batch)
  --seed S           the seed (a class is reproducible from file + seed + settings)
  --preset NAME      a built-in preset (bbgmdraft settings presets)
  --set key=value    a setting, repeatable (bbgmdraft settings lists them)
  --notes WHAT       the note template: none, short, forum, standard, stat, all,
                     or lines such as summary,stats,awards
  --year Y           which draft class of a league file

Options (run)
  --out FILE         where to write (default <file>_customized.json; - = stdout)
  --stats --prior --highs     write the college statline, earlier seasons, season highs
  --awards | --awards-major   write honors (all, or national and major-conference only)
  --no-ages --no-jerseys --no-injuries   leave those fields as they came
  --json             print the summary as JSON on stderr
  -q                 no summary

Options (universe)
  --out FILE         write the universe export (the page's Universe tab imports it)
  --no-gaps          do not extrapolate seasons missing between the files
  --json             the rows and threads as JSON on stdout

Options (batch)
  -n N               how many classes (default 10)
  --csv | --json     machine-readable output on stdout

Exit status is non-zero if the file is rejected or an option is wrong.`;

function main() {
	let args;
	try { args = parseArgs(process.argv.slice(2)); } catch (e) {
		process.stderr.write("bbgmdraft: " + e.message + "\n");
		process.exit(2);
	}
	const cmd = args.positional[0];
	if (!cmd || cmd === "help" || args.flags["--help"] || args.flags["-h"]) {
		process.stdout.write(HELP + "\n");
		process.exit(cmd || args.flags["--help"] || args.flags["-h"] ? 0 : 2);
	}
	loadEngine();
	try {
		if (cmd === "run") cmdRun(args);
		else if (cmd === "batch") cmdBatch(args);
		else if (cmd === "universe") cmdUniverse(args);
		else if (cmd === "mock") cmdMock(args);
		else if (cmd === "check") cmdCheck(args);
		else if (cmd === "settings") cmdSettings(args);
		else throw new Error("unknown command \"" + cmd + "\" (try: bbgmdraft help)");
	} catch (e) {
		process.stderr.write("bbgmdraft: " + (e && e.message ? e.message : e) + "\n");
		process.exit(1);
	}
}

main();
