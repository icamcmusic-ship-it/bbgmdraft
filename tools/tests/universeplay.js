/* Universe play (audit section 5, items 4, 5, 6, 8 and 10): following a
   program, the dynasty goal, the seeded pro career tail and its Hall of
   Fame, the IndexedDB save slots (source checks; the UI smoke drives them)
   and the per-season drawer. */
"use strict";

module.exports = function (ok, V) {
	const fs = require("fs");
	const path = require("path");
	const E = global.Engine;
	const CFG = global.Config;
	const U = global.Universe;

	/* A real two-season world to read. */
	const a = E.run(V.realisticClass(1, 60), CFG.make({ seed: "up-a" }));
	const b = E.run(V.realisticClass(2, 60), CFG.make({ seed: "up-b" }));
	const rows = [U.summarize(a, "u1", "a.json"), U.summarize(b, "u2", "b.json")];
	rows[0].season = 2025;
	rows[1].season = 2026;
	const programs = {};
	for (const [res, season] of [[a, 2025], [b, 2026]]) {
		const pr = U.programRowsOf(res, null);
		for (const n of Object.keys(pr)) {
			pr[n].season = season;
			(programs[n] = programs[n] || []).push(pr[n]);
		}
	}
	const u = { rows, programs, threads: U.threads(rows, []), order: [], cfgs: {} };
	const name = rows[0].champion;

	/* --- 4. follow a program ------------------------------------------- */
	{
		ok("a row mentions its champion", U.rowMentions(rows[0], name));
		ok("...and not a program it never names", !U.rowMentions(rows[0], "No Such U"));
		const c = U.followedCard(u, name, null);
		ok("the season-end card reads the latest season",
			c && c.season === 2026 && Number.isFinite(c.w) && Number.isFinite(c.l), JSON.stringify(c));
		ok("...with the level change and the coach",
			c && Number.isFinite(c.levelChange) && "coach" in c && typeof c.newCoach === "boolean");
		ok("...and counts its title", c && c.titles >= 1);
		ok("no program, no card", U.followedCard(u, null, null) === null &&
			U.followedCard(u, "No Such U", null) === null);
		const lead = U.followedLead(a, name);
		ok("the champion always has news", lead && lead.title && /national title/.test(lead.text));
		const plain = global.News.build(a);
		const led = global.News.build(a, { followed: name });
		ok("the paper leads with the followed program",
			led[0] && led[0].kind === "followed program" && led[0].lead, led[0] && led[0].kind);
		ok("...and nothing else in the feed moves",
			led.length === plain.length + 1 &&
			JSON.stringify(led.slice(1).map((x) => x.headline)) ===
				JSON.stringify(plain.map((x) => x.headline)));
		ok("a quiet program does not lead",
			U.followedLead(a, "No Such U") === null &&
			global.News.build(a, { followed: "No Such U" }).length === plain.length);
		const ex = U.exportUniverse(Object.assign({}, u, { followed: name,
			dynasty: { program: name, kind: "title", seasons: 3, budget: 2 } }));
		ok("the export carries the followed program and the goal",
			ex.followed === name && ex.dynasty && ex.dynasty.program === name);
		const view = U.viewOnlyUniverse(Object.assign({ timeline: rows }, ex));
		ok("...and a view-only import reads them back",
			view.followed === name && view.dynasty.kind === "title");
	}

	/* --- 5. dynasty goal ------------------------------------------------ */
	{
		const hist = [
			{ season: 2025, level: 40, title: false },
			{ season: 2026, level: 55, title: false },
			{ season: 2027, level: 72, title: true },
		];
		const lvl = (level, seasons, moved) => U.dynastyProgress(
			{ program: "X", kind: "level", level, seasons, budget: 2 }, hist, moved);
		ok("a level reached inside the window wins", lvl(70, 3, 0).status === "won" &&
			lvl(70, 3, 0).achievedAt === 2027);
		ok("...outside it fails", lvl(70, 2, 0).status === "failed");
		ok("...with seasons left it is in progress",
			U.dynastyProgress({ program: "X", kind: "level", level: 99, seasons: 5, budget: 2 },
				hist, 0).status === "in progress");
		ok("moving too many dials is over budget",
			lvl(70, 3, 3).status === "over budget" && lvl(70, 3, 3).overBudget === 1);
		ok("a title goal reads the title flag",
			U.dynastyProgress({ program: "X", kind: "title", seasons: 3 }, hist, 0).achievedAt === 2027 &&
			U.dynastyProgress({ program: "X", kind: "title", seasons: 2 }, hist, 0).status === "failed");
		ok("progress reports the best level and start",
			lvl(99, 3, 0).bestLevel === 72 && lvl(99, 3, 0).startLevel === 40);
		ok("no goal, no progress", U.dynastyProgress(null, hist, 0) === null);
		const low = U.lowPrestige(u, null, 5);
		ok("the picker suggests the weakest programs first",
			low.length === 5 && low[0].level <= low[4].level, JSON.stringify(low.slice(0, 2)));
		const real = U.dynastyProgress({ program: name, kind: "title", seasons: 2, budget: 1 },
			U.programHistory(u, name), 0);
		ok("a real program history scores", real && real.status === "won" && real.played === 2);
	}

	/* --- 6. pro career tail --------------------------------------------- */
	{
		const files = [{ fingerprint: "fpA" }, { fingerprint: "fpB" }];
		const reg = U.registryOf([a, b], files, rows);
		const ids = Object.keys(reg);
		const outs = ids.map((id) => U.proOutcome(reg[id])).filter(Boolean);
		ok("every drafted registry entry has a pro outcome", outs.length >= ids.length * 0.9,
			outs.length + " of " + ids.length);
		ok("...deterministic from the player id",
			ids.slice(0, 30).every((id) => JSON.stringify(U.proOutcome(reg[id])) ===
				JSON.stringify(U.proOutcome(JSON.parse(JSON.stringify(reg[id]))))));
		ok("...and different ids draw different careers",
			new Set(outs.map((o) => o.tier + o.years + "/" + o.allStars)).size >= 5);
		ok("All-Star counts never exceed years", outs.every((o) => o.allStars <= o.years));
		const hi = { id: "x/1", draft: { pot: 80, slot: 1 } };
		const lo = { id: "x/1", draft: { pot: 38, slot: null } };
		ok("pot sets the odds", U.proOutcome(hi).score > U.proOutcome(lo).score &&
			U.proOutcome(lo).tier === "bust");
		let stars = 0;
		let busts = 0;
		for (let i = 0; i < 200; i++) {
			if (U.proOutcome({ id: "hi/" + i, draft: { pot: 70, slot: 3 } }).star) stars++;
			if (U.proOutcome({ id: "lo/" + i, draft: { pot: 45, slot: 50 } }).bust) busts++;
		}
		ok("high pot mostly makes stars, low pot mostly busts", stars > 100 && busts > 60,
			stars + " stars, " + busts + " busts");
		ok("no pot, no outcome", U.proOutcome({ id: "q", draft: null }) === null);
		const rec = U.records(rows, [], reg);
		ok("the records book has a pro-weighted Hall of Fame",
			rec.proHall && rec.proHall.length === 10 &&
			rec.proHall.every((m, i) => !i || rec.proHall[i - 1].score >= m.score));
		ok("...in the records CSV", U.recordsTable(rec).some((r) => r[0] === "Pro-weighted Hall of Fame"));
		ok("the pro text reads", /All-Star/.test(U.proText({ tier: "star", years: 10, allStars: 3 })) &&
			U.proText(null) === "—");
	}

	/* --- 10. the season drawer ------------------------------------------ */
	{
		const du = Object.assign({}, u, {
			order: [{ index: 0, season: 2025 }, { index: 1, season: 2026 }],
			rows: rows.map((r, i) => Object.assign({}, r, { position: i })),
			cfgs: { 1: { seed: "u2", position: 1, settings: CFG.make({}), returners: [1, 2],
				pastRoster: [], universeAlumni: [{}], carryOver: { levels: { Duke: 90, Kansas: 85 },
					coaches: { Duke: {} }, titles: { Duke: 1 } } } },
			threads: [{ kind: "x", seasons: [2026], text: "a 2026 thread" },
				{ kind: "y", seasons: [2025], text: "not it" }, "old string"],
		});
		const d = U.seasonDetail(du, 1);
		ok("the drawer finds the season's config by file index",
			d && d.cfg && d.cfg.seed === "u2" && d.cfg.returners === 2);
		ok("...summarizes the carry", d.carry.programs === 2 && d.carry.topLevels[0].team === "Duke");
		ok("...and the threads touching that season",
			d.threads.length === 1 && d.threads[0].text === "a 2026 thread");
		const d0 = U.seasonDetail(du, 0);
		ok("a season without a snapshot still opens", d0 && d0.row && d0.cfg === null);
		ok("no row, no drawer", U.seasonDetail(du, 9) === null);
	}

	/* --- 8. IndexedDB slots and the app wiring (source checks) ---------- */
	{
		const app = fs.readFileSync(path.join(__dirname, "..", "..", "js", "app.js"), "utf8");
		ok("the universe saves to IndexedDB with named slots",
			/indexedDB\.open\(IDB_NAME/.test(app) && /UNIVERSE_SLOTS = 5/.test(app));
		ok("...every access guarded, falling back to null",
			/function idbOpen\(\)[\s\S]{0,900}catch \(e\) \{ resolve\(null\); \}/.test(app) &&
			/function idbRequest[\s\S]{0,600}catch \(e\) \{ resolve\(null\); \}/.test(app));
		ok("...the full universe, not the capped copy",
			/function universeFull\(\)[\s\S]{0,300}rows: u\.rows\.slice\(\)/.test(app));
		ok("...never autosaving before the full copy was read back",
			/if \(!autosaveReady \|\| idbOk === false\) return;/.test(app));
		ok("followed and the dynasty goal are persisted",
			/followed: u\.followed \|\| null,\n\t\t\tdynasty: u\.dynasty \|\| null/.test(app));
		ok("the dynasty budget uses the challenges' diff",
			/diffConfigs\(CFG\.make\(goal\.startCfg\), CFG\.make\(state\.cfg\)\)/.test(app));
		const views = fs.readFileSync(path.join(__dirname, "..", "..", "js", "views.js"), "utf8");
		ok("the paper is handed the followed program",
			/News\.build\(res, \{ followed \}\)/.test(views));
	}
};
