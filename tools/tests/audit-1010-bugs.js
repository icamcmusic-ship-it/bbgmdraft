/* Regression checks for section 1 ("Bugs", B1-B21) of the 2026-10-10 audit
   (AUDIT-2026-10-10.md). Each block names the finding it pins. The engine,
   share, almanac, pro and CLI fixes are driven for real; the page-state fixes
   in js/app.js live in event handlers and are pinned by static reads of the
   source, the way tools/tests/bugfixes-ui.js does it. */
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");

module.exports = function (ok, V) {
	const E = global.Engine;
	const C = global.Config;
	const clone = (x) => JSON.parse(JSON.stringify(x));
	const APP = read("js", "app.js");
	const CLI = read("bin", "bbgmdraft.js");
	// The body of one `function name(` in js/app.js, by brace matching.
	const fnBody = (name) => {
		const at = APP.indexOf("\tfunction " + name + "(");
		if (at < 0) return "";
		let depth = 0;
		let i = APP.indexOf("{", at);
		for (; i < APP.length; i++) {
			if (APP[i] === "{") depth++;
			else if (APP[i] === "}" && --depth === 0) break;
		}
		return APP.slice(at, i + 1);
	};

	/* ---- B1: a file switch parks the locks instead of deleting them ------- */
	{
		const body = fnBody("checkLockFingerprint");
		ok("B1/checkLockFingerprint parks the outgoing file's locks by fingerprint",
			/state\.lockStash\[from\] = state\.overrides/.test(body) &&
			/state\.overrides = state\.lockStash\[file\.fingerprint\] \|\| \{\}/.test(body));
		ok("B1/...and only for a switch between loaded files",
			/state\.files\.some\(\(f\) => f\.fingerprint === from\)/.test(body));
		ok("B1/dropping foreign locks pushes an undo entry first",
			/pushUndo\("dropped "[\s\S]*state\.overrides = \{\};/.test(body));
		ok("B1/the parked locks are persisted and restored",
			/lockStash: state\.lockStash,/.test(fnBody("payload")) &&
			/saved\.lockStash/.test(fnBody("restore")));
	}

	/* ---- B2: other files are not run with the active file's locks -------- */
	{
		const body = fnBody("withFileLocks");
		ok("B2/ensureResult runs every file through withFileLocks",
			/runner\.run\(withFileLocks\(ucfg \|\| fileCfgFor\(i\) \|\| effectiveCfg\(\), i\)\)/
				.test(fnBody("ensureResult")));
		ok("B2/a non-active file gets its own parked locks or none",
			/i === state\.active/.test(body) &&
			/overrides: own \|\| \{\}/.test(body));
	}

	/* ---- B3: the drawn seed survives a reload and a session restore ------- */
	{
		ok("B3/payload() carries lastSeed",
			/lastSeed: state\.lastSeed \|\| null,/.test(fnBody("payload")));
		ok("B3/restore() reads it back",
			/if \(validString\(saved\.lastSeed\)\) state\.lastSeed = saved\.lastSeed;/.test(fnBody("restore")));
	}

	/* ---- B4: efficiencyEnv invalidates the scoreboards ------------------- */
	{
		const sig = (res) => JSON.stringify([res.players.map((p) => [p.key, p.stats && p.stats.ppg]),
			res.tourney && res.tourney.champion && res.tourney.champion.team.name,
			res.tourney && res.tourney.final && res.tourney.final.score]);
		const runner = E.createRunner(V.realisticClass("b4-warm", 20));
		runner.run(C.make({ seed: "b4" }));
		const warm = runner.run(C.make({ seed: "b4", efficiencyEnv: 2.5 }));
		const cold = E.createRunner(V.realisticClass("b4-warm", 20))
			.run(C.make({ seed: "b4", efficiencyEnv: 2.5 }));
		ok("B4/a warm re-run after an efficiencyEnv change matches a cold run",
			sig(warm) === sig(cold));
		const src = read("js", "engine.js");
		ok("B4/efficiencyEnv is declared on the regular and postseason phases",
			/"scoringEnv", "efficiencyEnv", "injuryRate"/.test(src) &&
			/name: "postseason", deps: \[[^\]]*"efficiencyEnv"/.test(src));
	}

	/* ---- B5: a universe in the same drop is not cancelled by a run -------- */
	{
		ok("B5/importUniverse installs its embedded files without a run",
			/installFiles\(loaded, problems, \{ noRun: true \}\)/.test(fnBody("importUniverse")));
		ok("B5/readFiles does not run the classes when a universe is in the drop",
			/side\.universe\.length\s*\?\s*Object\.assign\(\{\}, opts, \{ noRun: true \}\)/
				.test(fnBody("readFiles")));
	}

	/* ---- B6: a failed or cancelled search puts the memories back --------- */
	{
		const body = fnBody("rerollUntil");
		ok("B6/the memories are saved before rememberPool",
			/const memoriesBefore = [\s\S]*rememberPool\(\);/.test(body));
		ok("B6/...and restored by unwind()",
			/function unwind\(\) \{[\s\S]*state\.poolHistory = memoriesBefore\.pool;[\s\S]*state\.flavorHistory = memoriesBefore\.flavor;/
				.test(body));
	}

	/* ---- B7: undo and run history carry mutators, challenge, the world ---- */
	{
		const snap = fnBody("undoSnapshot");
		const set = fnBody("setSnapshot");
		ok("B7/undoSnapshot records mutators, challenge and replayRun",
			/mutators: \(state\.mutators \|\| \[\]\)\.slice\(\)/.test(snap) &&
			/challenge: state\.challenge \|\| null/.test(snap) && /replayRun:/.test(snap));
		ok("B7/...and, for undo/redo only, the universe and its dynasty",
			/withWorld && state\.universe/.test(snap) &&
			/undoSnapshot\(label, true\)/.test(fnBody("pushUndo")));
		ok("B7/setSnapshot puts them back",
			/state\.mutators = global\.ReplayMeta\.cleanMutators\(snap\.mutators\)/.test(set) &&
			/state\.challenge = snap\.challenge/.test(set) &&
			/state\.universe = snap\.universe/.test(set));
		ok("B7/a persisted run-history row does not hold the universe",
			/const snap = undoSnapshot\(fp\);/.test(fnBody("rememberSession")));
	}

	/* ---- B8: appended players' relatives are remapped -------------------- */
	{
		const lf = V.realisticClass("b8", 12);
		lf.players.forEach((p, i) => { p.pid = 100 + i; });
		lf.players[0].relatives = [{ type: "brother", pid: 101, name: "x" }, { type: "father", pid: 5, name: "y" }];
		lf.players[1].relatives = [{ type: "brother", pid: 100, name: "z" }];
		const res = E.run(clone(lf), C.make({ seed: "b8" }));
		const leaguePlayers = [];
		for (let pid = 0; pid < 130; pid++) {
			leaguePlayers.push({ pid, tid: 1, firstName: "Lg", lastName: "P" + pid,
				draft: { year: res.season - 5 }, ratings: [{ season: res.season }] });
		}
		const league = { version: res.leagueFile.version, startingSeason: res.season,
			gameAttributes: { season: res.season }, teams: [{ tid: 0 }, { tid: 1 }], players: leaguePlayers };
		const out = E.mergeIntoLeague(res, league, {});
		const added = out.file.players.filter((p) => p.pid >= 130);
		const byName = (p) => added.find((x) => x.firstName === p.firstName && x.lastName === p.lastName);
		const a = byName(res.leagueFile.players.find((p) => p.pid === 100));
		const b = byName(res.leagueFile.players.find((p) => p.pid === 101));
		ok("B8/an appended player's brother is the brother's NEW pid",
			a && b && Array.isArray(a.relatives) && a.relatives.length === 1 &&
			a.relatives[0].pid === b.pid && b.relatives[0].pid === a.pid,
			JSON.stringify(a && a.relatives) + " / " + (b && b.pid));
		ok("B8/a relative outside the class is dropped, not left pointing at a stranger",
			a && !a.relatives.some((r) => r.pid === 5 || r.pid === 101));
	}

	/* ---- B9: pinned-at-default settings reach the command line ----------- */
	{
		const S = global.Share;
		const out = S.commandLine({ file: "c.json", seed: "s1",
			delta: { seed: "s1", pace: 70, pinned: ["pace", "upsetFactor", "injuryRate"] } });
		ok("B9/a pinned setting at its default is written as --set key=<default>",
			out.text.indexOf("--set upsetFactor=" + C.DEFAULTS.upsetFactor) !== -1 &&
			out.text.indexOf("--set injuryRate=" + C.DEFAULTS.injuryRate) !== -1, out.text);
		ok("B9/...and a non-default one is written once",
			out.text.split("pace=").length === 2, out.text);
		const cli = C.make({ upsetFactor: C.DEFAULTS.upsetFactor });
		ok("B9/the CLI's Config.make pins a key it is given at its default",
			Array.isArray(cli.pinned) && cli.pinned.indexOf("upsetFactor") !== -1, JSON.stringify(cli.pinned));
	}

	/* ---- B10: --locks reads every column the page writes ----------------- */
	{
		const players = [{ key: "a", name: "Al Bo" }, { key: "b", name: "Cy De" }, { key: "c", name: "Ed Fa" }];
		const plan = E.planLockCsv("﻿key,name,ovr,newname,hgtinches,weight,dnk\r\n" +
			"a,,,Zed Q,80,,\r\nb,,,,,,70\r\nc,,,,,,\r\n", players);
		ok("B10/rename, size and rating columns are applied",
			plan.applied.length === 2 && plan.applied[0].patch.name === "Zed Q" &&
			plan.applied[0].patch.hgtInches === 80 && plan.applied[1].patch.ratings.dnk === 70,
			JSON.stringify(plan.applied.map((x) => x.patch)));
		ok("B10/a matched row that locks nothing is reported",
			plan.total === 3 && plan.empty.length === 1 && plan.empty[0] === "Ed Fa");
		ok("B10/the page reads the same parser",
			/global\.Engine\.planLockRows\(rows, players, lists\)/.test(read("js", "views.js")));
		ok("B10/the CLI says how many rows locked nothing",
			/locked nothing/.test(CLI));
	}

	/* ---- B11: a settings file brings its mutators ------------------------ */
	{
		const body = fnBody("applySettingsJson");
		ok("B11/applySettingsJson reads mu into state.mutators and keeps it out of cfg",
			/state\.mutators = global\.ReplayMeta\.cleanMutators\(rest\.mu\)/.test(body) &&
			/delete rest\.mu;/.test(body) && /CFG\.make\(rest\)/.test(body));
	}

	/* ---- B12: setHash keeps the history entry's state --------------------- */
	ok("B12/setHash replaces the hash with history.state, not null",
		/history\.replaceState\(history\.state, "", hash \|\| "#"\)/.test(fnBody("setHash")) &&
		!/replaceState\(null/.test(APP));

	/* ---- B13: a lean link keeps fp while it has deep fields ---------------- */
	{
		const script = `
			global.window = global;
			require(${JSON.stringify(path.join(ROOT, "js", "share.js"))});
			const S = global.Share;
			const rnd = {}; let x = 777;
			for (let i = 0; i < 400; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; rnd["k" + i] = { name: x.toString(36) + x.toString(16) }; }
			(async () => {
				const deep = await S.encodeLink({ classQuality: 4, overrides: rnd, fp: "abc123", tab: "compare", pk: "7" }, { limit: 1500 });
				const flat = await S.encodeLink({ classQuality: 4, overrides: rnd, fp: "abc123" }, { limit: 1500 });
				const d = S.readDeep(await S.decodeLink(deep.hash), ["compare", "board"]);
				const f = await S.decodeLink(flat.hash);
				console.log(JSON.stringify({ lean: deep.lean, applies: S.deepApplies(d, "abc123"), flatFp: f.fp === undefined }));
			})().catch((e) => console.log(JSON.stringify({ error: String(e && e.stack || e) })));
		`;
		const r = spawnSync(process.execPath, ["-e", script], { encoding: "utf8" });
		let got = {};
		try { got = JSON.parse(r.stdout.trim().split("\n").pop()); } catch (e) { got = { error: r.stdout + r.stderr }; }
		ok("B13/a lean link with a tab or prospect still applies on its own file",
			got.lean === true && got.applies === true, JSON.stringify(got));
		ok("B13/...and one with no deep fields still drops fp", got.flatFp === true, JSON.stringify(got));
		ok("B13/writeHash's lean pass does the same",
			/if \(lean\.tab === undefined && lean\.pk === undefined && lean\.cmp === undefined\) delete lean\.fp;/
				.test(fnBody("writeHash")));
	}

	/* ---- B14: the service worker deletes only its own caches -------------- */
	{
		const SW = read("sw.js");
		ok("B14/activate deletes only bbgm-draft-workshop- caches",
			/k !== CACHE && k\.indexOf\("bbgm-draft-workshop-"\) === 0/.test(SW));
		ok("B14/the runtime cache write is inside waitUntil",
			/e\.waitUntil\(caches\.open\(CACHE\)\.then\(\(c\) => c\.put\(req, copy\)\)\)/.test(SW));
	}

	/* ---- B15: every CSV writer has the formula guard ---------------------- */
	{
		const S = global.Share;
		ok("B15/Share.csvCell neutralizes a formula and quotes a bare \\r",
			S.csvCell("=cmd|calc") === "'=cmd|calc" && S.csvCell("@SUM(1)") === "'@SUM(1)" &&
			S.csvCell("a\rb") === '"a\rb"' && S.csvCell(-3) === "-3" && S.csvCell(NaN) === "");
		const csv = S.contactCsv([{ label: "=HYPERLINK(1)", seed: "s", flavor: "=cmd|calc", strangeness: 0,
			tallBig: 0, meanOvr: 1, meanPot: 1, ppg: 1, champion: "@SUM(1)", top: [] }]);
		ok("B15/the batch contact sheet has no live formula",
			!/(^|,)"?[=@]/m.test(csv.split("\n").slice(1).join("\n")), csv);
		ok("B15/the CLI's --csv writer is Share.csvCell",
			/const csvCell = \(v\) => global\.Share\.csvCell\(v\);/.test(CLI));
	}

	/* ---- B16: -q stops the progress counter ------------------------------ */
	ok("B16/every progress write checks quiet(args), which reads both flags",
		/function quiet\(args\) \{\s*return !!\(args\.flags\["--quiet"\] \|\| args\.flags\["-q"\]\);/.test(CLI) &&
		!/!f\["--quiet"\]|!args\.flags\["--quiet"\]/.test(CLI));

	/* ---- B17: a mutator toggle invalidates a running search --------------- */
	ok("B17/untilKey covers the mutators and the challenge",
		/state\.mutators \|\| \[\], state\.challenge \|\| null/.test(fnBody("untilKey")));

	/* ---- B18: almanac names are Markdown-escaped; no double periods ------- */
	{
		const A = global.Almanac;
		const res = E.run(V.realisticClass("b18", 10), C.make({ seed: "b18" }));
		const evil = "_a_ `b` [c](#d) **e** <img src=x>";
		res.players[0].name = evil;
		res.board = res.board || res.players;
		const md = A.markdown(res, {});
		ok("B18/a hostile name is escaped in the .md",
			md.indexOf(evil) === -1 && md.indexOf("\\_a\\_ \\`b\\` \\[c\\](#d) \\*\\*e\\*\\* \\<img") !== -1);
		const html = A.html(res, {});
		ok("B18/...and prints as itself, with no markup from it",
			html.indexOf("_a_ `b` [c](#d) **e** &lt;img src=x&gt;") !== -1 &&
			html.indexOf('<a href="#d">c</a>') === -1 && html.indexOf("<em>a</em>") === -1);
		const t = res.tourney;
		const region = t && t.regions && Object.keys(t.regions)[0];
		if (region && t.regions[region].champ && t.regions[region].champ.team) {
			t.regions[region].champ.team.name = "N.J.I.T.";
			const md2 = A.markdown(res, {});
			ok("B18/an abbreviation ending a sentence gets one period",
				md2.indexOf("N.J.I.T.._") === -1 && md2.indexOf("N.J.I.T.\\_") === -1 &&
				md2.indexOf("champion: N.J.I.T._") !== -1);
		}
	}

	/* ---- B19: mock --rounds is honored for a league file ------------------ */
	{
		const res = E.run(V.realisticClass("b19", 40), C.make({ seed: "b19" }));
		const teams = [];
		for (let tid = 0; tid < 6; tid++) teams.push({ tid, region: "R" + tid, name: "T" + tid });
		const league = { teams, players: [], draftPicks: [] };
		const three = global.Pro.mockDraft(res, { league, rounds: 3 });
		const one = global.Pro.mockDraft(res, { league, rounds: 1 });
		const maxRound = (m) => m.picks.reduce((x, p) => Math.max(x, p.round || 0), 0);
		ok("B19/a league mock drafts the rounds asked for",
			maxRound(three) === 3 && maxRound(one) === 1 && one.picks.length === 6,
			maxRound(three) + " / " + maxRound(one) + " / " + one.picks.length);
	}

	/* ---- B20: a merge refuses classes that have not run ------------------- */
	ok("B20/mergeInto names the skipped files and merges nothing",
		/skipped\.push\(/.test(fnBody("mergeInto")) && /Not merged: /.test(fnBody("mergeInto")));

	/* ---- B21: the daily is keyed on the UTC date ------------------------- */
	{
		const RP = global.Replay;
		// 23:30 on Oct 9 in UTC-5 is 04:30 on Oct 10 UTC.
		const d = new Date(Date.UTC(2026, 9, 10, 4, 30));
		ok("B21/Replay.dateKey is the UTC date", RP.dateKey(d) === "2026-10-10", RP.dateKey(d));
		ok("B21/dailySeed is the UTC date",
			/getUTCFullYear\(\)[\s\S]*getUTCMonth\(\)[\s\S]*getUTCDate\(\)/.test(fnBody("dailySeed")));
	}
};
