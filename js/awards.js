/* Postseason honors, awarded from the simulated stat lines, team results and
   the strength of the league the player did it in.

   The central problem this file has to solve: a 70-man draft class shares
   Division I with about 4,000 players nobody here models. Ranking prospects
   only against each other handed out fixed quotas by array index — every class
   contained the National Player of the Year and all five Consensus First
   Teamers, 80 awards a year across 51% of the class. So the unseen field is
   modeled explicitly: every filler on every roster gets a comparable score,
   and a prospect has to finish ahead of them to be honored.

   The award list itself used to be eighteen strings, three of them generic
   ("National Player of the Year", "National Defensive Player of the Year") and
   six conference-templated. A real college season hands out well over a
   hundred distinguishable honors, and — more importantly — the defensive ones
   had almost nothing to rank on, because defense was two counting stats and a
   composite. Both halves are fixed here: the defensive score reads a real
   defensive box score (contested shots, deflections, charges, defensive
   rating), and the honors it feeds are the ones that actually exist. */
(function (global) {
	"use strict";

	const { clamp } = global.BBGMRng;
	const C = global.Colleges;
	const T = global.TeamsSim;

	/* A production resume, normalized for PACE.

	   The counting half of this is raw per-game volume, and PROGRAM_STYLES
	   moves a team's possessions by +/-5.5 a game — so a run-and-gun program
	   handed its best player about 8% more of everything than a pack-line
	   program did, for nothing he had done. This score is what the award model
	   and the draft board rank on, so that was a systematic tilt of the whole
	   honors list towards fast schools.

	   The counting terms are scaled to a reference tempo and the rate term
	   (true shooting) is left alone, because a percentage is already
	   pace-free. A player whose team's pace is unknown is scored as if he
	   played at the reference, which is what the old formula did for
	   everybody. */
	const REF_PACE = 68;
	function productionScore(p) {
		const s = p.stats;
		const pace = Number.isFinite(p.teamPace) && p.teamPace > 40 ? p.teamPace : REF_PACE;
		const k = REF_PACE / pace;
		return (
			(s.ppg + 1.2 * s.rpg + 1.7 * s.apg + 2.6 * s.spg + 2.6 * s.bpg -
				0.8 * s.topg) * k +
			55 * (s.ts - 0.52)
		);
	}

	/* A defensive resume, not an offensive one wearing a hat.

	   The old version was 2.6*spg + 3.4*bpg + 0.45*rpg + 26*(defense - .45):
	   two counting stats a low-usage perimeter stopper does not accumulate, and
	   one composite. Contested shots, deflections and charges are the plays
	   that make up the rest of a real defensive record, and defensive rating
	   folds in what happened while he was on the floor. */
	function defenseScore(p, comps) {
		const s = p.stats;
		const events =
			2.4 * s.spg + 3.0 * s.bpg + 0.40 * s.drpg +
			0.55 * (s.cspg || 0) + 0.90 * (s.deflpg || 0) + 1.60 * (s.chgpg || 0);
		const skill =
			14 * (comps.defense - 0.45) +
			7 * (comps.defenseInterior - 0.46) +
			7 * (comps.defensePerimeter - 0.46);
		const impact = Number.isFinite(s.drtg) ? 0.30 * (104 - s.drtg) : 0;
		// Fouling your way through a game is not defense.
		return events + skill + impact - 0.5 * Math.max(0, s.pfpg - 2.6);
	}

	const NCAA_BONUS = {
		"National Champion": 9, "National Runner-Up": 7, "Lost in the Final Four": 6,
		"Lost in the Elite Eight": 4.5, "Lost in the Sweet 16": 3,
		"Lost in the Round of 32": 1.5, "Lost in the Round of 64": 0.8, "Lost in the First Four": 0.2,
	};
	const NIT_BONUS = {
		"NIT Champion": 1.6, "Lost in the NIT Championship": 1.2,
		"Lost in the NIT Semifinal": 0.9, "Lost in the NIT Quarterfinal": 0.6,
		"Lost in the NIT Second Round": 0.3, "Lost in the NIT First Round": 0.1,
	};

	/* Team-side contribution to an award case. The first parameter used to be a
	   `p` that the body never read — buildField passed null and it worked, but
	   it was a trap for the next person to add a `p.` reference. It is gone. */
	function resumeScore(team) {
		if (!team) return 0;
		const conf = C.CONFERENCES[team.conf] || C.CONFERENCES.Independent;
		/* THIS SEASON's conference strength, not the constant in the table.
		   The season drifts conference strength (see conferenceDrift in
		   js/teams.js) and stores it on the team; reading the static value
		   here meant that in a year the Mountain West was up, its players'
		   resumes did not know. */
		const confStrength = Number.isFinite(team.confStrength)
			? team.confStrength : conf.strength;
		// Deliberately a minority of the total: winning helps a candidacy, it
		// does not manufacture one out of 4 points a game. team.w now includes
		// postseason wins, which is the point — a March run should be worth
		// something on a resume.
		return (
			0.18 * team.w +
			0.18 * (confStrength - 58) +
			0.6 * (NCAA_BONUS[team.ncaaResult] || 0) +
			(NIT_BONUS[team.nitResult] || 0) +
			(team.apRank ? (26 - team.apRank) * 0.10 : 0) +
			(team.confRegularChamp ? 1.2 : 0)
		);
	}

	/* Ordinary least squares of a score against college talent.

	   This used to be the whole basis of the unseen field: fit prospect
	   production against talent, then extrapolate the line down to every
	   returning player in the country. Two things were wrong with that. The
	   fit was estimated over prospects only — a talent range of roughly 65-85 —
	   and extrapolated to talent 20, where a straight line predicts that a
	   low-major's leading scorer produces nothing; and with fewer than four
	   prospects it fell back to hardcoded constants, so a five-player class
	   scored the entire D-I field off a pair of magic numbers and awards became
	   arbitrary.

	   Every program is now simulated, so the field is made of real stat lines
	   (see buildField) and no extrapolation is needed. The fit survives for one
	   job: measuring how far a player's production sits from what a player of
	   his talent typically produces, which is the "most improved" proxy. It is
	   estimated on the field itself, which spans the whole talent range. */
	const FIT_PRIOR = { a: -22, b: 0.62, sd: 6 };

	function fitScores(points, prior) {
		const pr = prior || FIT_PRIOR;
		const n = points.length;
		if (!n) return Object.assign({}, pr);
		let mx = 0;
		let my = 0;
		for (const pt of points) { mx += pt.x; my += pt.y; }
		mx /= n;
		my /= n;
		let sxy = 0;
		let sxx = 0;
		for (const pt of points) {
			sxy += (pt.x - mx) * (pt.y - my);
			sxx += (pt.x - mx) * (pt.x - mx);
		}
		// Shrink toward the prior by sample size, so the fit degrades smoothly
		// from "one data point" to "two thousand" instead of falling off a
		// cliff into constants.
		const trust = n / (n + 4);
		const b = trust * (sxx > 1e-9 ? sxy / sxx : pr.b) + (1 - trust) * pr.b;
		const a = trust * (my - b * mx) + (1 - trust) * pr.a;
		let ss = 0;
		for (const pt of points) {
			const e = pt.y - (a + b * pt.x);
			ss += e * e;
		}
		return { a, b, sd: Math.max(2, trust * Math.sqrt(ss / n) + (1 - trust) * pr.sd) };
	}

	/* Backwards-compatible wrapper. */
	function fitTalentToScore(ncaa, teams, key, prior) {
		const points = [];
		for (const p of ncaa) {
			const t = teams[p.newCollege];
			if (!t || !p.stats || !Number.isFinite(p[key])) continue;
			const m = t.members.filter((x) => !x.filler && x.player === p)[0];
			if (!m) continue;
			points.push({ x: m.talent, y: p[key] });
		}
		return fitScores(points, prior);
	}

	/* Positions, so the five position-specific national awards have a field to
	   beat. Roughly the real D-I rotation split. */
	const FILLER_POS = [
		["PG", 0.17], ["G", 0.08], ["SG", 0.16], ["GF", 0.09], ["SF", 0.14],
		["F", 0.08], ["PF", 0.13], ["FC", 0.06], ["C", 0.09],
	];
	function rollPos(rng) {
		let x = rng.random();
		for (const [pos, w] of FILLER_POS) {
			x -= w;
			if (x <= 0) return pos;
		}
		return "F";
	}

	/* Every returning player in Division I, scored on exactly the scale the
	   prospects are scored on, because his season was simulated by exactly the
	   same model. These are the players a prospect actually has to beat for an
	   All-America slot.

	   Team totals, the possession identity, minutes and usage allocation, the
	   defensive box score — the fillers went through all of it already, and the
	   lines were being thrown away. */
	function buildField(teams, rng, noise) {
		// Defaulted, because buildField is exported and a caller that predates
		// the dial should get what it always got.
		const noiseScale = Number.isFinite(noise) ? noise : 1;
		const field = [];
		for (const name of Object.keys(teams)) {
			const t = teams[name];
			if (!t.fieldPlayers || !t.fieldPlayers.length) continue;
			const trng = rng.child("field|" + name);
			const resume = resumeScore(t);
			for (const fp of t.fieldPlayers) {
				if (fp.mpg < 8) continue;
				const stats = fp.line;
				const holder = { stats, teamPace: t.pace };
				const prod = productionScore(holder);
				// A returner's defensive composites are not stored, so the
				// composite half of the defensive score is approximated from
				// his defensive event rates, which are.
				const def = fieldDefenseScore(stats);
				field.push({
					filler: true,
					key: fp.key || null,
					// His own name, when the roster gave him one (it does now);
					// the slot label survives as a fallback for old callers.
					name: fp.name || (t.name + " returner " + (fp.rotationIndex + 1)),
					school: t.name,
					classYear: fp.classYear || null,
					starReturner: fp.starReturner || null,
					conf: t.conf,
					team: t,
					stats,
					pos: rollPos(trng),
					// Returning players are mostly upperclassmen — that is what
					// makes them returning players.
					isFreshman: trng.random() < 0.22,
					isNewcomer: trng.random() < 0.30,
					isReserve: fp.rotationIndex >= 5,
					talent: fp.talent,
					// A bench player who was a rotation player last year is the
					// most-improved archetype; so is a sophomore leap.
					improvement: trng.normal(0, 1),
					scoreProd: prod,
					scoreDef: def,
					/* The same scale the prospects' own scoreTotal uses. It was
					   a constant here, so at awardNoise 0 the prospects were
					   deterministic and the FIELD they are ranked against — every
					   returning rotation player in Division I, which is what
					   decides an All-America slot — was still randomized. Half a
					   deterministic comparison is not one. */
					scoreTotal: prod + resume + trng.normal(0, 1.4 * noiseScale),
					scoreDefTotal: def + resume * 0.35 + trng.normal(0, 1.2 * noiseScale),
				});
			}
		}
		return field;
	}

	/* The defensive score for a player whose rating vector does not exist. The
	   composite terms of defenseScore() are re-derived from the event rates the
	   stat model produced, on the same scale. */
	function fieldDefenseScore(s) {
		const perMin = (v) => (s.mpg > 0 ? (v * 40) / s.mpg : 0);
		const events =
			2.4 * s.spg + 3.0 * s.bpg + 0.40 * s.drpg +
			0.55 * (s.cspg || 0) + 0.90 * (s.deflpg || 0) + 1.60 * (s.chgpg || 0);
		// Contest and deflection rates per 40 carry the same information the
		// defenseInterior / defensePerimeter composites carry for a prospect.
		const skill =
			1.05 * (perMin(s.cspg || 0) - 8.4) +
			1.30 * (perMin(s.deflpg || 0) - 2.6);
		const impact = Number.isFinite(s.drtg) ? 0.30 * (104 - s.drtg) : 0;
		return events + skill + impact - 0.5 * Math.max(0, s.pfpg - 2.6);
	}

	/* --------------------------------------------------------------- awards */

	/* The named national player-of-the-year awards. Six real trophies with six
	   different electorates: usually the same player sweeps, occasionally they
	   split, which is exactly what happens in real seasons. `sd` is how much
	   that electorate diverges from consensus. */
	/* `resume` is the electorate's own weighting of what the player's TEAM did,
	   over and above what scoreTotal already carries.

	   The six trophies diverged only by how noisy each electorate was, so a
	   split was a coin flip and never an argument: nothing in the model was the
	   voter who gives it to the best player on the best team, and that voter
	   decides real player-of-the-year races. The NABC is coaches and the
	   Sporting News panel is broadcasters, both of whom watch teams; the AP is
	   writers covering a beat and is the closest of the six to a box score.
	   A positive `resume` reweights that electorate's ballot toward the
	   resume; a negative one is the voter who does not care who won. */
	const NATIONAL_POY = [
		{ name: "Naismith Trophy", sd: 1.1, resume: 0.10 },
		{ name: "John R. Wooden Award", sd: 1.2, resume: 0.15 },
		{ name: "Oscar Robertson Trophy", sd: 1.5, resume: 0.05 },
		{ name: "AP Player of the Year", sd: 1.0, resume: -0.10 },
		{ name: "NABC Player of the Year", sd: 1.4, resume: 0.35 },
		{ name: "Sporting News Player of the Year", sd: 1.6, resume: 0.30 },
	];
	const NATIONAL_DPOY = [
		{ name: "Naismith Defensive Player of the Year", sd: 1.4 },
		{ name: "NABC Defensive Player of the Year", sd: 1.6 },
		{ name: "Lefty Driesell Award", sd: 1.9 },
	];
	/* The five position awards. Highest-value addition in the whole list: the
	   position is already computed, they scale with class composition on their
	   own, and "Bob Cousy Award finalist" says far more about a prospect than
	   "All-Big Ten First Team". */
	const POSITION_AWARDS = [
		{ name: "Bob Cousy Award", label: "best point guard", pos: ["PG", "G"] },
		{ name: "Jerry West Award", label: "best shooting guard", pos: ["SG", "G"] },
		{ name: "Julius Erving Award", label: "best small forward", pos: ["SF", "GF"] },
		{ name: "Tim Duncan Award", label: "best power forward", pos: ["PF", "F"] },
		{ name: "Kareem Abdul-Jabbar Award", label: "best center", pos: ["C", "FC"] },
	];

	/* How much an honor is worth on a scouting note, so a résumé reads
	   "Naismith Trophy; Consensus First Team All-American; All-Big Ten First
	   Team" and not whatever order the code happened to run in. Lower sorts
	   first. There are ninety-odd distinguishable honors now; without an
	   ordering, the good ones get buried. */
	const AWARD_TIERS = [
		[/^Consensus National Player of the Year/, 0],
		[/^(Naismith Trophy|John R\. Wooden Award|Oscar Robertson Trophy|AP Player of the Year|NABC Player of the Year|Sporting News Player of the Year)$/, 1],
		[/^(Naismith Defensive|NABC Defensive|Lefty Driesell)/, 2],
		[/^(Bob Cousy|Jerry West|Julius Erving|Tim Duncan|Kareem Abdul-Jabbar|Pete Newell|Lute Olson|Wayman Tisdale) Award$/, 3],
		[/^Consensus First Team All-American$/, 4],
		[/^Consensus Second Team All-American$/, 5],
		[/^Third Team All-American$/, 6],
		[/^NABC All-Defensive First Team$/, 7],
		[/^NABC All-Defensive Second Team$/, 8],
		[/^All-Freshman Team$/, 9],
		[/^Final Four Most Outstanding Player$/, 10],
		[/^NCAA National Champion$/, 10.5],
		[/^NCAA National Runner-Up$/, 11.5],
		[/All-Region Team$/, 11],
		[/^NCAA All-Tournament Team$/, 12],
		[/Player of the Year$/, 13],
		[/Defensive Player of the Year$/, 14],
		[/Freshman of the Year$/, 15],
		[/Sixth Man of the Year$/, 16],
		[/Most Improved Player$/, 17],
		[/ First Team$/, 18],
		[/ Second Team$/, 19],
		[/Tournament MVP$/, 20],
		/* The professional leagues' own honors, which had no tier and so
		   sorted alphabetically: "ACB Best Young Player" ahead of "ACB MVP". */
		[/ Finals MVP$/, 20],
		[/ (Champion|Cup Winner)$/, 20.5],
		[/Regular-Season Champion$/, 20.6],
		[/ MVP$/, 13],
		[/(Rising Star|Best Young Player|Rookie of the Year|Next Up Award|Next Generation Award|Youth Player of the Year)$/, 15],
		[/Defensive Team$/, 21],
		[/Freshman Team$/, 22],
		[/Newcomer Team$/, 23],
		[/Tournament Team$/, 24],
		[/^NIT /, 25],
		[/^Academic All-American$/, 26],
	];
	function awardRank(name) {
		for (const [re, rank] of AWARD_TIERS) if (re.test(name)) return rank;
		return 30;
	}
	function sortAwards(list) {
		return list.slice().sort((a, b) => awardRank(a) - awardRank(b) || a.localeCompare(b));
	}

	/* Who is eligible for which kind of honor.

	   These are separate predicates on purpose. Every conference honor used to
	   run through ONE gate — `mpg < 20 || scoreProd < 12` — including Defensive
	   Player of the Year, and scoreProd is an offensive box score
	   (ppg + 1.2*rpg + 1.7*apg + 2.6*spg + 2.6*bpg - 0.8*tov + 55*(ts-.52)).
	   A genuine low-usage perimeter stopper — 5 points, 3 rebounds, 1.6 steals
	   — scores about 11 on it and was disqualified from a DEFENSIVE award by
	   his scoring. Meanwhile the national DPOY used a minutes-only gate, so the
	   two were not even consistent with each other.

	   Exported so the behavior is testable directly rather than inferred from
	   whoever happened to win. */
	const GATES = {
		offensive: (x) => !x.stats || (x.stats.mpg >= 20 && x.scoreProd >= 12),
		// Minutes, plus a DEFENSIVE record. Never an offensive one.
		defensive: (x) => !x.stats ||
			(x.stats.mpg >= 20 && (x.scoreDef === undefined || x.scoreDef >= 9)),
		// A reserve award has to be won by a reserve.
		reserve: (x) => !x.stats || (x.stats.mpg >= 12 && x.stats.mpg <= 27),
	};

	/* Where a prospect's season places him against the rest of Division I.

	   The defensive box score — contested shots, deflections, charges,
	   defensive rating — is generated, displayed, and never contextualized.
	   2.4 deflections a game is a number; "second in the country in
	   deflections" is a scouting report, and the difference between them is a
	   sort the model was already in a position to do: `field` is every
	   returning rotation player in D-I, simulated through the same stat model,
	   which is exactly the population a national rank is against. The award
	   model ranked prospects against it to hand out trophies and then threw the
	   ordering away.

	   Both scopes, because they answer different questions: leading your
	   conference in blocks says what you were on your own floor, and top-ten
	   nationally says whether that meant anything. Ranks are only kept when
	   they are worth saying — a national rank outside the top fifty and a
	   conference rank outside the top ten tell nobody anything, and storing
	   them would put "217th in charges drawn" in a scouting note.

	   `low: true` marks a statistic where the small number is the good one. */
	const RANKED_STATS = [
		{ key: "ppg", label: "scoring" },
		{ key: "rpg", label: "rebounding" },
		{ key: "apg", label: "assists" },
		{ key: "bpg", label: "blocks" },
		{ key: "spg", label: "steals" },
		{ key: "deflpg", label: "deflections" },
		{ key: "cspg", label: "contested shots" },
		{ key: "chgpg", label: "charges drawn" },
		{ key: "drtg", label: "defensive rating", low: true },
		{ key: "ts", label: "true shooting" },
	];
	const RANK_NATIONAL_MAX = 50;
	const RANK_CONF_MAX = 10;
	// Below this a rate statistic is not a season, it is a sample.
	const RANK_MIN_MPG = 15;

	function rankAgainstField(prospects, everyone) {
		const eligible = everyone.filter((x) =>
			x.stats && Number.isFinite(x.stats.mpg) && x.stats.mpg >= RANK_MIN_MPG);
		const byConf = {};
		for (const x of eligible) {
			if (!x.conf) continue;
			(byConf[x.conf] = byConf[x.conf] || []).push(x);
		}
		for (const p of prospects) p.statRanks = {};
		for (const stat of RANKED_STATS) {
			const cmp = (a, b) => (stat.low
				? a.stats[stat.key] - b.stats[stat.key]
				: b.stats[stat.key] - a.stats[stat.key]);
			const national = eligible.slice()
				.filter((x) => Number.isFinite(x.stats[stat.key])).sort(cmp);
			national.forEach((x, i) => {
				if (!x.statRanks || i >= RANK_NATIONAL_MAX) return;
				x.statRanks[stat.key] = Object.assign({}, x.statRanks[stat.key],
					{ national: i + 1, nationalOf: national.length, label: stat.label });
			});
			for (const conf of Object.keys(byConf)) {
				const list = byConf[conf].slice()
					.filter((x) => Number.isFinite(x.stats[stat.key])).sort(cmp);
				list.forEach((x, i) => {
					if (!x.statRanks || i >= RANK_CONF_MAX) return;
					x.statRanks[stat.key] = Object.assign({}, x.statRanks[stat.key],
						{ conf: i + 1, confOf: list.length, confName: conf,
							label: stat.label });
				});
			}
		}
	}

	/* The one or two rank facts worth putting in a note, newest-first by how
	   impressive they are: leading the country, then leading a conference,
	   then a top-ten national finish. */
	function rankHighlights(p, max) {
		const ranks = p.statRanks;
		if (!ranks) return [];
		const out = [];
		for (const key of Object.keys(ranks)) {
			const r = ranks[key];
			if (!r) continue;
			if (r.national === 1) out.push({ score: 100, text: "led the country in " + r.label });
			else if (r.conf === 1) {
				out.push({ score: 80, text: "led the " + r.confName + " in " + r.label });
			} else if (r.national <= 10) {
				out.push({ score: 70 - r.national,
					text: ordinal(r.national) + " nationally in " + r.label });
			} else if (r.conf <= 3) {
				out.push({ score: 40 - r.conf,
					text: ordinal(r.conf) + " in the " + r.confName + " in " + r.label });
			}
		}
		out.sort((a, b) => b.score - a.score);
		return out.slice(0, max || 2).map((x) => x.text);
	}

	function ordinal(n) {
		const v = n % 100;
		if (v >= 11 && v <= 13) return n + "th";
		return n + (["th", "st", "nd", "rd"][n % 10] || "th");
	}

	/* HONORS FOR THE SEASONS BEFORE THIS ONE.

	   A prospect who stayed three years finished with exactly the honors of
	   his draft year, because only the draft year was ranked against a
	   field. His sophomore season was simulated — a stat line, a rotation, a
	   program level — and then nothing asked whether it was an all-conference
	   season, so a two-time all-conference pick was not a thing the tool
	   could produce and a one-and-done and a fourth-year senior finished
	   with the same number of lines under "Honors".

	   There is no field for an earlier year (the season was not played
	   across 364 programs), so an earlier season is measured against THIS
	   season's bars: the score of the last man named to each honor is what a
	   prior line has to reach. A conference all-first-team season last year
	   is one that would have made the first team this year, which is the
	   only yardstick that exists and a fair one — the field does not change
	   shape much from one year to the next. The résumé half of the score is
	   the program's record that year (the drawn schedule carries one) and its
	   conference's strength; the March half is unknown and left out, so an
	   earlier season is if anything held to a slightly higher bar.

	   Honors go onto `p.priorAwards` as {season, classYear, award} — never
	   into `p.awards`, which is the draft year and is what every count, band
	   and export scope was written against — and `p.awards` stays the draft
	   year's list. The export writes them as rows at their own seasons. */
	function priorHonors(ncaa, teams, confBars, natBars, rng, noiseScale) {
		const has = (v) => Number.isFinite(v);
		for (const p of ncaa) {
			p.priorAwards = [];
			if (!Array.isArray(p.priorSeasons)) continue;
			for (const row of p.priorSeasons) {
				if (row.redshirt || !row.simulated || !row.line) continue;
				const L = row.line;
				// The same gates the draft year applies: a bit-part season is
				// not an all-conference one however the maths ranked it.
				if (!(L.mpg >= 20)) continue;
				const prod = productionScore({ stats: L, teamPace: p.teamPace });
				if (prod < 12) continue;
				const team = teams[row.team] || teams[p.newCollege];
				const conf = team ? team.conf : null;
				const cmeta = conf ? (C.CONFERENCES[conf] || C.CONFERENCES.Independent) : null;
				const confStrength = team && Number.isFinite(team.confStrength)
					? team.confStrength : (cmeta ? cmeta.strength : 60);
				const wins = row.record && Number.isFinite(row.record.w) ? row.record.w : 16;
				const resume = 0.18 * wins + 0.18 * (confStrength - 58);
				const r = rng.child(p.key + "|" + row.season);
				const score = prod + resume + r.normal(0, 1.4 * noiseScale);
				const def = fieldDefenseScore(L) + resume * 0.35 + r.normal(0, 1.2 * noiseScale);
				const fresh = row.classYear === "Freshman";
				const out = [];
				const bars = conf && confBars[conf] && teams[row.team] ? confBars[conf] : null;
				if (bars) {
					const lb = bars.label;
					if (has(bars.poy) && score >= bars.poy) out.push(lb + " Player of the Year");
					if (has(bars.first) && score >= bars.first) out.push("All-" + lb + " First Team");
					else if (has(bars.second) && score >= bars.second) out.push("All-" + lb + " Second Team");
					if (fresh) {
						if (has(bars.froy) && score >= bars.froy) out.push(lb + " Freshman of the Year");
						if (has(bars.allFresh) && score >= bars.allFresh) out.push("All-" + lb + " Freshman Team");
					}
					if (has(bars.dpoy) && def >= bars.dpoy && def >= 9) out.push(lb + " Defensive Player of the Year");
					else if (has(bars.allDef) && def >= bars.allDef && def >= 9) out.push("All-" + lb + " Defensive Team");
				}
				if (has(natBars.aa1) && score >= natBars.aa1) out.push("Consensus First Team All-American");
				else if (has(natBars.aa2) && score >= natBars.aa2) out.push("Consensus Second Team All-American");
				else if (has(natBars.aa3) && score >= natBars.aa3) out.push("Third Team All-American");
				if (fresh) {
					if (has(natBars.tisdale) && score >= natBars.tisdale) out.push("Wayman Tisdale Award");
					if (has(natBars.allFresh) && score >= natBars.allFresh) out.push("All-Freshman Team");
				}
				if (has(natBars.allDef1) && def >= natBars.allDef1 && def >= 9) {
					out.push("NABC All-Defensive First Team");
				}
				row.awards = sortAwards(out);
				for (const award of row.awards) {
					p.priorAwards.push({ season: row.season, classYear: row.classYear, award });
				}
			}
		}
	}

	function assign(prospects, teams, tourney, cfg, rng) {
		const strict = clamp(cfg.awardStrictness, 0.2, 3);
		// Conference hardware is its own dial. 32 conferences hand out far more
		// of it than the national voters do, and wanting a realistic number of
		// one was never a reason to get fewer of the other — but one slider
		// used to drive both, plus the pro-league score bar on top.
		const confStrict = clamp(
			cfg.confAwardStrictness === undefined ? strict : cfg.confAwardStrictness, 0.2, 3);
		const proStrict = clamp(
			cfg.proAwardStrictness === undefined ? strict : cfg.proAwardStrictness, 0.2, 3);
		/* How much the voters disagree with the arithmetic. The model already
		   carried a fixed amount of this; it was not adjustable and there was
		   no way to ask for the year where the award list is exactly what the
		   numbers say, or for the year with a genuine snub in it. */
		const noiseScale = clamp(
			cfg.awardNoise === undefined ? 1 : cfg.awardNoise, 0, 3);
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
			p.scoreResume = resumeScore(team);
			p.scoreTotal = p.scoreProd + p.scoreResume + rng.normal(0, 1.4 * noiseScale);
			p.scoreDefTotal = p.scoreDef + p.scoreResume * 0.35 + rng.normal(0, 1.2 * noiseScale);
			p.isFreshman = p.classYear === "Freshman";
			p.isNewcomer = p.isFreshman || !!p.transfer;
			p.isReserve = p.minutesRank !== undefined && p.minutesRank >= 5;
			p.pos = p.newPos;
			p.conf = team ? team.conf : "Independent";
			p.team = team;
		}

		// The rest of Division I, from its own simulated seasons.
		const field = buildField(teams, rng.child("field"), noiseScale);
		/* "Improvement" against what a player of this talent typically
		   produces: there is no previous season to compare with, so
		   outperforming your own baseline is the proxy, and it is the same
		   thing voters actually reward. The fit is estimated on the field,
		   which spans the whole talent range — the old version fitted it on
		   prospects alone and extrapolated. */
		const fit = fitScores(field.map((f) => ({ x: f.talent, y: f.scoreProd })));
		for (const x of field) {
			x.improvement = (x.scoreProd - (fit.a + fit.b * x.talent)) / Math.max(1, fit.sd);
		}
		for (const p of ncaa) {
			const team = teams[p.newCollege];
			const m = team && team.members.filter((x) => !x.filler && x.player === p)[0];
			p.improvement = m
				? (p.scoreProd - (fit.a + fit.b * m.talent)) / Math.max(1, fit.sd)
				: 0;
		}
		const everyone = ncaa.concat(field);
		rankAgainstField(ncaa, everyone);
		// A candidate pool for any honor that needs a comparable score for a
		// player on one particular team.
		const fieldByTeam = {};
		for (const x of field) (fieldByTeam[x.team.name] = fieldByTeam[x.team.name] || []).push(x);

		// awardStrictness shifts how far into the field the honors reach:
		// 1.0 = the real slot counts, higher = fewer slots, lower = more.
		const slots = (n) => Math.max(1, Math.round(n / strict));
		const confSlots = (n) => Math.max(1, Math.round(n / confStrict));

		const label = T.label;

		/* --- conference honors ------------------------------------------- */
		const confBars = {};
		const byConf = {};
		for (const x of everyone) {
			if (!x.conf) continue;
			(byConf[x.conf] = byConf[x.conf] || []).push(x);
		}
		for (const conf of Object.keys(byConf)) {
			const pool = byConf[conf];
			const list = pool.slice().sort((a, b) => b.scoreTotal - a.scoreTotal);
			const lb = label(conf);
			// Offensive honors: a bit-part player never wins one however the
			// maths ranked him.
			const give = (x, award) => {
				if (x.filler || !x.awards) return;
				if (!GATES.offensive(x)) return;
				x.awards.push(award);
			};
			/* Defensive honors get their OWN gate. The shared one required
			   scoreProd >= 12 — an offensive box score — so a genuine
			   low-usage perimeter stopper (5 points, 3 rebounds, 1.6 steals)
			   scored about 11 and was disqualified from Defensive Player of the
			   Year by his scoring. The national DPOY meanwhile used a
			   minutes-only gate, so the two were not even consistent with each
			   other. Minutes only, both places, now. */
			const giveDef = (x, award) => {
				if (x.filler || !x.awards) return;
				if (!GATES.defensive(x)) return;
				x.awards.push(award);
			};
			// A reserve award has to be won by a reserve.
			const giveReserve = (x, award) => {
				if (x.filler || !x.awards) return;
				if (!GATES.reserve(x)) return;
				x.awards.push(award);
			};

			list.slice(0, confSlots(1)).forEach((x) => give(x, lb + " Player of the Year"));
			/* Two teams of five, like the real thing. The old code took one
			   slice of 5 and split it with `i < slots(5) / 2`, i.e. i < 2.5, so
			   the First Team had three players and the Second Team had two —
			   measured 19.0 First Team selections per class against 4.3 Second.
			   Two explicit slices, matching how the national teams are done. */
			const firstN = confSlots(5);
			list.slice(0, firstN).forEach((x) => give(x, "All-" + lb + " First Team"));
			list.slice(firstN, firstN + confSlots(5))
				.forEach((x) => give(x, "All-" + lb + " Second Team"));

			const fresh = list.filter((x) => x.isFreshman);
			fresh.slice(0, confSlots(1)).forEach((x) => give(x, lb + " Freshman of the Year"));
			fresh.slice(0, confSlots(5)).forEach((x) => give(x, "All-" + lb + " Freshman Team"));

			// Newcomer here means "arrived from another program". Freshmen
			// have their own team; naming them on both is double-counting the
			// same five players.
			const newcomers = list.filter((x) => x.isNewcomer && !x.isFreshman);
			newcomers.slice(0, confSlots(5))
				.forEach((x) => give(x, "All-" + lb + " Newcomer Team"));

			const reserves = list.filter((x) => x.isReserve);
			reserves.slice(0, confSlots(1))
				.forEach((x) => giveReserve(x, lb + " Sixth Man of the Year"));

			const improved = pool.slice()
				.sort((a, b) => (b.improvement || 0) - (a.improvement || 0))
				.filter((x) => !x.isFreshman);
			improved.slice(0, confSlots(1))
				.forEach((x) => give(x, lb + " Most Improved Player"));

			const def = pool.slice().sort((a, b) => b.scoreDefTotal - a.scoreDefTotal);
			def.slice(0, confSlots(1))
				.forEach((x) => giveDef(x, lb + " Defensive Player of the Year"));
			// Thirty-one conferences name an all-defensive team and the sim
			// named none of them.
			def.slice(0, confSlots(5))
				.forEach((x) => giveDef(x, "All-" + lb + " Defensive Team"));
			/* The bar each honor cleared this season, for the earlier
			   seasons (see priorHonors below): the score of the last man
			   named is what an earlier year has to match. */
			const at = (arr, n) => (arr[Math.min(arr.length, n) - 1] || {});
			confBars[conf] = {
				label: lb,
				poy: at(list, 1).scoreTotal,
				first: at(list, firstN).scoreTotal,
				second: at(list, firstN + confSlots(5)).scoreTotal,
				froy: at(fresh, 1).scoreTotal,
				allFresh: at(fresh, confSlots(5)).scoreTotal,
				dpoy: at(def, 1).scoreDefTotal,
				allDef: at(def, confSlots(5)).scoreDefTotal,
			};
		}

		/* --- national honors ---------------------------------------------- */
		const ranked = ncaa.slice().sort((a, b) => b.scoreTotal - a.scoreTotal);
		const nation = everyone.slice().sort((a, b) => b.scoreTotal - a.scoreTotal);
		/* Honors that went to the field rather than the class. A returning
		   player who beats every prospect to a trophy used to take the slot
		   and vanish — the award was simply not handed out. He has a name
		   now, so it is a result: "the class lost the POY race to a senior
		   at Houston" is a fact about the class. */
		const fieldHonors = [];
		const giveNat = (x, award, unshift) => {
			if (x.filler || !x.awards) {
				if (x.filler && x.name) {
					fieldHonors.push({
						award,
						name: x.name,
						key: x.key || null,
						school: x.school || (x.team ? x.team.name : null),
						classYear: x.classYear || null,
						starReturner: x.starReturner || null,
					});
				}
				return;
			}
			if (x.stats && x.stats.mpg < 20) return;
			if (unshift) x.awards.unshift(award);
			else x.awards.push(award);
		};

		/* Six real trophies, six electorates. A clear best player sweeps; a
		   close year splits, which is how "consensus" ends up meaning
		   something. Only a sweep gets the consensus label. */
		const poyWins = new Map();
		const top = nation.slice(0, Math.max(6, slots(8)));
		/* THE BALLOTS.

		   Six trophies, six electorates, and the model computed a full ordered
		   ballot for each of them and then kept only the name at the top. In a
		   split year — which is the interesting year, and the reason the six
		   electorates exist at all — a reader could see that two men won three
		   trophies each and had no way to see how close any of the six was.
		   Kept, top five per trophy, so the Awards tab can show the vote. */
		const ballotRows = [];
		/* This season's mood. Some years the whole electorate is arguing about
		   the best player and some years it is arguing about the best team, and
		   an electorate whose lean is a constant produces the same argument
		   every season. Drawn once per class, so it is a fact about the year:
		   at 0 the trophies are decided on the box score alone and at the top
		   of the range a 26-win one seed's leading scorer beats a better player
		   on a 19-win team. */
		/* Scaled as a whole, base included. The 0.55 sat OUTSIDE the multiply,
		   so at awardNoise 0 the resume lean was still 0.55x its full strength
		   and the two electorates that weight the resume most (the coaches' and
		   the broadcasters', at 0.35 and 0.30) still split away from the other
		   four — measured, 1 of 30 classes at noise 0, and it was those two
		   every time, which is the signature of this rather than of noise. Both
		   the slider caption and Config.DEFAULTS promise that 0 hands every
		   trophy to whoever the production model ranks first. */
		const mood = (0.55 + rng.child("voters").uniform(-0.55, 1.15)) * noiseScale;
		for (const award of NATIONAL_POY) {
			const vrng = rng.child("poy|" + award.name);
			const lean = (award.resume || 0) * mood;
			/* One noise draw PER CANDIDATE, stored, then sorted on the stored
			   key. The draw used to live inside the comparator, so every
			   pairwise comparison redrew the voter noise: the "ordering" was
			   not transitive, the number of RNG draws consumed depended on the
			   sort algorithm's internals, and the realized variance was not
			   the authored sd — at high noise the winner was a shuffle, not a
			   sampled electorate. */
			const ballots = top.map((x) => ({
				x,
				score: x.scoreTotal + lean * (x.scoreResume || 0) +
					vrng.normal(0, award.sd * noiseScale),
			}));
			ballots.sort((a, b) => b.score - a.score);
			const winner = ballots.length ? ballots[0].x : null;
			if (!winner) continue;
			/* Scores are on an arbitrary internal scale, so the ballot is
			   reported as a MARGIN from the winner: "0.4 behind" is a fact a
			   reader can use and "score 41.7" is not. */
			ballotRows.push({
				award: award.name,
				resumeLean: Number((lean).toFixed(3)),
				top: ballots.slice(0, 5).map((b, i) => ({
					rank: i + 1,
					name: b.x.name,
					key: b.x.key || null,
					school: b.x.school || (b.x.team ? b.x.team.name : null),
					// `filler` is what buildField stamps on a returning player.
					inClass: !b.x.filler,
					behind: Number((ballots[0].score - b.score).toFixed(2)),
				})),
			});
			giveNat(winner, award.name);
			poyWins.set(winner, (poyWins.get(winner) || 0) + 1);
		}
		for (const [winner, n] of poyWins) {
			if (n >= 4) giveNat(winner, "Consensus National Player of the Year", true);
		}

		nation.slice(0, slots(5)).forEach((x) => giveNat(x, "Consensus First Team All-American"));
		nation.slice(slots(5), slots(10)).forEach((x) => giveNat(x, "Consensus Second Team All-American"));
		nation.slice(slots(10), slots(15)).forEach((x) => giveNat(x, "Third Team All-American"));

		// Position awards. Each is a one-winner trophy over its own position
		// group, so award volume tracks what the class is actually made of.
		/* One position trophy per man: the Cousy (PG, G) and West (SG, G)
		   pools overlap on "G", and the same guard used to take both. */
		const positioned = new Set();
		for (const pa of POSITION_AWARDS) {
			const pool = nation.filter((x) => pa.pos.indexOf(x.pos) !== -1 && !positioned.has(x));
			if (!pool.length) continue;
			const winner = pool[0];
			positioned.add(winner);
			giveNat(winner, pa.name);
		}
		// Best big man in the country, regardless of the PF/C split.
		const bigs = nation.filter((x) => ["PF", "FC", "C", "F"].indexOf(x.pos) !== -1);
		if (bigs.length) giveNat(bigs[0], "Pete Newell Big Man Award");
		// Best player who is not a freshman.
		const vets = nation.filter((x) => !x.isFreshman);
		if (vets.length) giveNat(vets[0], "Lute Olson Award");

		const natDef = everyone.slice().sort((a, b) => b.scoreDefTotal - a.scoreDefTotal);
		const defTop = natDef.slice(0, Math.max(5, slots(6)));
		for (const award of NATIONAL_DPOY) {
			const vrng = rng.child("dpoy|" + award.name);
			// Same fix as the POY block: draw once per candidate, sort on the
			// stored score, never draw inside a comparator.
			const ballots = defTop.map((x) => ({
				x, score: x.scoreDefTotal + vrng.normal(0, award.sd),
			}));
			ballots.sort((a, b) => b.score - a.score);
			const winner = ballots.length ? ballots[0].x : null;
			if (!winner) continue;
			if (winner.filler || !winner.awards) {
				if (winner.filler && winner.name) {
					fieldHonors.push({
						award: award.name, name: winner.name, key: winner.key || null,
						school: winner.school || (winner.team ? winner.team.name : null),
						classYear: winner.classYear || null,
						starReturner: winner.starReturner || null,
					});
				}
				continue;
			}
			if (!GATES.defensive(winner)) continue;
			winner.awards.push(award.name);
		}
		// The NABC all-defensive teams, which did not exist at national level.
		natDef.slice(0, slots(5)).forEach((x) => {
			if (x.filler || !x.awards || !GATES.defensive(x)) return;
			x.awards.push("NABC All-Defensive First Team");
		});
		natDef.slice(slots(5), slots(10)).forEach((x) => {
			if (x.filler || !x.awards || !GATES.defensive(x)) return;
			x.awards.push("NABC All-Defensive Second Team");
		});

		const freshmen = nation.filter((x) => x.isFreshman);
		freshmen.slice(0, slots(1)).forEach((x) => giveNat(x, "Wayman Tisdale Award"));
		freshmen.slice(0, slots(5)).forEach((x) => giveNat(x, "All-Freshman Team"));
		const natAt = (arr, n) => (arr[Math.min(arr.length, n) - 1] || {});
		const natBars = {
			aa1: natAt(nation, slots(5)).scoreTotal,
			aa2: natAt(nation, slots(10)).scoreTotal,
			aa3: natAt(nation, slots(15)).scoreTotal,
			tisdale: natAt(freshmen, slots(1)).scoreTotal,
			allFresh: natAt(freshmen, slots(5)).scoreTotal,
			allDef1: natAt(natDef, slots(5)).scoreDefTotal,
		};
		priorHonors(ncaa, teams, confBars, natBars, rng.child("prior-honors"), noiseScale);

		/* Finalists.

		   Ninety awards, every one of them binary: you won it or your season
		   does not appear. That is not how the honors actually work and it
		   throws away most of the resolution the model already has — the
		   difference between the ninth-best player in the country and the
		   fortieth is real, and both of them finished the year with nothing to
		   show for it.

		   These are real, they are cheap (they are the same ranked list, read
		   further down), and they roughly triple the number of distinguishable
		   outcomes without adding a single winner. Named after the trophy, and
		   never given to somebody who already won the thing itself. */
		/* `wonPrefix` names the trophy the tier belongs to, for the "never
		   given to somebody who already won the thing itself" check. It used
		   to be derived as label.split(" finalist")[0], which for "Wooden
		   Award Late Season Top 20" is the whole string — a prefix nobody
		   holds — so the Wooden winner also collected the Top 20, unlike
		   every other finalist tier. */
		const finalist = (list, from, to, label, wonPrefix) => {
			const prefix = wonPrefix || label.split(" finalist")[0];
			for (const x of list.slice(from, to)) {
				if (x.filler || !x.awards) continue;
				if (x.stats && x.stats.mpg < 20) continue;
				if (x.awards.some((a) => a.indexOf(prefix) === 0)) continue;
				x.awards.push(label);
			}
		};
		finalist(nation, 0, slots(4), "Naismith Trophy finalist");
		finalist(nation, 0, slots(20), "Wooden Award Late Season Top 20", "John R. Wooden Award");
		finalist(nation, slots(15), slots(30), "Associated Press honorable mention");
		finalist(natDef.filter((x) => GATES.defensive(x)), 0, slots(4),
			"Naismith Defensive Player of the Year finalist");
		finalist(freshmen, slots(5), slots(10), "Wayman Tisdale Award watch list");
		for (const pa of POSITION_AWARDS) {
			const pool = nation.filter((x) => pa.pos.indexOf(x.pos) !== -1);
			finalist(pool, 0, slots(4), pa.name + " finalist");
		}

		/* Academic All-America. BBGM has no academics, so this is rolled from
		   the player's own seed and gated on basketball IQ and production —
		   which at least makes it deterministic, rare, and never a surprise on
		   a player who did not play. */
		for (const p of ncaa) {
			if (!p.stats || p.stats.mpg < 22 || p.scoreProd < 14) continue;
			const r = rng.child("academic|" + p.key);
			const oiq = (p.newRatings && p.newRatings.oiq) || 45;
			if (r.random() < clamp((oiq - 45) / 260, 0, 0.14)) {
				p.awards.push("Academic All-American");
			}
		}

		/* --- tournament honors -------------------------------------------- */
		const ffNames = new Set(tourney.finalFour.map((x) => x.team.name));
		const inFF = ncaa.filter((p) => ffNames.has(p.newCollege))
			.sort((a, b) => b.scoreProd - a.scoreProd);
		const champName = tourney.champion.team.name;
		// The Most Outstanding Player is a Final Four team's best player — but
		// on a Final Four roster of 10, the prospect is usually not it.
		const mopField = [];
		for (const nm of ffNames) {
			for (const x of (fieldByTeam[nm] || []).slice(0, 5)) {
				mopField.push({ filler: true, score: x.scoreProd });
			}
		}
		const mopAll = inFF.map((p) => ({ p, score: p.scoreProd + (p.newCollege === champName ? 3 : 0) }))
			.concat(mopField.map((f) => ({ p: null, score: f.score })))
			.sort((a, b) => b.score - a.score);
		const mop = mopAll[0] && mopAll[0].p ? mopAll[0].p : null;
		if (mop) mop.awards.push("Final Four Most Outstanding Player");
		mopAll.slice(0, 5).forEach((x) => {
			// Same minutes gate the All-Region and conference tournament
			// teams apply; this one applied none.
			if (x.p && x.p !== mop && x.p.stats && x.p.stats.mpg >= 18) {
				x.p.awards.push("NCAA All-Tournament Team");
			}
		});

		/* All-Region teams: five players per regional, drawn from the two teams
		   that played the regional final. Four more real honors the sim built
		   the entire bracket for and then never used. */
		if (tourney.regions) {
			for (const region of Object.keys(tourney.regions)) {
				const r = tourney.regions[region];
				const finalRound = r.rounds[r.rounds.length - 1];
				if (!finalRound || !finalRound.length) continue;
				const g = finalRound[0];
				const names = new Set([g.a.team.name, g.b.team.name]);
				const cands = ncaa.filter((p) => names.has(p.newCollege))
					.map((p) => ({ p, score: p.scoreProd }));
				for (const nm of names) {
					for (const x of (fieldByTeam[nm] || []).slice(0, 5)) {
						cands.push({ p: null, score: x.scoreProd });
					}
				}
				cands.sort((a, b) => b.score - a.score);
				cands.slice(0, 5).forEach((x) => {
					if (x.p && x.p.stats && x.p.stats.mpg >= 18) {
						x.p.awards.push("NCAA " + region + " All-Region Team");
					}
				});
			}
		}

		// Conference tournament: an MVP and an all-tournament team, not just
		// the MVP.
		for (const conf of Object.keys(byConf)) {
			const champ = Object.values(teams).filter(
				(t) => t.conf === conf && t.confTourneyChamp)[0];
			if (!champ) continue;
			const crng = rng.child("cttourney|" + conf);
			const cands = ncaa.filter((p) => {
				const t = teams[p.newCollege];
				return t && t.conf === conf && t.inConfTourney && (t.ctW || 0) >= 1;
			}).map((p) => ({
				p,
				/* The MVP of a conference tournament is on the team that won
				   it: every real league gives it that way. The all-tournament
				   team can span the bracket, and a lift keeps the champion's
				   men at the front of it. */
				score: p.scoreProd + (p.newCollege === champ.name ? 6 : 0) +
					crng.normal(0, 1.5),
				champ: p.newCollege === champ.name,
			}));
			for (const t of Object.values(teams)) {
				if (t.conf !== conf || !t.inConfTourney || (t.ctW || 0) < 1) continue;
				for (const x of (fieldByTeam[t.name] || []).slice(0, 4)) {
					cands.push({
						p: null,
						score: x.scoreProd + crng.normal(0, 1.5) + (t === champ ? 6 : 0),
						champ: t === champ,
					});
				}
			}
			if (!cands.length) continue;
			cands.sort((a, b) => b.score - a.score);
			const lb = label(conf);
			// Filter for eligibility FIRST, so a gated-out top candidate does
			// not silently vacate the MVP slot while the rest of the team is
			// still handed out.
			const eligible = cands.filter((x) => x.p && x.p.stats && x.p.stats.mpg >= 18);
			/* Whether the champion's best man is a filler or a prospect, the
			   trophy goes to the champion: a filler MVP is recorded as the
			   field's, the way the national honors already are, so the
			   Awards tab can name him rather than leaving the slot empty. */
			const champBest = cands.find((x) => x.champ);
			const mvp = champBest && champBest.p && eligible.indexOf(champBest) !== -1
				? champBest : null;
			if (mvp) {
				mvp.p.awards.push(lb + " Tournament MVP");
			} else if (champBest && !champBest.p) {
				const x = (fieldByTeam[champ.name] || []).slice(0, 4)
					.slice().sort((a, b) => b.scoreProd - a.scoreProd)[0];
				if (x && x.name) {
					fieldHonors.push({
						award: lb + " Tournament MVP", name: x.name, key: x.key || null,
						school: champ.name, classYear: x.classYear || null,
						starReturner: x.starReturner || null,
					});
				}
			}
			eligible.filter((x) => x !== mvp).slice(0, mvp ? 4 : 5).forEach((x) => {
				x.p.awards.push("All-" + lb + " Tournament Team");
			});
		}

		// NIT all-tournament team.
		if (tourney.nit && tourney.nit.champion) {
			const nrng = rng.child("nit-awards");
			const nitTeams = new Set(tourney.nit.field
				.filter((t) => (t.nitWins || 0) >= 2).map((t) => t.name));
			const cands = ncaa.filter((p) => nitTeams.has(p.newCollege))
				.map((p) => ({ p, score: p.scoreProd + nrng.normal(0, 1.2) }))
				.sort((a, b) => b.score - a.score);
			// Eligibility first, same as the conference tournaments: the old
			// index-based gate could vacate the MVP while still naming four
			// All-Tournament players.
			cands.filter((x) => x.p.stats && x.p.stats.mpg >= 18)
				.slice(0, 5).forEach((x, i) => {
					x.p.awards.push(i === 0 ? "NIT Most Valuable Player" : "NIT All-Tournament Team");
				});
		}

		/* --- championships -------------------------------------------------
		   The bracket crowned a champion and no player ever carried it: a
		   prospect who started on the national champion finished with
		   "NCAA All-Tournament Team" at best, and a reserve on that roster
		   finished with nothing at all. A title is a line on every roster
		   member's page for the rest of his life, so every prospect who
		   played for the champion gets it — the same way a ring is not
		   minutes-gated — and the same for a conference title, the NIT, and
		   (below) a professional league, cup or continental title. */
		const played = (p) => p.stats && p.stats.gp > 0;
		for (const p of ncaa) {
			if (!played(p)) continue;
			const t = teams[p.newCollege];
			if (!t) continue;
			if (t.name === champName) p.awards.push("NCAA National Champion");
			else if (tourney.runnerUp && t.name === tourney.runnerUp.team.name) {
				p.awards.push("NCAA National Runner-Up");
			}
			if (t.nitChamp) p.awards.push("NIT Champion");
			const lb = label(t.conf);
			if (t.confTourneyChamp) p.awards.push(lb + " Tournament Champion");
			if (t.confRegularChamp) p.awards.push(lb + " Regular-Season Champion");
		}

		/* --- pro / DII league honors --------------------------------------- */
		const PRO_AWARDS = {
			"EuroLeague": ["EuroLeague Rising Star", "EuroLeague Best Young Player", "All-EuroLeague Second Team"],
			"NBA G League": ["G League Rookie of the Year", "G League All-Rookie Team", "G League Next Up Award"],
			"Liga ACB": ["ACB Best Young Player", "ACB Rising Star", "All-ACB Second Team"],
			"NBL": ["NBL Next Generation Award", "NBL Rookie of the Year", "All-NBL Second Team"],
			"Chinese CBA": ["CBA Rookie of the Year", "CBA Most Improved Player", "All-CBA Second Team"],
			"LNB Pro A": ["LNB Best Young Player", "LNB Rising Star", "All-LNB Second Team"],
			"EuroCup": ["EuroCup Rising Star", "EuroCup Best Young Player", "All-EuroCup Second Team"],
			"Basketball Bundesliga": ["BBL Best Young Player", "BBL Rising Star", "All-BBL Second Team"],
			"Adriatic League": ["ABA Best Young Player", "ABA Rising Star", "All-ABA Second Team"],
			"NBL1": ["NBL1 Youth Player of the Year", "NBL1 Rookie of the Year", "All-NBL1 Second Team"],
			"Overtime Elite": ["Overtime Elite MVP", "OTE Defensive Player of the Year", "All-OTE First Team"],
			"NBA Academy": ["NBA Academy Games MVP", "NBA Academy Player of the Year", "Academy All-Star"],
			"DII NCAA": ["Division II Player of the Year", "Division II All-American", "Division II Freshman of the Year"],
			/* The destinations added alongside these had no honors at all, so
			   a prospect who spent his year in Turkey or the BAL finished it
			   with an empty award list whatever he averaged — and the award
			   list is most of what a note about an overseas prospect has to
			   say. */
			"Basketball Champions League": ["BCL Rising Star", "BCL Best Young Player", "All-BCL Second Team"],
			"Turkish BSL": ["BSL Best Young Player", "BSL Rising Star", "All-BSL Second Team"],
			"Greek Basket League": ["GBL Best Young Player", "GBL Rising Star", "All-GBL Second Team"],
			"Israeli Premier League": ["Israeli League Rising Star", "Israeli League Best Young Player", "All-Israeli League Second Team"],
			"Japan B.League": ["B.League Rookie of the Year", "B.League Best Young Player", "All-B.League Second Team"],
			"Brazil NBB": ["NBB Revelation of the Year", "NBB Best Young Player", "All-NBB Second Team"],
			"Basketball Africa League": ["BAL Rising Star", "BAL Best Young Player", "All-BAL Second Team"],
			"CEBL": ["CEBL Canadian of the Year", "CEBL Rookie of the Year", "All-CEBL Second Team"],
			"Prep / Postgrad": ["National Prep Player of the Year", "Prep All-American", "Prep Showcase MVP"],
			"NAIA": ["NAIA Player of the Year", "NAIA All-American", "NAIA Freshman of the Year"],
			"Italian LBA": ["LBA Best Under-22", "LBA Rising Star", "All-LBA Second Team"],
			"Lithuanian LKL": ["LKL Best Young Player", "LKL Rising Star", "All-LKL Second Team"],
			"VTB United League": ["VTB Best Young Player", "VTB Rising Star", "All-VTB Second Team"],
			"Polish PLK": ["PLK Best Young Player", "PLK Rising Star", "All-PLK Second Team"],
			"BNXT League": ["BNXT Rising Star", "BNXT Best Young Player", "All-BNXT Second Team"],
			"Korean KBL": ["KBL Rookie of the Year", "KBL Best Young Player", "All-KBL Second Team"],
			"Philippine PBA": ["PBA Rookie of the Year", "PBA Most Improved Player", "All-PBA Second Team"],
			"Argentine Liga Nacional": ["LNB Revelation of the Year", "LNB Best Young Player", "All-Liga Nacional Second Team"],
			"Mexican LNBP": ["LNBP Rookie of the Year", "LNBP Best Young Player", "All-LNBP Second Team"],
			"Puerto Rico BSN": ["BSN Rookie of the Year", "BSN Best Young Player", "All-BSN Second Team"],
			"New Zealand NBL": ["NZNBL Rookie of the Year", "NZNBL Best Young Player", "All-NZNBL Second Team"],
			"JUCO": ["NJCAA Player of the Year", "NJCAA All-American", "NJCAA Freshman of the Year"],
			"DIII NCAA": ["Division III Player of the Year", "Division III All-American", "Division III Rookie of the Year"],
		};
		const byLeague = {};
		for (const p of pros) {
			p.awards = [];
			// A prospect with no stat line (a club that never got simulated)
			// cannot be scored; he must not take the rest of the list down.
			if (!p.stats) { p.scoreProd = 0; p.scoreTotal = -Infinity; continue; }
			p.scoreProd = productionScore(p);
			p.scoreDef = defenseScore(p, global.BBGM.composites(p.newRatings));
			// A club that finished top of its league helps a case; a prospect
			// buried on a relegation side has to score his way out.
			const club = p.proTeam;
			const standing = club && club.standing
				? (10 - club.standing) * 0.35 + club.w * 0.10
				: 0;
			p.scoreTotal = p.scoreProd + standing + rng.normal(0, 1.5);
			(byLeague[p.newCollege] = byLeague[p.newCollege] || []).push(p);
		}
		/* The achievement layer the pro side lacked. Clubs, tables, playoffs,
		   cups and relegation existed; a prospect who led the ACB in scoring
		   finished the year with an empty award list, because the only
		   honors were age-restricted. These are the league's own trophies:
		   the MVP, the first team, a Finals MVP for the man who carried the
		   champion, a cup-final MVP, and the continental honor when his
		   club's European run went deep. The bar is the same production
		   scale the youth awards use, set higher, and the league's own
		   strength raises it — an MVP in the EuroLeague is a harder thing
		   than one in NBL1. */
		const SHORT = PRO_SHORT;
		for (const lg of Object.keys(byLeague)) {
			const list = byLeague[lg].sort((a, b) => b.scoreTotal - a.scoreTotal);
			const names = PRO_AWARDS[lg] || [];
			const meta = C.NON_NCAA[lg] || {};
			const short = SHORT[lg];
			if (short && !meta.youth && !meta.idle) {
				const strength = Number.isFinite(meta.strength) ? meta.strength : 50;
				const mvpBar = (22 + strength * 0.10) * proStrict;
				const firstBar = (17 + strength * 0.08) * proStrict;
				const env = global.StatsSim.leagueEnv(lg);
				const minMpg = env.youthCap ? Math.min(20, env.youthCap * 0.8) : 20;
				list.forEach((p, i) => {
					if (!p.stats || p.stats.mpg < minMpg) return;
					if (i === 0 && p.scoreTotal > mvpBar) p.awards.push(short + " MVP");
					else if (i < 5 && p.scoreTotal > firstBar) p.awards.push("All-" + short + " First Team");
					const club = p.proTeam;
					if (!club) return;
					const bestAtClub = club.prospects.slice()
						.sort((a, b) => b.scoreTotal - a.scoreTotal)[0] === p;
					if (club.leagueChamp && bestAtClub && p.scoreTotal > firstBar * 0.8) {
						p.awards.push(short + " Finals MVP");
					}
					if (club.cupChamp && bestAtClub && p.scoreTotal > firstBar * 0.7) {
						p.awards.push(short + " Cup Final MVP");
					}
					/* The continental competition his club played in (see
					   continentalRun in js/engine.js). A Final Four or a title
					   is an honor in its own right; a group-stage exit is a
					   line in the note and nothing else. */
					const cont = club.continental;
					if (cont && bestAtClub && p.scoreTotal > firstBar * 0.9) {
						if (cont.result === "champions") p.awards.push(cont.competition + " Final Four MVP");
						else if (/Final Four|final/.test(cont.result)) p.awards.push("All-" + cont.competition + " Team");
					}
				});
			}
			// These are age-restricted or rookie awards, so a prospect really
			// can win one — but he still has to be the best of the ones here,
			// and the bar scales with how hard the league is. A youth league
			// (Overtime Elite, the NBA Academies) is a league of teenagers, so
			// there is no age handicap to clear.
			const base = meta.youth ? 12 : lg === "DII NCAA" ? 24 : 16 + meta.strength * 0.05;
			const bar = base * proStrict;
			// Minutes bars scale with the league's own youth cap.
			const env = global.StatsSim.leagueEnv(lg);
			const minMpg = env.youthCap ? Math.min(18, env.youthCap * 0.72) : 18;
			list.forEach((p, i) => {
				if (i < names.length && p.scoreTotal > bar && p.stats && p.stats.mpg >= minMpg) {
					p.awards.push(names[i]);
				}
			});
			/* Titles. A prospect on the champion is a champion whatever he
			   averaged; the trophy names the league the way its honors do. */
			const shortName = short || lg;
			for (const p of list) {
				const club = p.proTeam;
				if (!club || !p.stats || !(p.stats.gp > 0)) continue;
				if (club.leagueChamp) p.awards.push(shortName + " Champion");
				if (club.cupChamp) p.awards.push(shortName + " Cup Winner");
				if (club.continental && club.continental.result === "champions") {
					p.awards.push(club.continental.competition + " Champion");
				}
			}
		}

		// One consistent order everywhere: the note, the table, the editor.
		for (const p of prospects) {
			if (p.awards && p.awards.length) p.awards = sortAwards(p.awards);
		}

		/* --- COACH OF THE YEAR ---------------------------------------------
		   Every program carried a `rep` "for Coach of the Year" and nothing
		   ever voted. It is voted against expectations: the season a program
		   had over the season its name and its coach's reputation said it
		   would have. Three national panels weigh that differently — the
		   Naismith leans to the record, the AP to the surprise, the Henry
		   Iba to the tournament run — and each conference names its own. */
		const coachHonors = [];
		const crng = rng.child("coy");
		const coachRows = Object.keys(teams)
			.filter((n) => n.indexOf("__") !== 0 && teams[n] && teams[n].coach && teams[n].regGames)
			.map((n) => {
				const t = teams[n];
				const c = t.coach;
				const expected = 0.45 * (c.rep || 50) + 0.30 * (t.prestige || 50) + 0.25 * 50;
				const achieved = 100 * (t.regPct || 0) * 0.6 + (t.regSosAvg - 45) * 0.5 +
					(t.quadWins || 0) * 1.4 +
					(t.apRank ? Math.max(0, 26 - t.apRank) * 0.35 : 0) +
					(t.ncaaWins || 0) * 2.2 + (t.confTourneyChamp ? 2 : 0);
				return {
					team: t, coach: c,
					surprise: achieved - expected,
					record: 100 * (t.regPct || 0) * 0.8 + (t.quadWins || 0) * 1.6,
					march: (t.ncaaWins || 0) * 4 + (t.bid ? 3 : 0),
				};
			});
		if (coachRows.length) {
			const give = (award, pick, filter) => {
				const pool = filter ? coachRows.filter(filter) : coachRows;
				if (!pool.length) return;
				const winner = pool.slice().sort((a, b) => pick(b) - pick(a))[0];
				coachHonors.push({
					award, coach: winner.coach.name, school: winner.team.name,
					conf: winner.team.conf, record: winner.team.regW + "-" + winner.team.regL,
					situation: winner.coach.situationLabel || null,
				});
			};
			const noise = new Map(coachRows.map((r) => [r, crng.normal(0, 3.5)]));
			give("Naismith Coach of the Year",
				(r) => r.surprise * 0.7 + r.record * 0.5 + r.march * 0.4 + noise.get(r));
			give("AP Coach of the Year",
				(r) => r.surprise * 1.0 + r.record * 0.3 + noise.get(r) + crng.normal(0, 2));
			give("Henry Iba Award",
				(r) => r.surprise * 0.5 + r.record * 0.3 + r.march * 0.8 + noise.get(r) + crng.normal(0, 2));
			/* The Hugh Durham (mid-major) and Ben Jobe (minority coaches at
			   any level — modeled here as the best coach outside the power
			   leagues on a one-bid league's budget) awards. */
			give("Hugh Durham Award",
				(r) => r.surprise * 0.8 + r.record * 0.4 + r.march * 0.5 + noise.get(r),
				(r) => (global.Colleges.CONFERENCES[r.team.conf] || {}).tier !== "high");
			for (const conf of Object.keys(byConf)) {
				const lb = label(conf);
				give(lb + " Coach of the Year",
					(r) => r.surprise * 0.8 + r.record * 0.5 + noise.get(r),
					(r) => r.team.conf === conf);
			}
		}

		/* RETURNED, NOT STASHED ON THE TEAM MAP.

		   These three used to be written onto `teams` as `__`-prefixed keys
		   and lifted off by the caller. That works exactly as long as every
		   one of them is remembered at both ends: `teams` is iterated with
		   Object.keys in the stats phase, so a key left behind is a "team"
		   with no members, and a warm re-run — a slider that re-runs stats but
		   not awards — dies on it. Adding a fourth key here and forgetting the
		   matching delete is a one-line change with a failure three phases
		   away, which is exactly the kind of coupling that should not be
		   possible.

		   So `assign` returns them. The old keys are still written for one
		   release because js/batch.js and any external caller may read them,
		   and the caller deletes what it reads. */
		teams.__fieldHonors = fieldHonors;
		teams.__poyBallots = ballotRows;
		teams.__coachHonors = coachHonors;
		/* The best of the field, independent of whether he won anything —
		   for the News item that says the country's best player this year
		   was not in the draft class at all. Trimmed to what a spotlight
		   article needs; the rest of `field` (the fitted improvement scores,
		   the defensive approximations) stays internal to this function. */
		const fieldTop = field.slice()
			.sort((a, b) => b.scoreTotal - a.scoreTotal)
			.slice(0, 5)
			.map((x) => ({
				name: x.name, key: x.key || null,
				school: x.school || (x.team ? x.team.name : null),
				classYear: x.classYear || null, starReturner: x.starReturner || null,
				pos: x.pos, stats: x.stats,
			}));
		/* Still written onto the map as well, for one release, in case an
		   external caller reads them; the engine deletes every `__` key it
		   finds after this returns. */
		teams.__fieldTop = fieldTop;
		return { ranked, fieldHonors, fieldTop, poyBallots: ballotRows, coachHonors };
	}

	/* ------------------------------------------------------- award scope

	   A good prospect finishes a season holding fifteen to twenty-two honors,
	   and BBGM's player page renders every one of them as its own row. Most of
	   that is conference filler — All-Sun Belt Newcomer Team, All-MAC
	   Tournament Team, an Ohio Valley all-freshman nod — and it buries the
	   three lines a reader actually wants. Measured over six classes: 114
	   distinct types, 2.4 honors a player, 22 on the most decorated.

	   `major` is the answer to "what would a broadcast graphic list". It is
	   deliberately a predicate over the award STRING rather than a flag set
	   where each award is created: awards are minted in a dozen places here,
	   several of them by template from a conference name, and a flag would
	   have to be remembered at every one of them forever.

	   MAJOR_CONFERENCES is overridable per export (opts.majorConferences), so
	   a user who cares about the WCC can say so. */
	const MAJOR_CONFERENCES = [
		"ACC", "Big Ten", "Big 12", "Big East", "SEC",
		// The mid-major exception the audit asks for: a conference POY at one
		// of these is a national name, not filler.
		"WCC", "Mountain West", "Atlantic 10", "American", "AAC", "Missouri Valley",
	];

	/* Nothing below the line, whatever it is attached to. Checked first, so a
	   "Naismith Trophy finalist" loses to the finalist rule and not to the
	   national-trophy rule that also matches it. */
	const MINOR_SUFFIX = /(finalist|watch list|honorable mention|Late Season Top \d+|Midseason Top \d+)/i;
	const MINOR_ALWAYS = [
		/All-\w+ All-Region Team$/,          // NCAA East/West/Midwest/South
		/^NCAA \w+ All-Region Team$/,
		/^Academic All-American$/,
		/Cup Final MVP$/,                    // domestic cups abroad
		/Most Improved Player$/,
		/Sixth Man of the Year$/,
	];

	const MAJOR_NATIONAL = [
		/^Consensus National Player of the Year$/,
		/^(Naismith Trophy|John R\. Wooden Award|Oscar Robertson Trophy)$/,
		/^(AP|NABC|Sporting News) Player of the Year$/,
		/^Consensus (First|Second) Team All-American$/,
		/^Third Team All-American$/,
		/^(Naismith|NABC) Defensive Player of the Year$/,
		/^Lefty Driesell Award$/,
		/^(Bob Cousy|Jerry West|Julius Erving|Tim Duncan|Kareem Abdul-Jabbar) Award$/,
		/^Final Four Most Outstanding Player$/,
		/^NCAA National Champion$/,
		/^NCAA All-Tournament Team$/,
		/^NIT Most Valuable Player$/,
	];

	/* The short name every professional (and non-DI) league's honors are
	   minted under: "ACB MVP", "All-BBL First Team". One table, read by the
	   minting below and by isMajorAward, which used to carry a hand-typed
	   copy that had drifted (an All-ACB First Team was filler; All-BBL was
	   major). */
	const PRO_SHORT = {
		"EuroLeague": "EuroLeague", "NBA G League": "G League", "Liga ACB": "ACB",
		"NBL": "NBL", "Chinese CBA": "CBA", "LNB Pro A": "LNB", "EuroCup": "EuroCup",
		"Basketball Bundesliga": "BBL", "Adriatic League": "ABA", "NBL1": "NBL1",
		"Basketball Champions League": "BCL", "Turkish BSL": "BSL",
		"Greek Basket League": "GBL", "Israeli Premier League": "Israeli League",
		"Japan B.League": "B.League", "Brazil NBB": "NBB",
		"Basketball Africa League": "BAL", "CEBL": "CEBL", "NAIA": "NAIA",
		"DII NCAA": "Division II",
		"Italian LBA": "LBA", "Lithuanian LKL": "LKL", "VTB United League": "VTB",
		"Polish PLK": "PLK", "BNXT League": "BNXT", "Korean KBL": "KBL",
		"Philippine PBA": "PBA", "Argentine Liga Nacional": "Liga Nacional",
		"Mexican LNBP": "LNBP", "Puerto Rico BSN": "BSN", "New Zealand NBL": "NZNBL",
		"JUCO": "NJCAA", "DIII NCAA": "Division III",
	};
	const PRO_FIRST_TEAM = new RegExp("^All-(" + Object.values(PRO_SHORT)
		.concat(["East Asia Super League"])
		.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ") First Team$");

	/* Abroad and in the G League: the same shape of rule, one league up. */
	const MAJOR_PRO = [
		/\bMVP$/, /\bFinals MVP$/, /^All-[\w .]+ First Team$/, /\bChampion$/,
		/Rising Star$/, /Best Young Player$/, /Rookie of the Year$/,
	];
	/* Which of those are conference rows rather than pro rows: "All-ACC First
	   Team" matches the pro First Team pattern too, so conferences are decided
	   before the pro list is consulted. */
	function conferenceIn(award, confs) {
		for (const c of confs) {
			if (award === c + " Player of the Year" ||
				award === c + " Defensive Player of the Year" ||
				award === c + " Freshman of the Year" ||
				award === "All-" + c + " First Team" ||
				award === c + " Tournament Champion" ||
				award === c + " Tournament MVP") return true;
		}
		return false;
	}
	/* Any conference at all — used to reject a NON-major conference row before
	   the pro patterns can claim it. */
	const CONF_SHAPED =
		/(Player of the Year|Freshman of the Year|Tournament MVP|Defensive Player of the Year|Tournament Champion|Regular-Season Champion)$|^All-.+ (First|Second|Freshman|Newcomer|Defensive|Tournament) Team$/;

	function isMajorAward(award, confs) {
		const a = String(award || "").trim();
		if (!a) return false;
		if (MINOR_SUFFIX.test(a)) return false;
		for (const re of MINOR_ALWAYS) if (re.test(a)) return false;
		for (const re of MAJOR_NATIONAL) if (re.test(a)) return true;
		/* Awards are minted under the conference LABEL ("AAC"), so a key the
		   user typed ("American") is mapped through it as well. */
		const raw = confs && confs.length ? confs : MAJOR_CONFERENCES;
		const T = global.TeamsSim;
		const list = T && T.label ? raw.concat(raw.map((c) => T.label(c))) : raw;
		if (conferenceIn(a, list)) return true;
		/* A conference-shaped row that did not match the list above is filler
		   by construction — second teams, all-freshman, all-newcomer, and
		   every award of a conference the user did not name. */
		if (CONF_SHAPED.test(a)) {
			// ...unless it is a professional league's own award, which is
			// conference-shaped only by coincidence of wording.
			if (PRO_FIRST_TEAM.test(a)) return true;
			return false;
		}
		for (const re of MAJOR_PRO) if (re.test(a)) return true;
		return false;
	}

	/* Filter a player's honor list to a scope. "all" is the identity, so the
	   caller never has to branch. */
	function scopeAwards(list, scope, confs) {
		if (scope !== "major") return (list || []).slice();
		return (list || []).filter((a) => isMajorAward(a, confs));
	}

	global.Awards = {
		priorHonors,
		assign, productionScore, defenseScore, fieldDefenseScore, resumeScore,
		rankAgainstField, rankHighlights, RANKED_STATS,
		REF_PACE,
		buildField, fitScores, fitTalentToScore, awardRank, sortAwards,
		NATIONAL_POY, NATIONAL_DPOY, POSITION_AWARDS, AWARD_TIERS,
		NCAA_BONUS, NIT_BONUS, GATES,
		MAJOR_CONFERENCES, isMajorAward, scopeAwards,
	};
})(typeof window !== "undefined" ? window : self);
