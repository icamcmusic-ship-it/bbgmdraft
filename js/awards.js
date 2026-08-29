/* Postseason honours, awarded from the simulated stat lines, team results and
   the strength of the league the player did it in.

   The central problem this file has to solve: a 70-man draft class shares
   Division I with about 4,000 players nobody here models. Ranking prospects
   only against each other handed out fixed quotas by array index — every class
   contained the National Player of the Year and all five Consensus First
   Teamers, 80 awards a year across 51% of the class. So the unseen field is
   modelled explicitly: every filler on every roster gets a comparable score,
   and a prospect has to finish ahead of them to be honoured. */
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
		const conf = C.CONFERENCES[team.conf] || C.CONFERENCES.Independent;
		// Deliberately a minority of the total: winning helps a candidacy, it
		// does not manufacture one out of 4 points a game.
		return (
			0.18 * team.w +
			0.18 * (conf.strength - 58) +
			0.6 * (NCAA_BONUS[team.ncaaResult] || 0) +
			(team.apRank ? (26 - team.apRank) * 0.10 : 0) +
			(team.confRegularChamp ? 1.2 : 0)
		);
	}

	/* Least-squares fit of production score against college talent, taken from
	   the prospects in this very class. That gives a calibrated way to score
	   the ~2,800 returning players on the same scale without simulating a stat
	   line for each of them. */
	function fitTalentToScore(ncaa, teams) {
		const xs = [];
		const ys = [];
		for (const p of ncaa) {
			const t = teams[p.newCollege];
			if (!t || !p.stats) continue;
			const m = t.members.filter((x) => !x.filler && x.player === p)[0];
			if (!m) continue;
			xs.push(m.talent);
			ys.push(p.scoreProd);
		}
		if (xs.length < 4) return { a: -22, b: 0.62, sd: 6 };
		const n = xs.length;
		const mx = xs.reduce((a, b) => a + b, 0) / n;
		const my = ys.reduce((a, b) => a + b, 0) / n;
		let sxy = 0;
		let sxx = 0;
		for (let i = 0; i < n; i++) {
			sxy += (xs[i] - mx) * (ys[i] - my);
			sxx += (xs[i] - mx) * (xs[i] - mx);
		}
		const b = sxx > 0 ? sxy / sxx : 0.62;
		const a = my - b * mx;
		let ss = 0;
		for (let i = 0; i < n; i++) {
			const e = ys[i] - (a + b * xs[i]);
			ss += e * e;
		}
		return { a, b, sd: Math.max(2, Math.sqrt(ss / n)) };
	}

	/* Every returning player in Division I, scored on the prospects' scale.
	   These are the players a prospect actually has to beat for an
	   All-American slot. */
	function buildField(teams, fit, rng) {
		const field = [];
		for (const name of Object.keys(teams)) {
			const t = teams[name];
			const trng = rng.child("field|" + name);
			const resume = resumeScore(null, t);
			// Only rotation players are candidates for anything.
			const rotation = t.members.filter((m) => m.filler)
				.sort((a, b) => b.talent - a.talent)
				.slice(0, 7);
			rotation.forEach((m, i) => {
				const prod = fit.a + fit.b * m.talent + trng.normal(0, fit.sd);
				// A team's alpha carries the usage (and so the counting stats)
				// that award voters see; the fifth starter does not, and the
				// bench does not win awards however talented.
				const minutesFactor = [1.14, 1.02, 0.94, 0.88, 0.84][i] || 0.5;
				field.push({
					filler: true,
					name: t.name + " returner " + (i + 1),
					conf: t.conf,
					team: t,
					// Returning players are mostly upperclassmen — that is what
					// makes them returning players.
					isFreshman: trng.random() < 0.22,
					scoreProd: prod * minutesFactor,
					scoreTotal: prod * minutesFactor + resume + trng.normal(0, 1.4),
					scoreDefTotal: prod * minutesFactor * 0.42 + resume * 0.5 +
						trng.normal(0, 2.6),
				});
			});
		}
		return field;
	}

	function assign(prospects, teams, tourney, cfg, rng) {
		const strict = clamp(cfg.awardStrictness, 0.2, 3);
		// DII NCAA has pro: false, so splitting on leaguePro put DII players in
		// the D-I pool — they could and did win Consensus All-American, while
		// the DII award list was unreachable dead code. Split on nonNcaa.
		const ncaa = prospects.filter((p) => !p.nonNcaa);
		const pros = prospects.filter((p) => p.nonNcaa);

		for (const p of ncaa) {
			const team = teams[p.newCollege];
			p.awards = [];
			p.scoreProd = productionScore(p);
			p.scoreDef = defenseScore(p, global.BBGM.composites(p.newRatings));
			p.scoreResume = resumeScore(p, team);
			p.scoreTotal = p.scoreProd + p.scoreResume + rng.normal(0, 1.4);
			p.scoreDefTotal = p.scoreDef + p.scoreResume * 0.5 + rng.normal(0, 1.2);
			p.isFreshman = p.classYear === "Freshman";
			p.conf = team ? team.conf : "Independent";
			p.team = team;
		}

		// The rest of Division I, scored on the same scale.
		const fit = fitTalentToScore(ncaa, teams);
		const field = buildField(teams, fit, rng.child("field"));
		const everyone = ncaa.concat(field);

		// awardStrictness now shifts how far into the field the honours reach:
		// 1.0 = the real slot counts, higher = fewer slots, lower = more.
		const slots = (n) => Math.max(1, Math.round(n / strict));

		const label = (conf) =>
			// "All-American First Team" (the AAC) would read as a national
			// honour and collide with Consensus All-America; special-case it.
			(conf === "American" ? "AAC" : conf);

		// --- conference honours -------------------------------------------
		const byConf = {};
		for (const x of everyone) {
			if (!x.conf) continue;
			(byConf[x.conf] = byConf[x.conf] || []).push(x);
		}
		for (const conf of Object.keys(byConf)) {
			const list = byConf[conf].slice().sort((a, b) => b.scoreTotal - a.scoreTotal);
			const lb = label(conf);
			const give = (x, award) => {
				if (x.filler || !x.awards) return;
				// Never honour a bit-part player, however the maths ranked him.
				if (x.stats && (x.stats.mpg < 20 || x.scoreProd < 12)) return;
				x.awards.push(award);
			};
			list.slice(0, slots(1)).forEach((x) => give(x, lb + " Player of the Year"));
			list.slice(0, slots(5)).forEach((x, i) => {
				give(x, "All-" + lb + " " + (i < slots(5) / 2 ? "First" : "Second") + " Team");
			});
			const fresh = list.filter((x) => x.isFreshman);
			fresh.slice(0, slots(1)).forEach((x) => give(x, lb + " Freshman of the Year"));
			const def = byConf[conf].slice().sort((a, b) => b.scoreDefTotal - a.scoreDefTotal);
			def.slice(0, slots(1)).forEach((x) => give(x, lb + " Defensive Player of the Year"));
		}

		// --- national honours ---------------------------------------------
		const ranked = ncaa.slice().sort((a, b) => b.scoreTotal - a.scoreTotal);
		const nation = everyone.slice().sort((a, b) => b.scoreTotal - a.scoreTotal);
		const giveNat = (x, award, unshift) => {
			if (x.filler || !x.awards) return;
			if (x.stats && x.stats.mpg < 20) return;
			if (unshift) x.awards.unshift(award);
			else x.awards.push(award);
		};
		nation.slice(0, slots(1)).forEach((x) => giveNat(x, "National Player of the Year", true));
		nation.slice(0, slots(5)).forEach((x) => giveNat(x, "Consensus First Team All-American"));
		nation.slice(slots(5), slots(10)).forEach((x) => giveNat(x, "Consensus Second Team All-American"));
		nation.slice(slots(10), slots(15)).forEach((x) => giveNat(x, "Third Team All-American"));

		const natDef = everyone.slice().sort((a, b) => b.scoreDefTotal - a.scoreDefTotal);
		natDef.slice(0, slots(1)).forEach((x) =>
			giveNat(x, "National Defensive Player of the Year"));

		const freshmen = nation.filter((x) => x.isFreshman);
		freshmen.slice(0, slots(1)).forEach((x) => giveNat(x, "National Freshman of the Year"));
		freshmen.slice(0, slots(5)).forEach((x) => giveNat(x, "All-Freshman Team"));

		// --- tournament honours --------------------------------------------
		const ffNames = new Set(tourney.finalFour.map((x) => x.team.name));
		const inFF = ncaa.filter((p) => ffNames.has(p.newCollege))
			.sort((a, b) => b.scoreProd - a.scoreProd);
		const champName = tourney.champion.team.name;
		// The Most Outstanding Player is a Final Four team's best player — but
		// on a Final Four roster of 10, the prospect is usually not it.
		const mopField = [];
		for (const nm of ffNames) {
			const t = teams[nm];
			if (!t) continue;
			const frng = rng.child("mop|" + nm);
			for (const m of t.members.filter((x) => x.filler).slice(0, 5)) {
				mopField.push({ filler: true, score: fit.a + fit.b * m.talent + frng.normal(0, fit.sd) });
			}
		}
		const mopAll = inFF.map((p) => ({ p, score: p.scoreProd + (p.newCollege === champName ? 3 : 0) }))
			.concat(mopField.map((f) => ({ p: null, score: f.score })))
			.sort((a, b) => b.score - a.score);
		const mop = mopAll[0] && mopAll[0].p ? mopAll[0].p : null;
		if (mop) mop.awards.push("Final Four Most Outstanding Player");
		mopAll.slice(0, 5).forEach((x) => {
			if (x.p && x.p !== mop) x.p.awards.push("NCAA All-Tournament Team");
		});

		for (const p of ncaa) {
			const t = teams[p.newCollege];
			if (!t || !t.confTourneyChamp) continue;
			const mates = ncaa.filter((q) => q.newCollege === t.name)
				.sort((a, b) => b.scoreProd - a.scoreProd);
			// The MVP of a conference tournament is on the winning team, but he
			// is only this prospect if the prospect outplayed the returners.
			const bestReturner = t.members.filter((m) => m.filler)
				.reduce((a, m) => Math.max(a, fit.a + fit.b * m.talent), -Infinity);
			if (mates[0] === p && p.stats.mpg >= 20 && p.scoreProd > bestReturner) {
				p.awards.push(label(t.conf) + " Tournament MVP");
			}
		}

		// --- pro / DII league honours ---------------------------------------
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
			// A club that finished top of its league helps a case; a prospect
			// buried on a relegation side has to score his way out.
			const club = p.proTeam;
			const standing = club && club.standing
				? (10 - club.standing) * 0.35 + club.w * 0.10
				: 0;
			p.scoreTotal = p.scoreProd + standing + rng.normal(0, 1.5);
			(byLeague[p.newCollege] = byLeague[p.newCollege] || []).push(p);
		}
		for (const lg of Object.keys(byLeague)) {
			const list = byLeague[lg].sort((a, b) => b.scoreTotal - a.scoreTotal);
			const names = PRO_AWARDS[lg] || [];
			// These are age-restricted or rookie awards, so a prospect really
			// can win one — but he still has to be the best of the ones here.
			const bar = (lg === "DII NCAA" ? 24 : 20) * strict;
			list.forEach((p, i) => {
				if (i < names.length && p.scoreTotal > bar && p.stats && p.stats.mpg >= 18) {
					p.awards.push(names[i]);
				}
			});
		}

		return ranked;
	}

	global.Awards = { assign, productionScore, defenseScore, buildField, fitTalentToScore };
})(window);
