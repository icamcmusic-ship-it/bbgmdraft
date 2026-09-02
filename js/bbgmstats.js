/* BBGM's season stats row: the schema, and the advanced statistics that fill
   it.

   js/bbgm.js reimplements the RATING formulas so a generated player evaluates
   identically inside the game. This file does the same job for the STATS row,
   because a college season this tool simulates and then writes into a league
   file has to be a stats row Basketball GM itself could have written — not a
   dozen counting stats in a shape nothing in the game knows how to read.

   Sources (transcribed, not guessed):
     src/worker/core/player/stats.basketball.ts   the key set, and its order
     src/worker/core/player/addStatsRow.ts        what an empty row looks like
     src/worker/core/game/writePlayerStats.ts     max stats, dd/td/qd/fxf
     src/common/helpers.ts                        gameScore
     src/worker/util/advStats.basketball.ts       every derived statistic

   Two facts from those files drove the rewrite of the export:

     1. A row BBGM writes has EVERY key in `STATS` on it. A partial row is not
        a smaller version of a real one; the game's own tables read the keys
        they were promised and show blanks where they are missing.
     2. A season high is `[value, gid]` — the value AND the game it happened
        in — not a bare number. A bare number is not a smaller version of that
        either: `ps[key][0]` on a number is `undefined`.

   The gid half of a high is the one thing here that cannot be honest: these
   games were played by a simulator that is not BBGM's, in a league that has no
   game log, so there is no game to point at. See seasonHighs(). */
(function (global) {
	"use strict";

	/* src/worker/core/player/stats.basketball.ts, verbatim. `derived` is
	   everything advStats computes, `raw` everything the game sim records,
	   `max` the per-game highs. */
	const STATS = {
		derived: [
			"per", "ewa", "astp", "blkp", "drbp", "orbp", "stlp", "trbp", "usgp",
			"drtg", "ortg", "pm100", "onOff100", "dws", "ows", "obpm", "dbpm",
			"vorp",
		],
		raw: [
			"gp", "gs", "min", "minAvailable",
			"fg", "fga", "fgAtRim", "fgaAtRim", "fgLowPost", "fgaLowPost",
			"fgMidRange", "fgaMidRange", "tp", "tpa", "ft", "fta",
			"pm", "orb", "drb", "ast", "tov", "stl", "blk", "ba", "pf", "pts",
			"dd", "td", "qd", "fxf",
		],
		max: [
			"minMax", "fgMax", "fgaMax", "tpMax", "tpaMax", "ftMax", "ftaMax",
			"pmMax", "orbMax", "drbMax", "astMax", "tovMax", "stlMax", "blkMax",
			"baMax", "pfMax", "ptsMax", "2pMax", "2paMax", "trbMax", "gmscMax",
		],
	};

	/* The whole key set, in the order addStatsRow writes it — which is the
	   order an exported BBGM file has them in, so a diff against a real file
	   is a diff about values and not about key order. */
	const KEYS = ["playoffs", "season", "tid", "yearsWithTeam"]
		.concat(STATS.derived, STATS.raw, STATS.max, ["jerseyNumber"]);

	/* addStatsRow's row: counting stats zero, highs null. Null and not
	   undefined for the highs, for the reason BBGM's own comment gives —
	   undefined does not survive JSON, and career totals need to know the
	   field exists. */
	function blankRow(season, tid, jerseyNumber) {
		const row = { playoffs: false, season, tid, yearsWithTeam: 1 };
		for (const k of STATS.derived) row[k] = 0;
		for (const k of STATS.raw) row[k] = 0;
		for (const k of STATS.max) row[k] = null;
		row.jerseyNumber = jerseyNumber === undefined ? undefined : String(jerseyNumber);
		return row;
	}

	/* src/common/constants.ts. A stats row whose tid is DOES_NOT_EXIST is a
	   season played for a team this league has never heard of — which is what
	   BBGM's own Import players tool stamps on every row it imports from
	   another league, and what a college program is. helpers.getAbbrev renders
	   it "DNE"; -1 (free agent) renders as nothing at all. */
	const TID_DOES_NOT_EXIST = -7;

	// src/common/helpers.ts
	function gameScore(s) {
		return (
			s.pts + 0.4 * s.fg - 0.7 * s.fga - 0.4 * ((s.fta || 0) - (s.ft || 0)) +
			0.7 * (s.orb || 0) + 0.3 * (s.drb || 0) + (s.stl || 0) +
			0.7 * (s.ast || 0) + 0.7 * (s.blk || 0) - 0.4 * (s.pf || 0) -
			(s.tov || 0)
		);
	}

	/* The season highs of a game log, in BBGM's `[value, gid]` shape.

	   `gid` identifies the box score the game's page links to. These games
	   were not played in the league the file is imported into and there is no
	   box score to reach, so the id is a stable negative number derived from
	   the season and the game's place in the schedule: negative because BBGM's
	   own game ids are non-negative, so nothing here can ever collide with a
	   real game and quietly link a college high to somebody else's night. The
	   value — which is what every table displays — is exact. */
	function seasonHighs(games, season) {
		if (!games || !games.length) return null;
		const gid = (g, i) => -(Math.abs(season || 0) * 10000 + i + 1);
		const derived = {
			"2p": (g) => g.fg - g.tp,
			"2pa": (g) => g.fga - g.tpa,
			trb: (g) => g.orb + g.drb,
			gmsc: gameScore,
		};
		const out = {};
		for (const key of STATS.max) {
			const stat = key.slice(0, -3);
			const read = derived[stat] || ((g) => g[stat]);
			let best = null;
			for (let i = 0; i < games.length; i++) {
				const v = read(games[i]);
				if (!Number.isFinite(v)) continue;
				if (!best || v > best[0]) best = [v, gid(games[i], i)];
			}
			out[key] = best;
		}
		return out;
	}

	/* dd/td/qd/fxf, by writePlayerStats.ts's rule: how many of points,
	   assists, steals, blocks and rebounds cleared ten in a game (and five,
	   for the five-by-five). */
	function doubleCounts(games) {
		const out = { dd: 0, td: 0, qd: 0, fxf: 0 };
		for (const g of games || []) {
			const vals = [g.pts, g.ast, g.stl, g.blk, (g.orb || 0) + (g.drb || 0)];
			let doubles = 0;
			let fives = 0;
			for (const v of vals) {
				if (v >= 5) {
					fives++;
					if (v >= 10) doubles++;
				}
			}
			if (doubles >= 2) {
				out.dd++;
				if (doubles >= 3) {
					out.td++;
					if (doubles >= 4) out.qd++;
				}
			}
			if (fives >= 5) out.fxf++;
		}
		return out;
	}

	/* ------------------------------------------------------- advanced stats */

	const PRLS = {
		PG: 11, G: 10.75, SG: 10.5, GF: 10.5, SF: 10.5,
		F: 11, PF: 11.5, FC: 11.05, C: 10.6,
	};

	function getEWA(per, min, pos, gameLengthFactor) {
		const prl = PRLS[pos] !== undefined ? PRLS[pos] : 10.75;
		const va = (min * (per - prl)) / 67 / gameLengthFactor;
		return (va / 30) * 0.8;
	}

	const POS_NUM = {
		PG: 1, G: 1.5, SG: 2, GF: 2.5, SF: 3, F: 3.5, PF: 4, FC: 4.5, C: 5,
	};

	function fix(v) {
		return Number.isFinite(v) ? v : 0;
	}

	/* Every derived statistic in a stats row, for a whole league at once.

	   Whole league and not one team because two of them cannot be computed
	   for a team in isolation: PER is normalized so that the league average
	   is exactly 15, and BPM's team adjustment is measured against the league
	   average team. Handing this function one team would not give a slightly
	   worse answer, it would give a meaningless one — so the export runs the
	   entire simulated field through it, which is also the only way the
	   numbers a class exports agree with each other.

	   `teams` is [{ stats, players: [{ pos, stats }] }] with SEASON TOTALS
	   throughout (BBGM's advStats reads totals, never per-game). Team stats
	   need the same keys the game's own team stats have, opponent columns
	   included; see collegeSeasonStats and opponentTotals in js/engine.js for
	   how a simulated season supplies them.

	   Deviations from src/worker/util/advStats.basketball.ts, both because a
	   college game is 40 minutes and BBGM's is 48:
	     - `gameMinutes` replaces the hardcoded 48 in BPM's possession estimate
	     - `numGames` (the length of a BBGM season) still scales VORP, because
	       VORP is defined per 82-game season wherever the games were played */
	function leagueAdvanced(teams, opts) {
		const o = opts || {};
		const gameMinutes = o.gameMinutes || 48;
		const numPlayersOnCourt = o.numPlayersOnCourt || 5;
		const numGames = o.numGames || 82;
		const gameLengthFactor = gameMinutes / 48;

		const players = [];
		for (const t of teams) {
			for (const p of t.players) players.push({ p, t });
		}

		// League totals, summed over teams exactly as advStats does — pace
		// weighted by games played, everything else a plain sum.
		const LEAGUE_KEYS = ["gp", "ft", "pf", "ast", "fg", "pts", "fga", "orb",
			"tov", "fta", "trb", "poss", "ortg", "drtg"];
		const league = { pace: 0 };
		for (const k of LEAGUE_KEYS) league[k] = 0;
		for (const t of teams) {
			for (const k of LEAGUE_KEYS) league[k] += t.stats[k] || 0;
			league.pace += (t.stats.pace || 0) * (t.stats.gp || 0);
		}
		league.pace = league.gp > 0 ? league.pace / league.gp : 0;
		const numTeams = teams.filter((t) => (t.stats.gp || 0) > 0).length || 1;

		const out = players.map(() => ({}));
		if (!players.length || !league.gp) return out;

		/* --- on/off --------------------------------------------------- */
		for (let i = 0; i < players.length; i++) {
			const ps = players[i].p.stats;
			const t = players[i].t.stats;
			const tminAvg = t.min / numPlayersOnCourt;
			const onPerMin = ps.pm / (ps.min + 1e-6);
			const offMin = tminAvg - ps.min;
			const mov = t.pts - t.oppPts;
			const movWithout = mov - ps.pm;
			const offPerMin = movWithout / (offMin + 1e-6);
			const perMin = onPerMin - offPerMin;
			out[i].pm100 = fix((100 / t.pace) * gameMinutes * onPerMin);
			out[i].onOff100 = fix((100 / t.pace) * gameMinutes * perMin);
		}

		/* --- PER and EWA ---------------------------------------------- */
		{
			const factor = 2 / 3 - (0.5 * (league.ast / league.fg)) / (2 * (league.fg / league.ft));
			const vop = league.pts / (league.fga - league.orb + league.tov + 0.44 * league.fta);
			const drbp = (league.trb - league.orb) / league.trb;
			const aPER = [];
			let leagueAPER = 0;
			for (let i = 0; i < players.length; i++) {
				const ps = players[i].p.stats;
				const t = players[i].t.stats;
				const paceAdj = t.pace === 0 ? 1 : league.pace / t.pace;
				let uPER = 0;
				if (ps.min > 10) {
					uPER = (1 / ps.min) *
						(ps.tp +
							(2 / 3) * ps.ast +
							(2 - factor * (t.ast / t.fg)) * ps.fg +
							ps.ft * 0.5 * (1 + (1 - t.ast / t.fg) + (2 / 3) * (t.ast / t.fg)) -
							vop * ps.tov -
							vop * drbp * (ps.fga - ps.fg) -
							vop * 0.44 * (0.44 + 0.56 * drbp) * (ps.fta - ps.ft) +
							vop * (1 - drbp) * (ps.trb - ps.orb) +
							vop * drbp * ps.orb +
							vop * ps.stl +
							vop * drbp * ps.blk -
							ps.pf * (league.ft / league.pf - 0.44 * (league.fta / league.pf) * vop));
				}
				aPER[i] = fix(paceAdj * uPER);
				leagueAPER += aPER[i] * ps.min;
			}
			leagueAPER /= league.gp * numPlayersOnCourt * gameMinutes;
			for (let i = 0; i < players.length; i++) {
				const per = leagueAPER > 0 ? aPER[i] * (15 / leagueAPER) : 0;
				out[i].per = fix(per);
				out[i].ewa = fix(getEWA(out[i].per, players[i].p.stats.min,
					players[i].p.pos, gameLengthFactor));
			}
		}

		/* --- the percentages ------------------------------------------ */
		for (let i = 0; i < players.length; i++) {
			const ps = players[i].p.stats;
			const t = players[i].t.stats;
			const tmin = t.min / numPlayersOnCourt;
			out[i].astp = fix((100 * ps.ast) / ((ps.min / tmin) * t.fg - ps.fg));
			out[i].blkp = fix((100 * (ps.blk * tmin)) / (ps.min * (t.oppFga - t.oppTpa)));
			out[i].drbp = fix((100 * (ps.drb * tmin)) / (ps.min * (t.drb + t.oppOrb)));
			out[i].orbp = fix((100 * (ps.orb * tmin)) / (ps.min * (t.orb + t.oppDrb)));
			out[i].stlp = fix((100 * (ps.stl * tmin)) / (ps.min * t.poss));
			out[i].trbp = fix((100 * (ps.trb * tmin)) / (ps.min * (t.trb + t.oppTrb)));
			out[i].usgp = fix((100 * ((ps.fga + 0.44 * ps.fta + ps.tov) * tmin)) /
				(ps.min * (t.fga + 0.44 * t.fta + t.tov)));
		}

		/* --- offensive and defensive ratings, and win shares ---------- */
		for (let i = 0; i < players.length; i++) {
			const ps = players[i].p.stats;
			const t = players[i].t.stats;

			const dorPct = t.oppOrb / (t.oppOrb + t.drb);
			const dfgPct = t.oppFg / t.oppFga;
			const fmwt = (dfgPct * (1 - dorPct)) /
				(dfgPct * (1 - dorPct) + (1 - dfgPct) * dorPct);
			const stops1 = ps.stl + ps.blk * fmwt * (1 - 1.07 * dorPct) +
				ps.drb * (1 - fmwt);
			const stops2 =
				(((t.oppFga - t.oppFg - t.blk) / t.min) * fmwt * (1 - 1.07 * dorPct) +
					(t.oppTov - t.stl) / t.min) * ps.min +
				(ps.pf / t.pf) * 0.4 * t.oppFta * Math.pow(1 - t.oppFt / t.oppFta, 2);
			const stops = stops1 + stops2;
			const stopPct = (stops * t.min) / (t.poss * ps.min);
			const dPtsPerscPoss = t.oppPts /
				(t.oppFg + (1 - Math.pow(1 - t.oppFt / t.oppFta, 2)) * t.oppFta * 0.4);
			let drtg = t.drtg + 0.2 * (100 * dPtsPerscPoss * (1 - stopPct) - t.drtg);

			const marginalDefense = (ps.min / t.min) * t.poss *
				(1.08 * (league.pts / league.poss) - drtg / 100);
			const marginalPtsPerWin = 0.32 * (league.pts / league.gp) * (t.pace / league.pace);
			let dws = marginalDefense / marginalPtsPerWin;

			const ftRatio = ps.fta > 0 ? ps.ft / ps.fta : 0;
			const qAst =
				(ps.min / (t.min / numPlayersOnCourt)) * (1.14 * ((t.ast - ps.ast) / t.fg)) +
				(((t.ast / t.min) * ps.min * 5 - ps.ast) /
					((t.fg / t.min) * ps.min * 5 - ps.fg)) *
					(1 - ps.min / (t.min / numPlayersOnCourt));
			const fgPart = ps.fg * (1 - 0.5 * ((ps.pts - ps.ft) / (2 * ps.fga)) * qAst);
			const astPart = 0.5 *
				((t.pts - t.ft - (ps.pts - ps.ft)) / (2 * (t.fga - ps.fga))) * ps.ast;
			const ftPart = (1 - Math.pow(1 - ftRatio, 2)) * 0.4 * ps.fta;
			const teamScoringPoss = t.fg +
				(1 - Math.pow(1 - t.ft / t.fta, 2)) * t.fta * 0.4;
			const teamOrbPct = t.orb / (t.orb + t.oppDrb);
			const teamPlayPct = teamScoringPoss / (t.fga + t.fta * 0.4 + t.tov);
			const teamOrbWeight = ((1 - teamOrbPct) * teamPlayPct) /
				((1 - teamOrbPct) * teamPlayPct + teamOrbPct * (1 - teamPlayPct));
			const orbPart = ps.orb * teamOrbWeight * teamPlayPct;
			const scPoss = (fgPart + astPart + ftPart) *
				(1 - (t.orb / teamScoringPoss) * teamOrbWeight * teamPlayPct) + orbPart;
			const fgxPoss = (ps.fga - ps.fg) * (1 - 1.07 * teamOrbPct);
			const ftxPoss = Math.pow(1 - ftRatio, 2) * 0.4 * ps.fta;
			const totPoss = scPoss + fgxPoss + ftxPoss + ps.tov;
			const pProdFgPart = 2 * (ps.fg + 0.5 * ps.tp) *
				(1 - 0.5 * ((ps.pts - ps.ft) / (2 * ps.fga)) * qAst);
			const pProdAstPart = 2 *
				((t.fg - ps.fg + 0.5 * (t.tp - ps.tp)) / (t.fg - ps.fg)) * 0.5 *
				((t.pts - t.ft - (ps.pts - ps.ft)) / (2 * (t.fga - ps.fga))) * ps.ast;
			const pProdOrbPart = ps.orb * teamOrbWeight * teamPlayPct *
				(t.pts / (t.fg + (1 - Math.pow(1 - t.ft / t.fta, 2)) * 0.4 * t.fta));
			const pProd = (pProdFgPart + pProdAstPart + ps.ft) *
				(1 - (t.orb / teamScoringPoss) * teamOrbWeight * teamPlayPct) + pProdOrbPart;
			let ortg = 100 * (pProd / totPoss);
			const marginalOffense = pProd - 0.92 * (league.pts / league.poss) * totPoss;
			let ows = marginalOffense / marginalPtsPerWin;

			if (!Number.isFinite(drtg)) drtg = 0;
			if (!Number.isFinite(ortg)) ortg = 0;
			if (!Number.isFinite(dws) || ps.min < 10) dws = 0;
			if (!Number.isFinite(ows) || ps.min < 10) ows = 0;
			out[i].drtg = drtg;
			out[i].ortg = ortg;
			out[i].dws = dws;
			out[i].ows = ows;
		}

		/* --- BPM and VORP --------------------------------------------- */
		{
			const teamAvg = teams.map((t) => {
				const offRate = t.stats.ortg - league.ortg / numTeams;
				const defRate = league.drtg / numTeams - t.stats.drtg;
				const teamRate = offRate + defRate;
				const avgLead = (teamRate * t.stats.pace) / 200;
				const leadBonus = (0.35 / 2) * avgLead;
				return {
					tmRate: teamRate + leadBonus,
					ofRate: offRate + leadBonus,
					ptsTSA: t.stats.pts / (t.stats.fga + 0.44 * t.stats.fta),
					teamThresh: 0, trim1t: 0, trim1c: 0, trim2t: 0, trim2c: 0,
					teamBPM: 0, teamOBPM: 0, teamAdjBPM: 0, teamAdjOBPM: 0,
				};
			});
			const teamIndex = new Map();
			teams.forEach((t, i) => teamIndex.set(t, i));

			const playerPoss = [];
			const playerMin = [];
			const playerPos = [];
			const playerRole = [];
			const adjPts = [];
			const threshPts = [];

			for (let i = 0; i < players.length; i++) {
				const ps = players[i].p.stats;
				const t = players[i].t.stats;
				const ta = teamAvg[teamIndex.get(players[i].t)];
				const tsa = ps.fga + ps.fta * 0.44;
				const ptsTsa = ps.pts / (tsa + 1e-6);
				adjPts[i] = (ptsTsa - ta.ptsTSA + 1) * tsa;
				playerPoss[i] = 1e-6 + (ps.min * t.pace) / gameMinutes;
				threshPts[i] = tsa * (ptsTsa - (ta.ptsTSA - 0.33));
				ta.teamThresh += threshPts[i];
			}

			for (let i = 0; i < players.length; i++) {
				const ps = players[i].p.stats;
				const t = players[i].t.stats;
				const ta = teamAvg[teamIndex.get(players[i].t)];
				const prl = POS_NUM[players[i].p.pos] !== undefined
					? POS_NUM[players[i].p.pos] : 3;
				const minp = t.min > 0 ? (ps.min + 1e-9) / (t.min / numPlayersOnCourt) : 0;
				const trbp = t.trb > 0 ? ps.trb / t.trb / minp : 0;
				const stlp = t.stl > 0 ? ps.stl / t.stl / minp : 0;
				const pfp = t.pf > 0 ? ps.pf / t.pf / minp : 0;
				const astp = t.ast > 0 ? ps.ast / t.ast / minp : 0;
				const blkp = t.blk > 0 ? ps.blk / t.blk / minp : 0;
				const thsp = ta.teamThresh !== 0 ? threshPts[i] / ta.teamThresh / minp : 0;

				const estPos1 = 2.13 + 8.668 * trbp - 2.486 * stlp + 0.992 * pfp -
					3.536 * astp + 1.667 * blkp;
				const minAdj1 = (estPos1 * ps.min + prl * 50) / (50 + ps.min);
				ta.trim1t += Math.max(1, Math.min(minAdj1, 5));
				ta.trim1c += 1;
				playerPos[i] = minAdj1;
				playerMin[i] = minp;

				const orole = 6 - 6.642 * astp - 8.544 * thsp;
				const oroleMin1 = (orole * ps.min + 4 * 50) / (50 + ps.min);
				ta.trim2t += Math.max(1, Math.min(oroleMin1, 5));
				ta.trim2c += 1;
				playerRole[i] = oroleMin1;
			}

			// One convergence step, as BBGM does.
			for (let i = 0; i < players.length; i++) {
				const ta = teamAvg[teamIndex.get(players[i].t)];
				playerPos[i] = Math.max(1, Math.min(
					playerPos[i] - (ta.trim1t / ta.trim1c - 3), 5));
				playerRole[i] = Math.max(1, Math.min(
					playerRole[i] - (ta.trim2t / ta.trim2c - 3), 5));
			}

			const coeffsBPM1 = [0.86, -0.56, -0.246, 0.389, 0.58, -0.964, 0.613,
				0.116, 0.0, 1.369, 1.327, -0.367];
			const coeffsBPM5 = [0.86, -0.78, -0.343, 0.389, 1.034, -0.964, 0.181,
				0.181, 0.0, 1.008, 0.703, -0.367];
			const coeffsORBPM1 = [0.605, -0.33, -0.145, 0.477, 0.476, -0.579, 0.606,
				-0.112, 0.0, 0.177, 0.725, -0.439];
			const coeffsORBPM5 = [0.605, -0.472, -0.208, 0.477, 0.476, -0.882, 0.422,
				0.103, 0.0, 0.294, 0.097, -0.439];

			const BPM = [];
			const OBPM = [];
			for (let i = 0; i < players.length; i++) {
				const ps = players[i].p.stats;
				const ta = teamAvg[teamIndex.get(players[i].t)];
				const poss = playerPoss[i];
				const role = playerRole[i];
				const pos = playerPos[i];
				const per100 = (v) => (v / poss) * 100;
				const pts100 = per100(adjPts[i]);
				const fga100 = per100(ps.fga);
				const fta100 = per100(ps.fta);
				const tp100 = per100(ps.tp);
				const ast100 = per100(ps.ast);
				const stl100 = per100(ps.stl);
				const blk100 = per100(ps.blk);
				const pf100 = per100(ps.pf);
				const to100 = per100(ps.tov);
				const orb100 = per100(ps.orb);
				const drb100 = per100(ps.drb);
				const trb100 = per100(ps.trb);

				const interBPM = pos < 3 ? ((3 - pos) / 2) * -0.818 : 1.387 * (role - 3);
				const interORBPM = pos < 3 ? ((3 - pos) / 2) * -1.698 : 0.43 * (role - 3);

				const cB = [];
				const cO = [];
				for (let j = 0; j < coeffsBPM1.length; j++) {
					const posB = j === 1 || j === 2 ? role : pos;
					cB[j] = ((5 - posB) / 4) * coeffsBPM1[j] + ((posB - 1) / 4) * coeffsBPM5[j];
					cO[j] = ((5 - posB) / 4) * coeffsORBPM1[j] + ((posB - 1) / 4) * coeffsORBPM5[j];
				}
				const box = (c) =>
					pts100 * c[0] + fga100 * c[1] + fta100 * c[2] + tp100 * c[3] +
					ast100 * c[4] + to100 * c[5] +
					orb100 * c[6] + drb100 * c[7] + trb100 * c[8] + stl100 * c[9] +
					blk100 * c[10] + pf100 * c[11];

				BPM[i] = box(cB) + interBPM;
				OBPM[i] = box(cO) + interORBPM;
				ta.teamBPM += BPM[i] * playerMin[i];
				ta.teamOBPM += OBPM[i] * playerMin[i];
			}

			for (const ta of teamAvg) {
				ta.teamAdjBPM = (ta.tmRate - ta.teamBPM) / numPlayersOnCourt;
				ta.teamAdjOBPM = (ta.ofRate - ta.teamOBPM) / numPlayersOnCourt;
			}
			for (let i = 0; i < players.length; i++) {
				const ta = teamAvg[teamIndex.get(players[i].t)];
				const bpm = BPM[i] + ta.teamAdjBPM;
				const obpm = OBPM[i] + ta.teamAdjOBPM;
				out[i].obpm = fix(obpm);
				out[i].dbpm = fix(bpm - obpm);
				out[i].vorp = fix(((bpm + 2) * playerMin[i] * players[i].t.stats.gp) / numGames);
			}
		}

		return out;
	}

	global.BBGMStats = {
		STATS, KEYS, TID_DOES_NOT_EXIST, blankRow, gameScore, seasonHighs, doubleCounts,
		leagueAdvanced, getEWA,
	};
})(typeof window !== "undefined" ? window : self);
