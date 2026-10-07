#!/usr/bin/env node
/* BBGM Draft Class Workshop, without the browser.

   The same engine the page runs, loaded the way the test harness loads it
   (js/manifest.js), so a class made here is the class the page makes for the
   same file, seed and settings — which is the point: the engine is
   deterministic, and a commissioner can script it.

     bbgmdraft run   <file> [options]   generate a class and write the customized file
     bbgmdraft batch <file> [options]   generate many and print the distribution
     bbgmdraft seek  <file> [options]   find the first seed that meets some conditions
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
// The page's own names for the same presets (its Notes tab: "Stat sheet",
// "Everything"), so what the page calls them works here too.
NOTE_PRESETS["stat sheet"] = NOTE_PRESETS["stat-sheet"] = NOTE_PRESETS.stat;
NOTE_PRESETS.everything = null;

const FLAGS = {
	// name: takes a value?
	"--seed": true, "--preset": true, "--set": true, "--year": true, "--notes": true,
	"--out": true, "-n": true, "--stats": false, "--prior": false, "--highs": false,
	"--awards": false, "--awards-major": false, "--no-ages": false, "--no-jerseys": false,
	"--no-injuries": false, "--no-notes": false, "--keep-notes": false, "--csv": false, "--json": false,
	"--quiet": false, "-q": false, "--no-gaps": false, "--help": false, "-h": false,
	"--settings": true, "--locks": true, "--gzip": false, "--count": true, "--merge": true,
	"--players-file": false, "--fragment": false, "--rounds": true, "--want": true, "--not": true,
	"--tries": true, "--fuzz": true, "--scouting": true, "--recipe": false, "--hometowns": false,
	"--pro-lines": false,
};
// Options that may be given more than once, kept as lists.
const REPEATABLE = { "--set": "set", "--want": "want", "--not": "not" };

function parseArgs(argv) {
	const out = { positional: [], set: [], want: [], not: [], flags: {} };
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
			if (REPEATABLE[a]) out[REPEATABLE[a]].push(v); else out.flags[a] = v;
		} else out.flags[a] = true;
	}
	return out;
}

/* ------------------------------------------------------------ the files */

function readClassFile(file, year, opts) {
	if (!file) throw new Error("no file given");
	if (year !== undefined) {
		const y = String(year).trim();
		if (!/^\d{4}$/.test(y)) throw new Error("--year takes a four-digit year, not \"" + year + "\"");
		year = Number(y);
	}
	// "-" is standard input (a pipe: `cat class.json.gz | bbgmdraft run - ...`).
	const shown = file === "-" ? "standard input" : file;
	let buf = fs.readFileSync(file === "-" ? 0 : file);
	if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
	const text = buf.toString("utf8").replace(/^﻿/, "");
	let data;
	try { data = JSON.parse(text); } catch (e) {
		throw new Error(shown + " is not JSON: " + e.message);
	}
	const E = global.Engine;
	// A league export holds a class per future draft year; pick one.
	if (E.isLeagueFile(data)) {
		const found = E.draftClassesIn(data);
		if (!found.length) throw new Error("no draft class found in the league file " + shown);
		if (year === undefined) {
			if (found.length === 1) year = found[0].year;
			else if (opts && opts.listClasses) return { league: true, classes: found, leagueData: data };
			else throw new Error(shown + " is a league with " + found.length + " draft classes (" +
				found.map((c) => c.year).join(", ") + "); choose one with --year");
		}
		return { data: E.extractDraftClass(data, Number(year)), league: true, leagueData: data };
	}
	if (year !== undefined) {
		process.stderr.write("bbgmdraft: note: --year only chooses a class of a league file; " +
			shown + " is a plain class file, so it is ignored\n");
	}
	return { data, league: false };
}

/* ---------------------------------------------------------- the settings */

function coerce(key, raw) {
	const C = global.Config;
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
	/* Settings whose default is null (audit C13). This branch took the raw
	   string for them, and Config.make quietly drops a string where it wants a
	   number or a table, so `--set leagueWeights=...` and `--set wEuroLeague=40`
	   ran exactly like not giving them. The three legacy destination dials are
	   numbers; the two weight tables are JSON objects of numbers; the rest are
	   containers the page fills from the classes it has already made. */
	if (D[key] === null) {
		if (key === "wEuroLeague" || key === "wGLeague" || key === "wNBL") {
			const n = Number(raw);
			if (raw === "" || !Number.isFinite(n) || n < 0) {
				throw new Error(key + " takes a number of 0 or more, not \"" + raw + "\"");
			}
			return n;
		}
		if (key === "leagueWeights" || key === "archetypeWeights") {
			let obj;
			try { obj = JSON.parse(raw); } catch (e) {
				throw new Error(key + " takes a JSON object, e.g. " +
					(key === "leagueWeights" ? "'{\"EuroLeague\": 60, \"JUCO\": 1}'" : "'{\"Sharpshooter\": 3}'") +
					" — \"" + raw + "\" is not JSON (" + e.message + ")");
			}
			if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
				throw new Error(key + " takes a JSON object of name: weight, not " +
					(Array.isArray(obj) ? "a list" : String(raw)));
			}
			const known = key === "leagueWeights"
				? Object.keys(global.Colleges.NON_NCAA)
				: global.RatingsBuilder.ARCHETYPES.map((a) => a.name);
			const bad = Object.keys(obj).filter((k) => known.indexOf(k) === -1);
			if (bad.length) {
				throw new Error(key + " has no entry called " + bad.map((k) => "\"" + k + "\"").join(", ") +
					" (see: bbgmdraft settings " + key + ")");
			}
			const nan = Object.keys(obj).filter((k) => typeof obj[k] !== "number" || !Number.isFinite(obj[k]));
			if (nan.length) throw new Error(key + " weights must be numbers (" + nan.join(", ") + ")");
			return obj;
		}
		throw new Error(key + " cannot be set from the command line: it holds what the page " +
			"has already generated (previous classes, picked anomalies, a biography)");
	}
	if (t === "string") {
		// Config.make quietly resets a choice it does not know to the default,
		// which made a typo run as if it had not been given.
		const allowed = C.CHOICES && C.CHOICES[key] ? C.CHOICES[key]() : null;
		if (allowed && allowed.indexOf(raw) === -1) {
			throw new Error(key + " takes one of: " + allowed.map((v) => v === "" ? "\"\"" : v).join(", ") +
				" — not \"" + raw + "\"");
		}
		return raw;
	}
	throw new Error(key + " cannot be set from the command line (use a preset, or --notes for the note template)");
}

/* A settings file: what the page's "Export settings JSON" writes,
   {format: "bbgm-draft-workshop/settings", v: 1, cfg}. A class file this tool
   wrote with --recipe (or the page with the recipe option on) works too: the
   recipe's seed and settings are what made it. */
const SETTINGS_FORMAT = "bbgm-draft-workshop/settings";
function readSettingsFile(file, args) {
	const data = readJsonFile(file);
	let cfg;
	const recipe = data && global.Engine.readRecipe(data);
	if (data && data.format === SETTINGS_FORMAT) {
		cfg = data.cfg;
		if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) {
			throw new Error(file + " carries no settings.");
		}
		cfg = Object.assign({}, cfg);
	} else if (recipe) {
		cfg = Object.assign({}, recipe.settings, { seed: recipe.seed });
	} else {
		throw new Error(file + " is not a settings file (expected format \"" + SETTINGS_FORMAT +
			"\", the page's \"Export settings JSON\") and carries no recipe.");
	}
	const D = global.Config.DEFAULTS;
	// `pinned` and `seed` are settings the page writes that are not in DEFAULTS' shape.
	for (const k of Object.keys(cfg)) {
		if (k === "mu") {
			say(args, "note: " + file + " names mutators (mu), which only the page applies; ignored");
			delete cfg[k];
		} else if (!(k in D) && k !== "pinned") {
			say(args, "note: " + file + " has a setting this version does not know (" + k + "); ignored");
			delete cfg[k];
		}
	}
	return cfg;
}

/* The prospects of a class file as {key, name}, keyed exactly as the engine
   keys them (a pid, or "pid#2" for a repeat), so a locks CSV matches the
   same men the page would. */
function playersOfClass(data) {
	const seen = new Set();
	return (data.players || []).map((p, idx) => ({
		key: global.Engine.playerKey(p, idx, seen),
		name: ((p.firstName || "") + " " + (p.lastName || "")).trim() ||
			("Prospect " + (p.pid === undefined ? idx : p.pid)),
	}));
}

function buildConfig(args, data) {
	const C = global.Config;
	const f = args.flags;
	const cfg = {};
	const setKeys = [];
	if (f["--preset"]) {
		const names = Object.keys(C.PRESETS);
		const name = names.find((n) => n.toLowerCase() === String(f["--preset"]).toLowerCase());
		if (!name) throw new Error("unknown preset \"" + f["--preset"] + "\". Presets: " + names.join(", "));
		Object.assign(cfg, C.PRESETS[name]);
	}
	if (f["--settings"]) Object.assign(cfg, readSettingsFile(f["--settings"], args));
	if (f["--locks"]) {
		if (!data) throw new Error("--locks applies to one class file; it is not available here");
		const text = fs.readFileSync(f["--locks"], "utf8");
		let plan;
		try { plan = global.Engine.planLockCsv(text, playersOfClass(data)); } catch (e) {
			throw new Error(f["--locks"] + ": " + e.message);
		}
		const locks = Object.assign({}, cfg.overrides);
		for (const a of plan.applied) locks[a.player.key] = Object.assign({}, locks[a.player.key], a.patch);
		cfg.overrides = locks;
		say(args, "locks: " + plan.applied.length + " of " + plan.total + " row(s) applied" +
			(plan.unmatched.length ? "; " + plan.unmatched.length + " matched nobody" : ""));
		for (const r of plan.rejected) say(args, "locks: " + r);
	}
	for (const s of args.set) {
		const eq = s.indexOf("=");
		if (eq < 1) throw new Error("--set takes key=value, not \"" + s + "\"");
		cfg[s.slice(0, eq)] = coerce(s.slice(0, eq), s.slice(eq + 1));
		setKeys.push(s.slice(0, eq));
	}
	if (f["--notes"] !== undefined) {
		const all = global.Engine.NOTE_LINES.map((x) => x[0]);
		const v = String(f["--notes"]);
		const named = v.toLowerCase();
		if (named in NOTE_PRESETS) {
			cfg.noteLines = NOTE_PRESETS[named] ||
				(named === "all" || named === "everything" ? all : C.DEFAULTS.noteLines.slice());
		} else {
			const lines = v.split(",").map((x) => x.trim()).filter(Boolean);
			const bad = lines.filter((x) => all.indexOf(x) === -1);
			if (bad.length) throw new Error("unknown note line " + bad.join(", ") + ". Lines: " + all.join(", "));
			cfg.noteLines = lines;
		}
	}
	if (f["--seed"] !== undefined) cfg.seed = String(f["--seed"]);
	const made = C.make(cfg);
	/* Config.make clamps a number to the band the page's slider offers and
	   rounds a count; say so, or classQuality=99 looks like it was honoured. */
	for (const k of setKeys) {
		if (typeof cfg[k] === "number" && made[k] !== cfg[k]) {
			const r = C.sliderRange(k);
			say(args, "note: " + k + "=" + cfg[k] + " is outside what the page allows" +
				(r ? " (" + r.min + " to " + r.max + ")" : "") + "; using " + made[k]);
		}
	}
	return made;
}

function exportOptions(args) {
	const f = args.flags;
	const opts = {
		ages: !f["--no-ages"], injuries: !f["--no-injuries"], jerseys: !f["--no-jerseys"],
		stats: !!f["--stats"], prior: !!f["--prior"], highs: !!f["--highs"],
		awards: !!f["--awards"] || !!f["--awards-major"],
		awardsScope: f["--awards-major"] ? "major" : "all",
		// The page's "Include scouting notes" (off: write none of ours, leave the
		// file's own) and "Keep any note already in the file".
		includeNotes: !f["--no-notes"], noteAppend: !!f["--keep-notes"],
	};
	// The opt-in extras: absent, the export is exactly what it always was.
	if (f["--fuzz"] !== undefined) {
		const v = String(f["--fuzz"]);
		if (["keep", "zero", "regenerate"].indexOf(v) === -1) {
			throw new Error("--fuzz takes keep, zero or regenerate, not \"" + v + "\"");
		}
		opts.fuzz = v;
	}
	if (f["--scouting"] !== undefined) {
		const n = Number(f["--scouting"]);
		if (!Number.isFinite(n) || n < 1 || n > 100) {
			throw new Error("--scouting takes a scouting level from 1 to 100, not \"" + f["--scouting"] + "\"");
		}
		opts.scoutingLevel = n;
	}
	if (f["--recipe"]) opts.recipe = true;
	if (f["--hometowns"]) opts.hometowns = true;
	if (f["--pro-lines"]) opts.proLines = true;
	return opts;
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

/* Bytes for a file: the JSON with the byte-order mark the page's exports
   carry, gzipped on --gzip. (zlib writes no timestamp, so a gzip is as
   reproducible as the JSON inside it.) */
function bodyOf(args, out) {
	const body = "﻿" + JSON.stringify(out, null, 2);
	return args.flags["--gzip"] ? zlib.gzipSync(Buffer.from(body, "utf8")) : body;
}

function writeBody(args, dest, body) {
	if (dest === "-") process.stdout.write(typeof body === "string" ? body + "\n" : body);
	else fs.writeFileSync(dest, body);
}

function cmdRun(args) {
	const file = args.positional[1];
	const f = args.flags;
	const { data } = readClassFile(file, f["--year"]);
	const cfg = buildConfig(args, data);
	const kinds = ["--merge", "--players-file", "--fragment"].filter((k) => f[k]);
	if (kinds.length > 1) throw new Error(kinds.join(" and ") + " each write a different file; choose one");
	if (f["--count"] !== undefined) return cmdRunMany(args, file, data, cfg, kinds);
	const res = global.Engine.run(data, cfg);
	const opts = exportOptions(args);
	const base = file === "-" ? "stdin" : path.basename(file).replace(/\.json(\.gz)?$|\.gz$/i, "");
	const gz = f["--gzip"] ? ".gz" : "";
	let out;
	let defaultDest;
	if (f["--merge"]) {
		const league = readJsonFile(f["--merge"]);
		const merged = global.Engine.mergeIntoLeague(res, league, opts);
		out = merged.file;
		for (const w of merged.warnings) say(args, "warning: " + w);
		say(args, "merged into " + path.basename(f["--merge"]) + ": " + merged.replaced +
			" prospects replaced, " + merged.added + " added, " + merged.removed + " removed");
		const lb = path.basename(f["--merge"]).replace(/\.json(\.gz)?$|\.gz$/i, "");
		defaultDest = path.join(path.dirname(f["--merge"]), lb + "_merged.json" + gz);
	} else if (f["--players-file"]) {
		out = global.Engine.exportPlayersFile(res, opts);
		defaultDest = path.join(file === "-" ? "." : path.dirname(file), base + "_players.json" + gz);
	} else if (f["--fragment"]) {
		out = global.Engine.exportLeagueFragment(res);
		defaultDest = path.join(file === "-" ? "." : path.dirname(file), base + "_fragment.json" + gz);
	} else {
		out = global.Engine.exportFile(res, opts);
		// A class piped in has no folder to write beside: it goes back out the pipe.
		defaultDest = file === "-" ? "-" : path.join(path.dirname(file), base + "_customized.json" + gz);
	}
	const dest = f["--out"] || defaultDest;
	writeBody(args, dest, bodyOf(args, out));
	const top = (res.board || []).slice(0, 5);
	if (f["--json"]) {
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

/* --count N: N classes, seeds <base>#0 to <base>#N-1 (the same seeds `batch`
   runs), one file each in a directory (--out DIR, default <file>_classes). */
function cmdRunMany(args, file, data, cfg, kinds) {
	const f = args.flags;
	if (kinds.length) throw new Error("--count writes class files; it cannot be combined with " + kinds[0]);
	const rawN = String(f["--count"]).trim();
	const n = Number(rawN);
	if (!/^\d+$/.test(rawN) || !Number.isSafeInteger(n) || n < 1 || n > 1000) {
		throw new Error("--count takes a whole number from 1 to 1000, not \"" + rawN + "\"");
	}
	const base = global.BatchStats.batchSeed(cfg, cfg.seed);
	const name = file === "-" ? "stdin" : path.basename(file).replace(/\.json(\.gz)?$|\.gz$/i, "");
	const dir = f["--out"] || path.join(file === "-" ? "." : path.dirname(file), name + "_classes");
	if (dir === "-") throw new Error("--count writes a directory of files; --out - (stdout) cannot hold them");
	fs.mkdirSync(dir, { recursive: true });
	const safe = base.replace(/[^A-Za-z0-9._-]+/g, "_");
	const runner = global.Engine.createRunner(data);
	const opts = exportOptions(args);
	const written = [];
	for (let i = 0; i < n; i++) {
		const c = global.Config.make(cfg);
		c.seed = base + "#" + i;
		const res = runner.run(c);
		const dest = path.join(dir, name + "_" + safe + "_" + i + ".json" + (f["--gzip"] ? ".gz" : ""));
		fs.writeFileSync(dest, bodyOf(args, global.Engine.exportFile(res, opts)));
		written.push({ seed: c.seed, file: dest });
		if (process.stderr.isTTY && !f["--quiet"]) process.stderr.write("\r  " + (i + 1) + "/" + n);
	}
	if (process.stderr.isTTY && !f["--quiet"]) process.stderr.write("\r          \r");
	if (f["--json"]) process.stderr.write(JSON.stringify({ baseSeed: base, written,
		engineRev: global.Universe.ENGINE_REV }, null, 2) + "\n");
	else say(args, "wrote " + n + " classes to " + dir + " · base seed " + base +
		" · engine rev " + global.Universe.ENGINE_REV);
}

function readJsonFile(file) {
	let buf = fs.readFileSync(file);
	if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
	try { return JSON.parse(buf.toString("utf8").replace(/^﻿/, "")); } catch (e) {
		throw new Error(file + " is not JSON: " + e.message);
	}
}

function cmdBatch(args) {
	const file = args.positional[1];
	const { data } = readClassFile(file, args.flags["--year"]);
	const cfg = buildConfig(args, data);
	const rawN = args.flags["-n"] === undefined ? "10" : String(args.flags["-n"]).trim();
	const n = Number(rawN);
	if (!/^\d+$/.test(rawN) || !Number.isSafeInteger(n) || n < 1) {
		throw new Error("-n takes a whole number of 1 or more, not \"" + rawN + "\"");
	}
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

/* The first seed whose class meets every condition, as the page's "reroll
   until" searches (the same predicates, the same clauses). Seeds are
   <base>#0, <base>#1, ... (the seeds `batch` runs), so what is found here can
   be written with `bbgmdraft run <file> --seed <seed>`. Prints the seed on
   stdout; exits 1 when nothing matched in --tries. */
function cmdSeek(args) {
	const E = global.Engine;
	const f = args.flags;
	const { data } = readClassFile(args.positional[1], f["--year"]);
	const cfg = buildConfig(args, data);
	const keys = [];
	const split = (list) => list.join(",").split(",").map((x) => x.trim()).filter(Boolean);
	for (const k of split(args.want)) keys.push(k);
	for (const k of split(args.not)) keys.push(k.charAt(0) === "!" ? k : "!" + k);
	if (!keys.length) {
		throw new Error("seek needs a condition: --want <name> and/or --not <name>. Names: " +
			E.REROLL_PREDICATES.map((p) => p.key).join(", ") + "; with a value: " +
			E.PARAM_CLAUSES.map((c) => c.example).join(", "));
	}
	const clauses = keys.map((k) => {
		const c = E.parseRerollClause(k);
		if (!c) {
			throw new Error("unknown condition \"" + k + "\". Names: " +
				E.REROLL_PREDICATES.map((p) => p.key).join(", ") + "; with a value: " +
				E.PARAM_CLAUSES.map((x) => x.example).join(", "));
		}
		return c;
	});
	const rawT = f["--tries"] === undefined ? "100" : String(f["--tries"]).trim();
	const tries = Number(rawT);
	if (!/^\d+$/.test(rawT) || !Number.isSafeInteger(tries) || tries < 1) {
		throw new Error("--tries takes a whole number of 1 or more, not \"" + rawT + "\"");
	}
	const base = global.BatchStats.batchSeed(cfg, cfg.seed);
	const runner = E.createRunner(data);
	for (let i = 0; i < tries; i++) {
		const c = global.Config.make(cfg);
		c.seed = base + "#" + i;
		const res = runner.run(c);
		if (process.stderr.isTTY && !f["--quiet"]) process.stderr.write("\r  " + (i + 1) + "/" + tries);
		if (!clauses.every((cl) => cl.test(res))) continue;
		if (process.stderr.isTTY && !f["--quiet"]) process.stderr.write("\r          \r");
		const top = (res.board || [])[0];
		if (f["--json"]) {
			process.stdout.write(JSON.stringify({ seed: c.seed, tries: i + 1,
				conditions: clauses.map((cl) => cl.key), engineRev: global.Universe.ENGINE_REV,
				no1: top ? { name: top.name, pos: top.newPos, ovr: top.newOvr, school: top.proClub || top.newCollege }
					: null }, null, 2) + "\n");
		} else {
			process.stdout.write(c.seed + "\n");
			say(args, "found after " + (i + 1) + " " + (i ? "tries" : "try") + ": " +
				clauses.map((cl) => cl.label).join("; ") +
				(top ? " · No. 1: " + top.name + " (" + top.newPos + ", " + top.newOvr + ")" : ""));
			say(args, "write it with: bbgmdraft run " + args.positional[1] + " --seed " + c.seed);
		}
		return;
	}
	if (process.stderr.isTTY && !f["--quiet"]) process.stderr.write("\r          \r");
	say(args, "no class met " + clauses.map((cl) => cl.key).join(" and ") + " in " + tries +
		" tries (base seed " + base + ")");
	process.exitCode = 1;
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
	const { data, leagueData } = readClassFile(args.positional[1], args.flags["--year"]);
	const res = global.Engine.run(data, buildConfig(args, data));
	const projections = global.Pro.projectClass(res);
	const mockOpts = { projections, league: leagueData || null };
	if (args.flags["--rounds"] !== undefined) {
		const raw = String(args.flags["--rounds"]).trim();
		const n = Number(raw);
		if (!/^\d+$/.test(raw) || n < 1 || n > 10) {
			throw new Error("--rounds takes a whole number from 1 to 10, not \"" + raw + "\"");
		}
		mockOpts.rounds = n;
	}
	// A class from a league export is drafted by that league's teams.
	const mock = global.Pro.mockDraft(res, mockOpts);
	if (args.flags["--json"]) {
		process.stdout.write(JSON.stringify({ seed: res.seed, engineRev: global.Universe.ENGINE_REV,
			teams: mock.teams, picks: mock.picks, undrafted: mock.undrafted }, null, 2) + "\n");
		return;
	}
	const rows = mock.picks.map((k) => [k.pick, k.team + (k.via ? " (via " + k.via + ")" : ""), k.name, k.pos, k.ovr + "/" + k.pot,
		k.consensus || "", k.projection ? k.projection.peak + " (" + k.projection.peakLow + "-" +
			k.projection.peakHigh + ")" : "", k.projection ? k.projection.verdict : "", k.why]);
	const heads = ["pick", "team", "player", "pos", "ovr/pot", "board", "peak", "verdict", "why"];
	if (args.flags["--csv"]) {
		process.stdout.write(heads.join(",") + "\n" + rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n");
	} else {
		process.stdout.write(table([heads].concat(rows)) + "\n");
		say(args, "seed " + res.seed + " · " + mock.picks.length + " picks · " +
			mock.undrafted.length + " undrafted · " + mock.source);
	}
}

function cmdCheck(args) {
	const read = readClassFile(args.positional[1], args.flags["--year"], { listClasses: true });
	if (read.classes) {
		// A league with several draft classes: say which, instead of refusing.
		process.stdout.write("league file with " + read.classes.length + " draft classes: " +
			read.classes.map((c) => c.year + " (" + c.count + " players)").join(", ") + "\n");
		process.stdout.write("check one with --year <year>\n");
		return;
	}
	const { data, league } = read;
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
		// A list (the note template) has its own option; null is a real
		// setting whose value is a number or a JSON object (see coerce).
		if (Array.isArray(d)) continue;
		const r = C.sliderRange(k);
		rows.push([k, JSON.stringify(d), r ? r.min : "", r ? r.max : ""]);
	}
	process.stdout.write(table(rows) + "\n");
	if (!name) {
		process.stdout.write("\nbbgmdraft settings presets  lists the presets\n" +
			"A null default is a real setting: wEuroLeague, wGLeague and wNBL take a number; " +
			"leagueWeights and archetypeWeights take a JSON object, e.g.\n" +
			"  --set 'leagueWeights={\"EuroLeague\": 60, \"JUCO\": 1}'\n" +
			"poolMemory, flavorMemory and anomalyMemory need the classes the page has already " +
			"made, so they do nothing from the command line.\n");
	}
}

const HELP = `BBGM Draft Class Workshop (command line, experimental)

  bbgmdraft run   <file> [options]    write a customized class file
  bbgmdraft batch <file> [options]    run many seeds, print a table
  bbgmdraft seek  <file> [options]    find the first seed that meets some conditions
  bbgmdraft universe <file>... [opts] run the classes as one continuous world
  bbgmdraft mock  <file> [options]    mock draft and pro career projections
  bbgmdraft check <file>              validate a file
  bbgmdraft settings [name|presets]   settings, defaults, ranges; presets

<file> is a BBGM draft class (.json or .json.gz) or a league export; for a league
with several draft classes choose one with --year. A file of - is standard input.

Options (run, batch)
  --seed S           the seed (a class is reproducible from file + seed + settings)
  --preset NAME      a built-in preset (bbgmdraft settings presets)
  --set key=value    a setting, repeatable (bbgmdraft settings lists them)
  --notes WHAT       the note template: none, short, forum, standard, stat sheet
                     (or stat), everything (or all), or lines such as summary,stats,awards
  --year Y           which draft class of a league file
  --settings FILE    a settings file (the page's "Export settings JSON"), or a class
                     file written with --recipe; applied after --preset, before --set
  --locks FILE       a locks CSV (the page's "Export locks CSV": key, name, ovr, pot,
                     archetype, college) applied to the class, as the page's import does

Options (run)
  --out FILE         where to write (default <file>_customized.json; - = stdout, and
                     the default when the class came from stdin)
  --gzip             write gzip (the default name gains .gz)
  --count N          write N classes, seeds <base>#0 .. #N-1, one file each into the
                     directory --out names (default <file>_classes)
  --merge LEAGUE     merge the class into this league file (replacing its class for
                     that draft) and write the league (default <league>_merged.json)
  --players-file     write the Tools -> Import players file instead of a class file
  --fragment         write the college-league fragment (teams, standings) instead
  --fuzz MODE        scouting fuzz: keep (default), zero, or regenerate (a seeded draw
                     shaped like BBGM's own); --scouting N sets the level (default 34)
  --recipe           embed what made the file (seed, engine revision, settings, source
                     fingerprint) in its bbgmdraft key; --settings reads it back
  --hometowns        give a blank birthplace a "City, ST, USA" drawn from the school's
                     region instead of "USA"
  --pro-lines        add "Pro projection:" and "Mock:" lines to each note
  --stats --prior --highs     write the college statline, earlier seasons, season highs
  --awards | --awards-major   write honors (all, or national and major-conference only)
  --no-ages --no-jerseys --no-injuries   leave those fields as they came
  --no-notes         write none of the generated notes and leave the file's own
                     notes as they were (the page's "Include scouting notes" off)
  --keep-notes       keep a note the file already has and put the generated one
                     under it ("Keep any note already in the file")
  --json             print the summary as JSON on stderr
  -q                 no summary

Options (universe)
  --out FILE         write the universe export (the page's Universe tab imports it)
  --no-gaps          do not extrapolate seasons missing between the files
  --json             the rows and threads as JSON on stdout

Options (batch)
  -n N               how many classes (default 10)
  --csv | --json     machine-readable output on stdout

Options (mock)
  --rounds N         rounds of the mock draft (default 2)

Options (seek)
  --want NAME        a condition the class must meet (repeatable, or comma-separated):
                     tallTop5, abroadNo1, deepClass, strangeness:N, ... or with a value
                     topOvr:N, count50:N, pos1:C, archetype:Name, school:Name,
                     height:N, freshmen:N
  --not NAME         a condition it must not meet
  --tries N          how many seeds to try (default 100; seeds are <--seed>#0, #1, ...)
  prints the first seed that qualifies on stdout (--json for more), exit 1 if none

A player the note template writes nothing for ends up with no note, unless
--keep-notes or --no-notes keeps the file's own.

One difference from the page: the page draws a face for every player and writes it
into the file; the command line does not load the face library, so a class made
here has no face field (BBGM draws its own on import). Everything else is the same.

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
		else if (cmd === "seek") cmdSeek(args);
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
