/* Postseason honours, awarded from the simulated stat lines, team results and
   the strength of the league the player did it in. */
(function (global) {
	"use strict";

	const { clamp } = global.BBGMRng;
	const C = global.Colleges;

	function productionScore(p) {
		const s = p.stats;
		return (
			s.ppg + 1.2 * s.rpg + 1.7 * s.apg + 2.6 * s.spg + 2.6 * s.bpg -
			0.8 * s.topg + 55 * (s.ts - 0.52)
		);
	}

	function defenseScore(p, comps) {
		const s = p.stats;
		return 2.6 * s.spg + 3.4 * s.bpg + 0.45 * s.rpg + 26 * (comps.defense - 0.45);
	}

	const NCAA_BONUS = {
		"National Champion": 9, "National Runner-Up": 7, "Lost in the Final Four": 6,
		"Lost in the Elite Eight": 4.5, "Lost in the Sweet 16": 3,
		"Lost in the Round of 32": 1.5, "Lost in the Round of 64": 0.8, "Lost in the First Four": 0.2,
	};

	function resumeScore(p, team) {
		if (!team) return 0;
		const conf = C.CONFERENCES[team.conf];
		// Deliberately a minority of the total: winning helps a candidacy, it
		// does not manufacture one out of 4 points a game.
		return (
			0.18 * team.w +
			0.18 * (conf.strength - 58) +
			0.6 * (NCAA_BONUS[team.ncaaResult] || 0) +
			(team.apRank ? (26 - team.apRank) * 0.10 : 0)
		);
	}

	function assign(prospects, teams, tourney, cfg, rng) {
		const strict = clamp(cfg.awardStrictness, 0.2, 3);
		const ncaa = prospects.filter((p) => !p.leaguePro);
		const pros = prospects.filter((p) => p.leaguePro);

		for (const p of ncaa) {
			const team = teams[p.newCollege];
			p.awards = [];
			p.scoreProd = productionScore(p);
			p.scoreDef = defenseScore(p, global.BBGM.composites(p.newRatings));
			p.scoreResume = resumeScore(p, team);
			p.scoreTotal = p.scoreProd + p.scoreResume + rng.normal(0, 1.4);
			p.scoreDefTotal = p.scoreDef + p.scoreResume * 0.5 + rng.normal(0, 1.2);
		}

		const ranked = ncaa.slice().sort((a, b) => b.scoreTotal - a.scoreTotal);

		// --- conference honours -------------------------------------------
		const byConf = {};
		for (const p of ncaa) {
			const t = teams[p.newCollege];
			if (!t) continue;
			(byConf[t.conf] = byConf[t.conf] || []).push(p);
		}
		for (const conf of Object.keys(byConf)) {
			const list = byConf[conf].sort((a, b) => b.scoreTotal - a.scoreTotal);
			const cs = C.CONFERENCES[conf].strength;
			// Bar a prospect must clear to beat the (unmodelled) upperclassmen.
			const bar = (24 + 0.30 * (cs - 50)) * strict;
			const firstTeamBar = bar - 6 * strict;
			const secondTeamBar = bar - 11 * strict;

			list.forEach((p, i) => {
				if (p.scoreProd < 14) return; // never honour a bit-part player
				if (i === 0 && p.scoreTotal > bar + 4) p.awards.push(conf + " Player of the Year");
				if (p.scoreTotal > firstTeamBar && p.awards.length < 3 && i < 5) {
					p.awards.push("All-" + conf + " First Team");
				} else if (p.scoreTotal > secondTeamBar && i < 10) {
					p.awards.push("All-" + conf + " Second Team");
				}
				if (p.classYear === "Freshman" && i === 0 && p.scoreTotal > secondTeamBar) {
					p.awards.push(conf + " Freshman of the Year");
				}
			});
			const def = list.slice().sort((a, b) => b.scoreDefTotal - a.scoreDefTotal)[0];
			if (def && def.scoreDefTotal > (18 + 0.22 * (cs - 50)) * strict) {
				def.awards.push(conf + " Defensive Player of the Year");
			}
		}

		// --- national honours ---------------------------------------------
		const natBar = 46 * strict;
		ranked.forEach((p, i) => {
			if (p.scoreProd < 18) return;
			if (i === 0 && p.scoreTotal > natBar) p.awards.unshift("National Player of the Year");
			if (i < 5 && p.scoreTotal > natBar - 5 * strict) p.awards.push("Consensus First Team All-American");
			else if (i < 10 && p.scoreTotal > natBar - 11 * strict) p.awards.push("Consensus Second Team All-American");
			else if (i < 15 && p.scoreTotal > natBar - 16 * strict) p.awards.push("Third Team All-American");
		});
		const natDef = ncaa.slice().sort((a, b) => b.scoreDefTotal - a.scoreDefTotal)[0];
		if (natDef && natDef.scoreDefTotal > 34 * strict) {
			natDef.awards.push("National Defensive Player of the Year");
		}
		const freshmen = ranked.filter((p) => p.classYear === "Freshman");
		if (freshmen[0] && freshmen[0].scoreTotal > natBar - 14 * strict) {
			freshmen[0].awards.push("National Freshman of the Year");
		}
		freshmen.slice(0, 5).forEach((p) => {
			if (p.scoreTotal > natBar - 20 * strict) p.awards.push("All-Freshman Team");
		});

		// --- tournament honours --------------------------------------------
		const ffNames = new Set(tourney.finalFour.map((x) => x.team.name));
		const inFF = ncaa.filter((p) => ffNames.has(p.newCollege))
			.sort((a, b) => b.scoreProd - a.scoreProd);
		const champName = tourney.champion.team.name;
		const mop = inFF.filter((p) => p.newCollege === champName)[0] || inFF[0];
		if (mop) mop.awards.push("Final Four Most Outstanding Player");
		inFF.slice(0, 5).forEach((p) => {
			if (p !== mop) p.awards.push("NCAA All-Tournament Team");
		});
		for (const p of ncaa) {
			const t = teams[p.newCollege];
			if (!t || !t.confTourneyChamp) continue;
			const mates = ncaa.filter((q) => q.newCollege === t.name)
				.sort((a, b) => b.scoreProd - a.scoreProd);
			if (mates[0] === p) p.awards.push(t.conf + " Tournament MVP");
		}

		// --- pro league honours ---------------------------------------------
		const PRO_AWARDS = {
			"EuroLeague": ["EuroLeague Rising Star", "EuroLeague Best Young Player", "All-EuroLeague Second Team"],
			"NBA G League": ["G League Rookie of the Year", "All-G League First Team", "G League Next Up Award"],
			"NBL": ["NBL Next Generation Award", "NBL Rookie of the Year", "All-NBL Second Team"],
			"DII NCAA": ["Division II Player of the Year", "Division II All-American", "Division II Freshman of the Year"],
		};
		const byLeague = {};
		for (const p of pros) {
			p.awards = [];
			p.scoreProd = productionScore(p);
			p.scoreTotal = p.scoreProd + rng.normal(0, 1.5);
			(byLeague[p.newCollege] = byLeague[p.newCollege] || []).push(p);
		}
		for (const lg of Object.keys(byLeague)) {
			const list = byLeague[lg].sort((a, b) => b.scoreTotal - a.scoreTotal);
			const names = PRO_AWARDS[lg] || [];
			const bar = lg === "DII NCAA" ? 24 * strict : 20 * strict;
			list.forEach((p, i) => {
				if (i < names.length && p.scoreTotal > bar) p.awards.push(names[i]);
			});
		}

		return ranked;
	}

	global.Awards = { assign, productionScore, defenseScore };
})(window);
