"use strict";
/* Checks for the review round that fixed blank-value sorting, the COUNTS
   set, the universe timeline's school field, the oversized-file offer, the
   preview cache and the export's experience field. Each one turns a bug
   report into something CI fails on. */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const HTML = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const CSS = fs.readFileSync(path.join(ROOT, "css", "style.css"), "utf8");
const VIEWS = fs.readFileSync(path.join(ROOT, "js", "views.js"), "utf8");

module.exports = function (ok, V) {
	const E = global.Engine;
	const U = global.Universe;
	const CFG = global.Config;

	/* B2: a setting in COUNTS is rounded by flavors and narratives, so every
	   member's slider has to step in whole numbers — buildNoise stepped by
	   0.5 and was in the set. Read the steps off the page so the next
	   misfiling fails here rather than in a flavor. */
	{
		const steps = {};
		const re = /id="([A-Za-z]+)"[^>]*step="([^"]+)"/g;
		let m;
		while ((m = re.exec(HTML))) steps[m[1]] = Number(m[2]);
		const bad = Array.from(CFG.COUNTS).filter((k) =>
			steps[k] !== undefined && !Number.isInteger(steps[k]));
		ok("every COUNTS setting has a whole-number slider step (buildNoise is out)",
			bad.length === 0 && !CFG.COUNTS.has("buildNoise"), bad.join(", "));
	}

	/* B1: the blank-last rule is not multiplied by the direction. A static
	   check, since sortRows lives in the DOM module; the browser smoke test
	   drives the real table. */
	ok("sortRows keeps blanks last in both directions",
		/return ba \? 1 : -1;/.test(VIEWS) && !/return \(ba \? 1 : -1\) \* dir;/.test(VIEWS));

	/* B4: the timeline row's school is the NCAA program, never the pro
	   club, and the club rides beside it. */
	{
		const fake = {
			leagueFile: { startingSeason: 2030 },
			tourney: null, poll: [], realignment: [], coachingCarousel: [],
			players: [
				{ name: "A", key: "a", boardRank: 1, newCollege: "EuroLeague",
					proClub: "Real Madrid", nonNcaa: true, awards: [] },
				{ name: "B", key: "b", boardRank: 2, newCollege: "Kansas",
					awards: ["Naismith Trophy"] },
			],
		};
		const row = U.summarize(fake, "s", "f.json");
		ok("summarize: No. 1 pick's school is the program, club kept beside it",
			row.no1 && row.no1.school === "EuroLeague" && row.no1.club === "Real Madrid" &&
			row.no1.nonNcaa === true, JSON.stringify(row.no1));
		ok("summarize: player of the year comes from Awards.NATIONAL_POY",
			row.poy && row.poy.name === "B" && row.poy.school === "Kansas" && !row.poy.club,
			JSON.stringify(row.poy));
		const rows = [
			Object.assign({}, row, { season: 2030 }),
			Object.assign({}, row, { season: 2031 }),
		];
		const th = U.threads(rows);
		ok("threads: a pro club never counts as a program producing No. 1 picks",
			!th.some((t) => t.kind === "no1" && t.team === "EuroLeague"));
		ok("threads: back-to-back POY schools still counted for a program",
			th.some((t) => t.kind === "poyRepeat" && t.team === "Kansas"));
	}

	/* B5: an oversized file with a recoverable class is offered as that
	   class by Universe.validate, the way the standalone path offers it. */
	{
		const cls = V.syntheticClass(3, 40);
		const season = cls.startingSeason;
		const big = JSON.parse(JSON.stringify(cls));
		for (let i = 0; i < E.MAX_CLASS + 10; i++) {
			const p = JSON.parse(JSON.stringify(cls.players[i % cls.players.length]));
			p.pid = 10000 + i;
			p.draft = Object.assign({}, p.draft, { year: season + 3 });
			big.players.push(p);
		}
		const rows = U.validate([{ name: "league.json", data: big }]);
		ok("validate: an oversized file with a class inside is runnable as that class",
			rows[0].ok && Array.isArray(rows[0].classPids) &&
			rows[0].classPids.length === cls.players.length &&
			rows[0].players === cls.players.length,
			JSON.stringify({ ok: rows[0].ok, n: rows[0].players, errors: rows[0].errors }));
		const none = JSON.parse(JSON.stringify(big));
		for (const p of none.players) p.draft = Object.assign({}, p.draft, { year: season + 3 });
		const rows2 = U.validate([{ name: "league.json", data: none }]);
		ok("validate: an oversized file with no class to pick out is still refused",
			!rows2[0].ok && /cap/.test(rows2[0].errors.join(" ")));
	}

	/* B6: previewClass is memoized on the build phase's own key. */
	{
		const lf = V.syntheticClass(5, 30);
		const cfg = CFG.make({ seed: "preview" });
		const a = E.previewClass(lf, cfg);
		const b = E.previewClass(lf, CFG.make({ seed: "preview", awardStrictness: 1.5 }));
		const c = E.previewClass(lf, CFG.make({ seed: "preview", classQuality: 2 }));
		ok("previewClass reuses the preview when only a non-build setting changed", a === b);
		ok("previewClass rebuilds when a build setting changed", a !== c);
		const d = E.previewClass(lf, CFG.make({ seed: "preview" }));
		ok("previewClass rebuilds and matches when the build key returns",
			d !== a && d.players.length === a.players.length &&
			d.players[0].key === a.players[0].key);
	}

	/* B8: two files with the same season get different seeds. */
	ok("seedFor: same season, different index, different seed",
		U.seedFor("base", 0, 2031, "fp1") !== U.seedFor("base", 1, 2031, "fp1"));

	/* experience: 0 on every exported prospect. */
	{
		const res = E.run(V.syntheticClass(8, 30), CFG.make({ seed: "exp" }));
		const out = E.exportFile(res);
		ok("exportFile writes experience: 0 on every prospect",
			out.players.every((p) => p.experience === 0));
		const pf = E.exportPlayersFile(res, {});
		ok("exportPlayersFile keeps experience: 0",
			pf.players.every((p) => p.experience === 0));
	}

	/* Quick wins that are static facts about the page. */
	ok("every script tag is deferred", !/<script src=/.test(HTML) &&
		(HTML.match(/<script defer src=/g) || []).length >= 20);
	ok("a print stylesheet exists", /@media print/.test(CSS));
	ok("the header has a reroll-until button", /id="btnRerollUntil"/.test(HTML));
};
