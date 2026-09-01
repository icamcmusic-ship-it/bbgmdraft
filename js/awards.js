/* Postseason honours, awarded from the simulated stat lines, team results and
   the strength of the league the player did it in.

   The central problem this file has to solve: a 70-man draft class shares
   Division I with about 4,000 players nobody here models. Ranking prospects
   only against each other handed out fixed quotas by array index — every class
   contained the National Player of the Year and all five Consensus First
   Teamers, 80 awards a year across 51% of the class. So the unseen field is
   modelled explicitly: every filler on every roster gets a comparable score,
   and a prospect has to finish ahead of them to be honoured.

   The award list itself used to be eighteen strings, three of them generic
   ("National Player of the Year", "National Defensive Player of the Year") and
   six conference-templated. A real college season hands out well over a
   hundred distinguishable honours, and — more importantly — the defensive ones
   had almost nothing to rank on, because defence was two counting stats and a
   composite. Both halves are fixed here: the defensive score reads a real
   defensive box score (contested shots, deflections, charges, defensive
   rating), and the honours it feeds are the ones that actually exist. */
(function (global) {
	"use strict";

	const { clamp } = global.BBGMRng;
	const C = global.Colleges;
	const T = global.TeamsSim;

	/* A production resume, normalised for PACE.

	   The counting half of this is raw per-game volume, and PROGRAM_STYLES
	   moves a team's possessions by +/-5.5 a game — so a run-and-gun program
	   handed its best player about 8% more of everything than a pack-line
	   program did, for nothing he had done. This score is what the award model
	   and the draft board rank on, so that was a systematic tilt of the whole
	   honours list towards fast schools.

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
		// Fouling your way through a game is not defence.
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
					name: t.name + " returner " + (fp.rotationIndex + 1),
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
					   decides an All-America slot — was still randomised. Half a
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
		{ name: "Karl Malone Award", label: "best power forward", pos: ["PF", "F"] },
		{ name: "Kareem Abdul-Jabbar Award", label: "best center", pos: ["C", "FC"] },
	];

	/* How much an honour is worth on a scouting note, so a résumé reads
	   "Naismith Trophy; Consensus First Team All-American; All-Big Ten First
	   Team" and not whatever order the code happened to run in. Lower sorts
	   first. There are ninety-odd distinguishable honours now; without an
	   ordering, the good ones get buried. */
	const AWARD_TIERS = [
		[/^Consensus National Player of the Year/, 0],
		[/^(Naismith Trophy|John R\. Wooden Award|Oscar Robertson Trophy|AP Player of the Year|NABC Player of the Year|Sporting News Player of the Year)$/, 1],
		[/^(Naismith Defensive|NABC Defensive|Lefty Driesell)/, 2],
		[/^(Bob Cousy|Jerry West|Julius Erving|Karl Malone|Kareem Abdul-Jabbar|Pete Newell|Lute Olson|Wayman Tisdale) Award$/, 3],
		[/^Consensus First Team All-American$/, 4],
		[/^Consensus Second Team All-American$/, 5],
		[/^Third Team All-American$/, 6],
		[/^NABC All-Defensive First Team$/, 7],
		[/^NABC All-Defensive Second Team$/, 8],
		[/^All-Freshman Team$/, 9],
		[/^Final Four Most Outstanding Player$/, 10],
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

	/* Who is eligible for which kind of honour.

	   These are separate predicates on purpose. Every conference honour used to
	   run through ONE gate — `mpg < 20 || scoreProd < 12` — including Defensive
	   Player of the Year, and scoreProd is an offensive box score
	   (ppg + 1.2*rpg + 1.7*apg + 2.6*spg + 2.6*bpg - 0.8*tov + 55*(ts-.52)).
	   A genuine low-usage perimeter stopper — 5 points, 3 rebounds, 1.6 steals
	   — scores about 11 on it and was disqualified from a DEFENSIVE award by
	   his scoring. Meanwhile the national DPOY used a minutes-only gate, so the
	   two were not even consistent with each other.

	   Exported so the behaviour is testable directly rather than inferred from
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
	   defensive rating — is generated, displayed, and never contextualised.
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
		// A candidate pool for any honour that needs a comparable score for a
		// player on one particular team.
		const fieldByTeam = {};
		for (const x of field) (fieldByTeam[x.team.name] = fieldByTeam[x.team.name] || []).push(x);

		// awardStrictness shifts how far into the field the honours reach:
		// 1.0 = the real slot counts, higher = fewer slots, lower = more.
		const slots = (n) => Math.max(1, Math.round(n / strict));
		const confSlots = (n) => Math.max(1, Math.round(n / confStrict));

		const label = T.label;

		/* --- conference honours ------------------------------------------- */
		const byConf = {};
		for (const x of everyone) {
			if (!x.conf) continue;
			(byConf[x.conf] = byConf[x.conf] || []).push(x);
		}
		for (const conf of Object.keys(byConf)) {
			const pool = byConf[conf];
			const list = pool.slice().sort((a, b) => b.scoreTotal - a.scoreTotal);
			const lb = label(conf);
			// Offensive honours: a bit-part player never wins one however the
			// maths ranked him.
			const give = (x, award) => {
				if (x.filler || !x.awards) return;
				if (!GATES.offensive(x)) return;
				x.awards.push(award);
			};
			/* Defensive honours get their OWN gate. The shared one required
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

			// Newcomer here means "arrived from another programme". Freshmen
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
		}

		/* --- national honours ---------------------------------------------- */
		const ranked = ncaa.slice().sort((a, b) => b.scoreTotal - a.scoreTotal);
		const nation = everyone.slice().sort((a, b) => b.scoreTotal - a.scoreTotal);
		const giveNat = (x, award, unshift) => {
			if (x.filler || !x.awards) return;
			if (x.stats && x.stats.mpg < 20) return;
			if (unshift) x.awards.unshift(award);
			else x.awards.push(award);
		};

		/* Six real trophies, six electorates. A clear best player sweeps; a
		   close year splits, which is how "consensus" ends up meaning
		   something. Only a sweep gets the consensus label. */
		const poyWins = new Map();
		const top = nation.slice(0, Math.max(6, slots(8)));
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
			const ballot = (x) => x.scoreTotal + lean * (x.scoreResume || 0) +
				vrng.normal(0, award.sd * noiseScale);
			const winner = top.slice().sort((a, b) => ballot(b) - ballot(a))[0];
			if (!winner) continue;
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
		for (const pa of POSITION_AWARDS) {
			const pool = nation.filter((x) => pa.pos.indexOf(x.pos) !== -1);
			if (!pool.length) continue;
			const winner = pool[0];
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
			const winner = defTop.slice()
				.sort((a, b) => (b.scoreDefTotal + vrng.normal(0, award.sd)) -
					(a.scoreDefTotal + vrng.normal(0, award.sd)))[0];
			if (!winner) continue;
			if (winner.filler || !winner.awards) continue;
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

		/* Finalists.

		   Ninety awards, every one of them binary: you won it or your season
		   does not appear. That is not how the honours actually work and it
		   throws away most of the resolution the model already has — the
		   difference between the ninth-best player in the country and the
		   fortieth is real, and both of them finished the year with nothing to
		   show for it.

		   These are real, they are cheap (they are the same ranked list, read
		   further down), and they roughly triple the number of distinguishable
		   outcomes without adding a single winner. Named after the trophy, and
		   never given to somebody who already won the thing itself. */
		const finalist = (list, from, to, label) => {
			for (const x of list.slice(from, to)) {
				if (x.filler || !x.awards) continue;
				if (x.stats && x.stats.mpg < 20) continue;
				if (x.awards.some((a) => a.indexOf(label.split(" finalist")[0]) === 0)) continue;
				x.awards.push(label);
			}
		};
		finalist(nation, 0, slots(4), "Naismith Trophy finalist");
		finalist(nation, 0, slots(20), "Wooden Award Late Season Top 20");
		finalist(nation, slots(15), slots(30), "Associated Press honourable mention");
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

		/* --- tournament honours -------------------------------------------- */
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
			if (x.p && x.p !== mop) x.p.awards.push("NCAA All-Tournament Team");
		});

		/* All-Region teams: five players per regional, drawn from the two teams
		   that played the regional final. Four more real honours the sim built
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
				// The MVP of a conference tournament comes off the winning team
				// far more often than not.
				score: p.scoreProd + (p.newCollege === champ.name ? 6 : 0) +
					crng.normal(0, 1.5),
			}));
			for (const t of Object.values(teams)) {
				if (t.conf !== conf || !t.inConfTourney || (t.ctW || 0) < 1) continue;
				for (const x of (fieldByTeam[t.name] || []).slice(0, 4)) {
					cands.push({
						p: null,
						score: x.scoreProd + crng.normal(0, 1.5) + (t === champ ? 6 : 0),
					});
				}
			}
			if (!cands.length) continue;
			cands.sort((a, b) => b.score - a.score);
			const lb = label(conf);
			cands.slice(0, 5).forEach((x, i) => {
				if (!x.p || !x.p.stats || x.p.stats.mpg < 18) return;
				x.p.awards.push(i === 0
					? lb + " Tournament MVP"
					: "All-" + lb + " Tournament Team");
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
			cands.slice(0, 5).forEach((x, i) => {
				if (!x.p.stats || x.p.stats.mpg < 18) return;
				x.p.awards.push(i === 0 ? "NIT Most Valuable Player" : "NIT All-Tournament Team");
			});
		}

		/* --- pro / DII league honours --------------------------------------- */
		const PRO_AWARDS = {
			"EuroLeague": ["EuroLeague Rising Star", "EuroLeague Best Young Player", "All-EuroLeague Second Team"],
			"NBA G League": ["G League Rookie of the Year", "All-G League First Team", "G League Next Up Award"],
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
			/* The destinations added alongside these had no honours at all, so
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
		for (const lg of Object.keys(byLeague)) {
			const list = byLeague[lg].sort((a, b) => b.scoreTotal - a.scoreTotal);
			const names = PRO_AWARDS[lg] || [];
			const meta = C.NON_NCAA[lg] || {};
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
		}

		// One consistent order everywhere: the note, the table, the editor.
		for (const p of prospects) {
			if (p.awards && p.awards.length) p.awards = sortAwards(p.awards);
		}

		return ranked;
	}

	global.Awards = {
		assign, productionScore, defenseScore, fieldDefenseScore, resumeScore,
		rankAgainstField, rankHighlights, RANKED_STATS,
		REF_PACE,
		buildField, fitScores, fitTalentToScore, awardRank, sortAwards,
		NATIONAL_POY, NATIONAL_DPOY, POSITION_AWARDS, AWARD_TIERS,
		NCAA_BONUS, NIT_BONUS, GATES,
	};
})(typeof window !== "undefined" ? window : self);
