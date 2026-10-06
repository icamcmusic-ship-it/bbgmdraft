/* Regression tests for the engine / export / command-line findings of the
   2026-10-05 audit (AUDIT-2026-10-05.md, sections 0 and 1). Each block names
   the finding it pins. */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

module.exports = function (ok, V) {
	const E = global.Engine;
	const C = global.Config;
	const clone = (x) => JSON.parse(JSON.stringify(x));
	const run = (lf, seed, extra) => E.run(clone(lf), C.make(Object.assign({ seed }, extra || {})));
	const marker = "Generated scouting notes:";

	/* ---- N2: Include scouting notes off must not delete the file's own ------ */
	{
		const lf = V.realisticClass("bf-n2", 12);
		lf.players[0].note = "FILE NOTE zero";
		lf.players[1].note = "keep me\nHonors: stale line\nEarlier honors: 2020 old\n" +
			"My notes: mine\n" + marker + "\nold generated text";
		const res = run(lf, "bf-n2");
		for (const o of [{ includeNotes: false }, { includeNotes: false, noteAppend: true }]) {
			const f = E.exportFile(res, o);
			ok("N2/includeNotes:false keeps the file's note " + JSON.stringify(o),
				f.players[0].note === "FILE NOTE zero" && f.players[0].noteBool === 1,
				JSON.stringify(f.players[0].note));
			ok("N2/...minus our own Honors, My notes and generated blocks " + JSON.stringify(o),
				f.players[1].note === "keep me", JSON.stringify(f.players[1].note));
			ok("N2/...and a player with no note gets none " + JSON.stringify(o),
				f.players[2].note === undefined && f.players[2].noteBool === undefined);
		}
		const mine = run(lf, "bf-n2");
		mine.userMarks = { notes: { [mine.players[0].key]: "scribble" }, watch: {} };
		const f = E.exportFile(mine, { includeNotes: false, myMarks: true });
		ok("N2/My notes still ride along when Include notes is off",
			f.players[0].note === "FILE NOTE zero\n\nMy notes: scribble", JSON.stringify(f.players[0].note));
	}

	/* ---- N3: one rule when the template writes nothing for a player -------- */
	{
		const lf = V.realisticClass("bf-n3", 40);
		lf.players.forEach((p) => { p.note = "FILE NOTE " + p.pid; });
		const res = run(lf, "bf-n3", { noteLines: ["injury"] });
		const f = E.exportFile(res, {});
		const bad = f.players.filter((p, i) => res.players[i].note
			? p.note !== res.players[i].note
			: p.note !== undefined);
		ok("N3/a note is the template's output: written where it wrote, cleared where it did not",
			bad.length === 0 && res.players.some((p) => !p.note) && res.players.some((p) => p.note),
			bad.length + " players differ");
		const kept = E.exportFile(res, { noteAppend: true });
		ok("N3/...unless Keep any note already in the file is on",
			kept.players.every((p, i) => p.note.indexOf("FILE NOTE " + lf.players[i].pid) === 0));
	}

	/* ---- N7: noteAppend seeds from the league's note and does not stack ----- */
	{
		const lf = V.realisticClass("bf-n7", 8);
		lf.players.forEach((p) => { p.note = "CLASS NOTE " + p.pid; });
		const res = run(lf, "bf-n7");
		const league = { version: 73, startingSeason: 2026, gameAttributes: { season: 2026 },
			players: clone(E.exportFile(res, {}).players).map((p, i) => Object.assign(p, {
				tid: -2, note: "LEAGUE NOTE " + i, noteBool: 1, watch: 2,
			})) };
		const m = E.mergeIntoLeague(res, clone(league), { noteAppend: true });
		const n0 = m.file.players[0].note;
		ok("N7/league merge keeps the LEAGUE's note, not the class file's",
			n0.indexOf("LEAGUE NOTE 0\n\n" + marker + "\n") === 0 && n0.indexOf("CLASS NOTE") === -1,
			JSON.stringify(n0.slice(0, 80)));
		const off = E.mergeIntoLeague(res, clone(league), { includeNotes: false });
		ok("N7/...and Include notes off leaves the league's note as it was",
			off.file.players[0].note === "LEAGUE NOTE 0" && off.file.players[0].noteBool === 1,
			JSON.stringify(off.file.players[0].note));

		// Re-export round trip: the note does not grow.
		let cur = clone(lf);
		const lens = [];
		let first = null;
		for (let g = 0; g < 3; g++) {
			const r = E.run(clone(cur), C.make({ seed: "bf-n7" }));
			cur = E.exportFile(r, { noteAppend: true });
			lens.push(cur.players[0].note.length);
			if (g === 0) first = cur.players[0].note;
		}
		const occ = (t, x) => t.split(x).length - 1;
		ok("N7/three re-exports with noteAppend keep one generated block and one copy of the file's note",
			occ(cur.players[0].note, marker) === 1 && occ(cur.players[0].note, "CLASS NOTE 0") === 1 &&
			first.indexOf("CLASS NOTE 0\n\n" + marker) === 0 && cur.players[0].note.indexOf("CLASS NOTE 0") === 0,
			lens.join(","));
		// ...even when My notes is appended each time.
		let cur2 = clone(lf);
		let l2 = [];
		for (let g = 0; g < 3; g++) {
			const r = E.run(clone(cur2), C.make({ seed: "bf-n7" }));
			r.userMarks = { notes: { [r.players[0].key]: "mine" }, watch: {} };
			cur2 = E.exportFile(r, { noteAppend: true, myMarks: true });
			l2.push(cur2.players[0].note.length);
		}
		ok("N7/...nor My notes",
			occ(cur2.players[0].note, marker) === 1 && occ(cur2.players[0].note, "My notes:") === 1 &&
			/My notes: mine$/.test(cur2.players[0].note), l2.join(","));
	}

	/* ---- N6: the watchlist survives a league merge -------------------------- */
	{
		const lf = V.realisticClass("bf-n6", 6);
		const res = run(lf, "bf-n6");
		res.userMarks = { notes: {}, watch: { [res.players[0].key]: true } };
		const league = { version: 73, startingSeason: 2026, gameAttributes: { season: 2026 },
			players: clone(E.exportFile(res, {}).players).map((p) => { p.tid = -2; delete p.watch; return p; }) };
		league.players[3].watch = 3;
		const m = E.mergeIntoLeague(res, clone(league), { myMarks: true });
		ok("N6/the star is written on the merge route", m.file.players[0].watch === true,
			String(m.file.players[0].watch));
		ok("N6/...and a class file that says nothing does not wipe the league's own",
			m.file.players[3].watch === 3, String(m.file.players[3].watch));
	}

	/* ---- N9: the note's seasons are the exported rows' seasons -------------- */
	{
		const lf = V.realisticClass("bf-n9", 20);
		lf.startingSeason = 2026;
		lf.players.forEach((p) => { p.draft = Object.assign({}, p.draft, { year: 2027 }); });
		const res = run(lf, "bf-n9", { noteLines: ["stats", "highs", "awards"] });
		const f = E.exportFile(res, { stats: true, prior: true, awards: true });
		let bad = 0;
		let withPrior = 0;
		f.players.forEach((p) => {
			const m = /^(\d{4}): \d+ GP/m.exec(p.note);
			const last = p.stats[p.stats.length - 1].season;
			if (m && Number(m[1]) !== last) bad++;
			const e = /^Earlier honors: (.*)$/m.exec(p.note);
			if (e) {
				withPrior++;
				const seasons = (e[1].match(/\d{4}/g) || []).map(Number);
				const rows = (p.awards || []).map((a) => a.season);
				if (seasons.some((s) => rows.indexOf(s) === -1)) bad++;
			}
		});
		ok("N9/the stats line is labelled with the exported season (2027), not startingSeason",
			bad === 0 && /^2027: /m.test(f.players[0].note), bad + " mismatched");
		const plain = E.exportFile(res, {});
		ok("N9/...and the same note whether or not awards are written",
			plain.players.every((p, i) => (p.note || "") .split("\n").filter((l) => /^Earlier honors/.test(l)).join() ===
				(f.players[i].note || "").split("\n").filter((l) => /^Earlier honors/.test(l)).join()));
		void withPrior;
	}

	/* ---- N11: no "Postseason" line under "no postseason" -------------------- */
	{
		const res = run(V.realisticClass("bf-n11", 120), "bf-n11", { noteLines: ["record", "march"] });
		const bad = res.players.filter((p) => /no postseason/.test(p.note) && /^Postseason:/m.test(p.note));
		const relabelled = res.players.filter((p) => /no postseason/.test(p.note) && /^Conference tournament:/m.test(p.note));
		ok("N11/a team with no postseason never has a Postseason line", bad.length === 0, bad.length + " do");
		ok("N11/...its tournament games are labelled for what they were", relabelled.length > 0,
			relabelled.length + " relabelled");
	}

	/* ---- N13: the almanac prints Honors once -------------------------------- */
	{
		const res = run(V.realisticClass("bf-n13", 40), "bf-n13", { noteLines: ["summary", "awards"] });
		const md = global.Almanac.markdown(res, {});
		const caps = md.split("### ").slice(1);
		const twice = caps.filter((c) => (c.match(/Honors:/g) || []).length > 1);
		ok("N13/no prospect capsule carries two Honors lines",
			twice.length === 0 && /\*\*Honors:\*\*/.test(md), twice.length + " do");
	}

	/* ---- B1: an anomaly's size reaches the file ----------------------------- */
	{
		const res = run(V.realisticClass("bf-b1", 70), "hg", { lockHeights: false });
		const f = E.exportFile(res, {});
		const moved = res.players.map((p, i) => [p, i])
			.filter(([p]) => p.newHgtInches !== p.hgtInches || p.newWeight !== p.weight);
		ok("B1/some prospect's size was changed by the run", moved.length > 0);
		ok("B1/...and the exported hgt / weight say so",
			moved.every(([p, i]) => f.players[i].hgt === p.newHgtInches && f.players[i].weight === p.newWeight),
			moved.filter(([p, i]) => f.players[i].hgt !== p.newHgtInches).length + " differ");
		const untouched = res.players.map((p, i) => [p, i])
			.filter(([p]) => p.newHgtInches === p.hgtInches && p.newWeight === p.weight);
		ok("B1/...and a player nothing changed is still left as the file had him",
			untouched.every(([p, i]) => f.players[i].hgt === p.src.hgt && f.players[i].weight === p.src.weight));
		const league = { version: 73, startingSeason: 2026, gameAttributes: { season: 2026 },
			players: clone(E.exportFile(res, {}).players).map((p) => Object.assign(p, { tid: -2, hgt: 70, weight: 150 })) };
		const m = E.mergeIntoLeague(res, league, {});
		const bi = moved[0][1];
		ok("B1/the league merge writes the changed size too",
			m.file.players[bi].hgt === moved[0][0].newHgtInches, String(m.file.players[bi].hgt));
	}

	/* ---- B3: a class with no draft year or tid still imports ---------------- */
	{
		const lf = V.realisticClass("bf-b3", 20);
		lf.players.forEach((p) => { delete p.draft; delete p.tid; });
		const f = E.exportFile(run(lf, "bf-b3"), {});
		ok("B3/every prospect exports tid -2",
			f.players.every((p) => p.tid === -2), JSON.stringify(f.players[0].tid));
		const d = f.players[0].draft;
		ok("B3/...with the draft year and BBGM's undrafted slot filled in",
			d.year === 2026 && d.round === 0 && d.pick === 0 && d.tid === -1 && d.originalTid === -1 &&
			Number.isFinite(d.ovr), JSON.stringify(d));
		const lf2 = V.realisticClass("bf-b3b", 20);
		lf2.players.forEach((p) => { p.tid = 7; p.draft = { year: 2020, round: 1, pick: 3, tid: 7, originalTid: 7 }; });
		lf2.players.slice(0, 12).forEach((p) => { p.draft.year = 2026; });
		const f2 = E.exportFile(run(lf2, "bf-b3b"), {});
		ok("B3/a row that names another draft year is still left alone",
			f2.players[15].tid === 7 && f2.players[15].draft.round === 1 && f2.players[0].tid === -2);
	}

	/* ---- B4: a league's season is gameAttributes.season --------------------- */
	{
		const lf = V.realisticClass("bf-b4", 20);
		const league = { version: 73, startingSeason: 2020, gameAttributes: { season: 2026 },
			teams: [], players: clone(lf.players) };
		ok("B4/a league file reads gameAttributes.season before startingSeason",
			E.findSeason(league) === 2026, String(E.findSeason(league)));
		const rows = { version: 73, startingSeason: 2020, teams: [],
			gameAttributes: [{ key: "season", value: 2026 }, { key: "startingSeason", value: 2020 }],
			players: [] };
		ok("B4/...in the array form too", E.findSeason(rows) === 2026);
		ok("B4/a plain class file is unchanged",
			E.findSeason({ startingSeason: 2024, players: [] }) === 2024 &&
			E.findSeason({ season: 2023, players: [] }) === 2023);
		ok("B4/a league with only a startingSeason still reads it",
			E.findSeason({ startingSeason: 2020, teams: [{}], players: [] }) === 2020);
		const cls = clone(lf);
		cls.startingSeason = 2024;
		cls.players.forEach((p) => { p.draft = Object.assign({}, p.draft, { year: 2024 }); });
		const res = run(cls, "bf-b4");
		league.players = clone(E.exportFile(res, {}).players).map((p) => Object.assign(p, { tid: -2 }));
		const m = E.mergeIntoLeague(res, league, {});
		ok("B4/merging a 2024 class into a league in 2026 warns that the draft has happened",
			m.warnings.length === 1 && /2026/.test(m.warnings[0]), JSON.stringify(m.warnings));
	}

	/* ---- B5: stale values and contract do not outlive a rewrite -------------- */
	{
		const lf = V.realisticClass("bf-b5", 10);
		lf.players.forEach((p) => {
			p.value = 40; p.valueFuzz = 41; p.valueNoPot = 39; p.valueNoPotFuzz = 38;
			p.valueWithContract = 37; p.contract = { amount: 500, exp: 2030 };
		});
		const res = run(lf, "bf-b5", { ovrMode: "curve", classQuality: 3 });
		const f = E.exportFile(res, {});
		const stale = ["value", "valueFuzz", "valueNoPot", "valueNoPotFuzz", "valueWithContract", "contract"];
		ok("B5/the class file carries none of the stale value fields or the old contract",
			f.players.every((p) => stale.every((k) => p[k] === undefined)),
			JSON.stringify(stale.filter((k) => f.players[0][k] !== undefined)));
		const pf = E.exportPlayersFile(res, {});
		ok("B5/the Import players route is unchanged (value stripped, contract kept)",
			pf.players.every((p) => p.value === undefined && p.contract && p.contract.amount === 500));
		const league = { version: 73, startingSeason: 2026, gameAttributes: { season: 2026 },
			players: clone(f.players).map((p) => Object.assign(p, { tid: -2, value: 48, valueFuzz: 47, contract: { amount: 1500, exp: 2030 } })) };
		const m = E.mergeIntoLeague(res, league, {});
		ok("B5/the league merge drops the league's stale value (the game recomputes it)",
			m.file.players.every((p) => p.value === undefined && p.valueFuzz === undefined));
	}

	/* ---- B10: a blank or null jersey number is a missing one ----------------- */
	{
		const lf = V.realisticClass("bf-b10", 10);
		lf.players[0].jerseyNumber = "";
		lf.players[1].jerseyNumber = null;
		lf.players[2].jerseyNumber = "23";
		const f = E.exportFile(run(lf, "bf-b10"), { stats: true });
		const nums = f.players.map((p) => String(p.jerseyNumber));
		ok("B10/a blank and a null number are assigned one",
			/^\d+$/.test(nums[0]) && /^\d+$/.test(nums[1]), nums[0] + "," + nums[1]);
		ok("B10/...a real one is kept and the class stays unique",
			nums[2] === "23" && new Set(nums).size === nums.length, nums.join(","));
		ok("B10/...and the stats rows carry the assigned number",
			f.players[0].stats[f.players[0].stats.length - 1].jerseyNumber === nums[0]);
		const none = E.exportFile(run(lf, "bf-b10"), { jerseys: false });
		ok("B10/jerseys:false still leaves the file's own alone",
			none.players[0].jerseyNumber === "" && none.players[1].jerseyNumber === null);
	}

	/* ---- B12: an override name is text, trimmed and capped ------------------ */
	{
		const lf = V.realisticClass("bf-b12", 6);
		const pid = (i) => lf.players[i].pid;
		const res = run(lf, "bf-b12", { overrides: {
			[pid(0)]: { name: { x: 1 } },
			[pid(1)]: { name: "  " + "x".repeat(300) + " " },
			[pid(2)]: { name: "  Ada  Lovelace " },
			[pid(3)]: { name: ["a", "b"] },
		} });
		const f = E.exportFile(res, {});
		ok("B12/an object name is ignored, not '[object Object]'",
			res.players[0].name === "Test P0" && f.players[0].firstName !== "[object" &&
			f.players[3].firstName !== "a,b", res.players[0].name + " / " + f.players[0].firstName);
		ok("B12/a long name is capped",
			res.players[1].name.length === 100 && (f.players[1].firstName + (f.players[1].lastName || "")).length <= 100,
			String(res.players[1].name.length));
		ok("B12/a good name is trimmed and still works",
			res.players[2].name === "Ada  Lovelace" && f.players[2].firstName === "Ada" &&
			f.players[2].lastName === "Lovelace", f.players[2].firstName + "|" + f.players[2].lastName);
	}

	/* ---- the command line: B7, B8, B9, N15 ---------------------------------- */
	{
		const BIN = path.join(__dirname, "..", "..", "bin", "bbgmdraft.js");
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bbgmdraft-bf-"));
		const cli = (...args) => spawnSync(process.execPath, [BIN].concat(args), { encoding: "utf8", cwd: dir });
		const lf = V.realisticClass("bf-cli", 40);
		lf.players[0].note = "FILE NOTE zero";
		const file = path.join(dir, "class.json");
		fs.writeFileSync(file, JSON.stringify(lf));
		const body = (r) => JSON.parse(r.stdout.replace(/^﻿/, ""));

		const n1 = cli("batch", file, "-n", "abc", "--csv");
		ok("B7/batch -n abc exits 1 with a message, not an empty table",
			n1.status === 1 && /-n takes a whole number/.test(n1.stderr) && n1.stdout === "", n1.stderr);
		ok("B7/-n 0 and -n 2.5 are refused too",
			cli("batch", file, "-n", "0").status === 1 && cli("batch", file, "-n", "2.5").status === 1);
		ok("B7/a good -n still runs", cli("batch", file, "-n", "2", "--csv", "--seed", "x").status === 0);

		const y = cli("run", file, "--year", "abc", "-q", "--out", "-");
		ok("B8/--year abc is a clear error", y.status === 1 && /--year takes a four-digit year/.test(y.stderr), y.stderr);
		const yp = cli("run", file, "--year", "2026", "-q", "--out", "-");
		ok("B8/--year on a plain class file says it is ignored",
			yp.status === 0 && /plain class file/.test(yp.stderr), yp.stderr);

		const bad = cli("run", file, "--set", "ovrMode=curv", "-q", "--out", "-");
		ok("B8/a --set choice that is not a choice is refused, listing the real ones",
			bad.status === 1 && /preserve, curve/.test(bad.stderr), bad.stderr);
		ok("B8/...for every choice setting",
			cli("run", file, "--set", "collegeSource=bogus", "-q", "--out", "-").status === 1 &&
			cli("run", file, "--set", "era=1850", "-q", "--out", "-").status === 1 &&
			cli("run", file, "--set", "ovrMode=curve", "-q", "--out", "-").status === 0);
		const clamp = cli("run", file, "--set", "classQuality=99", "--out", path.join(dir, "c.json"));
		ok("B8/a number outside the slider range is reported when it is clamped",
			clamp.status === 0 && /classQuality=99 is outside/.test(clamp.stderr) && /using 3/.test(clamp.stderr),
			clamp.stderr);
		ok("B8/-q silences the clamp note",
			!/outside/.test(cli("run", file, "--set", "classQuality=99", "-q", "--out", "-").stderr));

		// A league with two classes: check lists them instead of erroring.
		const a = V.realisticClass("bf-la", 30);
		const b = V.realisticClass("bf-lb", 30);
		const league = { version: 73, startingSeason: 2026, gameAttributes: { season: 2026 }, teams: [{ tid: 0 }],
			players: a.players.map((p, i) => Object.assign({}, p, { pid: i, tid: -2, draft: { year: 2026 } }))
				.concat(b.players.map((p, i) => Object.assign({}, p, { pid: 100 + i, tid: -2, draft: { year: 2027 } }))) };
		const lfile = path.join(dir, "league.json");
		fs.writeFileSync(lfile, JSON.stringify(league));
		const ck = cli("check", lfile);
		ok("B8/check on a league with several classes lists them and exits 0",
			ck.status === 0 && /2 draft classes: 2026 \(30 players\), 2027 \(30 players\)/.test(ck.stdout) &&
			/--year/.test(ck.stdout), ck.stdout + ck.stderr);
		ok("B8/...and check --year checks that class", /class of 2027/.test(cli("check", lfile, "--year", "2027").stdout));

		// B9: the safe option is to say so.
		const help = cli("help").stdout;
		ok("B9/the help says the command line writes no face",
			/does not load the face library/.test(help) && /no face field/.test(help));
		const readme = fs.readFileSync(path.join(__dirname, "..", "..", "README.md"), "utf8");
		ok("B9/the README says so too", /command line does not load the face library/.test(readme));

		// N15: the note flags and the page's preset names.
		const keep = body(cli("run", file, "--notes", "none", "--keep-notes", "-q", "--out", "-"));
		ok("N15/--keep-notes keeps the file's note under an empty template",
			keep.players[0].note === "FILE NOTE zero", JSON.stringify(keep.players[0].note));
		const clear = body(cli("run", file, "--notes", "none", "-q", "--out", "-"));
		ok("N15/...and without it an empty template clears it",
			clear.players[0].note === undefined);
		const leave = body(cli("run", file, "--no-notes", "-q", "--out", "-"));
		ok("N15/--no-notes writes none of ours and leaves the file's",
			leave.players[0].note === "FILE NOTE zero" && leave.players[1].note === undefined);
		const every = E.NOTE_LINES.map((x) => x[0]);
		const viaPage = body(cli("run", file, "--notes", "Everything", "--seed", "np", "-q", "--out", "-"));
		const viaLines = body(cli("run", file, "--notes", every.join(","), "--seed", "np", "-q", "--out", "-"));
		const viaOld = body(cli("run", file, "--notes", "all", "--seed", "np", "-q", "--out", "-"));
		ok("N15/the page's 'Everything' and 'Stat sheet' names work, and the old ones still do",
			JSON.stringify(viaPage) === JSON.stringify(viaLines) && JSON.stringify(viaOld) === JSON.stringify(viaLines) &&
			JSON.stringify(body(cli("run", file, "--notes", "Stat sheet", "--seed", "np", "-q", "--out", "-"))) ===
				JSON.stringify(body(cli("run", file, "--notes", "stat", "--seed", "np", "-q", "--out", "-"))));
	}
};
