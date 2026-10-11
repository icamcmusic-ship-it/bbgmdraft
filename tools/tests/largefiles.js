"use strict";
/* Large league files and general robustness (audit 2026-10-10, section 3) and
   the engine-side responsiveness work of section 11 (P3).

   The scanner and splicer (js/leaguescan.js) are pure and are tested here
   directly against JSON.parse: every chunk size, the skipped stores, the
   byte ranges, the wrong-type sniffing, a truncated file. The CLI merge is
   run for real. The page's wiring (the streamed load, Cancel, the .json.gz
   merge, the Blob session) is read statically here and driven in a browser
   by the "Large files" section of tools/uismoke.js. */
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");

module.exports = function (ok, V) {
	if (!global.window) global.window = global;
	if (!global.self) global.self = global;
	const LS = global.LeagueScan;
	const E = global.Engine;
	ok("leaguescan/loads in Node through the manifest", !!(LS && LS.createScanner));
	if (!LS) return;

	/* A small league with the real shape: version first, a future class of
	   undrafted prospects, a roster, teams, and the stores the tool skips. */
	function league(seed, opts) {
		const o = opts || {};
		const cls = V.syntheticClass(seed, 40);
		const season = cls.startingSeason;
		const players = cls.players.map((p) => Object.assign({}, p, {
			tid: -2, draft: Object.assign({}, p.draft, { year: season }),
		}));
		for (let i = 0; i < 30; i++) {
			const src = cls.players[i % cls.players.length];
			players.push(Object.assign({}, src, {
				pid: 1000 + i, tid: i % 4, firstName: "Vet", lastName: "Ëric" + i,
				draft: { year: season - 5, round: 1, pick: i + 1, tid: i % 4 },
			}));
		}
		if (o.noPids) for (const p of players) delete p.pid;
		return {
			version: 64, startingSeason: season - 6,
			meta: { name: "Test “League” é" },
			gameAttributes: { season },
			players,
			teams: [0, 1, 2, 3].map((tid) => ({ tid, region: "R" + tid, name: "N\\" + tid })),
			teamSeasons: [{ tid: 0, season }],
			games: Array.from({ length: 50 }, (_, i) => ({ gid: i, teams: [{ tid: 0, pts: 99 }, { tid: 1, pts: 90 + (i % 7) }], note: "a \"quoted\" } ] , string" })),
			events: [{ text: "x" }, { text: "y☃" }],
			draftPicks: [{ dpid: 1, tid: 0, season }],
			schedule: [],
			awards: [{ season: season - 1 }],
		};
	}

	/* ---- the scanner is JSON.parse, minus the skipped stores --------------- */
	{
		const lg = league(31);
		const text = JSON.stringify(lg);
		const u8 = Buffer.from(text, "utf8");
		let allSame = true;
		let detail = "";
		for (const size of [1, 2, 3, 7, 64, 1000, 1 << 16, u8.length]) {
			const sc = LS.createScanner();
			for (let i = 0; i < u8.length; i += size) sc.push(u8.subarray(i, i + size));
			const r = sc.end();
			const want = Object.assign({}, lg);
			for (const k of LS.SKIP_STORES) delete want[k];
			const same = JSON.stringify(r.data) === JSON.stringify(want) &&
				JSON.stringify(r.keys) === JSON.stringify(Object.keys(lg)) &&
				r.keys.every((k) => u8.subarray(r.ranges[k][0], r.ranges[k][1]).toString("utf8") === JSON.stringify(lg[k])) &&
				u8[r.closeAt] === 0x7d && r.closeAt === u8.length - 1;
			if (!same) { allSame = false; detail = "chunk size " + size; }
		}
		ok("leaguescan/every chunk size gives JSON.parse's answer and exact byte ranges", allSame, detail);
		const r = (() => { const sc = LS.createScanner(); sc.push(u8); return sc.end(); })();
		ok("leaguescan/box scores, events and the schedule are skipped, and say so",
			r.data.games === undefined && r.data.events === undefined && r.data.schedule === undefined &&
			JSON.stringify(r.skipped) === '["games","events","schedule"]' &&
			JSON.stringify(r.data.__omitted) === '["games","events","schedule"]' &&
			Object.keys(r.data).indexOf("__omitted") === -1 && r.data.awards !== undefined);
		// Whitespace, a BOM and pretty-printing do not move a byte range.
		const pretty = Buffer.from("﻿" + JSON.stringify(lg, null, 2) + "\n", "utf8");
		const sc2 = LS.createScanner();
		for (let i = 0; i < pretty.length; i += 333) sc2.push(pretty.subarray(i, i + 333));
		const r2 = sc2.end();
		ok("leaguescan/a pretty-printed file with a BOM scans the same",
			JSON.stringify(r2.data.players) === JSON.stringify(lg.players) &&
			JSON.stringify(JSON.parse(pretty.subarray(r2.ranges.games[0], r2.ranges.games[1]).toString())) === JSON.stringify(lg.games));
		const keepAll = LS.createScanner({ skip: [] });
		keepAll.push(u8);
		ok("leaguescan/with nothing skipped it is exactly JSON.parse",
			JSON.stringify(keepAll.end().data) === text);
		const arr = LS.createScanner();
		arr.push(Buffer.from(" [1,2]"));
		const ar = arr.end();
		ok("leaguescan/a top-level array is handed back whole", ar.top === "other" &&
			Buffer.from(ar.bytes).toString() === "[1,2]");
		// The players array can hold odd elements; each parses on its own.
		const odd = LS.createScanner();
		odd.push(Buffer.from('{"players":[ {"a":"],}"} , null,3 ,"s,]",[1,[2]] ],"v":1}'));
		ok("leaguescan/odd players elements parse one by one",
			JSON.stringify(odd.end().data) === '{"players":[{"a":"],}"},null,3,"s,]",[1,[2]]],"v":1}');
	}

	/* ---- truncated, damaged and wrong-type files (L9) ---------------------- */
	{
		const u8 = Buffer.from(JSON.stringify(league(32)));
		const sc = LS.createScanner();
		sc.push(u8.subarray(0, Math.floor(u8.length * 0.7)));
		let err = null;
		try { sc.end(); } catch (e) { err = e; }
		ok("l9/a file that stops partway says so", err && err.code === "truncated" &&
			/stops partway/.test(err.message), err && err.message);
		let bad = null;
		try { const s = LS.createScanner(); s.push(Buffer.from("{ nope }")); s.end(); } catch (e) { bad = e; }
		ok("l9/garbage inside an object is not valid JSON", bad && bad.code === "badjson");
		let trunc = null;
		try { LS.parseText('{"players":[{"a":1}', 19); } catch (e) { trunc = e; }
		ok("l9/a truncated text (the fallback path) says so too", trunc && trunc.code === "truncated");
		ok("l9/zip, UTF-16 (with and without a BOM), gzip, binary and empty are told apart",
			LS.sniff(Buffer.from("PK\x03\x04abc", "latin1")) === "zip" &&
			LS.sniff(Buffer.from("\xff\xfe{\x00", "latin1")) === "utf16le" &&
			LS.sniff(Buffer.from("\xfe\xff\x00{", "latin1")) === "utf16be" &&
			LS.sniff(Buffer.from("{\x00\"\x00", "latin1")) === "utf16le" &&
			LS.sniff(Buffer.from([0x1f, 0x8b, 8, 0])) === "gzip" &&
			LS.sniff(Buffer.from("\x7fELF", "latin1")) === "notjson" &&
			LS.sniff(Buffer.from("  \n")) === "empty" &&
			LS.sniff(Buffer.from("﻿ {", "utf8")) === "json" &&
			/unzip it/.test(LS.sniffMessage("zip")) && /not a JSON file/.test(LS.sniffMessage("notjson")));
		const gz = zlib.gzipSync(Buffer.from("x".repeat(1000)));
		ok("l1/a gzip's own trailer gives the unpacked size", LS.gzipSize(gz.subarray(gz.length - 4)) === 1000);
		ok("l1/the string ceiling is a sentence, not 'Unexpected end of JSON input'",
			/browser cannot hold/.test(LS.tooLong(560 * 1048576).message));
	}

	/* ---- the splice merge (L6, L7) ------------------------------------------ */
	{
		const lg = league(33);
		const text = JSON.stringify(lg);
		const u8 = Buffer.from(text);
		const sc = LS.createScanner();
		sc.push(u8);
		const scan = sc.end();
		const players = scan.data.players.map((p, i) => Object.assign({}, p, { note: "new " + i }));
		const changed = { players, bbgmdraft: { v: 1 } };
		const sp = LS.createSplicer(scan, Object.keys(changed));
		let out = "";
		for (let i = 0; i < u8.length; i += 777) {
			for (const piece of sp.push(u8.subarray(i, i + 777))) {
				if (piece instanceof Uint8Array) out += Buffer.from(piece).toString("latin1");
				else {
					const it = piece.append ? LS.addedChunks(scan, changed) : LS.valueChunks(changed[piece.key]);
					for (const t of it) out += Buffer.from(t, "utf8").toString("latin1");
				}
			}
		}
		const back = JSON.parse(Buffer.from(out, "latin1").toString("utf8"));
		const want = Object.assign({}, lg, { players, bbgmdraft: { v: 1 } });
		ok("splice/untouched stores are copied byte for byte, players replaced, a new key appended",
			JSON.stringify(back) === JSON.stringify(want) &&
			JSON.stringify(Object.keys(back)) === JSON.stringify(Object.keys(want)));
	}

	/* ---- L8: a malformed non-prospect row is a warning, not a refusal ------- */
	{
		const lg = league(34);
		delete lg.players[lg.players.length - 1].born;
		lg.players[lg.players.length - 2].ratings = "broken";
		lg.players.push(null);
		let res = null;
		let err = null;
		try { res = E.validateLeagueFile(lg); } catch (e) { err = e; }
		ok("l8/a league with broken retired rows loads, with one warning",
			!!res && res.warnings.some((w) => /3 rows that are not a draft prospect are malformed/.test(w)),
			err ? err.message : JSON.stringify(res && res.warnings));
		const found = E.draftClassesIn(lg);
		ok("l8/its class still comes out", found.length === 1 && found[0].count === 40);
		const bad = league(35);
		delete bad.players[0].born;
		let refused = null;
		try { E.validateLeagueFile(bad); } catch (e) { refused = e; }
		ok("l8/a broken PROSPECT row is still refused", !!refused && /born\.year/.test(refused.message));
		const cls = V.syntheticClass(36, 20);
		delete cls.players[3].born;
		let clsErr = null;
		try { E.validateLeagueFile(cls); } catch (e) { clsErr = e; }
		ok("l8/a class file is still held to every row", !!clsErr);
		// And the merge walks past the null row.
		const year = found[0].year;
		const c = E.extractDraftClass(lg, year);
		c.startingSeason = E.validateLeagueFile(c).season;
		const r = E.run(c, global.Config.make({ seed: "l8" }));
		let merged = null;
		try { merged = E.mergeIntoLeague(r, lg, {}); } catch (e) { merged = e; }
		ok("l8/the merge passes a null row through", merged && merged.file &&
			merged.file.players.indexOf(null) !== -1 && merged.replaced === 40, String(merged && merged.message));
	}

	/* ---- L12: a league with no pids at all ---------------------------------- */
	{
		const lg = league(37, { noPids: true });
		E.validateLeagueFile(lg);
		const year = E.draftClassesIn(lg)[0].year;
		const c = E.extractDraftClass(lg, year);
		c.startingSeason = E.validateLeagueFile(c).season;
		const r = E.run(c, global.Config.make({ seed: "l12" }));
		const m = E.mergeIntoLeague(r, lg, {});
		const pids = m.file.players.map((p) => p.pid).filter((p) => p !== undefined);
		ok("l12/new pids start past the league's last row, not at 0",
			pids.length === 40 && Math.min.apply(null, pids) === lg.players.length &&
			m.removed === 40 && m.file.players.length === lg.players.length);
	}

	/* ---- the CLI merge: compact, no BOM, gzipped like its input (L7) -------- */
	{
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bbgmdraft-large-"));
		const lg = league(38);
		const lgPath = path.join(dir, "league.json.gz");
		fs.writeFileSync(lgPath, zlib.gzipSync(Buffer.from(JSON.stringify(lg))));
		const year = E.draftClassesIn(lg)[0].year;
		const BIN = path.join(ROOT, "bin", "bbgmdraft.js");
		const r = spawnSync(process.execPath, [BIN, "run", lgPath, "--year", String(year),
			"--merge", lgPath, "--seed", "cli-merge", "-q"], { encoding: "utf8", cwd: dir });
		const outPath = path.join(dir, "league_merged.json.gz");
		ok("cli-merge/a .gz league merges to a .json.gz", r.status === 0 && fs.existsSync(outPath),
			r.stderr);
		if (fs.existsSync(outPath)) {
			const raw = zlib.gunzipSync(fs.readFileSync(outPath));
			const back = JSON.parse(raw.toString("utf8"));
			ok("cli-merge/compact JSON with no byte-order mark",
				raw[0] === 0x7b && raw.indexOf(Buffer.from("\n")) === -1);
			ok("cli-merge/the stores it did not touch are the league's own",
				JSON.stringify(back.games) === JSON.stringify(lg.games) &&
				JSON.stringify(back.events) === JSON.stringify(lg.events) &&
				JSON.stringify(back.teams) === JSON.stringify(lg.teams) &&
				back.players.length === lg.players.length && !!back.bbgmdraft);
			// The same merge in memory writes the same players.
			const c = E.extractDraftClass(lg, year);
			c.startingSeason = E.validateLeagueFile(c).season;
			const cfg = global.Config.make({ seed: "cli-merge" });
			const mem = E.mergeIntoLeague(E.run(c, cfg), JSON.parse(JSON.stringify(lg)), {
				ages: true, injuries: true, jerseys: true,
			});
			ok("cli-merge/the players are the in-memory merge's",
				back.players.length === mem.file.players.length &&
				back.players.filter((p) => p.tid === -2).length === 40);
		}
		const plain = spawnSync(process.execPath, [BIN, "run", lgPath, "--year", String(year),
			"--merge", lgPath, "--no-gzip", "--out", path.join(dir, "plain.json"), "-q"],
		{ encoding: "utf8", cwd: dir });
		ok("cli-merge/--no-gzip writes plain JSON", plain.status === 0 &&
			fs.readFileSync(path.join(dir, "plain.json"))[0] === 0x7b, plain.stderr);
		const zipPath = path.join(dir, "class.zip");
		fs.writeFileSync(zipPath, Buffer.from("PK\x03\x04junk", "latin1"));
		const z = spawnSync(process.execPath, [BIN, "check", zipPath], { encoding: "utf8" });
		ok("cli/a .zip is named as one", z.status === 1 && /\.zip archive/.test(z.stderr), z.stderr);
		const twice = path.join(dir, "twice.json.gz");
		fs.writeFileSync(twice, zlib.gzipSync(zlib.gzipSync(Buffer.from(JSON.stringify(V.syntheticClass(39, 20))))));
		const t2 = spawnSync(process.execPath, [BIN, "check", twice], { encoding: "utf8" });
		ok("cli/a file gzipped twice opens", t2.status === 0, t2.stderr);
		const u16 = path.join(dir, "u16.json");
		fs.writeFileSync(u16, Buffer.concat([Buffer.from([0xff, 0xfe]),
			Buffer.from(JSON.stringify(V.syntheticClass(40, 20)), "utf16le")]));
		const t3 = spawnSync(process.execPath, [BIN, "check", u16], { encoding: "utf8" });
		ok("cli/a UTF-16 file opens", t3.status === 0, t3.stderr);
	}

	/* ---- L5: the session keeps the league as its file ------------------------ */
	const Blob = global.Blob;
	if (typeof Blob === "function") {
		require(path.join(ROOT, "js", "views.js"));
		const Vw = global.Views;
		const cls = V.syntheticClass(41, 10);
		const blob = new Blob(["x".repeat(500)]);
		const data = { players: [{ pid: 1 }] };
		let stringified = 0;
		const real = JSON.stringify;
		const file = { name: "c.json", data: cls, fingerprint: "f", warnings: [],
			league: { name: "L.json.gz", data, blob, gz: true } };
		JSON.stringify = function (v) { if (v === data) stringified++; return real.apply(JSON, arguments); };
		let sh;
		try { sh = Vw.sessionShape([file], { maxBytes: 1e6 }); } finally { JSON.stringify = real; }
		ok("l5/a league with a file behind it is stored as that Blob, never stringified",
			stringified === 0 && sh.files.leagues.length === 1 && sh.files.leagues[0].blob === blob &&
			sh.files.leagues[0].json === undefined && sh.bytes >= 500 && !sh.leagueDropped);
		const small = Vw.sessionShape([file], { maxBytes: real(cls).length + 100 });
		ok("l5/a league file over the cap is dropped by its size alone",
			small.leagueDropped === true && small.files.leagues.length === 0);
		const back = Vw.sessionFiles(sh.files);
		ok("l5/a stored Blob comes back as a league to read again",
			back && back[0].league && back[0].league.blob === blob && back[0].league.data === null &&
			back[0].league.gz === true);
	}

	/* ---- P3: the AP poll and the NET once per regular season ---------------- */
	{
		const lf = V.syntheticClass(42, 40);
		const runner = E.createRunner(lf);
		const base = global.Config.make({ seed: "p3" });
		runner.run(base);
		const cfg2 = global.Config.make({ seed: "p3", upsetFactor: (Number(base.upsetFactor) || 1) * 1.6 });
		const warm = runner.run(cfg2);
		const cold = E.run(V.syntheticClass(42, 40), global.Config.make({ seed: "p3",
			upsetFactor: (Number(base.upsetFactor) || 1) * 1.6 }));
		const sig = (res) => JSON.stringify(Object.keys(res.teams).sort().map((k) => {
			const t = res.teams[k];
			return [k, t.netRank, t.netScore, t.apRank, t.apHistory, t.quads, t.committeeScore];
		}));
		ok("p3/a postseason-only re-run reuses the poll and still equals a cold run",
			warm.phasesRun[0] === "postseason" &&
			JSON.stringify(warm.pollHistory) === JSON.stringify(cold.pollHistory) &&
			sig(warm) === sig(cold) &&
			JSON.stringify(E.exportFile(warm)) === JSON.stringify(E.exportFile(cold)));
		const cfg3 = global.Config.make({ seed: "p3", pace: (Number(base.pace) || 70) + 4 });
		const warm3 = runner.run(cfg3);
		const cold3 = E.run(V.syntheticClass(42, 40), global.Config.make({ seed: "p3",
			pace: (Number(base.pace) || 70) + 4 }));
		ok("p3/a regular-season change recomputes it",
			warm3.phasesRun[0] === "regular" &&
			JSON.stringify(warm3.pollHistory) === JSON.stringify(cold3.pollHistory) && sig(warm3) === sig(cold3));
	}

	/* ---- the page's wiring, read statically ------------------------------- */
	{
		const APP = read("js", "app.js");
		const HTML = read("index.html");
		ok("wiring/the page loads the scanner", /<script defer src="js\/leaguescan\.js"><\/script>/.test(HTML));
		ok("wiring/the meter has a Cancel button", /class="tiny lp-cancel"/.test(HTML) &&
			/progressCancelable\(/.test(APP));
		ok("wiring/drops are read one file at a time through the scanner",
			/LS\.scanBlob\(f, \{ onBytes/.test(APP) && /files\.reduce\(\(p, f, i\) => p\.then/.test(APP));
		ok("wiring/the merge splices and gzips like its source",
			/LS\.spliceBlob\(source\.blob/.test(APP) && /"_class\.json" \+ \(gz \? "\.gz" : ""\)/.test(APP));
		ok("wiring/storage is asked to persist", /navigator\.storage/.test(APP) && /\.persist\(\)/.test(APP));
	}
};
