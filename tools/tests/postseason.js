/* The postseason honors, the bracket, the NET and the almanac's poll table
   (js/awards.js, js/tournament.js, js/rankings.js, js/almanac.js).

   Each check here pins a fault that shipped: a Final Four MOP from a team
   that lost its semifinal, an NIT MVP from a team that did not win the NIT,
   three "Player of the Year" winners at a loose strictness, trophies that
   vanished when their winner failed a gate, two top-four seeds from one
   league in one region, a NET that stopped iterating after four passes,
   and a pre-tournament poll printed beside post-tournament records. */
"use strict";

module.exports = function (ok, V) {
	const E = global.Engine;
	const C = global.Config;
	const A = global.Awards;
	const RK = global.Rankings;
	const TN = global.Tournament;

	const res = E.run(V.realisticClass("postseason", 60), C.make({ seed: "postseason" }));
	const loose = E.run(V.realisticClass("postseason", 60),
		C.make({ seed: "postseason", awardStrictness: 0.4, confAwardStrictness: 0.4 }));

	const holders = (r, award) => r.players.filter((p) => !p.nonNcaa &&
		(p.awards || []).indexOf(award) !== -1).map((p) => p.newCollege)
		.concat((r.fieldHonors || []).filter((f) => f.award === award).map((f) => f.school));

	/* ---- tournament honors -------------------------------------------- */
	for (const [label, r] of [["default", res], ["loose", loose]]) {
		const t = r.tourney;
		const mop = holders(r, "Final Four Most Outstanding Player");
		const finalists = [t.champion.team.name, t.runnerUp && t.runnerUp.team.name];
		ok("postseason/" + label + ": exactly one Final Four MOP, class or field",
			mop.length === 1, mop.join(", "));
		ok("postseason/" + label + ": the MOP played in the championship game",
			mop.length === 1 && finalists.indexOf(mop[0]) !== -1,
			mop.join(", ") + " vs " + finalists.join(" / "));
		if (t.nit && t.nit.champion) {
			const nit = holders(r, "NIT Most Valuable Player");
			ok("postseason/" + label + ": the NIT MVP is on the NIT champion",
				nit.length === 1 && nit[0] === t.nit.champion.name,
				nit.join(", ") + " vs " + t.nit.champion.name);
		}
	}

	/* ---- one-winner trophies stay one winner -------------------------- */
	{
		const ONE = /^(Naismith Trophy|John R\. Wooden Award|Oscar Robertson Trophy|AP Player of the Year|NABC Player of the Year|Sporting News Player of the Year|Naismith Defensive Player of the Year|NABC Defensive Player of the Year|Lefty Driesell Award|Wayman Tisdale Award|Pete Newell Big Man Award|Lute Olson Award|.* (Player|Freshman|Defensive Player) of the Year|.* Sixth Man of the Year|.* Most Improved Player)$/;
		for (const [label, r] of [["default", res], ["loose", loose]]) {
			const count = {};
			for (const p of r.players) {
				if (p.nonNcaa) continue;
				for (const a of p.awards || []) if (ONE.test(a)) count[a] = (count[a] || 0) + 1;
			}
			for (const f of r.fieldHonors || []) {
				if (ONE.test(f.award)) count[f.award] = (count[f.award] || 0) + 1;
			}
			const multi = Object.keys(count).filter((a) => count[a] > 1 &&
				!/^Consensus/.test(a));
			ok("postseason/" + label + ": no one-winner trophy has two winners",
				multi.length === 0, multi.map((a) => a + " x" + count[a]).join("; "));
		}
		// The six national trophies are always awarded to somebody.
		for (const a of ["Naismith Trophy", "John R. Wooden Award", "AP Player of the Year",
			"Naismith Defensive Player of the Year", "Wayman Tisdale Award"]) {
			ok("postseason/" + a + " is not vacated", holders(res, a).length === 1,
				holders(res, a).join(", "));
		}
	}

	/* ---- the games floor ---------------------------------------------- */
	{
		const team = { games: 35 };
		ok("postseason/eleven games of 35 is short of the floor",
			A.GATES.games({ stats: { gp: 11, mpg: 30 }, team }) === false);
		ok("postseason/thirty games of 35 clears it",
			A.GATES.games({ stats: { gp: 30, mpg: 30 }, team }) === true);
		ok("postseason/no team falls back to fifteen games",
			A.GATES.games({ stats: { gp: 15 } }) === true &&
			A.GATES.games({ stats: { gp: 14 } }) === false);
		const SEASON = /Player of the Year|All-American|All-.* (First|Second) Team$|Award$|Trophy$/;
		const short = res.players.filter((p) => {
			if (p.nonNcaa || !p.stats) return false;
			const t = res.teams[p.newCollege];
			if (!t) return false;
			return p.stats.gp < Math.ceil(0.6 * t.games) &&
				(p.awards || []).some((a) => SEASON.test(a) && !/Tournament|NIT|NCAA/.test(a));
		});
		ok("postseason/no season honor goes to a man who missed two fifths of the year",
			short.length === 0, short.map((p) => p.name).join(", "));
	}

	/* ---- the bracket -------------------------------------------------- */
	{
		const regions = res.tourney.regions;
		const topByConf = {};
		for (const r of Object.keys(regions)) {
			for (const x of regions[r].seeds) {
				if (x.seed <= 4) topByConf[x.team.conf] = (topByConf[x.team.conf] || 0) + 1;
			}
		}
		let bad = 0;
		let sameR64 = 0;
		for (const r of Object.keys(regions)) {
			const seen = {};
			for (const x of regions[r].seeds) {
				if (x.seed > 4) continue;
				if (seen[x.team.conf] && topByConf[x.team.conf] <= 4) bad++;
				seen[x.team.conf] = true;
			}
			for (const g of regions[r].rounds[0]) {
				if (g.a.team.conf && g.a.team.conf === g.b.team.conf) sameR64++;
			}
		}
		ok("postseason/a league's top-four seeds are in different regions", bad === 0, bad + "");
		ok("postseason/no first-round game between conference rivals", sameR64 === 0, sameR64 + "");
		// The balancer never makes a bracket worse and never changes a seed.
		const copy = {};
		for (const r of TN.REGIONS) copy[r] = regions[r].seeds.slice();
		const before = TN.bracketPenalty(copy);
		TN.balanceBracket(copy);
		ok("postseason/the published bracket is already balanced",
			TN.bracketPenalty(copy) === before, before + " -> " + TN.bracketPenalty(copy));
	}

	/* ---- the NET is solved, not sampled -------------------------------- */
	{
		const list = Object.values(res.teams);
		for (const t of list) t.regGamesList = t.log.filter((g) => g.stage === "reg");
		const e = RK.computeAdjEff(list, res.teams);
		let worst = 0;
		let mean = 0;
		for (const t of list) {
			mean += e.get(t.name);
			const games = t.regGamesList.filter((g) => Number.isFinite(g.teamPts));
			if (!games.length) continue;
			let sum = 0;
			for (const g of games) {
				const m = Math.max(-RK.MARGIN_CAP, Math.min(RK.MARGIN_CAP, g.teamPts - g.oppPts));
				sum += m - RK.HOME_EDGE * (g.home || 0) +
					(res.teams[g.opp] ? e.get(g.opp) : 0);
			}
			worst = Math.max(worst, Math.abs(sum / games.length - e.get(t.name)));
		}
		for (const t of list) delete t.regGamesList;
		mean /= list.length;
		ok("postseason/adjusted efficiency is mean-centered", Math.abs(mean) < 1e-6, mean + "");
		ok("postseason/adjusted efficiency is at its fixed point", worst < 0.01,
			worst.toFixed(4) + " after " + e.iterations + " passes");
	}

	/* ---- the almanac's poll table ------------------------------------- */
	{
		const md = global.Almanac.markdown(res, { sections: ["poll", "colophon"] });
		const header = md.split("\n").filter((l) => /^\| #/.test(l))[0] || "";
		const cols = header.split("|").map((c) => c.trim()).filter(Boolean);
		ok("postseason/the poll table has no two columns with one name",
			new Set(cols).size === cols.length, header);
		const champ = res.tourney.champion.team;
		const row = md.split("\n").filter((l) => l.indexOf("| " + champ.name + " |") !== -1)[0];
		if (row && champ.regSnapshot) {
			ok("postseason/the champion's poll record is the one it was voted on",
				row.indexOf(champ.regSnapshot.w + "-" + champ.regSnapshot.l) !== -1 &&
				row.indexOf(champ.w + "-" + champ.l) === -1, row);
		}
		ok("postseason/the settings table prints no null", !/\| null \|/.test(md));
	}
};
