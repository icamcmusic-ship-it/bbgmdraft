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
};
