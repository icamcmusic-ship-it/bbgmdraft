/* Builds the college (and pro) landscape the prospects play inside: program
   strength from BBGM draft frequency + conference, synthetic teammates, a full
   regular season, conference tournaments, and the resulting records. */
(function (global) {
	"use strict";

	const { clamp } = global.BBGMRng;
	const C = global.Colleges;

	// "College talent" scale, 0-100. Distinct from BBGM ovr: an 18-year-old
	// with a 40 NBA ovr is already a monster in college.
	function prospectTalent(ovr, pot) {
		return clamp(44 + (ovr - 20) * 1.55 + (pot - ovr) * 0.10, 20, 99);
	}

	function programLevel(name, rng) {
		const conf = C.CONFERENCES[C.conferenceOf(name)];
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
		for (const name of C.names) {
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
				conf: C.conferenceOf(name),
				prestige: C.prestige(name),
				level,
				members,
				rating: teamRating(members),
				prospects,
				w: 0, l: 0, cw: 0, cl: 0,
				sos: 0, games: 0, quadWins: 0,
			};
		}
		return teams;
	}

	function winProb(a, b, homeEdge) {
		const diff = a - b + (homeEdge || 0);
		return 1 / (1 + Math.exp(-diff / 7.5));
	}

	function playGame(rng, A, B, homeForA, cfg) {
		const noise = 1 + 0.35 * clamp(cfg.upsetFactor, 0, 3);
		const ra = A.rating + rng.normal(0, 5.0 * noise);
		const rb = B.rating + rng.normal(0, 5.0 * noise);
		const p = winProb(ra, rb, homeForA === 0 ? 0 : homeForA > 0 ? 3.2 : -3.2);
		return rng.random() < p;
	}

	function record(t, opp, won, conference) {
		if (won) { t.w++; if (conference) t.cw++; } else { t.l++; if (conference) t.cl++; }
		t.sos += opp.rating;
		t.games++;
		if (won && opp.rating > 70) t.quadWins++;
	}

	const CONF_GAMES = 18;
	const NON_CONF_GAMES = 13;

	// Pair teams up until everyone has played roughly `target` games, so every
	// program finishes with a comparable record regardless of league size.
	function pairUp(rng, pool, target, filterFn, onGame) {
		const need = new Map();
		for (const t of pool) need.set(t, target);
		let guard = 0;
		const maxGuard = pool.length * target * 6 + 500;
		while (guard++ < maxGuard) {
			const avail = pool.filter((t) => need.get(t) > 0);
			if (avail.length < 2) break;
			const a = avail[Math.floor(rng.random() * avail.length)];
			const pool2 = avail.filter((t) => t !== a);
			if (!pool2.length) { need.set(a, 0); continue; }
			let b = null;
			for (let tries = 0; tries < 14 && !b; tries++) {
				const cand = pool2[Math.floor(rng.random() * pool2.length)];
				if (!filterFn || filterFn(a, cand)) b = cand;
			}
			if (!b) b = pool2[Math.floor(rng.random() * pool2.length)];
			onGame(a, b);
			need.set(a, need.get(a) - 1);
			need.set(b, need.get(b) - 1);
		}
	}

	function simulateRegularSeason(teams, cfg, rng) {
		const names = C.names;

		for (const conf of Object.keys(C.byConference)) {
			const pool = C.byConference[conf].map((n) => teams[n]);
			pairUp(rng, pool, CONF_GAMES, null, (A, B) => {
				const aHome = rng.random() < 0.5 ? 1 : -1;
				const won = playGame(rng, A, B, aHome, cfg);
				record(A, B, won, true);
				record(B, A, !won, true);
			});
		}

		// Non-conference: teams mostly schedule near their own level, and the
		// bigger program usually hosts.
		const all = names.map((n) => teams[n]);
		pairUp(rng, all, NON_CONF_GAMES,
			(a, b) => a.conf !== b.conf &&
				rng.random() < Math.exp(-Math.abs(a.rating - b.rating) / 24) + 0.06,
			(A, B) => {
				const aHome = A.prestige > B.prestige ? 1 : -1;
				const won = playGame(rng, A, B, aHome, cfg);
				record(A, B, won, false);
				record(B, A, !won, false);
			});

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
		for (const conf of Object.keys(C.byConference)) {
			const seeds = C.byConference[conf]
				.map((n) => teams[n])
				.sort((a, b) => b.cw - b.cl - (a.cw - a.cl) || b.rating - a.rating);
			let field = seeds.slice(0, Math.min(12, seeds.length));
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
					const won = playGame(rng, A, B, 0, cfg);
					const wTeam = won ? A : B;
					bracketLog.push({ a: A.name, b: B.name, winner: wTeam.name });
					(won ? A : B).ctW = ((won ? A : B).ctW || 0) + 1;
					next.push(wTeam);
				}
				field = next;
			}
			results[conf] = { champ: field[0], seeds, log: bracketLog };
			field[0].confTourneyChamp = true;
			const best = seeds[0];
			best.confRegularChamp = true;
		}
		return results;
	}

	global.TeamsSim = {
		buildPrograms, simulateRegularSeason, simulateConferenceTournaments,
		prospectTalent, teamRating, winProb, playGame, rotationWeights,
	};
})(window);
