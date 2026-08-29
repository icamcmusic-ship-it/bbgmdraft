/* AP Top 25 and the 68-team national tournament. */
(function (global) {
	"use strict";

	const C = global.Colleges;
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
		for (const conf of Object.keys(C.byConference)) {
			const champ = C.byConference[conf]
				.map((n) => teams[n])
				.filter((t) => t.confTourneyChamp)[0];
			const pick = champ || C.byConference[conf]
				.map((n) => teams[n])
				.sort((a, b) => b.resume - a.resume)[0];
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

		// The four weakest auto bids play for two 16 seeds; the four weakest
		// at-large bids play for two 11 seeds.
		const autoPlayIn = autos.splice(-4, 4);
		const atLargePlayIn = atLarge.splice(-4, 4);
		const firstFour = [];
		const advance = [];
		const runPlayIn = (list, seed) => {
			for (let i = 0; i < list.length; i += 2) {
				const a = list[i];
				const b = list[i + 1];
				if (!b) { advance.push(a); continue; }
				const won = T.playGame(rng, a, b, 0, cfg);
				const winner = won ? a : b;
				const loser = won ? b : a;
				firstFour.push({ seed, a, b, winner });
				loser.ncaaResult = "Lost in the First Four";
				loser.ncaaSeed = seed;
				advance.push(winner);
			}
		};
		runPlayIn(autoPlayIn, 16);
		runPlayIn(atLargePlayIn, 11);

		const field64 = autos.concat(atLarge, advance)
			.sort((a, b) => b.resume - a.resume)
			.slice(0, 64);

		// S-curve: overall 1-4 are the 1 seeds, 5-8 the 2 seeds, and so on, one
		// of each seed per region.
		const regions = { East: [], West: [], South: [], Midwest: [] };
		field64.forEach((team, i) => {
			const seed = Math.floor(i / 4) + 1;
			const band = Math.floor(i / 4);
			const order = band % 2 === 0 ? REGIONS : REGIONS.slice().reverse();
			regions[order[i % 4]].push({ seed, team });
		});

		const ROUND_NAME = ["Round of 64", "Round of 32", "Sweet 16", "Elite Eight"];
		const regionResults = {};
		for (const r of REGIONS) {
			const bySeed = {};
			for (const x of regions[r]) bySeed[x.seed] = x;
			let alive = SEED_ORDER.map((sd) => bySeed[sd]).filter(Boolean);
			const regionRounds = [];
			while (alive.length > 1) {
				const next = [];
				const games = [];
				for (let i = 0; i < alive.length; i += 2) {
					const A = alive[i];
					const B = alive[i + 1];
					if (!B) { next.push(A); continue; }
					const won = T.playGame(rng, A.team, B.team, 0, cfg);
					const winner = won ? A : B;
					const loser = won ? B : A;
					games.push({
						region: r, a: A, b: B, winner,
						upset: winner.seed > loser.seed + 2,
					});
					winner.team.ncaaWins = (winner.team.ncaaWins || 0) + 1;
					next.push(winner);
				}
				regionRounds.push(games);
				alive = next;
			}
			regionResults[r] = { seeds: regions[r], rounds: regionRounds, champ: alive[0] };
		}

		const ff = REGIONS.map((r) => regionResults[r].champ);
		const semis = [];
		const finalists = [];
		for (let i = 0; i < 4; i += 2) {
			const won = T.playGame(rng, ff[i].team, ff[i + 1].team, 0, cfg);
			const winner = won ? ff[i] : ff[i + 1];
			semis.push({ a: ff[i], b: ff[i + 1], winner });
			winner.team.ncaaWins = (winner.team.ncaaWins || 0) + 1;
			finalists.push(winner);
		}
		const wonFinal = T.playGame(rng, finalists[0].team, finalists[1].team, 0, cfg);
		const champion = wonFinal ? finalists[0] : finalists[1];
		const runnerUp = wonFinal ? finalists[1] : finalists[0];
		champion.team.ncaaWins = (champion.team.ncaaWins || 0) + 1;

		for (const r of REGIONS) {
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

		return {
			selection: sel, firstFour, regions: regionResults, semis,
			final: { a: finalists[0], b: finalists[1], winner: champion },
			champion, runnerUp, finalFour: ff,
		};
	}

	global.Tournament = { apPoll, simulate, selectField, REGIONS, SEED_ORDER };
})(window);
