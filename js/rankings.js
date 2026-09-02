/* Results-based rankings: a NET-style rating built from what actually happened
   on the floor, quadrant records, a committee selection score, and a weekly AP
   poll voted by a persistent electorate.

   The old model was two lines: the AP poll was `resume + prestige * 0.06`
   computed once, and selection was a single sort of `resume` — a formula that
   read `t.rating`, the sim's hidden true strength. The committee was peeking
   at the answer key. Everything in this file is derived from OBSERVABLE
   results: the game log (opponent, won/lost, score, home/away, date), and
   prestige only where real voters use reputation (the preseason ballot).

   Everything here reads regular-season games only (g.stage === "reg"), which
   is what a selection resume is. */
(function (global) {
	"use strict";

	const { clamp } = global.BBGMRng;

	function regGames(t) {
		return t.log.filter((g) => g.stage === "reg");
	}

	/* ------------------------------------------------- results-based strength

	   Team Value Index: per-game credit, weighted by opponent strength and
	   location, where opponent strength is itself derived from results. Seeded
	   from win percentage and iterated to a fixed point: a few passes over 368
	   teams is a few milliseconds, and after 4 passes the ordering is stable. */
	const TVI_PASSES = 4;

	function computeStrength(list, byName) {
		const s = new Map();
		for (const t of list) s.set(t.name, 100 * (t.regGamesList.length
			? t.regGamesList.reduce((a, g) => a + (g.won ? 1 : 0), 0) / t.regGamesList.length
			: 0.5));
		for (let pass = 0; pass < TVI_PASSES; pass++) {
			// Percentile of strength, so the credit scale is stable across
			// seasons whatever the absolute numbers do.
			const sorted = list.map((t) => s.get(t.name)).sort((a, b) => a - b);
			const pctOf = (v) => {
				let lo = 0;
				let hi = sorted.length;
				while (lo < hi) {
					const mid = (lo + hi) >> 1;
					if (sorted[mid] < v) lo = mid + 1; else hi = mid;
				}
				return sorted.length > 1 ? lo / (sorted.length - 1) : 0.5;
			};
			const next = new Map();
			for (const t of list) {
				let credit = 0;
				const games = t.regGamesList;
				if (!games.length) { next.set(t.name, 50); continue; }
				for (const g of games) {
					const opp = byName[g.opp];
					const oppPct = opp ? pctOf(s.get(opp.name)) : 0.5;
					// A road win is worth more than a home win; a home loss
					// costs more than a road loss.
					if (g.won) {
						const locW = g.home < 0 ? 1.35 : g.home > 0 ? 1.0 : 1.15;
						credit += (0.35 + 1.05 * oppPct) * locW;
					} else {
						const locW = g.home > 0 ? 1.35 : g.home < 0 ? 1.0 : 1.15;
						credit -= (1.4 - 1.05 * oppPct) * locW;
					}
				}
				next.set(t.name, credit / games.length);
			}
			// Renormalize onto a stable 0-100-ish scale for the next pass.
			const vals = list.map((t) => next.get(t.name));
			const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
			const sd = Math.sqrt(vals.reduce((a, v) => a + (v - mean) * (v - mean), 0) /
				Math.max(1, vals.length - 1)) || 1;
			for (const t of list) {
				s.set(t.name, 50 + 16 * ((next.get(t.name) - mean) / sd));
			}
		}
		return s;
	}

	/* -------------------------------------------- adjusted net efficiency

	   Per-game margin, capped at 10 points like the real NET so blowouts
	   cannot reward running up the score, adjusted for opponent quality and
	   location by the same fixed-point iteration. */
	const EFF_PASSES = 4;
	const MARGIN_CAP = 10;
	const HOME_EDGE = 1.4;

	function computeAdjEff(list, byName) {
		const e = new Map();
		const rawMargin = (t) => {
			const games = t.regGamesList.filter((g) => Number.isFinite(g.pf));
			if (!games.length) return 0;
			return games.reduce((a, g) =>
				a + clamp(g.pf - g.pa, -MARGIN_CAP, MARGIN_CAP), 0) / games.length;
		};
		for (const t of list) e.set(t.name, rawMargin(t));
		for (let pass = 0; pass < EFF_PASSES; pass++) {
			const next = new Map();
			for (const t of list) {
				const games = t.regGamesList.filter((g) => Number.isFinite(g.pf));
				if (!games.length) { next.set(t.name, 0); continue; }
				let sum = 0;
				for (const g of games) {
					const opp = byName[g.opp];
					sum += clamp(g.pf - g.pa, -MARGIN_CAP, MARGIN_CAP) +
						(opp ? e.get(opp.name) : 0) -
						HOME_EDGE * (g.home || 0);
				}
				next.set(t.name, sum / games.length);
			}
			for (const t of list) e.set(t.name, next.get(t.name));
		}
		return e;
	}

	/* --------------------------------------------------------- quadrants

	   The standard NET quadrant map: opponent rank thresholds by location.
	   With 368 programs in the database the real ~360-team thresholds
	   transfer almost directly. */
	const QUADS = [
		{ q: 1, home: 30, neutral: 50, away: 75 },
		{ q: 2, home: 75, neutral: 100, away: 135 },
		{ q: 3, home: 160, neutral: 200, away: 240 },
		{ q: 4, home: Infinity, neutral: Infinity, away: Infinity },
	];

	function quadOf(oppRank, home) {
		const key = home > 0 ? "home" : home < 0 ? "away" : "neutral";
		for (const row of QUADS) if (oppRank <= row[key]) return row.q;
		return 4;
	}

	/* --------------------------------------------------------- main entry */

	function computeRankings(teams) {
		const list = Object.values(teams);
		const byName = teams;
		for (const t of list) t.regGamesList = regGames(t);

		const strength = computeStrength(list, byName);
		const adjEff = computeAdjEff(list, byName);

		// NET: efficiency-led, results-checked — like the real one.
		const effVals = list.map((t) => adjEff.get(t.name));
		const strVals = list.map((t) => strength.get(t.name));
		const z = (vals) => {
			const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
			const sd = Math.sqrt(vals.reduce((a, v) => a + (v - mean) * (v - mean), 0) /
				Math.max(1, vals.length - 1)) || 1;
			return (v) => (v - mean) / sd;
		};
		const zEff = z(effVals);
		const zStr = z(strVals);
		const ranked = list.map((t) => ({
			t,
			score: 0.55 * zEff(adjEff.get(t.name)) + 0.45 * zStr(strength.get(t.name)),
		})).sort((a, b) => b.score - a.score);
		ranked.forEach((x, i) => {
			x.t.netRank = i + 1;
			x.t.netScore = x.score;
			x.t.tvi = strength.get(x.t.name);
			x.t.adjEff = adjEff.get(x.t.name);
		});

		// Quadrant records, off the final NET ranks.
		for (const t of list) {
			const q = { q1w: 0, q1l: 0, q2w: 0, q2l: 0, q3w: 0, q3l: 0, q4w: 0, q4l: 0 };
			let roadW = 0;
			let roadL = 0;
			for (const g of t.regGamesList) {
				const opp = byName[g.opp];
				const quad = quadOf(opp ? opp.netRank : list.length, g.home || 0);
				q["q" + quad + (g.won ? "w" : "l")]++;
				if ((g.home || 0) <= 0) { if (g.won) roadW++; else roadL++; }
			}
			t.quads = q;
			t.roadW = roadW;
			t.roadL = roadL;
			// Form down the stretch: the committee's "last 12".
			const last = t.regGamesList.slice().sort((a, b) => a.when - b.when).slice(-12);
			t.last12W = last.reduce((a, g) => a + (g.won ? 1 : 0), 0);
			t.last12L = last.length - t.last12W;
		}

		/* Committee score, over the things a committee actually reads: NET
		   rank, Q1 record, Q1+Q2 wins, bad losses, road record, stretch form,
		   and winning percentage. No t.rating anywhere. */
		for (const t of list) {
			const q = t.quads;
			t.committeeScore =
				-0.16 * t.netRank +
				1.35 * q.q1w + 0.45 * q.q2w -
				1.2 * q.q3l - 2.0 * q.q4l +
				0.55 * t.roadW +
				0.45 * t.last12W +
				14 * (t.regPct || 0);
		}
		/* Head-to-head among the bubble: a win over another team near the cut
		   is exactly the argument a committee room hears. Applied to a band
		   around the projected at-large line so it cannot reorder the top. */
		const byScore = list.slice().sort((a, b) => b.committeeScore - a.committeeScore);
		const band = byScore.slice(30, 60);
		const bandNames = new Set(band.map((t) => t.name));
		for (const t of band) {
			let h2h = 0;
			for (const g of t.regGamesList) {
				if (!bandNames.has(g.opp)) continue;
				h2h += g.won ? 0.35 : -0.2;
			}
			t.committeeScore += h2h;
		}
		for (const t of list) delete t.regGamesList;
		return { computed: true };
	}

	/* ------------------------------------------------------- weekly AP poll

	   A real electorate: `VOTERS` voters, each with a persistent bias vector
	   over record, schedule, quality wins, bad losses and an "eye test" prior
	   drawn once per team — submitting a 25-deep ballot at each checkpoint,
	   aggregated by the real points system (25 for a first-place vote down to
	   1). Ballots are anchored on the voter's previous week (`INERTIA`), which
	   is what produces the realistic behavior where a team does not fall far
	   after one loss. */
	const VOTERS = 60;
	const WEEKS = 15;          // preseason + 14 in-season checkpoints
	const INERTIA = 0.62;

	function weeklyPoll(teams, rng) {
		const list = Object.values(teams);
		const n = list.length;
		if (!n) return [];
		for (const t of list) t.regGamesList = regGames(t)
			.slice().sort((a, b) => a.when - b.when);

		// Voter biases, drawn once. Sum-normalized so every voter's ballot is
		// on the same scale; the VARIATION between voters is the point.
		const voters = [];
		for (let v = 0; v < VOTERS; v++) {
			const vr = rng.child("voter" + v);
			voters.push({
				wRecord: 1 + vr.uniform(-0.35, 0.35),
				wSos: 0.5 + vr.uniform(-0.25, 0.25),
				wQual: 0.8 + vr.uniform(-0.35, 0.35),
				wBad: 0.9 + vr.uniform(-0.4, 0.4),
				wEye: 0.35 + vr.uniform(-0.2, 0.25),
				// The persistent prior a voter carries about each program.
				eye: list.map(() => vr.normal(0, 1)),
				prev: null,   // last week's scores, for inertia
			});
		}

		// Percentile helper over a snapshot of values.
		const pctRank = (vals) => {
			const sorted = vals.slice().sort((a, b) => a - b);
			return (v) => {
				let lo = 0;
				let hi = sorted.length;
				while (lo < hi) {
					const mid = (lo + hi) >> 1;
					if (sorted[mid] < v) lo = mid + 1; else hi = mid;
				}
				return sorted.length > 1 ? lo / (sorted.length - 1) : 0.5;
			};
		};

		const history = [];
		let lastRanked = null;
		for (let week = 0; week < WEEKS; week++) {
			const cutoff = week / (WEEKS - 1);
			// Features to date. Preseason (week 0) has no games: the ballot
			// runs on reputation, which is what a real preseason poll is.
			const feats = list.map((t) => {
				const played = t.regGamesList.filter((g) => g.when <= cutoff);
				const w = played.reduce((a, g) => a + (g.won ? 1 : 0), 0);
				const sos = played.length
					? played.reduce((a, g) => a + (g.quality || 50), 0) / played.length : 50;
				const qual = played.reduce((a, g) =>
					a + (g.won && (g.quality || 0) > 62 ? 1 : 0), 0);
				const bad = played.reduce((a, g) =>
					a + (!g.won && (g.quality || 50) < 42 ? 1 : 0), 0);
				return {
					games: played.length,
					pct: played.length ? w / played.length : 0,
					sos, qual, bad,
					prestige: t.prestige || 0,
					/* What a panel that has watched practice knows. The
					   preseason ballot used to run on prestige alone, and
					   the program's LEVEL this season — the roster it
					   actually has, the down year, the breakout — is drawn
					   before the ballot and was hidden from it. Measured
					   over thirty seasons: the preseason No. 1 missed the
					   tournament in seven of them, preseason top-25 teams
					   made the field 58% of the time against a real 80-85%,
					   and preseason rank correlated with final NET at 0.21.
					   A real October poll is reputation with a look at the
					   roster, so reputation is prestige blended with a damped
					   read of the level. */
					reputation: 0.4 * (t.prestige || 0) +
						0.6 * (Number.isFinite(t.level) ? t.level : (t.prestige || 0)),
				};
			});
			const sosPct = pctRank(feats.map((f) => f.sos));
			const presPct = pctRank(feats.map((f) => f.reputation));

			/* Voters only ever score a CANDIDATE set — the teams a real voter
			   actually considers: the top of the shared feature score plus
			   everyone ranked anywhere last week. Scoring all 368 for all 60
			   voters at all 15 checkpoints tripled the postseason phase for
			   ballots that were identical below the top fifty. */
			/* Reputation fades out over the first REP_GAMES games rather than
			   vanishing at tip-off. The preseason ballot scored 0-6 on
			   reputation and the first in-season ballot scored 0-15 on
			   results, so a 2-0 Colgate out-scored a 1-1 Kansas in week one
			   by nearly the whole scale and the inertia term, anchored on a
			   number a third the size, could not hold it — measured, a
			   week-one AP No. 2 at Colgate. A real November poll is the
			   preseason poll with the losers moved down. */
			/* On the SAME SCALE as the results score. Reputation used to be
			   scored 0-6 against a results score that reaches 15, so even a
			   half-weighted 4-0 La Salle out-pointed a fully-reputed 1-1
			   Kentucky, and the inertia term, anchored on a 0-6 number, could
			   not hold last week's ballot either. */
			const REP_GAMES = 10;
			const REP_SCALE = 14;
			const ramp = (f) => Math.min(1, f.games / REP_GAMES);
			const resultsScore = (f) => 10 * f.pct + 4 * sosPct(f.sos) + f.qual - 1.4 * f.bad;
			const reputation = (f) => REP_SCALE * presPct(f.reputation);
			const shared = new Array(n);
			for (let i = 0; i < n; i++) {
				const f = feats[i];
				const r = ramp(f);
				shared[i] = r * resultsScore(f) + (1 - r) * reputation(f);
			}
			const candSet = new Set(
				shared.map((s, i) => i).sort((a, b) => shared[b] - shared[a]).slice(0, 50));
			if (lastRanked) for (const i of lastRanked) candSet.add(i);
			const cands = Array.from(candSet);

			const totals = new Array(n).fill(0);
			const firsts = new Array(n).fill(0);
			for (const voter of voters) {
				const scores = new Map();
				for (const i of cands) {
					const f = feats[i];
					const r = ramp(f);
					const base = r * (voter.wRecord * 10 * f.pct +
							voter.wSos * 4 * sosPct(f.sos) +
							voter.wQual * f.qual -
							voter.wBad * 1.4 * f.bad) +
						(1 - r) * reputation(f) +
						voter.wEye * voter.eye[i];
					scores.set(i, voter.prev && voter.prev.has(i)
						? INERTIA * voter.prev.get(i) + (1 - INERTIA) * base
						: base);
				}
				voter.prev = scores;
				// This voter's 25-deep ballot.
				const order = cands.slice().sort((a, b) => scores.get(b) - scores.get(a));
				for (let r = 0; r < 25 && r < order.length; r++) {
					totals[order[r]] += 25 - r;
					if (r === 0) firsts[order[r]]++;
				}
			}
			lastRanked = totals.map((p, i) => i).filter((i) => totals[i] > 0);
			const order = totals.map((p, i) => i).sort((a, b) => totals[b] - totals[a]);
			history.push({
				week,
				label: week === 0 ? "Preseason" : "Week " + week,
				ranks: order.slice(0, 25).map((i, r) => ({
					rank: r + 1,
					team: list[i].name,
					points: totals[i],
					firstPlace: firsts[i],
					record: feats[i].games
						? Math.round(feats[i].pct * feats[i].games) + "-" +
							(feats[i].games - Math.round(feats[i].pct * feats[i].games))
						: "",
				})),
				othersReceivingVotes: order.slice(25, 40)
					.filter((i) => totals[i] > 0)
					.map((i) => ({ team: list[i].name, points: totals[i] })),
			});
		}

		// Final week writes the season-long facts the rest of the sim reads.
		const final = history[history.length - 1];
		const rankOf = {};
		final.ranks.forEach((r) => { rankOf[r.team] = r.rank; });
		for (const t of list) {
			t.apRank = rankOf[t.name] || null;
			/* Every ranked team keeps its first-place votes, not just No. 1.
			   In a genuinely split year the No. 2 and No. 3 teams have firsts
			   and the model computed them — throwing them away at the last
			   line discarded exactly the close-year texture the poll was
			   built for. */
			const finalRow = t.apRank
				? final.ranks.filter((r) => r.team === t.name)[0] : null;
			t.apFirstPlace = finalRow ? finalRow.firstPlace : 0;
			t.apHistory = history.map((wk) => {
				const row = wk.ranks.filter((r) => r.team === t.name)[0];
				return row ? row.rank : null;
			});
			const peaks = t.apHistory.filter((r) => r !== null);
			t.apPeak = peaks.length ? Math.min.apply(null, peaks) : null;
			t.apPreseason = t.apHistory[0];
			delete t.regGamesList;
		}
		return history;
	}

	global.Rankings = {
		computeRankings, weeklyPoll, quadOf, QUADS,
		VOTERS, WEEKS, INERTIA,
	};
})(typeof window !== "undefined" ? window : self);
