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

	/* Regular-season games only.

	   Conference-tournament games belong on a real resume — a bid stealer's
	   run changes nothing here, and the two seed it knocked out arrives at
	   Selection Sunday with the same NET it had on Saturday morning — but
	   adding them was measured and put five seeds past twelve seeds 81% of
	   the time against a real 64% and the band's 78% ceiling: championship
	   week is played on neutral floors against the rest of your own league,
	   and folding it into a NET built for a 31-game schedule sharpens the
	   seed line rather than describing it. Left as it was, deliberately. */
	function regGames(t) {
		return t.log.filter((g) => g.stage === "reg");
	}

	/* ------------------------------------------------- results-based strength

	   Team Value Index: per-game credit, weighted by opponent strength and
	   location, where opponent strength is itself derived from results. Seeded
	   from win percentage and iterated to a fixed point: a few passes over 364
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
	   location: a team's rating is its average of (capped margin + the
	   opponent's rating - the location edge), which is the least-squares
	   fit of margin = own - opp + home.

	   SOLVED, not sampled. This used to run four Jacobi passes from the raw
	   margins and stop, with no centering: after four passes the numbers
	   still moved by a fraction of a point on every pass, the level drifted
	   with the schedule's shape, and the answer depended on the pass count
	   rather than the games. It now iterates to a fixed point — damped, so a
	   schedule that alternates between two groups of teams cannot make it
	   oscillate, and mean-centered every pass, because the system only fixes
	   ratings up to a constant (adding one point to everybody changes no
	   margin). Stops when no team moves by more than EFF_TOL, or at
	   EFF_MAX_ITERS. */
	const EFF_MAX_ITERS = 400;
	const EFF_TOL = 1e-4;
	const EFF_DAMP = 0.5;
	const MARGIN_CAP = 10;
	const HOME_EDGE = 1.4;

	function computeAdjEff(list, byName) {
		const idx = new Map();
		list.forEach((t, i) => idx.set(t.name, i));
		const n = list.length;
		// Per team: the capped, location-adjusted margins and the opponent
		// indices (-1 for an opponent outside the list, rated at the mean).
		const rows = list.map((t) => {
			const games = t.regGamesList.filter((g) => Number.isFinite(g.teamPts));
			const m = [];
			const o = [];
			for (const g of games) {
				m.push(clamp(g.teamPts - g.oppPts, -MARGIN_CAP, MARGIN_CAP) -
					HOME_EDGE * (g.home || 0));
				const opp = byName[g.opp];
				o.push(opp && idx.has(opp.name) ? idx.get(opp.name) : -1);
			}
			return { m, o };
		});
		let e = new Float64Array(n);
		const center = (v) => {
			let mean = 0;
			for (let i = 0; i < n; i++) mean += v[i];
			mean /= Math.max(1, n);
			for (let i = 0; i < n; i++) v[i] -= mean;
		};
		for (let i = 0; i < n; i++) {
			const r = rows[i];
			e[i] = r.m.length ? r.m.reduce((a, v) => a + v, 0) / r.m.length : 0;
		}
		center(e);
		let iters = 0;
		for (; iters < EFF_MAX_ITERS; iters++) {
			const next = new Float64Array(n);
			for (let i = 0; i < n; i++) {
				const r = rows[i];
				if (!r.m.length) { next[i] = 0; continue; }
				let sum = 0;
				for (let k = 0; k < r.m.length; k++) {
					sum += r.m[k] + (r.o[k] >= 0 ? e[r.o[k]] : 0);
				}
				next[i] = EFF_DAMP * e[i] + (1 - EFF_DAMP) * (sum / r.m.length);
			}
			center(next);
			let delta = 0;
			for (let i = 0; i < n; i++) delta = Math.max(delta, Math.abs(next[i] - e[i]));
			e = next;
			if (delta < EFF_TOL) { iters++; break; }
		}
		const out = new Map();
		list.forEach((t, i) => out.set(t.name, e[i]));
		out.iterations = iters;
		return out;
	}

	/* --------------------------------------------------------- quadrants

	   The standard NET quadrant map: opponent rank thresholds by location.
	   With 364 programs in the database the real ~360-team thresholds
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

	function zScorer(vals) {
		const mean = vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length);
		const sd = Math.sqrt(vals.reduce((a, v) => a + (v - mean) * (v - mean), 0) /
			Math.max(1, vals.length - 1)) || 1;
		return (v) => (v - mean) / sd;
	}

	/* NET: efficiency-led, results-checked — like the real one. Over whatever
	   games each team's `regGamesList` holds, so the weekly poll can ask what
	   the NET said on a given Monday. */
	function netScores(list, byName) {
		const strength = computeStrength(list, byName);
		const adjEff = computeAdjEff(list, byName);
		const zEff = zScorer(list.map((t) => adjEff.get(t.name)));
		const zStr = zScorer(list.map((t) => strength.get(t.name)));
		const score = new Map();
		for (const t of list) {
			score.set(t.name, 0.55 * zEff(adjEff.get(t.name)) + 0.45 * zStr(strength.get(t.name)));
		}
		return { strength, adjEff, score };
	}

	/* --------------------------------------------------------- main entry */

	function computeRankings(teams) {
		const list = Object.values(teams);
		const byName = teams;
		for (const t of list) t.regGamesList = regGames(t);

		const { strength, adjEff, score } = netScores(list, byName);
		const ranked = list.map((t) => ({ t, score: score.get(t.name) }))
			.sort((a, b) => b.score - a.score);
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
				// STRICTLY road. A neutral-court game is not a road game, and
				// counting it as one credited a team for the holiday tournament
				// it played in Orlando.
				if ((g.home || 0) < 0) { if (g.won) roadW++; else roadL++; }
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
	const WIN_WEEK_HOLD = 0.75;

	function weeklyPoll(teams, rng) {
		const list = Object.values(teams);
		const n = list.length;
		if (!n) return [];
		for (const t of list) t.regGamesList = regGames(t)
			.slice().sort((a, b) => a.when - b.when);
		const seasonGames = new Map(list.map((t) => [t.name, t.regGamesList]));

		/* HOW GOOD THE OPPONENT WAS, FROM RESULTS.

		   Strength of schedule, quality wins and bad losses all read
		   `g.quality`, which js/teams.js stamps on every log row straight off
		   `opp.rating` — the sim's hidden true strength. So the electorate
		   this file's header says votes on observables was reading the answer
		   key for three of its six features: a team that was secretly good and
		   lost anyway still handed out quality wins, and a 24-7 record against
		   a schedule that only LOOKED hard was marked down.

		   computeRankings has already run and has already answered the same
		   question from the game log alone (TVI plus margin-capped adjusted
		   efficiency, iterated to a fixed point). Its ranking is what a voter
		   has: results, and everyone else's results. */
		const byName = {};
		for (const t of list) byName[t.name] = t;
		/* AS OF THAT WEEK, not as of March. The first version read the
		   FINAL netRank at every checkpoint, so a December ballot knew which
		   of a team's November opponents would finish the season in the top
		   thirty — a win over a team that later collapsed was marked down
		   retroactively, and a team that won every game in a week could fall
		   three places on news from the future. Each checkpoint now ranks
		   opponents on the NET computed from the games played BY THEN (see
		   netByWeek below), blended early in the season with the reputation
		   every voter starts from, because a NET over two games is not a
		   thing anybody quotes. */
		let weekRank = null;
		const oppRank = (g) => {
			const o = byName[g.opp];
			if (!o) return n;
			const r = weekRank ? weekRank.get(o.name) : o.netRank;
			return Number.isFinite(r) ? r : n;
		};
		// On a 0-100 scale like the rating it replaces, so the voter weights
		// and the percentile that reads it keep their range.
		const oppStrength = (g) => 100 * (1 - (oppRank(g) - 1) / Math.max(1, n - 1));
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

		/* Drawn once per program per season, outside the weekly loop: it is
		   October's story and it does not change in January.

		   Weighted by how far up the ballot the program already is, because
		   that is who a preseason story is ABOUT. A flat draw moved teams
		   into and out of the top 25 rather than around inside it, and the
		   share of preseason top-25 teams that reached the tournament fell
		   from 66% to 63% — a noisier poll, not a more interesting one.
		   Above a reputation of 80 the story is worth several places; below
		   60 nobody is writing one.

		   And the draw is deliberately much smaller than variety alone would
		   want. Measured on the twelve seasons tools/test.js checks: with no
		   hype at all, 71.7% of preseason top-25 teams reach the tournament;
		   at a sigma of 6.5 that falls to 63.7%, past the 65% the harness
		   requires and past what a real preseason poll manages. At 3.5 it is
		   68% and the preseason No. 1 is a different program in eight seasons
		   of twenty rather than six. The point is WHICH blue blood is No. 1,
		   not whether the ballot is any good. */
		const hype = new Map();
		for (const t of list) {
			const base = 0.4 * (t.prestige || 0) +
				0.6 * (Number.isFinite(t.level) ? t.level : (t.prestige || 0));
			const w = clamp((base - 60) / 20, 0, 1);
			hype.set(t.name, w * rng.child("hype:" + t.name).normal(0, 3.5));
		}
		const repOf = (t) => 0.4 * (t.prestige || 0) +
			0.6 * (Number.isFinite(t.level) ? t.level : (t.prestige || 0)) +
			(hype.get(t.name) || 0);

		/* The opponent ranking a voter reads at a checkpoint: the NET over
		   the games played to date, faded in from the reputation ranking
		   over the first NET_RAMP_GAMES games of a typical team's season. */
		const NET_RAMP_GAMES = 8;
		const zRep = zScorer(list.map((t) => repOf(t)));
		const netByWeek = (cutoff) => {
			for (const t of list) {
				t.regGamesList = seasonGames.get(t.name).filter((g) => g.when <= cutoff);
			}
			const played = list.map((t) => t.regGamesList.length).sort((a, b) => a - b);
			const typical = played[played.length >> 1] || 0;
			const w = clamp(typical / NET_RAMP_GAMES, 0, 1);
			const net = w > 0 ? netScores(list, byName).score : null;
			const order = list.map((t) => ({
				name: t.name,
				s: (net ? w * net.get(t.name) : 0) + (1 - w) * zRep(repOf(t)),
			})).sort((a, b) => b.s - a.s);
			const rank = new Map();
			order.forEach((x, i) => rank.set(x.name, i + 1));
			for (const t of list) t.regGamesList = seasonGames.get(t.name);
			return rank;
		};

		const history = [];
		let lastRanked = null;
		for (let week = 0; week < WEEKS; week++) {
			const cutoff = week / (WEEKS - 1);
			weekRank = netByWeek(cutoff);
			// Features to date. Preseason (week 0) has no games: the ballot
			// runs on reputation, which is what a real preseason poll is.
			const feats = list.map((t) => {
				const played = t.regGamesList.filter((g) => g.when <= cutoff);
				const w = played.reduce((a, g) => a + (g.won ? 1 : 0), 0);
				const sos = played.length
					? played.reduce((a, g) => a + oppStrength(g), 0) / played.length : 50;
				/* Quality wins, graded and capped. A flat count over a 62
				   bar let a power-conference team collect seven of them off
				   its schedule alone and finish 17-14 in the final top 25;
				   a win over a 63 is not a win over an 80, and past five of
				   them a voter has stopped counting. Bad losses grade the
				   same way, and a loss to the middle of the country now
				   costs something rather than nothing. */
				const qual = Math.min(5.5, played.reduce((a, g) =>
					a + (g.won ? clamp((60 - oppRank(g)) / 45, 0, 1) : 0), 0));
				const bad = played.reduce((a, g) =>
					a + (!g.won ? clamp((oppRank(g) - 120) / 90, 0, 1) : 0), 0);
				const prevCut = (week - 1) / (WEEKS - 1);
				const thisWeek = week > 0 ? played.filter((g) => g.when > prevCut) : [];
				return {
					weekPlayed: thisWeek.length,
					weekLost: thisWeek.filter((g) => !g.won).length,
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
					/* Plus this OCTOBER's story, which is neither the program's
					   reputation nor its true level: a recruiting class
					   everybody watched, a transfer haul, a returning senior
					   who nearly went pro. Without it the preseason ballot is
					   a table — the same program was voted No. 1 in eight of
					   twenty seasons and the top ten was the same nine names
					   — because both terms it read are stable by design. It
					   moves the ballot and nothing else: the season is played
					   on the level, and a preseason No. 1 that was hype finds
					   that out in November. */
					reputation: repOf(t),
				};
			});
			const sosPct = pctRank(feats.map((f) => f.sos));
			const presPct = pctRank(feats.map((f) => f.reputation));

			/* Voters only ever score a CANDIDATE set — the teams a real voter
			   actually considers: the top of the shared feature score plus
			   everyone ranked anywhere last week. Scoring all 364 for all 60
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
					let sc = voter.prev && voter.prev.has(i)
						? INERTIA * voter.prev.get(i) + (1 - INERTIA) * base
						: base;
					/* A week in which a team won every game it played is not
					   a week a voter marks it down for. Reputation fading
					   into results, and each opponent's NET moving as the
					   season fills in, could still pull an unbeaten week's
					   score under last week's — 8% of the time a team that
					   won all its games that week fell more than two places.
					   The voter holds WIN_WEEK_HOLD of the ground: it can
					   still slip when others jump it, and a little on its
					   own, but a win does not read as a loss. */
					if (voter.prev && voter.prev.has(i) && f.weekPlayed > 0 && f.weekLost === 0) {
						const pv = voter.prev.get(i);
						if (sc < pv) sc = pv - (1 - WIN_WEEK_HOLD) * (pv - sc);
					}
					scores.set(i, sc);
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
		VOTERS, WEEKS, INERTIA, WIN_WEEK_HOLD,
		computeAdjEff, netScores, MARGIN_CAP, HOME_EDGE,
	};
})(typeof window !== "undefined" ? window : self);
