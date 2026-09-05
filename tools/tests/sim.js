/* Season-simulation regressions: the team's three points totals, the advanced
   block, the walls, the schedule, and the injury window.

   tools/validate.js bands the DISTRIBUTIONS; these are the identities and the
   impossibilities — the things that should never be true of any line at all,
   which a band on a mean or a percentile cannot see.

   Shape: module.exports = function (ok, V), run after V.loadEngine(). */
"use strict";

module.exports = function (ok, V) {
	const BS = global.BBGMStats;
	const SEEDS = 3;

	/* One field of simulated seasons, plus every team-season the export ran
	   through the advanced formulas — captured by wrapping leagueAdvanced,
	   because that is the only place the whole population exists at once. */
	const captured = [];
	const runs = [];
	const orig = BS.leagueAdvanced;
	BS.leagueAdvanced = function (teams, opts) {
		const out = orig.call(this, teams, opts);
		let i = 0;
		for (const t of teams) {
			for (const p of t.players) captured.push({ t, p, adv: out[i++] });
		}
		return out;
	};
	try {
		for (let s = 0; s < SEEDS; s++) {
			const lf = V.realisticClass(4100 + s, 70);
			const res = global.Engine.run(lf, global.Config.make({ seed: "simtest" + s }));
			global.Engine.exportFile(res, { stats: true, prior: true });
			runs.push(res);
		}
	} finally {
		BS.leagueAdvanced = orig;
	}

	/* --------------------------------------------------- team points, three ways

	   The stat pool, the box score and the scoreboard used to be three
	   different numbers for one thing: over 3,640 team-seasons the box said
	   73.4 and the games the team actually played said 70.6, and 1,231 of them
	   disagreed by more than five points. */
	{
		let worst = 0;
		let worstName = "";
		let over3 = 0;
		let teams = 0;
		let netSum = 0;
		let marginSum = 0;
		for (const res of runs) {
			for (const t of Object.values(res.teams)) {
				if (!t.box || !t.log || !t.log.length) continue;
				teams++;
				const pf = t.log.reduce((a, g) => a + (g.pf || 0), 0) / t.log.length;
				const pa = t.log.reduce((a, g) => a + (g.pa || 0), 0) / t.log.length;
				const d = Math.abs(t.box.pts - pf);
				if (d > 3) over3++;
				if (d > worst) { worst = d; worstName = t.name; }
				if (t.offRtg !== null && t.defRtg !== null) netSum += t.offRtg - t.defRtg;
				marginSum += pf - pa;
			}
		}
		ok("a team's box score and its scoreboard agree on points",
			worst < 8 && over3 / teams < 0.02,
			"worst " + worst.toFixed(1) + " (" + worstName + "), " + over3 +
				" of " + teams + " over 3");
		/* Net rating is a difference between the two, so it inherited the gap:
		   the country netted +3.6 a hundred possessions on a true margin of
		   -0.19, which is not a rating, it is the bug with a name on it. */
		ok("the country's mean net rating is near zero",
			Math.abs(netSum / teams) < 1.2,
			"net " + (netSum / teams).toFixed(2) +
				" vs true margin " + (marginSum / teams).toFixed(2));
	}

	/* --------------------------------------------------------- era and scoreboard */
	{
		const CAL = global.Calibration;
		/* The scoreboard multiplied pace by a hardcoded 2.06 whatever era was
		   selected, so the modern game and 2009-2021 both scored about 70 a
		   team while the stat model was anchored at 73.6 and 70.0. The two
		   eras are run on the SAME seeds and compared as a ratio, because a
		   season's narrative flavor moves the whole country's pace by several
		   possessions and one seed cannot see past it. */
		const eras = Object.keys(CAL.ERAS);
		const scored = {};
		for (const era of eras) scored[era] = [];
		for (let s = 0; s < 2; s++) {
			for (const era of eras) {
				const res = global.Engine.run(V.realisticClass(4200 + s, 70),
					global.Config.make({ seed: "era" + s, era }));
				let pts = 0;
				let n = 0;
				for (const t of Object.values(res.teams)) {
					for (const g of t.log) { if (g.stage === "reg") { pts += g.pf; n++; } }
				}
				scored[era].push(n ? pts / n : 0);
			}
		}
		const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
		ok("each era's scoreboard lands near its own scoring anchor",
			eras.every((k) => Math.abs(mean(scored[k]) - CAL.ERAS[k].team.pts) <
				CAL.ERAS[k].team.pts * 0.10),
			eras.map((k) => k + " " + mean(scored[k]).toFixed(1) +
				" vs " + CAL.ERAS[k].team.pts).join("; "));
		if (eras.length >= 2) {
			const a = eras[0];
			const b = eras[1];
			const got = mean(scored[a]) / mean(scored[b]);
			const want = (CAL.ERAS[a].team.pts / CAL.ERAS[a].team.poss) /
				(CAL.ERAS[b].team.pts / CAL.ERAS[b].team.poss);
			ok("two eras score in the ratio their anchors do",
				Math.abs(got - want) < 0.035,
				"measured " + got.toFixed(3) + " vs " + want.toFixed(3));
		}
	}

	/* ------------------------------------------------------- the advanced block */
	{
		let impossible = 0;
		let detail = "";
		let n = 0;
		const note = (why, v) => { impossible++; if (!detail) detail = why + " " + v.toFixed(1); };
		for (const c of captured) {
			const ps = c.p.stats;
			const a = c.adv;
			if (!ps || ps.min < 200) continue;
			n++;
			for (const k of Object.keys(a)) {
				if (!Number.isFinite(a[k])) note("non-finite " + k, 0);
			}
			const bpm = a.obpm + a.dbpm;
			const ws40 = ((a.ows + a.dws) * 40) / ps.min;
			if (Math.abs(bpm) > 26) note("BPM", bpm);
			if (a.per > 55 || a.per < -10) note("PER", a.per);
			if (Math.abs(a.vorp) > 13) note("VORP", a.vorp);
			if (ws40 > 0.65 || ws40 < -0.35) note("WS/40", ws40);
			if (Math.abs(a.onOff100) > 75) note("on/off per 100", a.onOff100);
			if (Math.abs(a.pm100) > 65) note("plus/minus per 100", a.pm100);
			if (a.usgp > 45 || a.usgp < 0) note("USG%", a.usgp);
			if (a.ortg > 190 || (a.ortg < 40 && a.ortg !== 0)) note("ORtg", a.ortg);
			if (a.drtg > 190 || (a.drtg < 40 && a.drtg !== 0)) note("DRtg", a.drtg);
		}
		ok("no player finishes with an impossible advanced line",
			impossible === 0, impossible + " of " + n + " lines; first: " + detail);

		/* The identities. VORP is a function of BPM and floor time, EWA of PER
		   and floor time, and both were transcribed from BBGM — so if either
		   drifts, the row a league file imports is not the row the game would
		   have written. EWA's game-length factor used to be the run's nominal
		   forty minutes rather than the CLUB's, which put a G League season's
		   value over replacement out by as much as 1.6 wins. */
		let vWorst = 0;
		let eWorst = 0;
		for (const c of captured) {
			const ps = c.p.stats;
			const t = c.t.stats;
			if (!ps || ps.min < 200 || !(t.min > 0)) continue;
			const bpm = c.adv.obpm + c.adv.dbpm;
			const minp = (ps.min + 1e-9) / (t.min / 5);
			const vExp = ((bpm + 2) * minp * t.gp) / 82;
			vWorst = Math.max(vWorst, Math.abs(c.adv.vorp - vExp));
			const eExp = BS.getEWA(c.adv.per, ps.min, c.p.pos,
				(t.gameMinutes || 40) / 48);
			eWorst = Math.max(eWorst, Math.abs(c.adv.ewa - eExp));
		}
		ok("VORP is the function of BPM and minutes BBGM computes",
			vWorst < 1e-6, "worst " + vWorst.toExponential(2));
		ok("EWA is the function of PER and minutes, on the club's own clock",
			eWorst < 1e-6, "worst " + eWorst.toExponential(2));

		// Win shares are a share of WINS: the roster's should sum to about the
		// team's, and a factor of two out is a scale error, not noise.
		let wsSum = 0;
		let winSum = 0;
		const seen = new Set();
		for (const c of captured) {
			wsSum += c.adv.ows + c.adv.dws;
			if (!seen.has(c.t)) { seen.add(c.t); winSum += c.t.stats.gp / 2; }
		}
		const ratio = wsSum / winSum;
		ok("win shares sum to about the wins there were",
			ratio > 0.85 && ratio < 1.25, "ratio " + ratio.toFixed(3));

		/* PER is normalized so the league average is 15 and BPM so it is 0 —
		   over the WHOLE simulated field, which is the population the export
		   hands the formulas. If either centre moves, the normalization is
		   reading the wrong population. */
		let perMin = 0;
		let bpmMin = 0;
		let minTot = 0;
		for (const c of captured) {
			const m = c.p.stats ? c.p.stats.min : 0;
			perMin += c.adv.per * m;
			bpmMin += (c.adv.obpm + c.adv.dbpm) * m;
			minTot += m;
		}
		ok("PER is normalized on the field's average, not the class's",
			Math.abs(perMin / minTot - 15) < 1.5,
			"minute-weighted PER " + (perMin / minTot).toFixed(2));
		ok("BPM is centered on the field's average team",
			Math.abs(bpmMin / minTot) < 1.5,
			"minute-weighted BPM " + (bpmMin / minTot).toFixed(2));
	}

	/* ---------------------------------------------------------------- the walls */
	{
		const lines = [];
		for (const res of runs) {
			for (const t of Object.values(res.teams)) {
				for (const l of t.lines || []) lines.push(l);
			}
		}
		// How much of the sample sits on ONE value: a hard ceiling reports
		// itself as a spike, and 245 lines used to finish on exactly 3.90
		// fouls a game.
		/* Rotation players only, and only the TOP of each distribution: a
		   ceiling is a spike at the top, and half a roster recording no blocks
		   at all is a bench, not a wall. */
		const rotation = lines.filter((l) => l.mpg >= 12);
		const spike = (key, read) => {
			const vals = rotation.map((l) => (read ? read(l) : l[key]))
				.filter((v) => Number.isFinite(v));
			const sorted = vals.slice().sort((a, b) => a - b);
			const bar = sorted[Math.floor(0.9 * sorted.length)];
			const bins = new Map();
			for (const v of vals) {
				if (v < bar) continue;
				const b = v.toFixed(3);
				bins.set(b, (bins.get(b) || 0) + 1);
			}
			let worst = 0;
			for (const [, c] of bins) worst = Math.max(worst, c);
			return worst / rotation.length;
		};
		const per40 = (key) => (l) => (l.mpg > 0 ? (l[key] * 40) / l.mpg : 0);
		const walls = [
			["pfpg", spike("pfpg")],
			["rebounds per 40", spike(null, per40("rpg"))],
			["assists per 40", spike(null, per40("apg"))],
			["blocks per 40", spike(null, per40("bpg"))],
		];
		ok("no ceiling is a wall a slice of the country sits on",
			walls.every((w) => w[1] < 0.003),
			walls.map((w) => w[0] + " " + (100 * w[1]).toFixed(2) + "%").join(", "));

		let bigBlocks = 0;
		let bigRebs = 0;
		let maxBlk = 0;
		for (const l of lines) {
			if (l.bpg > 4.6) bigBlocks++;
			if (l.rpg > 14.5) bigRebs++;
			maxBlk = Math.max(maxBlk, l.bpg);
		}
		ok("nobody blocks shots at a rate nobody has",
			bigBlocks === 0 && bigRebs === 0,
			"max bpg " + maxBlk.toFixed(2) + ", " + bigBlocks + " over 4.6 blocks, " +
				bigRebs + " over 14.5 rebounds");
	}

	/* ------------------------------------------------------------- the schedule */
	{
		let lo = 99;
		let hi = 0;
		let confOff = 0;
		let teams = 0;
		for (const res of runs) {
			for (const t of Object.values(res.teams)) {
				let home = 0;
				let ch = 0;
				let cg = 0;
				for (const g of t.log) {
					if (g.stage !== "reg") continue;
					if (g.home > 0) home++;
					if (g.conference) { cg++; if (g.home > 0) ch++; }
				}
				teams++;
				lo = Math.min(lo, home);
				hi = Math.max(hi, home);
				if (Math.abs(ch - cg / 2) > 1.5) confOff++;
			}
		}
		/* Home games ran 3 to 27 in a 31-game season, because the
		   higher-prestige team always hosted and a conference game flipped a
		   coin with no return leg. */
		ok("every team plays a plausible number of home games",
			lo >= 7 && hi <= 23, "min " + lo + ", max " + hi);
		ok("a conference home schedule is about half its conference slate",
			confOff / teams < 0.05,
			confOff + " of " + teams + " off by more than a game and a half");
	}

	/* --------------------------------------------------------- absence and injury */
	{
		let tooLong = 0;
		let injured = 0;
		let postseason = 0;
		for (const res of runs) {
			for (const p of res.players) {
				if (p.nonNcaa || !p.stats || !p.gameLog) continue;
				const t = res.teams[p.newCollege];
				if (!t) continue;
				const av = p.availability;
				if (av && av.injury && av.from !== null) {
					injured++;
					const inWindow = t.log.filter((g) =>
						(g.when || 0) >= av.from && (g.when || 0) <= av.to).length;
					if (inWindow - av.games >= 5) tooLong++;
				}
				/* An ordinary absence used to be scattered over the WHOLE
				   schedule, so a coach's decision in December took a man out
				   of an NCAA tournament game his team played at full
				   strength. */
				if (av && !av.injury) {
					const played = new Set(p.gameLog.games.map((g) => g.i));
					for (let i = 0; i < t.log.length; i++) {
						if (t.log[i].stage !== "reg" && !played.has(i)) postseason++;
					}
				}
			}
		}
		ok("an injury window is as long as the games it costs",
			injured === 0 || tooLong / injured < 0.05,
			tooLong + " of " + injured + " windows five games too long");
		ok("an ordinary absence never costs a postseason game",
			postseason === 0, postseason + " postseason games skipped");
	}

	/* ------------------------------------------------------------ the derived NaN */
	{
		let nan = 0;
		let total = 0;
		for (const res of runs) {
			for (const t of Object.values(res.teams)) {
				for (const l of t.lines || []) {
					total++;
					for (const k of Object.keys(l)) {
						if (typeof l[k] === "number" && !Number.isFinite(l[k])) { nan++; break; }
					}
				}
			}
		}
		// astdRate read a composite the filler synthesis never defined, so
		// every filler line in the country carried NaN and exported as null.
		ok("no stat line in the country carries a NaN",
			nan === 0, nan + " of " + total + " lines");
	}

	/* ---------------------------------------------------- the poll and the resume */
	{
		/* The electorate is supposed to vote on results. Three of its features
		   read g.quality, which is the sim's hidden true rating stamped on
		   every log row — so the check is that a season's poll is reproducible
		   from the log ALONE: blank every quality field and the ballots must
		   not move. */
		const res = runs[0];
		const before = JSON.stringify(res.pollHistory[res.pollHistory.length - 1].ranks
			.map((r) => r.team));
		const teams = res.teams;
		const saved = [];
		for (const t of Object.values(teams)) {
			for (const g of t.log) { saved.push([g, g.quality]); g.quality = 50; }
		}
		let after;
		try {
			global.Rankings.computeRankings(teams);
			const hist = global.Rankings.weeklyPoll(teams,
				new global.BBGMRng.Rng("appoll-check"));
			after = JSON.stringify(hist[hist.length - 1].ranks.map((r) => r.team));
		} finally {
			for (const [g, q] of saved) g.quality = q;
		}
		/* The electorate is drawn off a different seed here, so the ballots are
		   not identical — but the top of the poll is a fact about the season
		   and has to survive losing the answer key. */
		const a = JSON.parse(before).slice(0, 25);
		const b = JSON.parse(after).slice(0, 25);
		const shared = a.filter((x) => b.indexOf(x) !== -1).length;
		ok("the AP poll does not read the sim's hidden rating",
			shared >= 20, shared + " of the top 25 survive blanking g.quality");
	}

	/* ---------------------------------------------- conference tournaments */
	{
		let missing = 0;
		let teams = 0;
		for (const res of runs) {
			for (const t of Object.values(res.teams)) {
				teams++;
				if (!t.log.some((g) => g.stage === "conf")) missing++;
			}
		}
		// The field was capped at twelve, so six ACC and Big Ten teams played
		// no conference tournament at all.
		ok("every program plays in its conference tournament",
			missing === 0, missing + " of " + teams + " played none");
	}
};
