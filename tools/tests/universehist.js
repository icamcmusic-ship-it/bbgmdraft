/* Universe history (audit section 5, items 3, 7, 9, 13, 14): the "he came
   back" thread off the registry, rivalry heat and the renewed-rivalry
   thread, the program digest and the drought stories it feeds, the coaches'
   record book and hot-seat preview, and strangeness per season with the
   weirdest-season record. */
"use strict";

module.exports = function (ok, V) {
	const fs = require("fs");
	const path = require("path");
	const E = global.Engine;
	const CFG = global.Config;
	const U = global.Universe;
	const N = global.News;

	/* --- rivalry heat ---------------------------------------------------- */
	{
		const old = { a: "Duke", b: "Kansas", games: 6, aw: 3, bw: 3, march: [2020, 2021, 2022, 2023] };
		const hot = { a: "Baylor", b: "Gonzaga", games: 3, aw: 2, bw: 1, march: [2038, 2040],
			seen: [2038, 2039, 2040] };
		ok("recent meetings are hotter than more, older ones",
			U.rivalryHeat(hot, 2040) > U.rivalryHeat(old, 2040),
			U.rivalryHeat(hot, 2040) + " vs " + U.rivalryHeat(old, 2040));
		ok("heat halves every RIVALRY_HALF_LIFE years",
			Math.abs(U.rivalryHeat({ march: [2030] }, 2030 + U.RIVALRY_HALF_LIFE) - 1.5) < 0.01);
		ok("an old save's entry (no `seen`) still has a heat", U.rivalryHeat(old, 2023) > 0);
		const table = U.rivalryTable({ "Duke|Kansas": old, "Baylor|Gonzaga": hot }, 2040);
		ok("the rivalry table ranks by heat, not by count",
			table[0].a === "Baylor" && table.every((e) => Number.isFinite(e.heat)));
		const riv = {
			"A|B": { a: "A", b: "B", march: [2020, 2021, 2029] },
			"C|D": { a: "C", b: "D", march: [2027, 2029] },
		};
		const ren = U.renewedThreads(riv);
		ok("a cold pair that meets in March again is a renewed rivalry",
			ren.length === 1 && ren[0].kind === "rivalryRenewed" &&
			ren[0].seasons.join() === "2021,2029" && ren[0].text.indexOf("A and B") === 0,
			JSON.stringify(ren));
		const step = U.harvest({ season: 2030, teams: {
			X: { name: "X", conf: "c", w: 1, l: 0, level: 50, log: [{ opp: "Y", stage: "ncaa", won: true }] },
			Y: { name: "Y", conf: "c", w: 0, l: 1, level: 50, log: [{ opp: "X", stage: "ncaa", won: false }] },
		} }, null);
		ok("the book records the seasons a pair met, for the heat",
			JSON.stringify(step.rivalries["X|Y"].seen) === "[2030]");
	}

	/* --- he came back ---------------------------------------------------- */
	{
		const reg = {
			"fpA/7": { id: "fpA/7", name: "Sam Hill", honors: [{ season: 2026, award: "x" },
				{ season: 2029, award: "y" }], returned: [], seasons: [{ season: 2026 }, { season: 2029 }] },
			/* Same name, same pid, different file: a different man. */
			"fpB/7": { id: "fpB/7", name: "Sam Hill", honors: [{ season: 2027, award: "x" }],
				returned: [], seasons: [{ season: 2027 }] },
			"fpC/3": { id: "fpC/3", name: "Jo Park", honors: [{ season: 2031, award: "z" }],
				returned: [2031], seasons: [{ season: 2030 }, { season: 2031, school: "Iowa" }] },
			"fpD/1": { id: "fpD/1", name: "No Story", honors: [], returned: [2031],
				seasons: [{ season: 2030 }, { season: 2031, school: "Iowa" }] },
		};
		const th = U.comebackThreads(reg);
		ok("honours in two seasons of ONE registry entry is a comeback",
			th.some((t) => t.id === "fpA/7" && /2026 and 2029/.test(t.text)));
		ok("...and a namesake in another file is not joined to him",
			!th.some((t) => t.id === "fpB/7") && !th.some((t) => /2027/.test(t.text)));
		ok("an undrafted returner who was honoured is a comeback",
			th.some((t) => t.id === "fpC/3" && t.team === "Iowa"));
		ok("...one nobody honoured is not", !th.some((t) => t.id === "fpD/1"));
		ok("threads() includes them when handed a registry",
			U.threads([], [], { registry: reg }).some((t) => t.kind === "cameBack"));
	}

	/* --- digest, coaches, hot seat, weirdest ------------------------------ */
	{
		const d0 = U.digestStep({ Duke: { title: 2020 } }, { season: 2030,
			tourney: { champion: { team: { name: "Iowa" } },
				finalFour: [{ team: { name: "Iowa" } }, { team: { name: "Duke" } }] },
			players: [] });
		ok("the digest records the last title and Final Four and keeps the rest",
			d0.Iowa.title === 2030 && d0.Iowa.ff === 2030 && d0.Duke.title === 2020 &&
			d0.Duke.ff === 2030);
		const aged = U.ageCarry({ levels: {}, coaches: {}, digest: d0 }, 2);
		ok("the digest survives a gap", aged.digest.Iowa.title === 2030);

		const programs = {
			Iowa: [{ season: 1, coach: "Al", w: 20, l: 10, title: false },
				{ season: 2, coach: "Al", w: 30, l: 5, title: true },
				{ season: 3, coach: "Bo", w: 10, l: 20 }],
			Duke: [{ season: 1, coach: "Bo", w: 25, l: 5 }, { season: 2, coach: "Bo", w: 25, l: 6 }],
		};
		const cr = U.coachRecords(programs, { by: { Al: [{}, {}, {}] } });
		ok("coach records sum wins across schools",
			cr.wins[0].name === "Bo" && cr.wins[0].w === 60 && cr.wins[0].schools.length === 2);
		ok("...count titles and the tree",
			cr.titles[0].name === "Al" && cr.titles[0].titles === 1 && cr.trees[0].tree === 3);
		ok("...and the longest run at one school",
			cr.tenure.every((c) => c.tenure === 2) && cr.tenure.some((c) => c.name === "Bo" &&
				c.tenureAt.school === "Duke"));
		const hs = U.hotSeatPreview({ levels: { Kentucky: 30, "Tiny State": 30 },
			coaches: { Kentucky: { coach: { name: "Cal", tenure: 6 } },
				"Tiny State": { coach: { name: "Zed", tenure: 3 } } } }, null);
		ok("a blue blood far under its prestige is on the hot seat preview",
			hs.length >= 1 && hs[0].school === "Kentucky" && hs[0].coach === "Cal");
		ok("...a program at its own level is not", !hs.some((h) => h.school === "Tiny State"));
		const w = U.weirdestSeason([{ season: 1, strange: { score: 10, reasons: [] } },
			{ season: 2, strange: { score: 40, reasons: ["x"] } },
			{ season: 3, extrapolated: true, strange: { score: 90, reasons: [] } }, { season: 4 }]);
		ok("the weirdest season is the strangest played row", w && w.season === 2 && w.score === 40);
	}

	/* --- a real chain ----------------------------------------------------- */
	const files = (seasons) => seasons.map((season, i) => {
		const lf = V.realisticClass("hist" + i, 46);
		lf.startingSeason = season;
		for (const p of lf.players) p.draft = Object.assign({}, p.draft, { year: season });
		return { name: "class-" + season + ".json", data: lf, fingerprint: "hf" + season + "-" + i };
	});
	const spec = (fl, extra) => Object.assign({
		mode: "cold", files: fl,
		runnable: fl.map((f, i) => ({ index: i, name: f.name, season: f.data.startingSeason })),
		settings: CFG.make({ seed: "hist" }), baseSeed: "hist",
		make: (st) => CFG.make(st),
		runnerFor: (i) => ({ run: (cfg) => E.run(fl[i].data, cfg) }),
		extrapolateGaps: false, store: () => {},
	}, extra || {});
	const drive = (sp) => {
		const c = U.beginChain(sp);
		for (let k = 0; k < c.runnable.length; k++) c.step(k);
		c.finish({});
		return c.universe;
	};
	const fl = files([2025, 2026, 2027, 2028]);
	const a = drive(spec(fl));
	const b = drive(spec(fl));
	ok("every played row carries its strangeness",
		a.rows.every((r) => r.strange && Number.isFinite(r.strange.score)));
	ok("the records book has a weirdest season, coaches and a hot-seat list",
		a.records.weirdest && a.records.coaches && a.records.coaches.wins.length > 0 &&
		Array.isArray(a.records.hotSeat));
	ok("the carry has a program digest, handed to the news desk",
		a.tail.carry.digest && Object.keys(a.tail.carry.digest).length > 0 &&
		a.cfgs[3].universeDigest && Object.keys(a.cfgs[3].universeDigest).length > 0);
	ok("the digest a season sees is the one before it was played",
		!Object.keys(a.cfgs[0].universeDigest).length);
	ok("threads and records are deterministic",
		JSON.stringify(a.threads) === JSON.stringify(b.threads) &&
		JSON.stringify(a.records) === JSON.stringify(b.records));
	const resumed = drive(spec(fl, { mode: "resume", from: 2, universe: drive(spec(fl)),
		runnable: fl.slice(2).map((f, i) => ({ index: i + 2, name: f.name,
			season: f.data.startingSeason })) }));
	ok("a resume reproduces the rows, digest and records",
		JSON.stringify(resumed.rows) === JSON.stringify(a.rows) &&
		JSON.stringify(resumed.tail.carry.digest) === JSON.stringify(a.tail.carry.digest) &&
		JSON.stringify(resumed.records.weirdest) === JSON.stringify(a.records.weirdest) &&
		JSON.stringify(resumed.records.coaches) === JSON.stringify(a.records.coaches));
	const json = JSON.parse(JSON.stringify(U.exportUniverse(a)));
	const v = U.viewOnlyUniverse(json);
	ok("an export round-trips strangeness, the weirdest season, coaches and the digest",
		v.rows.every((r) => r.strange) &&
		JSON.stringify(v.records.weirdest) === JSON.stringify(a.records.weirdest) &&
		JSON.stringify(v.records.coaches) === JSON.stringify(a.records.coaches) &&
		JSON.stringify(v.tail.carry.digest) === JSON.stringify(a.tail.carry.digest));
	const noRec = U.viewOnlyUniverse(Object.assign({}, json, { records: null }));
	ok("...and a file without records re-derives the weirdest season and hot seat",
		JSON.stringify(noRec.records.weirdest) === JSON.stringify(a.records.weirdest) &&
		Array.isArray(noRec.records.hotSeat));
	ok("the timeline CSV carries strangeness",
		U.timelineTable(a.rows)[0].slice(-1)[0] === "strangeness" &&
		U.timelineTable(a.rows)[1].slice(-1)[0] === a.rows[0].strange.score);

	/* --- the drought stories ------------------------------------------- */
	{
		const res = E.run(V.realisticClass(3, 60), CFG.make({ seed: "drought" }));
		const season = res.leagueFile.startingSeason;
		const champ = res.tourney.champion.team.name;
		const plain = N.build(res).map((x) => x.kind + "|" + JSON.stringify(x.headline));
		const dg = {};
		dg[champ] = { title: season - 9, poy: season - 12, poyName: "Old Timer" };
		const ffOther = (res.tourney.finalFour || []).map((x) => x && x.team ? x.team.name : null)
			.filter((x) => x && x !== champ)[0];
		if (ffOther) dg[ffOther] = { ff: season - 10 };
		res.cfg = Object.assign({}, res.cfg, { universeDigest: dg });
		const arts = N.build(res);
		const t = arts.filter((x) => x.kind === "title drought ended")[0];
		const txt = (segs) => (segs || []).map((s) => s.v || "").join("");
		ok("a title after nine years is a drought story",
			t && /9/.test(txt(t.headline)) && /Old Timer/.test(txt(t.body)),
			t ? txt(t.headline) : arts.map((x) => x.kind).join(","));
		ok("a Final Four after ten years ends a Final Four drought",
			!ffOther || arts.some((x) => x.kind === "final four drought ended" &&
				/10-year/.test(txt(x.headline))));
		ok("...and the rest of the paper is unchanged (no draws spent)",
			JSON.stringify(arts.filter((x) => !/drought ended/.test(x.kind))
				.map((x) => x.kind + "|" + JSON.stringify(x.headline))) === JSON.stringify(plain));
		const res2 = E.run(V.realisticClass(3, 60), CFG.make({ seed: "drought" }));
		ok("a single class (no digest) writes no drought story",
			!N.build(res2).some((x) => /drought ended/.test(x.kind)));
		res2.cfg = Object.assign({}, res2.cfg, { universeDigest: { [champ]: { title: season - 2 } } });
		ok("...nor does a title two years after the last",
			!N.build(res2).some((x) => x.kind === "title drought ended"));
	}

	/* --- wiring (source checks; the UI smoke renders it) -------------------- */
	{
		const views = fs.readFileSync(path.join(__dirname, "..", "..", "js", "views.js"), "utf8");
		const app = fs.readFileSync(path.join(__dirname, "..", "..", "js", "app.js"), "utf8");
		ok("the rivalries table ranks through Universe.rivalryTable",
			/Universe\.rivalryTable\(riv/.test(views));
		ok("the records book draws the coaches and the hot seat",
			/function coachRecordsSection/.test(views) && /Hot seat preview/.test(views));
		ok("a rebuilt season gets its digest back", /cfg\.universeDigest = saved\.universeDigest/.test(app));
	}
};
