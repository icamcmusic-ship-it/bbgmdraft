/* The command line (bin/bbgmdraft.js) must be the page's engine, not a second
   implementation of it: the same file, seed and settings give the same class
   whichever way it is run. These run the real executable. */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { spawnSync } = require("child_process");

module.exports = function (ok, V) {
	const E = global.Engine;
	const C = global.Config;
	const BIN = path.join(__dirname, "..", "..", "bin", "bbgmdraft.js");
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bbgmdraft-cli-"));
	const cli = (...args) => spawnSync(process.execPath, [BIN].concat(args),
		{ encoding: "utf8", cwd: dir });

	const lf = V.realisticClass("cli", 40);
	const file = path.join(dir, "class.json");
	fs.writeFileSync(file, JSON.stringify(lf));

	/* ---- run is the engine ------------------------------------------------ */
	{
		const out = path.join(dir, "out.json");
		const r = cli("run", file, "--seed", "cli-seed", "--set", "pace=72", "--notes", "short",
			"--stats", "--awards", "--out", out, "-q");
		ok("cli/run exits cleanly and writes the file", r.status === 0 && fs.existsSync(out),
			r.stderr + " " + r.stdout);
		const written = JSON.parse(fs.readFileSync(out, "utf8").replace(/^﻿/, ""));
		const cfg = C.make({ seed: "cli-seed", pace: 72, noteLines: ["summary", "team", "stats"] });
		const want = E.exportFile(E.run(JSON.parse(JSON.stringify(lf)), cfg), {
			ages: true, injuries: true, jerseys: true, stats: true, prior: false, highs: false,
			awards: true, awardsScope: "all",
		});
		ok("cli/the written class is exactly the engine's export for that file, seed and settings",
			JSON.stringify(written) === JSON.stringify(want),
			"players " + written.players.length + " vs " + want.players.length);
		const again = path.join(dir, "again.json");
		cli("run", file, "--seed", "cli-seed", "--set", "pace=72", "--notes", "short",
			"--stats", "--awards", "--out", again, "-q");
		ok("cli/the same command twice writes the same bytes",
			fs.readFileSync(out, "utf8") === fs.readFileSync(again, "utf8"));
		const stdout = cli("run", file, "--seed", "cli-seed", "--out", "-", "-q");
		ok("cli/--out - writes the file to stdout and nothing else",
			stdout.status === 0 && JSON.parse(stdout.stdout.replace(/^﻿/, "")).players.length === 40);
	}

	/* ---- batch rows are the batch module's rows ---------------------------- */
	{
		const r = cli("batch", file, "-n", "3", "--seed", "b", "--json");
		ok("cli/batch --json exits cleanly", r.status === 0, r.stderr);
		const rows = JSON.parse(r.stdout).rows;
		const runner = E.createRunner(JSON.parse(JSON.stringify(lf)));
		const want = [0, 1, 2].map((i) => global.BatchStats.summarize(
			runner.run(C.make({ seed: "b#" + i }))));
		ok("cli/batch rows equal BatchStats.summarize on the same seeds",
			JSON.stringify(rows) === JSON.stringify(want));
		const csv = cli("batch", file, "-n", "2", "--seed", "b", "--csv").stdout.trim().split("\n");
		ok("cli/batch --csv is a header and a row a class", csv.length === 3 && /^seed,flavor,/.test(csv[0]));
	}

	/* ---- the command line says no ------------------------------------------ */
	{
		const bad = cli("run", file, "--set", "nonsense=3");
		ok("cli/an unknown setting is refused, with a suggestion where there is one",
			bad.status === 1 && /unknown setting/.test(bad.stderr));
		const near = cli("run", file, "--set", "pac=70");
		ok("cli/...and names the setting it was probably after", /pace/.test(near.stderr), near.stderr);
		ok("cli/a non-numeric value for a number is refused",
			cli("run", file, "--set", "pace=fast").status === 1);
		ok("cli/an unknown option exits 2", cli("run", file, "--frobnicate").status === 2);
		ok("cli/an unknown preset lists the real ones",
			/Presets: /.test(cli("run", file, "--preset", "nope").stderr));
		ok("cli/a missing file is an error, not a stack trace",
			cli("run", path.join(dir, "missing.json")).status === 1 &&
			!/at Object|node:internal/.test(cli("run", path.join(dir, "missing.json")).stderr));
		const junk = path.join(dir, "junk.json");
		fs.writeFileSync(junk, "{ not json");
		ok("cli/a file that is not JSON is named as such",
			/not JSON/.test(cli("check", junk).stderr));
		const noPlayers = path.join(dir, "empty.json");
		fs.writeFileSync(noPlayers, JSON.stringify({ players: [] }));
		const rejected = cli("check", noPlayers);
		ok("cli/check rejects a class with no players and exits non-zero",
			rejected.status === 1 && /REJECTED/.test(rejected.stdout), rejected.stdout);
	}

	/* ---- inputs ------------------------------------------------------------ */
	{
		const gz = path.join(dir, "class.json.gz");
		fs.writeFileSync(gz, zlib.gzipSync(JSON.stringify(lf)));
		const a = cli("check", gz);
		ok("cli/a gzipped class is read", a.status === 0 && /40 players/.test(a.stdout), a.stdout + a.stderr);
		const s = cli("settings", "pace");
		ok("cli/settings lists a setting with its default and range", /pace\s+68\s+58\s+82/.test(s.stdout), s.stdout);
		ok("cli/settings presets lists the presets", /Loaded class/.test(cli("settings", "presets").stdout));
		ok("cli/help exits 0", cli("help").status === 0 && /bbgmdraft run/.test(cli("help").stdout));
		ok("cli/no command exits 2", cli().status === 2);
	}

	/* ---- a league export holds several classes: --year picks one -------- */
	{
		const a = V.realisticClass("cli-a", 30);
		const b = V.realisticClass("cli-b", 30);
		const lift = (cls, year, offset) => cls.players.map((p, i) => Object.assign({}, p, {
			pid: offset + i, tid: -2, draft: Object.assign({}, p.draft, { year, tid: -1 }),
			born: Object.assign({}, p.born, { year: year - 20 }),
		}));
		const league = {
			version: 73, startingSeason: 2026, gameAttributes: { season: 2026 },
			teams: [{ tid: 0 }, { tid: 1 }],
			players: lift(a, 2026, 0).concat(lift(b, 2027, 1000)),
		};
		const lfile = path.join(dir, "league.json");
		fs.writeFileSync(lfile, JSON.stringify(league));
		const none = cli("run", lfile, "-q");
		ok("cli/a league with two classes asks which one", none.status === 1 && /--year/.test(none.stderr),
			none.stderr);
		const out = path.join(dir, "league_out.json");
		const r = cli("run", lfile, "--year", "2027", "--seed", "lg", "--out", out, "-q");
		const written = r.status === 0 ? JSON.parse(fs.readFileSync(out, "utf8").replace(/^\ufeff/, "")) : null;
		ok("cli/--year writes that class alone, in a class envelope",
			written && written.players.length === 30 && written.startingSeason === 2027 &&
			!written.teams && written.players.every((p) => p.pid >= 1000), r.stderr);
	}

	/* ---- a universe: the chain the page runs ------------------------------ */
	{
		const seasons = [1, 2, 3].map((y) => {
			const c = V.realisticClass("cli-u" + y, 40);
			c.startingSeason = 2024 + y;
			c.players.forEach((p) => {
				p.draft.year = 2024 + y;
				p.born.year = 2024 + y - 20;
				p.pid = p.pid + y * 100;
			});
			const f = path.join(dir, "u" + y + ".json");
			fs.writeFileSync(f, JSON.stringify(c));
			return f;
		});
		const out = path.join(dir, "universe.json");
		const r = cli("universe", seasons[2], seasons[0], seasons[1], "--seed", "uni", "--out", out, "-q");
		ok("cli/universe runs the files in season order whatever order they are given",
			r.status === 0 && /2025[\s\S]*2026[\s\S]*2027/.test(r.stdout), r.stderr + r.stdout);
		const exp = JSON.parse(fs.readFileSync(out, "utf8"));
		ok("cli/the universe export is the page's format, with the engine revision",
			exp.format === "bbgm-draft-workshop/universe" && exp.seasons.length === 3 &&
			exp.engineRev === global.Universe.ENGINE_REV && exp.baseSeed === "uni");
		ok("cli/each season's seed is keyed to the base seed and the file, as the page's is",
			exp.seasons.every((x, i) => x.seed.indexOf("uni#" + i + ":" + x.season + ":") === 0),
			JSON.stringify(exp.seasons.map((x) => x.seed)));
		const again = cli("universe", seasons[0], seasons[1], seasons[2], "--seed", "uni", "-q");
		ok("cli/the same universe twice is the same world", again.stdout === r.stdout);
		ok("cli/a different seed is a different world",
			cli("universe", seasons[0], seasons[1], seasons[2], "--seed", "other", "-q").stdout !== r.stdout);
		const json = JSON.parse(cli("universe", seasons[0], seasons[1], "--seed", "uni", "--json").stdout);
		ok("cli/universe --json carries the rows and threads", json.rows.length === 2 && Array.isArray(json.threads));
		ok("cli/universe with no file is an error", cli("universe").status === 1);
	}

	fs.rmSync(dir, { recursive: true, force: true });
};
