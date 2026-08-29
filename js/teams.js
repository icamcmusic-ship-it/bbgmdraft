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

	/* Returning players are good, but not "NBA draft prospect" good: a top
	   program's supporting cast still sits well below its lottery freshman.

	   The decay is convex, not linear. A linear `- i * 1.6` made a blue blood's
	   ninth man an NBA-adjacent player: at level 90 the whole ten-man group sat
	   between 71 and 57, so a solid first-round prospect (talent ~74) was the
	   fourth-best player on his own team and played 26 minutes. Real
	   blue-blood rosters are top-heavy — two or three future pros, then a
	   clear cliff to role players — so 0-1 stay strong and 5-9 fall away fast.

	   The mean slope is flattened at the same time (0.72*level + 6 ->
	   0.60*level + 12.6) so the top of a good roster no longer out-talents the
	   prospects who are supposed to lead it, while the weighted team rating
	   stays close to what it was (the convex decay removes more from the tail,
	   which the higher intercept puts back at the top). Flattening also closes
	   the tier gap from the other end: measured PPG ran 10.3 at a high major
	   against 17.1 at a low major for the same ovr, when the real gap is 4-7. */
	function makeFiller(rng, level, i) {
		const mean = 0.60 * level + 12.6;
		const talent = clamp(rng.normal(mean, 8.5) - Math.pow(i, 1.35) * 1.9, 6, 95);
		// Endurance drives how much of a rotation spot a player can actually
		// hold, and it is the one rating that never fed the minutes model.
		return {
			filler: true, talent, name: "roster" + i,
			endurance: clamp(rng.normal(0.52 - 0.02 * i, 0.10), 0.15, 0.95),
		};
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
	/* `postseason` decides whether the "March upsets" slider applies.

	   It used to apply to every game in the season, so a slider labelled
	   "March upsets" silently re-rolled November too — which is also why
	   changing it had to re-simulate the entire regular season rather than only
	   the bracket it names. Regular-season variance is a fixed, realistic
	   amount; the slider moves the postseason, which is what the label says. */
	const REGULAR_NOISE = 1.35;

	function playGameScore(rng, A, B, homeForA, cfg, when, postseason) {
		const noise = postseason
			? 1 + 0.35 * clamp(cfg.upsetFactor, 0, 3)
			: REGULAR_NOISE;
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
			// Overtime: five more minutes, and somebody has to win them. The
			// old loop bailed after 4OT by adding a single point outside the
			// scoring model, so a 5OT game was decided by fiat. Instead, keep
			// playing extra periods but widen the swing each time, which ends
			// the game inside the model within a couple more periods and still
			// produces a plausible 5OT box score.
			ot++;
			const swing = rng.normal(edge * 0.10, 4.2 + ot * 0.8);
			a += Math.round(6 + swing / 2);
			b += Math.round(6 - swing / 2);
		}
		return { a, b, ot, won: a > b };
	}

	function playGame(rng, A, B, homeForA, cfg, when, postseason) {
		return playGameScore(rng, A, B, homeForA, cfg, when, postseason).won;
	}

	/* Every game a team plays goes through here, regular season and postseason
	   alike. Before this, only simulateRegularSeason called record(): a
	   conference tournament run bumped `ctW` and an NCAA run bumped `ncaaWins`,
	   and neither touched w/l/log. A national champion was displayed as 25-6
	   when it had actually gone 34-6, the note line printed a record that
	   contradicted the postseason result printed beside it, and the prospect's
	   own GP (which counts postseason games) exceeded his team's games played.

	   `stage` is one of "reg" | "conf" | "ncaa" | "nit", so the schedule can be
	   read back by phase and a signature game can name the round it happened
	   in. */
	function record(t, opp, won, conference, score, home, when, stage) {
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
			stage: stage || "reg",
			round: score && score.round ? score.round : null,
		});
	}

	/* A postseason game, recorded on both teams at once. `when` is deliberately
	   above 1 so the chronological sort puts March after February. */
	function recordPostseason(A, B, sc, stage, when, round) {
		record(A, B, sc.won, false,
			{ us: sc.a, them: sc.b, ot: sc.ot, round }, 0, when, stage);
		record(B, A, !sc.won, false,
			{ us: sc.b, them: sc.a, ot: sc.ot, round }, 0, when, stage);
	}

	/* Chronological order, once every game has been played.

	   simulateRegularSeason runs the whole conference loop before the whole
	   non-conference loop, so team.log came out conference-first regardless of
	   the `when` stamped on each game. Anything reading the log in order — the
	   signature game, a game log, "which games did he miss" — was reading the
	   season out of sequence, and a player who missed games always missed the
	   last N entries, i.e. always non-conference ones. */
	function finalizeSchedule(teams) {
		for (const name of Object.keys(teams)) {
			const t = teams[name];
			t.log.sort((a, b) => a.when - b.when);
			t.pct = t.games ? t.w / t.games : 0;
			t.sosAvg = t.games ? t.sos / t.games : 50;
		}
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
			record(A, B, sc.won, conference, { us: sc.a, them: sc.b, ot: sc.ot }, aHome, when, "reg");
			record(B, A, !sc.won, conference, { us: sc.b, them: sc.a, ot: sc.ot }, -aHome, when, "reg");
		};

		// Out-of-database colleges land in "Independent", which has no members
		// in byConference — so they used to get no conference slate, no
		// conference tournament and no auto bid. They are grouped into a real
		// (if synthetic) conference instead, so a prospect at an unrecognised
		// school gets the same kind of season as everyone else.
		const confPools = conferencePools(teams);

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
			// Frozen here: w/l keep growing through the postseason now, but a
			// selection resume is a regular-season resume.
			t.regW = t.w;
			t.regL = t.l;
			t.regGames = t.games;
			t.regPct = t.pct;
			// Resume score blends record, schedule and raw quality.
			t.resume = 100 * t.pct * 0.55 + (t.sosAvg - 45) * 0.9 + t.rating * 0.45 + t.quadWins * 0.9;
		}
	}

	/* "All-American First Team" (the AAC) would read as a national honour, so
	   the conference gets an abbreviation for label purposes. Shared with
	   awards.js via the export below so both spell it the same way. */
	function label(conf) {
		return conf === "American" ? "AAC" : conf;
	}

	/* Adopt a lone out-of-database program into the weakest real conference, so
	   it plays a conference slate and reaches a conference tournament. */
	function adoptConference(teams, team) {
		let best = null;
		let bestStrength = Infinity;
		for (const conf of Object.keys(C.byConference)) {
			if (C.byConference[conf].filter((n) => teams[n]).length < 4) continue;
			const strength = (C.CONFERENCES[conf] || {}).strength || 60;
			if (strength < bestStrength) { bestStrength = strength; best = conf; }
		}
		if (!best) return null;
		team.conf = best;
		team.adoptedConf = best;
		return best;
	}

	/* Conference -> its teams, the single place that decides where programs
	   outside the built-in 353 play.

	   Two or more of them form a synthetic "Independent" league. Exactly one
	   used to fall through every branch — a conference of one cannot play
	   itself — so that program got no conference slate, no conference
	   tournament and no auto bid, while two got all three. It is adopted into
	   the weakest real conference instead.

	   Every caller (the schedule, the conference tournaments, selection)
	   derives its pools from here, so all three agree on where a team plays. */
	function conferencePools(teams) {
		const pools = {};
		for (const conf of Object.keys(C.byConference)) {
			pools[conf] = C.byConference[conf].map((n) => teams[n]).filter(Boolean);
		}
		const extra = Object.values(teams).filter((t) => !C.COLLEGES[t.name]);
		if (extra.length >= 2) {
			for (const t of extra) t.conf = "Independent";
			pools.Independent = extra;
		} else if (extra.length === 1) {
			const host = extra[0].adoptedConf || adoptConference(teams, extra[0]);
			if (host && pools[host]) pools[host] = pools[host].concat(extra);
		}
		return pools;
	}

	/* Single-elimination conference tournament; returns {champ, runnerUp, seeds} */
	function simulateConferenceTournaments(teams, cfg, rng) {
		const results = {};
		const pools = conferencePools(teams);

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
			let ctRound = 0;
			while (field.length > 1) {
				const next = [];
				const n = field.length;
				const byes = Math.pow(2, Math.ceil(Math.log2(n))) - n;
				for (let i = 0; i < byes; i++) next.push(field[i]);
				const rest = field.slice(byes);
				ctRound++;
				// Just after the regular season, before the NCAA tournament.
				const when = 1.01 + ctRound * 0.004;
				for (let i = 0; i < rest.length / 2; i++) {
					const A = rest[i];
					const B = rest[rest.length - 1 - i];
					const sc = playGameScore(rng, A, B, 0, cfg, 1, true);
					const won = sc.won;
					const wTeam = won ? A : B;
					bracketLog.push({
						a: A.name, b: B.name, winner: wTeam.name,
						score: won ? sc.a + "-" + sc.b : sc.b + "-" + sc.a,
						ot: sc.ot,
					});
					(won ? A : B).ctW = ((won ? A : B).ctW || 0) + 1;
					recordPostseason(A, B, sc, "conf",
						when, label(conf) + " Tournament");
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
		rotationWeights, pairUp, record, recordPostseason, finalizeSchedule,
		REGULAR_NOISE,
		label, adoptConference, conferencePools, CONF_GAMES, NON_CONF_GAMES,
	};
})(typeof window !== "undefined" ? window : self);
