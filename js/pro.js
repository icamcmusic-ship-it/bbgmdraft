/* Life after the draft: a pro career projection and a mock draft.

   Both are DERIVED from a finished class and never feed back into it. The
   simulation, the export and the golden hashes do not change; nothing here is
   called by the engine. Every draw is seeded off the class seed and the
   player's key, so a projection and a mock draft are reproducible and survive a
   re-render.

   THE PROJECTION. BBGM's own development model moves a young player toward his
   potential and then ages him out. This does the same in miniature, many times
   over, and reports the spread rather than one draw, because a single invented
   career reads as a prediction and a range reads as what it is:

     - each season he closes a share of the gap to his potential, a large share
       at 19-22 and a small one by 26, with season-to-season noise;
     - his potential itself is uncertain, more so the younger he is;
     - from 29 he declines, faster each year past 31, and a veteran is kept
       only while he is still a rotation player;
     - a man at the end of the bench can lose his spot any summer;
     - he is out of the league when he is not good enough to stay (an ovr under
       the replacement line for two seasons running, or still under it at 25),
       or at 37.

   The verdict comes from the median peak, on BBGM's scale: 65+ is a star, 58 a
   starter, 50 a rotation player, 45 a fringe one, below that a bust risk.

   THE MOCK DRAFT. When the class came out of a BBGM league export, that
   league's own teams draft it, with their real rosters setting their strength
   and their positional needs and the league's draft picks setting the order
   (see leagueDraft). Otherwise thirty invented teams, each with a strength
   (which sets the draft order, with a lottery for the top four), a plan
   (rebuilding teams draft ceiling, contending teams draft readiness) and a
   need at guard, wing and big.
   Each pick takes the player with the best value to THAT team: his projected
   value, blended between ceiling and readiness by the team's plan, plus the fit
   of his position to the team's need, plus a little noise for taste. Two
   rounds. The board's own order is the consensus; the mock is what teams do
   with it. */
(function (global) {
	"use strict";

	const { Rng, clamp } = global.BBGMRng;

	const AGE_FOR_YEAR = { Freshman: 19, Sophomore: 20, Junior: 21, Senior: 22, Graduate: 23 };
	const REPLACEMENT = 43;   // an ovr a team will not carry for long
	const SIMS = 41;          // careers per projection (odd: the median is a career)
	const VERDICTS = [
		[65, "star"], [58, "starter"], [50, "rotation player"], [45, "fringe player"],
		[-Infinity, "bust risk"],
	];

	/* His age on draft day: the class year when there is one (BBGM writes 19 for
	   everybody, so the file's birth year says nothing), the file's age for a
	   prospect abroad. */
	function draftAge(p, season) {
		const cy = String(p.classYear || "");
		const base = AGE_FOR_YEAR[cy.replace(/^Redshirt /, "")];
		if (Number.isFinite(base) && !p.nonNcaa) return base + (/^Redshirt /.test(cy) ? 1 : 0);
		const born = p.born && Number(p.born.year);
		const a = Number.isFinite(born) && Number.isFinite(season) ? season - born : NaN;
		return Number.isFinite(a) ? clamp(a, 18, 26) : 20;
	}

	function growthRate(age) {
		return age <= 20 ? 0.34 : age <= 22 ? 0.3 : age <= 24 ? 0.22 : age <= 26 ? 0.12 : 0.04;
	}

	function decline(age) {
		return age < 29 ? 0 : age <= 30 ? 1.5 : age <= 32 ? 2.5 : age <= 34 ? 3.5 : 5;
	}

	/* One career. Returns the ovr for every season he stayed in the league. */
	function oneCareer(ovr, pot, age, rng) {
		// A younger man's ceiling is a wider bet.
		const potSd = clamp(3 + (23 - age) * 0.9, 2, 7);
		const ceiling = pot + rng.normal(0, potSd);
		let x = ovr;
		const seasons = [];
		let under = 0;
		for (let a = age; a <= 36; a++) {
			const grow = Math.max(0, ceiling - x) * growthRate(a);
			x = x + grow - decline(a) + rng.normal(0, 1.4);
			x = clamp(x, 20, 85);
			under = x < REPLACEMENT ? under + 1 : 0;
			// A veteran past his best is kept only while he is still a rotation player.
			if ((under >= 2 && a >= 22) || (a >= 25 && x < REPLACEMENT - 2) || (a >= 31 && x < 52)) break;
			/* Churn: a roster spot is never safe for a man at the end of the
			   bench. A starter almost never loses his job in a given summer; a
			   fringe player often does. Without it every player who cleared the
			   line once lasted a decade. */
			if (a >= 22 && rng.random() < (x >= 58 ? 0.01 : x >= 52 ? 0.06 : 0.2)) break;
			seasons.push({ age: a + 1, ovr: Math.round(x) });
		}
		return seasons;
	}

	function pct(sorted, p) {
		if (!sorted.length) return 0;
		const i = (sorted.length - 1) * p;
		const lo = Math.floor(i);
		const hi = Math.ceil(i);
		return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
	}

	/* The projection for one prospect: the median career year by year, the
	   spread of his peak and of how long he lasts, and a verdict. */
	function project(p, season, seed) {
		if (!p || !Number.isFinite(p.newOvr)) return null;
		const ovr = p.newOvr;
		const pot = Number.isFinite(p.newPot) ? p.newPot : ovr + 8;
		const age = draftAge(p, season);
		const rng = new Rng("pro-career|" + (seed || "") + "|" + p.key);
		const careers = [];
		for (let i = 0; i < SIMS; i++) careers.push(oneCareer(ovr, pot, age, rng.child("c" + i)));
		const peaks = careers.map((c) => (c.length ? Math.max.apply(null, c.map((s) => s.ovr)) : ovr))
			.sort((a, b) => a - b);
		const years = careers.map((c) => c.length).sort((a, b) => a - b);
		// The career whose peak is the median peak, so the curve shown is a real one.
		const mid = pct(peaks, 0.5);
		const typical = careers.slice().sort((a, b) =>
			Math.abs(peakOf(a, ovr) - mid) - Math.abs(peakOf(b, ovr) - mid) ||
			b.length - a.length)[0] || [];
		const peak = Math.round(mid);
		const verdict = VERDICTS.find((v) => peak >= v[0])[1];
		const bust = careers.filter((c) => c.length < 4 || peakOf(c, ovr) < 50).length / SIMS;
		const star = careers.filter((c) => peakOf(c, ovr) >= 65).length / SIMS;
		return {
			age, ovr, pot,
			peak, peakLow: Math.round(pct(peaks, 0.1)), peakHigh: Math.round(pct(peaks, 0.9)),
			peakAge: typical.length ? typical.reduce((b, s) => (s.ovr > b.ovr ? s : b), typical[0]).age : age,
			years: Math.round(pct(years, 0.5)), yearsLow: Math.round(pct(years, 0.1)),
			yearsHigh: Math.round(pct(years, 0.9)),
			bustChance: bust, starChance: star, verdict,
			curve: typical,
		};
	}
	function peakOf(c, ovr) { return c.length ? Math.max.apply(null, c.map((s) => s.ovr)) : ovr; }

	function projectClass(res) {
		const out = {};
		for (const p of (res && res.players) || []) out[p.key] = project(p, res.season, res.seed);
		return out;
	}

	/* ------------------------------------------------------- the mock draft */

	const TEAMS = [
		"Albany Anchors", "Anchorage Glaciers", "Birmingham Steel", "Boise Bison",
		"Buffalo Blizzard", "Charleston Tides", "Columbus Captains", "El Paso Suns",
		"Fresno Raisins", "Hartford Harbor", "Honolulu Waves", "Jacksonville Pilots",
		"Kansas City Monarchs", "Las Vegas Aces High", "Louisville Thoroughbreds",
		"Madison Lakers", "Memphis Blues", "Montreal Voyageurs", "Nashville Sound",
		"Norfolk Admirals", "Omaha Stockmen", "Pittsburgh Ironmen", "Portland Pines",
		"Providence Friars", "Raleigh Oaks", "Richmond Rebels", "Sacramento Gold",
		"San Juan Coquis", "St. Louis Arches", "Tulsa Roughnecks",
	];
	const GROUP = { PG: "guard", SG: "guard", G: "guard", GF: "wing", SF: "wing", F: "wing",
		PF: "big", FC: "big", C: "big" };

	function teamsFor(seed) {
		const rng = new Rng("mock-teams|" + (seed || ""));
		const teams = TEAMS.map((name, i) => {
			const strength = rng.normal(0, 1);
			const need = { guard: rng.random(), wing: rng.random(), big: rng.random() };
			// The weakest position is the one a front office talks about.
			const top = Object.keys(need).sort((a, b) => need[b] - need[a])[0];
			need[top] = Math.min(1, need[top] + 0.35);
			return { id: i, name, strength, need, needOf: top };
		});
		/* The order: worst first. A team at the bottom rebuilds; a team near the
		   top contends; between them the plan is a blend. */
		teams.sort((a, b) => a.strength - b.strength);
		teams.forEach((t, i) => {
			t.plan = clamp(i / (teams.length - 1), 0, 1);  // 0 = rebuild, 1 = win now
			t.planLabel = t.plan < 0.35 ? "rebuilding" : t.plan > 0.7 ? "contending" : "retooling";
		});
		// A lottery for the top four among the seven worst, weighted to the worst.
		const pool = teams.slice(0, 7);
		const order = [];
		const weights = [14, 13.4, 12.7, 12, 10.5, 9, 7.5];
		for (let k = 0; k < 4; k++) {
			const w = pool.map((t) => weights[teams.indexOf(t)]);
			const total = w.reduce((a, b) => a + b, 0);
			let r = rng.random() * total;
			let at = 0;
			while (r > w[at]) { r -= w[at]; at++; }
			order.push(pool.splice(at, 1)[0]);
		}
		return order.concat(pool, teams.slice(7));
	}

	/* What a prospect is worth to one team. */
	function valueTo(team, proj, p, rng) {
		const ceiling = proj ? proj.peak : p.newPot || p.newOvr;
		const ready = p.newOvr;
		const blend = ceiling * (1 - 0.45 * team.plan) + (ready + 8) * 0.45 * team.plan;
		const fit = (team.need[GROUP[p.newPos] || "wing"] || 0) * 4;
		const bust = proj ? proj.bustChance * (2 + 3 * team.plan) : 0;
		return { value: blend + fit - bust + rng.normal(0, 1.2), fit, ceiling, ready };
	}

	/* ------------------------------------------- the league's own teams

	   A class lifted out of a BBGM league export is drafted by that league's
	   teams, not by the invented thirty:

	     - each team's strength is BBGM's own team rating, computed from its
	       current roster (team/ovr.basketball.ts: the top ten overalls with
	       weights 0.3334 * e^(-0.1609 i), minus 102.98, as a predicted margin,
	       mapped to a 50-centred rating);
	     - its need at guard, wing and big is its positional depth (the mean of
	       its two best overalls at each) against the league's average depth
	       there, so a team whose bigs are thin drafts bigs;
	     - the order is the league's own draft picks for that season when it has
	       them (with their pick numbers if the lottery has been run, and with
	       traded picks owned by the team that holds them), and otherwise one
	       pick per team a round. Without pick numbers, teams are ordered worst
	       first by this season's record when games have been played and by
	       team rating when they have not, and the top four of round one are a
	       weighted lottery among the seven worst — a simplification of BBGM's
	       several lottery types, said as such in the view. */
	const TEAM_OVR = { a: 0.3334, b: -0.1609, k: 102.98 };

	function teamRating(ovrs) {
		const r = ovrs.slice().sort((x, y) => y - x).slice(0, 10);
		while (r.length < 10) r.push(0);
		let mov = -TEAM_OVR.k;
		for (let i = 0; i < 10; i++) mov += TEAM_OVR.a * Math.exp(TEAM_OVR.b * i) * r[i];
		return Math.round((mov * 50) / 15 + 50);
	}

	function lastRatings(p) {
		const rows = Array.isArray(p && p.ratings) ? p.ratings : [];
		return rows[rows.length - 1] || null;
	}

	function leagueDraft(league, season, seed) {
		if (!league || !Array.isArray(league.teams) || !Array.isArray(league.players)) return null;
		const BB = global.BBGM;
		const teams = league.teams.filter((t) => t && !t.disabled && Number.isFinite(Number(t.tid)))
			.map((t) => ({
				tid: Number(t.tid),
				name: [t.region, t.name].filter(Boolean).join(" ") || t.abbrev || ("Team " + t.tid),
				abbrev: t.abbrev || null, roster: [],
			}));
		if (teams.length < 2) return null;
		const byTid = new Map(teams.map((t) => [t.tid, t]));
		for (const p of league.players) {
			const t = byTid.get(Number(p && p.tid));
			const r = lastRatings(p);
			if (!t || !r) continue;
			const ovr = Number.isFinite(Number(r.ovr)) ? Number(r.ovr) : BB.ovr(r);
			const pos = r.pos || BB.pos(r);
			t.roster.push({ ovr, group: GROUP[pos] || "wing" });
		}
		const groups = ["guard", "wing", "big"];
		for (const t of teams) {
			t.ovr = teamRating(t.roster.map((x) => x.ovr));
			t.depth = {};
			for (const g of groups) {
				const top = t.roster.filter((x) => x.group === g).map((x) => x.ovr)
					.sort((x, y) => y - x).slice(0, 2);
				while (top.length < 2) top.push(30);
				t.depth[g] = (top[0] + top[1]) / 2;
			}
		}
		for (const g of groups) {
			const vals = teams.map((t) => t.depth[g]);
			const mean = vals.reduce((x, y) => x + y, 0) / vals.length;
			const sd = Math.sqrt(vals.reduce((x, y) => x + (y - mean) * (y - mean), 0) / vals.length) || 1;
			for (const t of teams) t.need = Object.assign(t.need || {}, { [g]: clamp(0.5 + (mean - t.depth[g]) / sd * 0.3, 0, 1) });
		}
		for (const t of teams) t.needOf = groups.slice().sort((x, y) => t.need[y] - t.need[x])[0];

		// Worst first: this season's record when games have been played, else rating.
		const recs = new Map();
		for (const ts of league.teamSeasons || []) {
			if (!ts || Number(ts.season) !== Number(season)) continue;
			const g = (Number(ts.won) || 0) + (Number(ts.lost) || 0) + (Number(ts.tied) || 0);
			if (g > 0) recs.set(Number(ts.tid), ((Number(ts.won) || 0) + 0.5 * (Number(ts.tied) || 0)) / g);
		}
		const usesRecord = recs.size >= teams.length / 2;
		const worse = (x, y) => (usesRecord
			? (recs.has(x.tid) ? recs.get(x.tid) : 0.5) - (recs.has(y.tid) ? recs.get(y.tid) : 0.5) : 0) ||
			x.ovr - y.ovr || x.tid - y.tid;
		const ranked = teams.slice().sort(worse);
		ranked.forEach((t, i) => {
			t.strength = i;
			t.plan = clamp(i / (ranked.length - 1), 0, 1);
			t.planLabel = t.plan < 0.35 ? "rebuilding" : t.plan > 0.7 ? "contending" : "retooling";
		});

		// The slots.
		const picks = (league.draftPicks || []).filter((dp) => dp && Number(dp.season) === Number(season) &&
			byTid.has(Number(dp.tid)) && byTid.has(Number(dp.originalTid)));
		const rng = new Rng("mock-league-lottery|" + (seed || ""));
		const lotteryOrder = () => {
			const pool = ranked.slice(0, 7);
			const weights = [14, 13.4, 12.7, 12, 10.5, 9, 7.5];
			const w = new Map(pool.map((t, i) => [t, weights[i]]));
			const out = [];
			for (let k = 0; k < 4 && pool.length; k++) {
				const total = pool.reduce((x, t) => x + w.get(t), 0);
				let r = rng.random() * total;
				let at = 0;
				while (at < pool.length - 1 && r > w.get(pool[at])) { r -= w.get(pool[at]); at++; }
				out.push(pool.splice(at, 1)[0]);
			}
			return out.concat(pool, ranked.slice(7));
		};
		let slots;
		let source;
		if (picks.length && picks.every((dp) => Number(dp.pick) > 0)) {
			slots = picks.slice().sort((x, y) => Number(x.round) - Number(y.round) || Number(x.pick) - Number(y.pick))
				.map((dp) => ({ round: Number(dp.round), team: byTid.get(Number(dp.tid)),
					via: Number(dp.tid) !== Number(dp.originalTid) ? byTid.get(Number(dp.originalTid)) : null }));
			source = "the league's draft order";
		} else {
			const first = lotteryOrder();
			const rounds = picks.length
				? Math.max.apply(null, picks.map((dp) => Number(dp.round) || 1)) : 2;
			slots = [];
			for (let round = 1; round <= rounds; round++) {
				const order = round === 1 ? first : ranked;
				for (const orig of order) {
					let owner = orig;
					if (picks.length) {
						const dp = picks.find((x) => Number(x.round) === round && Number(x.originalTid) === orig.tid);
						if (!dp) continue;   // the pick does not exist (forfeited, or never made)
						owner = byTid.get(Number(dp.tid));
					}
					slots.push({ round, team: owner, via: owner !== orig ? orig : null });
				}
			}
			source = (picks.length ? "the league's picks" : "one pick per team a round") +
				", ordered worst first by " + (usesRecord ? "this season's record" : "team rating") +
				", with a lottery for the top four";
		}
		return { teams: ranked, slots, source, league: true };
	}

	function depthText(t) {
		return t && t.depth ? "G " + Math.round(t.depth.guard) + " · W " + Math.round(t.depth.wing) +
			" · B " + Math.round(t.depth.big) : "";
	}

	function mockDraft(res, opts) {
		opts = opts || {};
		const rounds = opts.rounds || 2;
		const seed = (res && res.seed) || "";
		const projections = opts.projections || projectClass(res);
		let plan = opts.league ? leagueDraft(opts.league, res && res.season, seed) : null;
		if (!plan) {
			const order = teamsFor(seed);
			const slots = [];
			for (let round = 1; round <= rounds; round++) {
				for (const team of order) slots.push({ round, team, via: null });
			}
			plan = { teams: order, slots, source: "thirty invented teams", league: false };
		}
		const pool = ((res && res.board) || (res && res.players) || []).slice();
		const picks = [];
		let n = 0;
		const inRound = {};
		for (const slot of plan.slots) {
			if (!pool.length) break;
			const team = slot.team;
			n++;
			inRound[slot.round] = (inRound[slot.round] || 0) + 1;
			const rng = new Rng("mock-pick|" + seed + "|" + n);
			let best = null;
			for (const p of pool) {
				const v = valueTo(team, projections[p.key], p, rng.child(p.key));
				if (!best || v.value > best.v.value) best = { p, v };
			}
			pool.splice(pool.indexOf(best.p), 1);
			const consensus = best.p.boardRank || null;
			const reach = consensus ? consensus - n : 0;
			const why = best.v.fit >= 3 && team.needOf === (GROUP[best.p.newPos] || "wing")
				? "fills the need at " + team.needOf
				: team.plan < 0.35 && best.v.ceiling >= best.v.ready + 10 ? "bets on the ceiling"
				: team.plan > 0.7 ? "ready to play now"
				: "best available";
			picks.push({
				pick: n, round: slot.round, inRound: inRound[slot.round],
				team: team.name, via: slot.via ? slot.via.name : null,
				teamPlan: team.planLabel, teamNeed: team.needOf,
				teamOvr: Number.isFinite(team.ovr) ? team.ovr : null, teamDepth: depthText(team),
				key: best.p.key, name: best.p.name, pos: best.p.newPos,
				ovr: best.p.newOvr, pot: best.p.newPot, consensus, reach,
				why: reach >= 8 ? why + " (a reach: No. " + consensus + " on the board)"
					: reach <= -8 ? why + " (a steal: No. " + consensus + " on the board)" : why,
				projection: projections[best.p.key] || null,
			});
		}
		return {
			teams: plan.teams.map((t) => ({ name: t.name, plan: t.planLabel, need: t.needOf,
				ovr: Number.isFinite(t.ovr) ? t.ovr : null, depth: depthText(t) })),
			picks, undrafted: pool.map((p) => p.key), source: plan.source, fromLeague: plan.league,
		};
	}

	global.Pro = { project, projectClass, mockDraft, teamsFor, leagueDraft, teamRating, draftAge,
		VERDICTS, REPLACEMENT };
})(typeof window !== "undefined" ? window : self);
