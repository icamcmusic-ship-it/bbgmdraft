/* AP Top 25 and the 68-team national tournament. */
(function (global) {
	"use strict";

	const T = global.TeamsSim;

	function apPoll(teams, n) {
		return Object.values(teams)
			.map((t) => ({
				team: t,
				score: t.resume + t.prestige * 0.06,
			}))
			.sort((a, b) => b.score - a.score)
			.slice(0, n || 25)
			.map((x, i) => {
				x.team.apRank = i + 1;
				return x.team;
			});
	}

	function selectField(teams) {
		const autos = [];
		const autoSet = new Set();
		// Every conference that actually has teams gets an auto bid, Independent
		// included — out-of-database schools used to be silently excluded from
		// the whole postseason.
		const pools = T.conferencePools(teams);
		for (const conf of Object.keys(pools)) {
			if (!pools[conf].length) continue;
			const champ = pools[conf].filter((t) => t.confTourneyChamp)[0];
			const pick = champ || pools[conf]
				.slice().sort((a, b) => b.resume - a.resume)[0];
			if (!pick) continue;
			autos.push(pick);
			autoSet.add(pick.name);
			pick.bid = "auto";
		}
		const atLarge = Object.values(teams)
			.filter((t) => !autoSet.has(t.name))
			.sort((a, b) => b.resume - a.resume)
			.slice(0, 68 - autos.length);
		for (const t of atLarge) t.bid = "at-large";

		const bubble = Object.values(teams)
			.filter((t) => !autoSet.has(t.name) && !t.bid)
			.sort((a, b) => b.resume - a.resume)
			.slice(0, 6);

		return { autos, atLarge, field: autos.concat(atLarge), bubble };
	}

	const REGIONS = ["East", "West", "South", "Midwest"];
	const SEED_ORDER = [1, 16, 8, 9, 5, 12, 4, 13, 6, 11, 3, 14, 7, 10, 2, 15];

	/* 68 teams -> First Four -> a proper four-region, one-of-each-seed bracket. */
	function simulate(teams, cfg, rng) {
		const sel = selectField(teams);

		const autos = sel.autos.slice().sort((a, b) => b.resume - a.resume);
		const atLarge = sel.atLarge.slice().sort((a, b) => b.resume - a.resume);

		/* The four weakest auto bids play for two 16 seeds; the four weakest
		   at-large bids play for two 11 seeds.

		   Everything below assumed at least 68 eligible programs and at least
		   four teams in each play-in pool, which is true of the built-in 353
		   and not true of a modded colleges.js or a class whose schools map to
		   a small custom set: splice(-4, 4) on a two-team pool takes both of
		   them, and the hardcoded field64 slice offsets then produced a
		   silently malformed bracket or threw. The field is sized from what is
		   actually there. */
		const playInAuto = Math.min(4, Math.max(0, autos.length - 1));
		const playInAtLarge = Math.min(4, Math.max(0, atLarge.length - 1));
		const autoPlayIn = playInAuto >= 2 ? autos.splice(-playInAuto, playInAuto) : [];
		const atLargePlayIn = playInAtLarge >= 2
			? atLarge.splice(-playInAtLarge, playInAtLarge) : [];
		const firstFour = [];
		const runPlayIn = (list, seed) => {
			const adv = [];
			for (let i = 0; i < list.length; i += 2) {
				const a = list[i];
				const b = list[i + 1];
				if (!b) { adv.push(a); continue; }
				const sc = T.playGameScore(rng, a, b, 0, cfg, 1, true);
				T.recordPostseason(a, b, sc, "ncaa", 1.06, "First Four");
				const won = sc.won;
				const winner = won ? a : b;
				const loser = won ? b : a;
				firstFour.push({
					seed, a, b, winner,
					score: (won ? sc.a + "-" + sc.b : sc.b + "-" + sc.a) +
						(sc.ot ? (sc.ot > 1 ? " " + sc.ot + "OT" : " OT") : ""),
				});
				loser.ncaaResult = "Lost in the First Four";
				loser.ncaaSeed = seed;
				// Tracked separately from ncaaWins so round-name labelling
				// stays correct while the game still counts for GP.
				winner.ffWin = 1;
				adv.push(winner);
			}
			return adv;
		};
		const advAuto = runPlayIn(autoPlayIn, 16);
		const advAtLarge = runPlayIn(atLargePlayIn, 11);

		// Play-in winners are locked to the lines they played for (the two 11
		// seeds and the two 16 seeds), like the real tournament — they are not
		// re-seeded by resume into better lines.
		const main = autos.concat(atLarge).sort((a, b) => b.resume - a.resume);
		/* The seed-line offsets are derived from the field that exists. In a
		   full 68-team bracket this is exactly the old arithmetic — 40 teams on
		   lines 1-10, two on the 11 line plus the two play-in winners, sixteen
		   on lines 12-15, two on the 16 line plus the two play-in winners — and
		   in a smaller one it degrades to "seed everyone by resume" instead of
		   slicing past the end of the array. */
		const seatsFor = advAtLarge.length + advAuto.length;
		const full = main.length + seatsFor >= 64 && advAtLarge.length === 2 &&
			advAuto.length === 2;
		const field64 = full
			? main.slice(0, 40)                        // seed lines 1-10
				.concat(main.slice(40, 42), advAtLarge)  // 11 line
				.concat(main.slice(42, 58))              // 12-15 lines
				.concat(main.slice(58, 60), advAuto)     // 16 line
				.slice(0, 64)
			: main.concat(advAtLarge, advAuto).slice(0, 64);

		// S-curve: overall 1-4 are the 1 seeds, 5-8 the 2 seeds, and so on, one
		// of each seed per region.
		const regions = { East: [], West: [], South: [], Midwest: [] };
		field64.forEach((team, i) => {
			const seed = Math.floor(i / 4) + 1;
			const band = Math.floor(i / 4);
			const order = band % 2 === 0 ? REGIONS : REGIONS.slice().reverse();
			regions[order[i % 4]].push({ seed, team });
		});
		// A field too small to fill four regions leaves some empty; the round
		// loop below already skips an unpaired team, but an empty region has no
		// champion at all, so the Final Four has to be drawn from what is left.
		const liveRegions = REGIONS.filter((r) => regions[r].length);

		const ROUND_NAME = ["Round of 64", "Round of 32", "Sweet 16", "Elite Eight"];
		const regionResults = {};
		for (const r of liveRegions) {
			const bySeed = {};
			for (const x of regions[r]) bySeed[x.seed] = x;
			let alive = SEED_ORDER.map((sd) => bySeed[sd]).filter(Boolean);
			const regionRounds = [];
			while (alive.length > 1) {
				const next = [];
				const games = [];
				const roundName = ROUND_NAME[regionRounds.length] || "Regional";
				for (let i = 0; i < alive.length; i += 2) {
					const A = alive[i];
					const B = alive[i + 1];
					if (!B) { next.push(A); continue; }
					const sc = T.playGameScore(rng, A.team, B.team, 0, cfg, 1, true);
					T.recordPostseason(A.team, B.team, sc, "ncaa",
						1.07 + regionRounds.length * 0.01, roundName);
					const won = sc.won;
					const winner = won ? A : B;
					const loser = won ? B : A;
					games.push({
						region: r, a: A, b: B, winner,
						upset: winner.seed > loser.seed + 2,
						score: (won ? sc.a + "-" + sc.b : sc.b + "-" + sc.a) +
							(sc.ot ? (sc.ot > 1 ? " " + sc.ot + "OT" : " OT") : ""),
					});
					winner.team.ncaaWins = (winner.team.ncaaWins || 0) + 1;
					next.push(winner);
				}
				regionRounds.push(games);
				alive = next;
			}
			regionResults[r] = { seeds: regions[r], rounds: regionRounds, champ: alive[0] };
		}

		let ff = liveRegions.map((r) => regionResults[r].champ).filter(Boolean);
		// Pad an under-filled bracket so the Final Four is still four teams.
		while (ff.length > 1 && ff.length % 2 === 1) ff = ff.slice(0, ff.length - 1);
		const semis = [];
		const finalists = [];
		for (let i = 0; i + 1 < ff.length; i += 2) {
			const sc = T.playGameScore(rng, ff[i].team, ff[i + 1].team, 0, cfg, 1, true);
			T.recordPostseason(ff[i].team, ff[i + 1].team, sc, "ncaa", 1.12, "Final Four");
			const won = sc.won;
			const winner = won ? ff[i] : ff[i + 1];
			semis.push({
				a: ff[i], b: ff[i + 1], winner,
				score: (won ? sc.a + "-" + sc.b : sc.b + "-" + sc.a) +
					(sc.ot ? (sc.ot > 1 ? " " + sc.ot + "OT" : " OT") : ""),
			});
			winner.team.ncaaWins = (winner.team.ncaaWins || 0) + 1;
			finalists.push(winner);
		}
		if (finalists.length < 2) finalists.push(finalists[0] || ff[0]);
		const finalSc = T.playGameScore(rng, finalists[0].team, finalists[1].team, 0, cfg, 1, true);
		T.recordPostseason(finalists[0].team, finalists[1].team, finalSc, "ncaa", 1.13,
			"National Championship");
		const wonFinal = finalSc.won;
		const champion = wonFinal ? finalists[0] : finalists[1];
		const runnerUp = wonFinal ? finalists[1] : finalists[0];
		const finalScore = (wonFinal ? finalSc.a + "-" + finalSc.b : finalSc.b + "-" + finalSc.a) +
			(finalSc.ot ? (finalSc.ot > 1 ? " " + finalSc.ot + "OT" : " OT") : "");
		champion.team.ncaaWins = (champion.team.ncaaWins || 0) + 1;

		for (const r of liveRegions) {
			for (const x of regionResults[r].seeds) {
				const wins = x.team.ncaaWins || 0;
				x.team.ncaaSeed = x.seed;
				x.team.ncaaRegion = r;
				x.team.ncaaResult =
					x.team === champion.team ? "National Champion"
					: x.team === runnerUp.team ? "National Runner-Up"
					: wins >= 4 ? "Lost in the Final Four"
					: "Lost in the " + ROUND_NAME[wins];
			}
		}

		const nit = simulateNit(teams, sel, cfg, rng.child("nit"));

		return {
			selection: sel, firstFour, regions: regionResults, semis,
			final: { a: finalists[0], b: finalists[1], winner: champion, score: finalScore },
			champion, runnerUp, finalFour: ff, nit,
		};
	}

	/* The NIT. A fringe prospect's team plays somewhere in March, and "made a
	   run to the NIT semifinals" is a real line on a scouting report; before
	   this, missing the 68 meant the season simply stopped. 32 teams, the best
	   resumes left on the board, single elimination. */
	function simulateNit(teams, sel, cfg, rng) {
		const inField = new Set(sel.field.map((t) => t.name));
		const pool = Object.values(teams)
			.filter((t) => !inField.has(t.name))
			.sort((a, b) => b.resume - a.resume)
			.slice(0, 32);
		if (pool.length < 2) return null;
		for (const t of pool) t.nitBid = true;
		const NIT_ROUNDS = ["NIT First Round", "NIT Second Round", "NIT Quarterfinal",
			"NIT Semifinal", "NIT Championship"];
		let alive = pool.slice();
		const rounds = [];
		let r = 0;
		while (alive.length > 1) {
			const games = [];
			const next = [];
			const roundName = NIT_ROUNDS[r] || "NIT Round " + (r + 1);
			for (let i = 0; i < Math.floor(alive.length / 2); i++) {
				const A = alive[i];
				const B = alive[alive.length - 1 - i];
				const sc = T.playGameScore(rng, A, B, 0, cfg, 1, true);
				T.recordPostseason(A, B, sc, "nit", 1.065 + r * 0.01, roundName);
				const winner = sc.won ? A : B;
				winner.nitWins = (winner.nitWins || 0) + 1;
				games.push({
					a: A, b: B, winner, round: roundName,
					score: (sc.won ? sc.a + "-" + sc.b : sc.b + "-" + sc.a) +
						(sc.ot ? (sc.ot > 1 ? " " + sc.ot + "OT" : " OT") : ""),
				});
				next.push(winner);
			}
			if (alive.length % 2 === 1) next.push(alive[Math.floor(alive.length / 2)]);
			rounds.push(games);
			alive = next;
			r++;
		}
		const champ = alive[0];
		for (const t of pool) {
			const wins = t.nitWins || 0;
			t.nitResult = t === champ ? "NIT Champion"
				: wins >= 4 ? "Lost in the NIT Championship"
				: wins >= 3 ? "Lost in the NIT Semifinal"
				: wins >= 2 ? "Lost in the NIT Quarterfinal"
				: wins >= 1 ? "Lost in the NIT Second Round"
				: "Lost in the NIT First Round";
		}
		if (champ) champ.nitChamp = true;
		return { field: pool, rounds, champion: champ };
	}

	global.Tournament = { apPoll, simulate, selectField, simulateNit, REGIONS, SEED_ORDER };
})(typeof window !== "undefined" ? window : self);
