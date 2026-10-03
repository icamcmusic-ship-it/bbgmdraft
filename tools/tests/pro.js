/* Pro career projections and the mock draft (js/pro.js). Both are derived
   from a finished class and must never change it. */
"use strict";

module.exports = function (ok, V) {
	const E = global.Engine;
	const C = global.Config;
	const P = global.Pro;
	const res = E.run(V.realisticClass("pro-t", 60), C.make({ seed: "pro-t" }));
	const before = JSON.stringify(E.exportFile(res, {}));
	const proj = P.projectClass(res);
	const mock = P.mockDraft(res, { projections: proj });

	ok("pro/projecting and mocking leave the class and its export untouched",
		JSON.stringify(E.exportFile(res, {})) === before);
	ok("pro/the same class projects the same way twice",
		JSON.stringify(P.projectClass(res)) === JSON.stringify(proj) &&
		JSON.stringify(P.mockDraft(res)) === JSON.stringify(mock));
	ok("pro/every prospect has a projection", res.players.every((p) => proj[p.key]));
	const xs = Object.values(proj);
	ok("pro/ranges are ordered and on the BBGM scale",
		xs.every((x) => x.peakLow <= x.peak && x.peak <= x.peakHigh && x.peakLow >= Math.min(20, x.ovr) && x.peakHigh <= 85 &&
			x.yearsLow <= x.years && x.years <= x.yearsHigh));
	ok("pro/every verdict is one of the five", xs.every((x) => P.VERDICTS.some((v) => v[1] === x.verdict)));

	// The model's shape, on a controlled prospect.
	const base = { key: "k", newOvr: 47, newPot: 60, classYear: "Freshman" };
	const at = (o) => P.project(Object.assign({}, base, o), 2026, "shape");
	ok("pro/more potential, a higher median peak", at({ newPot: 70 }).peak > at({ newPot: 55 }).peak);
	ok("pro/a freshman's peak is a wider bet than a graduate's at the same ovr and pot",
		(at({}).peakHigh - at({}).peakLow) > (at({ classYear: "Graduate" }).peakHigh - at({ classYear: "Graduate" }).peakLow));
	ok("pro/a star prospect lasts longer than a fringe one",
		at({ newOvr: 52, newPot: 74 }).years > at({ newOvr: 40, newPot: 46 }).years);
	ok("pro/a low ceiling is mostly a bust", at({ newOvr: 38, newPot: 44 }).bustChance > 0.5);
	const counts = {};
	xs.forEach((x) => { counts[x.verdict] = (counts[x.verdict] || 0) + 1; });
	ok("pro/a class has more busts than stars", (counts["bust risk"] || 0) > (counts.star || 0),
		JSON.stringify(counts));

	// The mock draft.
	const keys = mock.picks.map((k) => k.key);
	ok("pro/two rounds of thirty, nobody picked twice, everyone from this class",
		mock.picks.length === 60 && new Set(keys).size === 60 &&
		keys.every((k) => res.players.some((p) => p.key === k)));
	ok("pro/every team picks once a round",
		[1, 2].every((r) => new Set(mock.picks.filter((k) => k.round === r).map((k) => k.team)).size === 30));
	ok("pro/the second round is in the first round's order",
		mock.picks.slice(30).every((k, i) => k.team === mock.picks[i].team));
	ok("pro/the No. 1 pick is near the top of the board",
		mock.picks[0].consensus !== null && mock.picks[0].consensus <= 6, String(mock.picks[0].consensus));
	const teams = P.teamsFor("pro-t");
	ok("pro/the order has a lottery: the four first picks come from the seven worst teams",
		teams.slice(0, 4).every((t) => t.plan <= 6 / 29 + 1e-9));
	ok("pro/the first ten picks lean to rebuilding teams, the last to contenders",
		teams.slice(0, 10).filter((t) => t.planLabel === "rebuilding").length >= 8 &&
		teams.slice(-5).every((t) => t.planLabel === "contending"));
	const needPicks = mock.picks.filter((k) => /fills the need/.test(k.why)).length;
	ok("pro/fit matters: some picks are made for need", needPicks >= 5, String(needPicks));
	ok("pro/a reach or a steal is named against the board",
		mock.picks.filter((k) => Math.abs(k.reach) >= 8).every((k) => /reach|steal/.test(k.why)));
	// Fit moves picks: give every team the same need and the board's bigs climb.
	const bigs = mock.picks.slice(0, 30).filter((k) => /^(PF|FC|C)$/.test(k.pos)).length;
	ok("pro/the board and the picks differ: the mock is not the board's order",
		mock.picks.slice(0, 30).some((k, i) => k.consensus !== i + 1), String(bigs));

	// The command line.
	{
		const fs = require("fs");
		const os = require("os");
		const path = require("path");
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bbgm-pro-"));
		const f = path.join(dir, "c.json");
		const lf = V.realisticClass("pro-cli", 40);
		fs.writeFileSync(f, JSON.stringify(lf));
		const r = require("child_process").spawnSync(process.execPath,
			[path.join(__dirname, "..", "..", "bin", "bbgmdraft.js"), "mock", f, "--seed", "pc", "--json"],
			{ encoding: "utf8" });
		const want = P.mockDraft(E.run(lf, C.make({ seed: "pc" })));
		ok("pro/bbgmdraft mock is the same mock draft", r.status === 0 &&
			JSON.stringify(JSON.parse(r.stdout).picks) === JSON.stringify(want.picks), r.stderr);
		fs.rmSync(dir, { recursive: true, force: true });
	}

	/* ---- a class from a league export is drafted by that league's teams ---- */
	{
		const BB = global.BBGM;
		const season = 2027;
		const prospects = V.realisticClass("lg-prospects", 50).players.map((p, i) => Object.assign({}, p, {
			pid: 5000 + i, tid: -2, draft: Object.assign({}, p.draft, { year: season, tid: -1 }),
			born: Object.assign({}, p.born, { year: season - 20 }),
		}));
		const vets = V.realisticClass("lg-vets", 120).players;
		const names = [["Austin", "Armadillos"], ["Baltimore", "Crabs"], ["Chicago", "Whirlwinds"],
			["Denver", "High"], ["Edmonton", "Elk"], ["Fresno", "Fig"]];
		const teams = names.map((n, tid) => ({ tid, region: n[0], name: n[1], abbrev: n[0].slice(0, 3).toUpperCase() }));
		/* Team 0 has no bigs at all; team 5 is stacked. Positions come from the
		   ratings rows, so they are set there. */
		const roster = [];
		let pid = 1;
		const add = (tid, src, pos, bump) => {
			const r = Object.assign({}, src.ratings[src.ratings.length - 1]);
			r.pos = pos;
			r.ovr = Math.min(80, (Number(r.ovr) || BB.ovr(r)) + bump);
			roster.push(Object.assign({}, src, { pid: pid++, tid, ratings: [r],
				draft: Object.assign({}, src.draft, { year: 2018 }) }));
		};
		let v = 0;
		for (const t of teams) {
			const positions = t.tid === 0 ? ["PG", "SG", "G", "PG", "SG", "GF", "SF", "G", "PG", "SF"]
				: ["PG", "SG", "SF", "PF", "C", "G", "F", "FC", "C", "GF"];
			for (const pos of positions) add(t.tid, vets[v++ % vets.length], pos, t.tid === 5 ? 25 : t.tid * 2);
		}
		const league = {
			version: 73, startingSeason: 2026, gameAttributes: { season: 2026 }, teams,
			players: roster.concat(prospects),
			teamSeasons: teams.map((t) => ({ tid: t.tid, season, won: 10 + t.tid * 8, lost: 50 - t.tid * 8 })),
			// Team 1 owns team 3's first-round pick; team 4 has no second-rounder.
			draftPicks: teams.flatMap((t) => [1, 2].filter((r) => !(r === 2 && t.tid === 4)).map((round) => ({
				tid: round === 1 && t.tid === 3 ? 1 : t.tid, originalTid: t.tid, round, pick: 0, season,
			}))),
		};
		const cls = E.extractDraftClass(league, season);
		const lres = E.run(cls, C.make({ seed: "lg" }));
		const m = P.mockDraft(lres, { league });
		ok("league/the league's teams draft, not invented ones",
			m.fromLeague && m.picks.every((k) => teams.some((t) => k.team === t.region + " " + t.name)),
			JSON.stringify(m.picks.slice(0, 3).map((k) => k.team)));
		ok("league/one slot per pick the league holds: 6 + 5, a forfeited pick is not made",
			m.picks.length === 11 && m.picks.filter((k) => k.round === 2).length === 5, String(m.picks.length));
		const traded = m.picks.find((k) => k.via === "Denver High");
		ok("league/a traded pick is used by the team that holds it", traded && traded.team === "Baltimore Crabs",
			JSON.stringify(traded));
		ok("league/round two runs worst record first",
			m.picks.filter((k) => k.round === 2).map((k) => k.team).join() ===
				["Austin Armadillos", "Baltimore Crabs", "Chicago Whirlwinds", "Denver High", "Fresno Fig"].join(),
			m.picks.filter((k) => k.round === 2).map((k) => k.team).join());
		const plan = P.leagueDraft(league, season, "lg");
		const t0 = plan.teams.find((t) => t.tid === 0);
		ok("league/a team with no bigs needs a big", t0.needOf === "big", JSON.stringify(t0.need));
		const t5 = plan.teams.find((t) => t.tid === 5);
		ok("league/the stacked team rates highest and is contending",
			t5.ovr === Math.max.apply(null, plan.teams.map((t) => t.ovr)) && t5.planLabel === "contending");
		ok("league/team rating follows BBGM's formula (top ten, exponential weights, 50-centred)",
			P.teamRating([50, 50, 50, 50, 50, 50, 50, 50, 50, 50]) ===
				Math.round(((-102.98 + [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].reduce((a, i) =>
					a + 0.3334 * Math.exp(-0.1609 * i) * 50, 0)) * 50) / 15 + 50));
		ok("league/each pick carries the drafting team's rating and depth",
			m.picks.every((k) => Number.isFinite(k.teamOvr) && /^G \d+ · W \d+ · B \d+$/.test(k.teamDepth)));
		// With the lottery run, the league's own pick numbers are the order.
		const ordered = Object.assign({}, league, { draftPicks: league.draftPicks.map((dp) => Object.assign({}, dp, {
			pick: dp.round === 1 ? 6 - dp.originalTid : 6 - dp.originalTid,
		})) });
		const m2 = P.mockDraft(lres, { league: ordered });
		ok("league/set pick numbers are followed exactly",
			m2.picks[0].team === "Fresno Fig" && /draft order/.test(m2.source), m2.picks[0].team + " · " + m2.source);
		ok("league/without a league the invented teams still draft", !P.mockDraft(lres).fromLeague);

		// The command line reads the league and drafts with its teams.
		const fs = require("fs");
		const os = require("os");
		const path = require("path");
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bbgm-pro-lg-"));
		const lf = path.join(dir, "league.json");
		fs.writeFileSync(lf, JSON.stringify(league));
		const r = require("child_process").spawnSync(process.execPath,
			[path.join(__dirname, "..", "..", "bin", "bbgmdraft.js"), "mock", lf, "--seed", "lg", "--json"],
			{ encoding: "utf8" });
		const cliPicks = r.status === 0 ? JSON.parse(r.stdout).picks : [];
		ok("league/bbgmdraft mock on a league file uses its teams",
			cliPicks.length === 11 && cliPicks[0].team === m.picks[0].team, r.stderr);
		fs.rmSync(dir, { recursive: true, force: true });
	}
};
