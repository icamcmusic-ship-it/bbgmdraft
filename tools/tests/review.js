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

	/* EVERY SLIDER ON THE PAGE IS A SLIDER THE PANEL PAINTS.

	   `SLIDERS` in js/app.js is the list paintConfig walks: a range input that
	   is not on it is a control that never shows its value, never shows its
	   hint, never gets a modified marker and never gets its ↺. A name on the
	   list with no input on the page is the reverse — a dead entry. Both
	   happened while this pass was being written, in both directions, and
	   neither is visible from either file alone.

	   Read off the two files rather than asserted, because the list is the
	   thing that goes stale. */
	{
		const app = fs.readFileSync(path.join(ROOT, "js", "app.js"), "utf8");
		const m3 = /const SLIDERS = \[([\s\S]*?)\];/.exec(app);
		const declared = m3
			? (m3[1].match(/"[A-Za-z]+"/g) || []).map((x) => x.slice(1, -1)) : [];
		const onPage = (HTML.match(/type="range" id="[A-Za-z]+"/g) || [])
			.map((x) => x.replace(/.*id="/, "").replace(/"$/, ""));
		const missing = onPage.filter((k) => declared.indexOf(k) === -1);
		const dead = declared.filter((k) => onPage.indexOf(k) === -1);
		ok("every range input on the page is painted by the settings panel",
			missing.length === 0, missing.join(", "));
		ok("every slider the panel paints exists on the page",
			dead.length === 0, dead.join(", "));
		/* And every one of them is a real setting, or paintConfig writes
		   `undefined` into a control and the user sees a blank slider. */
		const unknown = declared.filter((k) => !(k in CFG.DEFAULTS));
		ok("every slider names a setting that exists",
			unknown.length === 0, unknown.join(", "));
	}

	/* THE PANEL CAN REACH THE ENGINE'S OWN BAND.

	   Read every slider's min and max off the page and compare them against
	   the clamp the engine actually applies (Config.CLAMP). Three had drifted:
	   the pace slider stopped at 80 against a declared band of 55-82, so the
	   top of a constant named once expressly to stop the two halves of a run
	   disagreeing was unreachable from the interface; injuryRate stopped at 2
	   against a clamp of 3; surpriseBudget at 6 against 10. A deliberate
	   narrowing is declared as `floor`/`ceil` with a reason beside it, and is
	   allowed here; anything else is drift. */
	{
		const bounds = {};
		const re = /id="([A-Za-z]+)"[^>]*min="([^"]+)"[^>]*max="([^"]+)"/g;
		let m2;
		while ((m2 = re.exec(HTML))) {
			bounds[m2[1]] = { min: Number(m2[2]), max: Number(m2[3]) };
		}
		const drift = [];
		for (const key of Object.keys(CFG.CLAMP)) {
			const want = CFG.sliderRange(key);
			const got = bounds[key];
			if (!got) continue;
			if (got.min !== want.min || got.max !== want.max) {
				drift.push(key + " offers [" + got.min + ", " + got.max +
					"] against a declared [" + want.min + ", " + want.max + "]");
			}
		}
		ok("every slider reaches the band the engine declares for it",
			drift.length === 0, drift.join("; "));
		/* And a narrowing has to say why, or it is indistinguishable from the
		   drift this check exists to catch. */
		const unexplained = Object.keys(CFG.CLAMP).filter((k) => {
			const c = CFG.CLAMP[k];
			return (Number.isFinite(c.floor) && !c.floorWhy) ||
				(Number.isFinite(c.ceil) && !c.ceilWhy);
		});
		ok("a deliberately narrowed slider records its reason",
			unexplained.length === 0, unexplained.join(", "));
		ok("the engine's pace band is the declared one",
			CFG.CLAMP.pace.lo === 55 && CFG.CLAMP.pace.hi === 82);
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

	/* ---------------------------------------------------------------- 2026

	   The front door closes over the CONTAINERS too. Config.make's clamp
	   covered every scalar setting and left the three settings that are not
	   scalars to arrive from a URL, a preset or an imported settings JSON
	   unchecked. */
	{
		const c = CFG.make({ noteLines: "stats" });
		ok("make: a non-array note template falls back to the default",
			Array.isArray(c.noteLines) && c.noteLines.length > 1,
			JSON.stringify(c.noteLines));
		const c2 = CFG.make({ noteLines: ["stats", 7, "awards"] });
		ok("make: a note template keeps only its strings",
			JSON.stringify(c2.noteLines) === JSON.stringify(["stats", "awards"]),
			JSON.stringify(c2.noteLines));
		const c3 = CFG.make({ leagueWeights: { EuroLeague: NaN, NBL: -5,
			"Liga ACB": 1e9 } });
		const built = CFG.defaultLeagueWeights();
		ok("make: a broken destination weight falls back to the built-in",
			c3.leagueWeights.EuroLeague === built.EuroLeague,
			String(c3.leagueWeights.EuroLeague));
		ok("make: destination weights are held to the editor's own band",
			c3.leagueWeights.NBL === 0 &&
			c3.leagueWeights["Liga ACB"] === CFG.LEAGUE_WEIGHT_MAX,
			c3.leagueWeights.NBL + " / " + c3.leagueWeights["Liga ACB"]);
		ok("make: the destination table keeps every league",
			Object.keys(c3.leagueWeights).length === Object.keys(built).length);
		const c4 = CFG.make({ archetypeWeights: { A: -1, B: 500, C: NaN } });
		ok("make: build weights are held to the editor's own band",
			c4.archetypeWeights.A === 0 &&
			c4.archetypeWeights.B === CFG.ARCH_WEIGHT_MAX &&
			!("C" in c4.archetypeWeights),
			JSON.stringify(c4.archetypeWeights));
		/* The three legacy destination sliders were the one settings path
		   with no declared band at all, and make() folds them into the table
		   the engine reads. */
		for (const k of ["wEuroLeague", "wGLeague", "wNBL"]) {
			ok("make: " + k + " is clamped to its declared band",
				!!CFG.CLAMP[k] && CFG.make({ [k]: 1e9 })[k] === CFG.CLAMP[k].hi);
		}
		ok("make: a legacy slider cannot outrun the table it folds into",
			CFG.make({ wEuroLeague: 1e9 }).leagueWeights.EuroLeague ===
				CFG.LEAGUE_WEIGHT_MAX);
	}

	/* The build-pool clamp is a second copy of the table's size. The comment
	   over `archetypePool` in js/config.js says the number is checked against
	   ARCHETYPES.length; the CEILING beside it was not, so a table that grows
	   leaves a slider that cannot reach the whole of it. */
	ok("the build-pool clamp reaches the whole archetype table",
		CFG.CLAMP.archetypePool.hi === global.RatingsBuilder.ARCHETYPES.length,
		CFG.CLAMP.archetypePool.hi + " against " +
			global.RatingsBuilder.ARCHETYPES.length);

	/* BALANCED IS NOT DRAWN BY WEIGHT, so the panel must not offer a box for
	   one. Behavioural, because the claim is about the draw and not about the
	   markup: two classes that differ only in Balanced's weight are the same
	   class. */
	{
		const lf = V.syntheticClass(11, 60);
		const a = E.run(lf, CFG.make({ seed: "bal" }));
		const b = E.run(lf, CFG.make({ seed: "bal",
			archetypeWeights: { Balanced: 8 } }));
		const shape = (r) => r.players.map((p) => p.archetype).join("|");
		ok("a weight on Balanced changes nothing about the class",
			shape(a) === shape(b));
		const app = fs.readFileSync(path.join(ROOT, "js", "app.js"), "utf8");
		ok("and the panel says so instead of offering a dead input",
			/a\.name === "Balanced"[\s\S]{0,400}archnote/.test(app));
	}

	/* THE ARCHETYPE FILTER IS A FILTER. It was missing from both halves of
	   the empty-state card — the list of what is hiding rows, and the reset. */
	{
		ok("the filter reset restores every filter key, archetype included",
			/function clearFilters\(\)[\s\S]{0,400}archetype: ""/.test(VIEWS));
		ok("the empty state names the archetype filter among the active ones",
			/function describeFilters\(\)[\s\S]{0,600}f\.archetype/.test(VIEWS));
		ok("the filter bar carries its own reset",
			/Clear " \+\s*\(active\.length === 1/.test(VIEWS));
	}

	/* THE UNIVERSE'S TWO INDEX SPACES. registryOf and biographyOf are handed
	   a list of results beside the whole file list, and used to index the
	   second with the first's position — which is only right while every
	   loaded file is in the chain. */
	{
		const files = [{ fingerprint: "fpA" }, { fingerprint: "fpB" },
			{ fingerprint: "fpC" }];
		// The chain ran files 0 and 2; file 1 was not runnable.
		const results = [
			{ season: 2030, fileIndex: 0, players: [{ key: "7", name: "A",
				newCollege: "Kansas", classYear: "Freshman", awards: [] }],
				futurePlayers: [] },
			{ season: 2032, fileIndex: 2, players: [{ key: "7", name: "C",
				newCollege: "Duke", classYear: "Senior", awards: [] }],
				futurePlayers: [] },
		];
		const reg = U.registryOf(results, files, []);
		const ids = Object.keys(reg);
		ok("registryOf keys a man by the file he actually came out of",
			ids.some((id) => id.indexOf("fpA") === 0) &&
			ids.some((id) => id.indexOf("fpC") === 0) &&
			!ids.some((id) => id.indexOf("fpB") === 0), ids.join(", "));
		ok("registryOf reports the file index a view can open",
			ids.map((id) => reg[id].fileIndex).sort().join(",") === "0,2");
		const bio = U.biographyOf(results, files);
		ok("biographyOf scopes a biography to the right file",
			!!bio["fpA/7"] && !!bio["fpC/7"] && !bio["fpB/7"],
			Object.keys(bio).join(", "));
		// And the old, aligned shape still keys the way it always did.
		const plain = U.registryOf(
			results.map((r) => Object.assign({}, r, { fileIndex: undefined })), files, []);
		ok("a result with no file index falls back to its position",
			Object.keys(plain).some((id) => id.indexOf("fpB") === 0));
	}

	/* The two universe payloads that were written and never read back. */
	{
		const app = fs.readFileSync(path.join(ROOT, "js", "app.js"), "utf8");
		ok("the persisted career registry is restored on reload",
			/registry: saved\.universe\.registry/.test(app));
		ok("an extension drops last run's extrapolated tail before redrawing it",
			/row\.extrapolated &&[\s\S]{0,200}row\.season > lastSeason/.test(app));
		ok("a resumed chain keeps the guessed years inside the seasons it held",
			/if \(r\.extrapolated\) \{[\s\S]{0,200}r\.season <= before/.test(app));
		ok("the settings shortcut does not fire behind a dialog",
			/if \(e\.key !== "s"[\s\S]{0,900}modalEl\.hidden\) return;/.test(app));
		ok("the preview cache counts a hit as use",
			/previewCache\.delete\(leagueFile\);\s*\n\s*previewCache\.set\(leagueFile, byKey\);/
				.test(fs.readFileSync(path.join(ROOT, "js", "engine.js"), "utf8")));
	}

	/* The four conditions a search could not express. */
	{
		const keys = E.REROLL_PREDICATES.map((p) => p.key);
		for (const k of ["unbeaten", "abroadLottery", "unrankedTop10",
			"poyOutsideClass"]) {
			ok("reroll-until can ask for " + k, keys.indexOf(k) !== -1);
		}
		const app = fs.readFileSync(path.join(ROOT, "js", "app.js"), "utf8");
		ok("and the dialog remembers the last search",
			/state\.lastUntil = \{ keys: picked\.slice\(\), tries: n \};/.test(app));
	}

	/* Quick wins that are static facts about the page. */
	ok("every script tag is deferred", !/<script src=/.test(HTML) &&
		(HTML.match(/<script defer src=/g) || []).length >= 20);
	ok("a print stylesheet exists", /@media print/.test(CSS));
	ok("the header has a reroll-until button", /id="btnRerollUntil"/.test(HTML));
};
