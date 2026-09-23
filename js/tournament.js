/* AP Top 25 and the 68-team national tournament. */
(function (global) {
	"use strict";

	const T = global.TeamsSim;

	/* The one-shot `resume + prestige * 0.06` poll is gone — the AP poll is
	   voted weekly by a persistent electorate in js/rankings.js. This helper
	   remains only as a fallback for callers with no Rankings module. */
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

	/* The committee's ordering: the results-only committee score when the
	   rankings layer has run, the legacy resume otherwise. */
	function committee(t) {
		return Number.isFinite(t.committeeScore) ? t.committeeScore : t.resume;
	}

	/* The at-large model behind bidCheck's expectation; see selectField. */
	const BID_FIT = { a: -2.224, prestige: 0.61, strength: 0.385 };

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
				.slice().sort((a, b) => committee(b) - committee(a))[0];
			if (!pick) continue;
			autos.push(pick);
			autoSet.add(pick.name);
			pick.bid = "auto";
		}
		const atLarge = Object.values(teams)
			.filter((t) => !autoSet.has(t.name))
			.sort((a, b) => committee(b) - committee(a))
			.slice(0, 68 - autos.length);
		for (const t of atLarge) t.bid = "at-large";

		const bubble = Object.values(teams)
			.filter((t) => !autoSet.has(t.name) && !t.bid)
			.sort((a, b) => committee(b) - committee(a))
			.slice(0, 6);

		/* CONFERENCES[x].bids as a SANITY EXPECTATION, not a quota: the table
		   sat in js/colleges.js looking authoritative and controlling nothing.
		   The committee still selects on results alone; this reports where a
		   season diverged from the historical norm, which the news and the
		   selection view can then say out loud ("the SEC got 11 in"). */
		const bidCheck = [];
		const C = global.Colleges;
		const gotByConf = {};
		for (const t of autos.concat(atLarge)) {
			gotByConf[t.conf] = (gotByConf[t.conf] || 0) + 1;
		}
		/* Expected off THIS season's membership and strength, not a static
		   number beside a map that has since changed: the WCC's "3" outlived
		   Gonzaga and "A lean year for the WCC" ran in nine seasons of
		   twelve.

		   And expected off what THIS SIM does, not off a real-world
		   intuition. The old curve (0.55 x ((strength - 68) / 25)^1.4 of the
		   league) wanted eight or nine bids from the Big 12, SEC and ACC in a
		   sim whose committee gives them 5.6, 6.5 and 8.2 on average, so "A
		   lean year for the Big 12" ran in 23 seasons of 30 — a note about
		   the formula, not the season. The expectation is now one auto bid
		   plus each member's chance of an at-large, a logistic in the
		   member's prestige and its league's strength fitted to 40 seasons
		   of this committee's own selections (mean absolute error under 0.4
		   of a bid for every multi-bid league), and a season is flagged only
		   when it misses that by two bids or by 35% of it, whichever is
		   more — about one conference-season in twenty. */
		const atLargeChance = (t, strength) => 1 / (1 + Math.exp(-(
			BID_FIT.a + BID_FIT.prestige * ((t.prestige || 0) - 60) / 10 +
			BID_FIT.strength * (strength - 70) / 10)));
		const expectedFor = (conf) => {
			const members = pools[conf] || [];
			const n = members.length;
			const strength = C.CONFERENCES[conf] ? C.CONFERENCES[conf].strength : null;
			if (!n || strength === null) return null;
			// One member holds the auto bid and cannot also be an at-large.
			const atLargeSum = members.reduce((acc, t) => acc + atLargeChance(t, strength), 0);
			return Math.max(1, Math.round(1 + atLargeSum * (n - 1) / n));
		};
		for (const conf of Object.keys(gotByConf)) {
			const expected = expectedFor(conf);
			if (expected === null) continue;
			const margin = Math.max(2, Math.ceil(0.35 * expected));
			if (Math.abs(gotByConf[conf] - expected) >= margin) {
				bidCheck.push({ conf, expected, got: gotByConf[conf] });
			}
		}

		return { autos, atLarge, field: autos.concat(atLarge), bubble, bidCheck,
			byConf: gotByConf };
	}

	const REGIONS = ["East", "West", "South", "Midwest"];
	const SEED_ORDER = [1, 16, 8, 9, 5, 12, 4, 13, 6, 11, 3, 14, 7, 10, 2, 15];

	// Which four-team pod (0-3, the first-weekend site) and which half of a
	// region (0-1, the Sweet 16 pairing) a seed line plays in.
	const POD_OF = {};
	SEED_ORDER.forEach((sd, i) => { POD_OF[sd] = Math.floor(i / 4); });

	/* Games two teams have already played this season (regular season and
	   conference tournament), from the log. */
	function meetings(a, b) {
		let n = 0;
		for (const g of a.log || []) if (g.opp === b.name && g.stage !== "ncaa") n++;
		return n;
	}

	function bracketPenalty(regions) {
		let cost = 0;
		for (const r of REGIONS) {
			const list = regions[r];
			for (let i = 0; i < list.length; i++) {
				const A = list[i];
				if (!A.team.conf || A.team.conf === "Independent") continue;
				for (let j = i + 1; j < list.length; j++) {
					const B = list[j];
					if (B.team.conf !== A.team.conf) continue;
					// Two top-four seeds from one league in one region.
					if (A.seed <= 4 && B.seed <= 4) cost += 100;
					if (POD_OF[A.seed] === POD_OF[B.seed]) {
						// Could meet in the Round of 64 or 32. Worse still in
						// the Round of 64, which a swap can almost always fix.
						cost += A.seed + B.seed === 17 ? 40 : 10;
					} else if (Math.floor(POD_OF[A.seed] / 2) === Math.floor(POD_OF[B.seed] / 2) &&
						meetings(A.team, B.team) >= 3) {
						cost += 10;
					}
				}
			}
		}
		return cost;
	}

	function balanceBracket(regions) {
		const at = (r, seed) => regions[r].findIndex((x) => x.seed === seed);
		const swap = (r1, i1, r2, i2) => {
			const t = regions[r1][i1];
			regions[r1][i1] = regions[r2][i2];
			regions[r2][i2] = t;
		};
		let cost = bracketPenalty(regions);
		for (let pass = 0; pass < 40 && cost > 0; pass++) {
			let improved = false;
			for (let seed = 16; seed >= 1 && cost > 0; seed--) {
				for (let a = 0; a < REGIONS.length; a++) {
					for (let b = a + 1; b < REGIONS.length; b++) {
						const ia = at(REGIONS[a], seed);
						const ib = at(REGIONS[b], seed);
						if (ia < 0 || ib < 0) continue;
						swap(REGIONS[a], ia, REGIONS[b], ib);
						const next = bracketPenalty(regions);
						if (next < cost) { cost = next; improved = true; }
						else swap(REGIONS[a], ia, REGIONS[b], ib);
					}
				}
			}
			if (!improved) break;
		}
		return cost;
	}

	/* 68 teams -> First Four -> a proper four-region, one-of-each-seed bracket. */
	function simulate(teams, cfg, rng) {
		const sel = selectField(teams);

		const autos = sel.autos.slice().sort((a, b) => committee(b) - committee(a));
		const atLarge = sel.atLarge.slice().sort((a, b) => committee(b) - committee(a));

		/* The four weakest auto bids play for two 16 seeds; the four weakest
		   at-large bids play for two 11 seeds.

		   Everything below assumed at least 68 eligible programs and at least
		   four teams in each play-in pool, which is true of the built-in 364
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
				// Tracked separately from ncaaWins so round-name labeling
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
		const main = autos.concat(atLarge).sort((a, b) => committee(b) - committee(a));
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
		/* THE BRACKETING PRINCIPLES.

		   The committee's rules, not just the first-round one. The old pass
		   only looked at a seed against its 17-minus partner, so a region
		   could still hold an 8-9 winner's Round-of-32 game against a
		   same-league 1 seed — 109 same-conference Round-of-32 games in 80
		   seasons — and two of a league's top-four seeds shared a region
		   210 times in the same 80. What the committee actually does:

		   - the top four teams from a conference on the top four seed lines
		     go to four different regions;
		   - two teams from one conference do not meet before the Sweet 16
		     (they are kept out of the same four-team pod), and two that have
		     already met three or more times this season do not meet before
		     the Elite Eight (kept out of the same half of the region);

		   and it gets there by moving teams across regions WITHIN a seed
		   line, so nobody's seed changes and the S-curve's balance holds.
		   Scored as a penalty over the whole bracket and improved one
		   same-line swap at a time, lowest seeds first (moving a 12 seed
		   is the committee's first resort and moving a 1 seed its last),
		   until no swap helps. */
		if (full) balanceBracket(regions);
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
					/* The pod advantage. The first weekend is played in
					   four-team pods sited near the top seeds, so a 1 seed
					   opens forty minutes from campus in front of its own
					   crowd and its 16 seed has flown across the country —
					   which is worth about a point, and is a real part of
					   why the top lines almost never lose early. It is a
					   share of a home edge rather than a home game (see
					   playGameScore), and it stops after the first weekend,
					   when the regionals move to neutral sites.

					   The LOG still records a neutral court: the game-log
					   generator's home lift is a binary 5.5% and applying it
					   to a pod would overstate a one-point edge sixfold. */
					const pod = regionRounds.length <= 1
						? (A.seed < B.seed ? 0.3 : A.seed > B.seed ? -0.3 : 0)
						: 0;
					const sc = T.playGameScore(rng, A.team, B.team, pod, cfg, 1, true);
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
		/* A degenerate field can leave one finalist (or none of the semis
		   playable at all). The old padding pushed the same entry twice and
		   then played it against itself, crediting one team both a win and a
		   loss for a game that never happened. A lone survivor is champion by
		   walkover instead. */
		let champion;
		let runnerUp = null;
		let finalGame;
		let finalScore = "";
		if (finalists.length >= 2) {
			const finalSc = T.playGameScore(rng, finalists[0].team, finalists[1].team, 0, cfg, 1, true);
			T.recordPostseason(finalists[0].team, finalists[1].team, finalSc, "ncaa", 1.13,
				"National Championship");
			const wonFinal = finalSc.won;
			champion = wonFinal ? finalists[0] : finalists[1];
			runnerUp = wonFinal ? finalists[1] : finalists[0];
			finalScore = (wonFinal ? finalSc.a + "-" + finalSc.b : finalSc.b + "-" + finalSc.a) +
				(finalSc.ot ? (finalSc.ot > 1 ? " " + finalSc.ot + "OT" : " OT") : "");
			champion.team.ncaaWins = (champion.team.ncaaWins || 0) + 1;
			finalGame = { a: finalists[0], b: finalists[1], winner: champion, score: finalScore };
		} else {
			champion = finalists[0] || ff[0];
			finalGame = { a: champion, b: null, winner: champion, score: "" };
		}

		for (const r of liveRegions) {
			for (const x of regionResults[r].seeds) {
				const wins = x.team.ncaaWins || 0;
				x.team.ncaaSeed = x.seed;
				x.team.ncaaRegion = r;
				x.team.ncaaResult =
					x.team === champion.team ? "National Champion"
					: (runnerUp && x.team === runnerUp.team) ? "National Runner-Up"
					: wins >= 4 ? "Lost in the Final Four"
					: "Lost in the " + ROUND_NAME[wins];
			}
		}

		const nit = simulateNit(teams, sel, cfg, rng.child("nit"));

		return {
			selection: sel, firstFour, regions: regionResults, semis,
			final: finalGame,
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
			.sort((a, b) => committee(b) - committee(a))
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

	global.Tournament = { apPoll, simulate, selectField, simulateNit, REGIONS, SEED_ORDER,
		bracketPenalty, balanceBracket };
})(typeof window !== "undefined" ? window : self);
