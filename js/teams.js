/* Builds the college (and pro) landscape the prospects play inside: program
   strength from BBGM draft frequency + conference, synthetic teammates, a full
   regular season, conference tournaments, and the resulting records. */
(function (global) {
	"use strict";

	const { clamp } = global.BBGMRng;
	const C = global.Colleges;

	// "College talent" scale, 0-100. Distinct from BBGM ovr: an 18-year-old
	// with a 40 NBA ovr is already very good in college — but not automatically
	// the best player on a blue-blood roster. The slope is chosen so an ovr-40
	// second-rounder (~67) is comparable to a top program's returning core
	// (makeFiller mean 0.72*level+6 ≈ 71 at level 90), while an ovr-55+
	// lottery talent (~81) clearly leads any roster. No saturation until the
	// clamp at ovr ~73, so the top of a class stays ordered.
	function prospectTalent(ovr, pot) {
		return clamp(30 + ovr * 0.92 + (pot - ovr) * 0.15, 20, 97);
	}

	function programLevel(name, rng) {
		const conf = C.CONFERENCES[C.conferenceOf(name)] || C.CONFERENCES.Independent;
		const base = 0.45 * C.prestige(name) + 0.4 * conf.strength;
		// Year-to-year variance: good programs are steadier than bad ones.
		const vol = 9 - 0.03 * C.prestige(name);
		return clamp(base + rng.normal(0, vol), 12, 95);
	}

	// Returning players are good, but not "NBA draft prospect" good: a top
	// program's supporting cast still sits well below its lottery freshman.
	function makeFiller(rng, level, i) {
		const mean = 0.72 * level + 6;
		const talent = clamp(rng.normal(mean, 8.5) - i * 1.6, 6, 95);
		return { filler: true, talent, name: "roster" + i };
	}

	function rotationWeights(n) {
		const w = [1, 0.96, 0.9, 0.84, 0.76, 0.6, 0.45, 0.3, 0.18, 0.1];
		return w.slice(0, n);
	}

	function teamRating(members) {
		const sorted = members.slice().sort((a, b) => b.talent - a.talent).slice(0, 9);
		const w = rotationWeights(sorted.length);
		let num = 0;
		let den = 0;
		for (let i = 0; i < sorted.length; i++) {
			num += sorted[i].talent * w[i];
			den += w[i];
		}
		return num / den;
	}

	/* Build every NCAA program for the season. prospectsBySchool maps a college
	   name to the rebuilt draft prospects who play there. */
	function buildPrograms(prospectsBySchool, rng) {
		const teams = {};
		// Colleges outside the built-in 353 (league files drift across BBGM
		// versions) become independent mid-level programs instead of crashing.
		const extra = Object.keys(prospectsBySchool).filter((n) => !C.COLLEGES[n]);
		for (const name of C.names.concat(extra)) {
			const trng = rng.child("prog:" + name);
			const level = programLevel(name, trng);
			const prospects = prospectsBySchool[name] || [];
			const members = prospects.map((p) => ({
				filler: false,
				player: p,
				talent: prospectTalent(p.newOvr, p.newPot),
			}));
			const nFill = Math.max(6, 10 - members.length);
			for (let i = 0; i < nFill; i++) members.push(makeFiller(trng, level, i));

			teams[name] = {
				name,
				conf: C.conferenceOf(name) || "Independent",
				prestige: C.prestige(name),
				level,
				members,
				rating: teamRating(members),
				prospects,
				w: 0, l: 0, cw: 0, cl: 0,
				sos: 0, games: 0, quadWins: 0,
				log: [],
				// How much better (or worse) this team is in March than in
				// November. Young rosters improve most.
				form: trng.normal(2.0, 4.5),
			};
		}
		return teams;
	}

	function winProb(a, b, homeEdge) {
		const diff = a - b + (homeEdge || 0);
		return 1 / (1 + Math.exp(-diff / 7.5));
	}

	/* A team's rating on a given day. Programs are not frozen at build time:
	   freshmen figure it out, veterans wear down, and a team that is 8 points
	   better in March than in November is the most ordinary thing in college
	   basketball. `when` is 0 (first game) to 1 (last). */
	function ratingOn(t, when) {
		const w = when === undefined ? 0.5 : clamp(when, 0, 1);
		return t.rating + (t.form || 0) * (w - 0.5) * 2;
	}

	/* Play one game and produce an actual score. The margin is drawn from the
	   rating gap; the total comes from pace, so a grind-it-out league produces
	   58-55 finals and a track meet produces 88-84. Ties go to overtime. */
	function playGameScore(rng, A, B, homeForA, cfg, when) {
		const noise = 1 + 0.35 * clamp(cfg.upsetFactor, 0, 3);
		const home = homeForA === 0 ? 0 : homeForA > 0 ? 3.2 : -3.2;
		const edge = ratingOn(A, when) - ratingOn(B, when) + home;
		// ~0.72 points of margin per rating point, plus real game-to-game noise.
		const margin = edge * 0.72 + rng.normal(0, 9.4 * noise);
		const pace = clamp((cfg.pace || 68) + (cfg.scoringEnv || 0) * 1.6, 58, 82);
		const total = clamp(pace * 2.06 + rng.normal(0, 9), 92, 190);
		let a = Math.round((total + margin) / 2);
		let b = Math.round((total - margin) / 2);
		let ot = 0;
		while (a === b) {
			// Overtime: five more minutes, and somebody has to win them.
			ot++;
			const swing = rng.normal(edge * 0.10, 4.2);
			a += Math.round(6 + swing / 2);
			b += Math.round(6 - swing / 2);
			if (ot > 4) { a += 1; break; }
		}
		return { a, b, ot, won: a > b };
	}

	function playGame(rng, A, B, homeForA, cfg, when) {
		return playGameScore(rng, A, B, homeForA, cfg, when).won;
	}

	function record(t, opp, won, conference, score, home, when) {
		if (won) { t.w++; if (conference) t.cw++; } else { t.l++; if (conference) t.cl++; }
		t.sos += opp.rating;
		t.games++;
		// Team ratings run mean ~38, p95 ~61 on this scale, so "quality win"
		// means beating a clearly-above-average opponent, not a near-unicorn.
		if (won && opp.rating > 55) t.quadWins++;
		// Kept so a prospect's best night can name a real opponent and date.
		t.log.push({
			opp: opp.name, won, conference: !!conference,
			pf: score ? score.us : null, pa: score ? score.them : null,
			ot: score ? score.ot : 0,
			home: home === undefined ? 0 : home,
			when: when === undefined ? 0.5 : when,
			quality: opp.rating,
		});
	}

	const CONF_GAMES = 18;
	const NON_CONF_GAMES = 13;

	/* Pair teams up so that EVERY team finishes with exactly `target` games.
	   The old version bailed out of its guard loop and left teams up to four
	   games short, so a 27-game team's 20-7 sat in the same table as a 31-game
	   team's 23-8. This one keeps matching the neediest teams until the need
	   vector is empty, which it always can be: the total need is even (each
	   game consumes two), so the only failure mode is a single team left
	   needing games, which the odd-total guard below rules out. */
	function pairUp(rng, pool, target, filterFn, onGame) {
		if (pool.length < 2) return;
		const need = new Map();
		for (const t of pool) need.set(t, target);
		// An odd (teams x target) product cannot be split into pairs; drop one
		// game from a random team so the rest come out exact.
		if ((pool.length * target) % 2 === 1) {
			const victim = pool[Math.floor(rng.random() * pool.length)];
			need.set(victim, target - 1);
		}
		let guard = 0;
		const maxGuard = pool.length * target * 8 + 2000;
		while (guard++ < maxGuard) {
			// Always serve the neediest team first. That keeps the remaining
			// need spread evenly instead of stranding one team at the end.
			const avail = pool.filter((t) => need.get(t) > 0)
				.sort((a, b) => need.get(b) - need.get(a));
			if (avail.length < 2) break;
			const a = avail[0];
			const rest = avail.slice(1);
			let b = null;
			// Prefer an opponent the filter likes, but never at the cost of
			// leaving the schedule short.
			for (let tries = 0; tries < 14 && !b; tries++) {
				const cand = rest[Math.floor(rng.random() * Math.min(rest.length, 24))];
				if (cand && (!filterFn || filterFn(a, cand))) b = cand;
			}
			if (!b) b = rest[Math.floor(rng.random() * rest.length)];
			onGame(a, b);
			need.set(a, need.get(a) - 1);
			need.set(b, need.get(b) - 1);
		}
	}

	function simulateRegularSeason(teams, cfg, rng) {
		const names = Object.keys(teams);
		const play = (A, B, aHome, conference) => {
			// Conference play sits later in the calendar than non-conference.
			const when = conference ? rng.uniform(0.35, 1) : rng.uniform(0, 0.55);
			const sc = playGameScore(rng, A, B, aHome, cfg, when);
			record(A, B, sc.won, conference, { us: sc.a, them: sc.b, ot: sc.ot }, aHome, when);
			record(B, A, !sc.won, conference, { us: sc.b, them: sc.a, ot: sc.ot }, -aHome, when);
		};

		// Out-of-database colleges land in "Independent", which has no members
		// in byConference — so they used to get no conference slate, no
		// conference tournament and no auto bid. They are grouped into a real
		// (if synthetic) conference instead, so a prospect at an unrecognised
		// school gets the same kind of season as everyone else.
		const confPools = {};
		for (const conf of Object.keys(C.byConference)) {
			confPools[conf] = C.byConference[conf].map((n) => teams[n]).filter(Boolean);
		}
		const indep = names.map((n) => teams[n]).filter((t) => t.conf === "Independent");
		if (indep.length >= 2) confPools.Independent = indep;

		for (const conf of Object.keys(confPools)) {
			const pool = confPools[conf];
			pairUp(rng, pool, CONF_GAMES, null, (A, B) => {
				play(A, B, rng.random() < 0.5 ? 1 : -1, true);
			});
		}

		// Non-conference: teams mostly schedule near their own level, and the
		// bigger program usually hosts.
		const all = names.map((n) => teams[n]);
		// A team short of a conference slate (a one-team synthetic conference)
		// makes up the difference in non-conference play, so everyone still
		// finishes on the same number of games.
		const shortfall = new Map();
		for (const t of all) shortfall.set(t, CONF_GAMES + NON_CONF_GAMES - t.games);
		const nonConfTarget = NON_CONF_GAMES;
		pairUp(rng, all, nonConfTarget,
			(a, b) => a.conf !== b.conf &&
				rng.random() < Math.exp(-Math.abs(a.rating - b.rating) / 24) + 0.06,
			(A, B) => {
				play(A, B, A.prestige > B.prestige ? 1 : -1, false);
			});

		// Anyone still short (a lone Independent, or the odd-total victim)
		// tops up against the other short teams.
		let guard = 0;
		const target = CONF_GAMES + NON_CONF_GAMES;
		while (guard++ < all.length * 4) {
			const short = all.filter((t) => t.games < target)
				.sort((a, b) => a.games - b.games);
			if (short.length < 2) break;
			play(short[0], short[1], 0, false);
		}

		for (const name of names) {
			const t = teams[name];
			t.sosAvg = t.games ? t.sos / t.games : 50;
			t.pct = t.games ? t.w / t.games : 0;
			// Resume score blends record, schedule and raw quality.
			t.resume = 100 * t.pct * 0.55 + (t.sosAvg - 45) * 0.9 + t.rating * 0.45 + t.quadWins * 0.9;
		}
	}

	/* Single-elimination conference tournament; returns {champ, runnerUp, seeds} */
	function simulateConferenceTournaments(teams, cfg, rng) {
		const results = {};
		const pools = {};
		for (const conf of Object.keys(C.byConference)) {
			pools[conf] = C.byConference[conf].map((n) => teams[n]).filter(Boolean);
		}
		const indep = Object.values(teams).filter((t) => t.conf === "Independent");
		if (indep.length >= 2) pools.Independent = indep;

		for (const conf of Object.keys(pools)) {
			const seeds = pools[conf]
				.slice()
				.sort((a, b) => b.cw - b.cl - (a.cw - a.cl) || b.rating - a.rating);
			if (!seeds.length) continue;
			let field = seeds.slice(0, Math.min(12, seeds.length));
			// Only teams actually in the bracket play tournament games — the
			// old code credited every program in the country with one, which
			// inflated everybody's games played.
			for (const t of field) t.inConfTourney = true;
			const bracketLog = [];
			while (field.length > 1) {
				const next = [];
				const n = field.length;
				const byes = Math.pow(2, Math.ceil(Math.log2(n))) - n;
				for (let i = 0; i < byes; i++) next.push(field[i]);
				const rest = field.slice(byes);
				for (let i = 0; i < rest.length / 2; i++) {
					const A = rest[i];
					const B = rest[rest.length - 1 - i];
					const sc = playGameScore(rng, A, B, 0, cfg, 1);
					const won = sc.won;
					const wTeam = won ? A : B;
					bracketLog.push({
						a: A.name, b: B.name, winner: wTeam.name,
						score: won ? sc.a + "-" + sc.b : sc.b + "-" + sc.a,
						ot: sc.ot,
					});
					(won ? A : B).ctW = ((won ? A : B).ctW || 0) + 1;
					next.push(wTeam);
				}
				field = next;
			}
			results[conf] = { champ: field[0], seeds, log: bracketLog, regularChamp: seeds[0] };
			field[0].confTourneyChamp = true;
			// Winning the league over 18 games is a real, separate honour from
			// winning three games in March; both are surfaced and both are
			// worth something on an award resume.
			seeds[0].confRegularChamp = true;
		}
		return results;
	}

	global.TeamsSim = {
		buildPrograms, simulateRegularSeason, simulateConferenceTournaments,
		prospectTalent, teamRating, winProb, playGame, playGameScore, ratingOn,
		rotationWeights, pairUp, CONF_GAMES, NON_CONF_GAMES,
	};
})(window);
