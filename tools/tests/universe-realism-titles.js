/* Universe model realism over twenty seasons (audit 2026-10-10, UV5/UV6).

   UV5  elite seasons and dynasties: a 20-season audit chain gave one
        program five titles, and unbeaten regular seasons ran at ~0.37 a
        season (real ~0.1). Titles held within the last eight seasons now
        tax a program's carried level and its recruiting pile-on (damDynasty
        in js/universe.js, assignCollege's momentum block in js/engine.js).
   UV6  seeding read records without the schedule behind them: a 28-3
        Southern Conference team drew a top-four seed and programs ranked
        >100 by level were 1 seeds. The committee score now credits its
        win-count terms by schedule strength (js/rankings.js).

   One 20-season synthetic chain, driven the way js/app.js drives it. */
"use strict";

module.exports = function (ok) {
	const E = global.Engine;
	const CFG = global.Config;
	const U = global.Universe;

	const seed = "s7audit";
	const n = 20;
	const files = U.synthFiles(seed, 2030, n);
	const runners = files.map((f) => E.createRunner(f.data));
	const seasons = [];
	const c = U.beginChain({
		mode: "cold", files,
		runnable: files.map((f, i) => ({ index: i, name: f.name, season: f.data.startingSeason })),
		settings: CFG.make({ seed }), baseSeed: seed, make: (s) => CFG.make(s),
		runnerFor: (i) => runners[i],
		dataChanged: (i) => { runners[i] = E.createRunner(files[i].data); },
		extrapolateGaps: false,
		store: (i, r) => {
			const ts = Object.values(r.teams);
			const rank = new Map(ts.slice().sort((a, b) => b.level - a.level)
				.map((t, k) => [t.name, k + 1]));
			const champ = ts.find((t) => t.ncaaResult === "National Champion");
			seasons.push({
				champ: champ ? champ.name : null,
				champRank: champ ? rank.get(champ.name) : null,
				ones: ts.filter((t) => t.ncaaSeed === 1).map((t) => rank.get(t.name)),
				lowTop: ts.filter((t) => t.ncaaSeed && t.ncaaSeed <= 4 && rank.get(t.name) > 100).length,
				unbeaten: ts.filter((t) => (Number.isFinite(t.regL) ? t.regL : t.l) === 0).length,
			});
		},
	});
	for (let k = 0; k < c.runnable.length; k++) c.step(k);
	c.finish({});

	ok("uv5/twenty seasons played", seasons.length === n && seasons.every((s) => s.champ),
		seasons.length + " seasons");
	const titles = {};
	for (const s of seasons) titles[s.champ] = (titles[s.champ] || 0) + 1;
	const most = Object.keys(titles).sort((a, b) => titles[b] - titles[a])[0];
	ok("uv5/no program wins more than four titles in twenty seasons", titles[most] <= 4,
		most + " won " + titles[most] + ": " + JSON.stringify(titles));
	let back = 0;
	for (let i = 2; i < seasons.length; i++) {
		if (seasons[i].champ === seasons[i - 1].champ && seasons[i].champ === seasons[i - 2].champ) back++;
	}
	ok("uv5/at most one three-peat in twenty seasons", back <= 1, back + " three-peats");
	const unbeaten = seasons.reduce((a, s) => a + s.unbeaten, 0) / n;
	ok("uv5/unbeaten regular seasons at most ~0.15 a season", unbeaten <= 0.15,
		unbeaten.toFixed(2) + " a season");
	const ones = seasons.flatMap((s) => s.ones);
	const deepOnes = ones.filter((r) => r > 100).length;
	ok("uv6/1 seeds ranked >100 by level are rare (<=5%)", deepOnes <= 0.05 * ones.length,
		deepOnes + " of " + ones.length + ": " + ones.join(","));
	const lowTop = seasons.reduce((a, s) => a + s.lowTop, 0) / n;
	ok("uv6/top-four seeds from programs ranked >100 by level <=0.6 a season", lowTop <= 0.6,
		lowTop.toFixed(2) + " a season");
	const champRanks = seasons.map((s) => s.champRank).sort((a, b) => a - b);
	const p90 = champRanks[Math.floor(0.9 * (champRanks.length - 1))];
	ok("uv6/champion level rank p90 <= 50", p90 <= 50, "p90 " + p90 + ": " + champRanks.join(","));
};
