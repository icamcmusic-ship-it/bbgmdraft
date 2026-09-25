/* The Play tab's scoring (audit section 4, ideas 4, 5 and 8): the bracket
   pool's shape, helpers and ESPN scoring, the prediction grade and the
   blind scout score, all read off one real season. */
"use strict";

module.exports = function (ok, V) {
	const E = global.Engine;
	const CFG = global.Config;
	const P = global.Play;
	const { Rng } = global.BBGMRng;

	const res = E.run(V.syntheticClass(71, 60), CFG.make({ seed: "play-a" }));

	/* --- bracket pool -------------------------------------------------- */
	{
		const base = P.bracketBase(res.tourney);
		ok("the pool bracket is 64 slots in four regions", base && base.length === 64 &&
			new Set(base.map((s) => s.region)).size === 4);
		ok("...opening with 1 v 16 in every region",
			[0, 16, 32, 48].every((i) => base[i].seed === 1 && base[i + 1].seed === 16));
		const truth = P.bracketTruth(res.tourney, base);
		ok("the truth fills every game", P.complete(truth));
		ok("...and its champion is the tournament's",
			truth[5][0] === res.tourney.champion.team.name, truth[5][0]);
		ok("...and its Final Four is the tournament's",
			truth[3].slice().sort().join() ===
				res.tourney.finalFour.map((x) => x.team.name).sort().join());
		const perfect = P.scoreBracket(truth, truth);
		ok("a perfect bracket scores 1920", perfect.points === 1920 && perfect.max === 1920);
		ok("an empty bracket scores 0", P.scoreBracket(P.emptyPicks(), truth).points === 0);

		const chalk = P.autoFillBySeed(base);
		ok("auto-fill by seed completes the bracket", P.complete(chalk));
		ok("...with every 1 seed in the Elite Eight winners",
			chalk[3].every((n) => base.find((s) => s.name === n).seed === 1));
		const r1 = P.randomFill(base, P.emptyPicks(), new Rng("x|pool|0"));
		const r2 = P.randomFill(base, P.emptyPicks(), new Rng("x|pool|0"));
		ok("random fill is complete and deterministic per seed",
			P.complete(r1) && JSON.stringify(r1) === JSON.stringify(r2));
		ok("...and legal: every pick played in that game",
			r1.every((round, k) => round.every((n, g) => P.participants(base, r1, k, g).indexOf(n) !== -1)));

		// Changing an early pick clears the later picks that depended on it.
		const loser = P.participants(base, chalk, 0, 0).filter((n) => n !== chalk[0][0])[0];
		const edited = P.setPick(base, chalk, 0, 0, loser);
		ok("changing a pick clears the picks it made impossible",
			edited[0][0] === loser && edited[1][0] === null && !P.complete(edited));
		ok("...and leaves the rest", edited[0][1] === chalk[0][1] && edited[3][1] === chalk[3][1]);

		// Only correct picks score, at the round's value.
		const one = P.emptyPicks();
		one[0][0] = truth[0][0];
		one[5][0] = truth[5][0];
		ok("points are 10 per first-round hit and 320 for the champion",
			P.scoreBracket(one, truth).points === 330);
		ok("the upset factor reads as a difficulty",
			P.difficulty(0.35) === "Easy (chalk)" && P.difficulty(1) === "Normal" &&
			P.difficulty(1.9) === "Chaos");
		ok("an undersized field has no bracket", P.bracketBase({ regions: {} }) === null);
	}

	/* --- prediction ---------------------------------------------------- */
	{
		const a = P.predictionAnswers(res);
		ok("the answer key names the champion and the No. 1 pick",
			a.champion === res.tourney.champion.team.name && a.no1 === res.board[0].key);
		const best = P.gradePrediction({ champion: a.champion,
			poy: a.poy.length ? a.poy[0] : "none", no1: a.no1 }, a);
		ok("all three right is 11 of 11", best.points === 11 && best.max === 11);
		const ff = a.finalFour.filter((n) => n !== a.champion)[0];
		const part = P.gradePrediction({ champion: ff, poy: "nobody", no1: res.board[2].key }, a);
		ok("a Final Four team and a top-5 pick earn partial credit",
			part.champion === 2 && part.no1 === 1 && part.poy === 0, JSON.stringify(part));
		const none = P.gradePrediction({ champion: "x", poy: "none", no1: "y" },
			Object.assign({}, a, { poy: [] }));
		ok("\"nobody in this class\" scores when no class player won POY", none.poy === 3);
	}

	/* --- blind scout --------------------------------------------------- */
	{
		const exact = res.board.slice(0, 10).map((p) => p.key);
		const s = P.scoreScout(exact, res.board);
		ok("the real top 10 in order scores 100 with 10 hits",
			s.points === 100 && s.hits === 10 && s.error === 0);
		const rev = P.scoreScout(exact.slice().reverse(), res.board);
		ok("...reversed keeps the hits and loses points",
			rev.hits === 10 && rev.points < 100 && rev.points > 0 && rev.error === 50);
		const far = P.scoreScout(res.board.slice(40, 50).map((p) => p.key), res.board);
		ok("ten men from the back of the board score nothing", far.points === 0 && far.hits === 0);
		const ref = P.preseasonTop10(res.players);
		ok("the preseason reference is ten players", ref.length === 10);
		const again = E.run(V.syntheticClass(71, 60), CFG.make({ seed: "play-a" }));
		ok("the same seed gives the same answers",
			JSON.stringify(P.predictionAnswers(again)) === JSON.stringify(P.predictionAnswers(res)) &&
			P.scoreScout(ref, again.board).points === P.scoreScout(ref, res.board).points);
	}

	/* --- the record ---------------------------------------------------- */
	{
		const store = {};
		const prev = global.localStorage;
		global.localStorage = { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = v; } };
		P.saveRecord("scout", 40, 100, "s1");
		const r = P.saveRecord("scout", 70, 100, "s2");
		ok("the record keeps totals and the best game",
			r.played === 2 && r.points === 110 && r.best.points === 70 && r.best.seed === "s2");
		global.localStorage = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
		ok("blocked storage reads as an empty record and saving does not throw",
			JSON.stringify(P.loadRecord()) === "{}" && P.saveRecord("bracket", 1, 2, "x").played === 1);
		global.localStorage = prev;
	}
};
