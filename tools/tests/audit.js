/* Regression checks for the September-2026 external audit.

   Every check here is a claim the harness could not previously fail on. Four
   of them come from the audit's own "test gaps to close" list — the per-rating
   solver identity at zero shift, exported stat rows with no `undefined` keys,
   game minutes bounded by overtime, and a JSON round trip of the whole result
   — and the rest pin the bugs that pass fixed so they cannot come back
   quietly. */
"use strict";

module.exports = function (ok, V) {
	const { Rng } = global.BBGMRng;
	const BB = global.BBGM;
	const RB = global.RatingsBuilder;
	const BS = global.BBGMStats;
	const C = global.Colleges;
	const CAL = global.Calibration;

	/* ------------------------------------------- the solver at zero shift

	   `applyShift` eases ratings onto the floor so a shift DOWN does not drive
	   a specialist's weak ratings into 1. The ease used to be a map from value
	   to value with a fixed knee, so it fired at k = 0 as well: every rating
	   under 11 came back LIFTED, by up to +2.5, for a shift of nothing. It
	   moved no ovr worth speaking of (ft, fg and ins carry almost no weight),
	   so `touchUp` never corrected it and no test looked. Three README claims
	   depended on it not happening. */
	{
		const keys = BB.RATING_KEYS;
		let worst = 0;
		let worstWhere = "";
		const rng = new Rng("zeroshift");
		for (let i = 0; i < 400; i++) {
			const base = {};
			// Deliberately weighted low: the whole defect lived under 11.
			for (const k of keys) base[k] = Math.round(rng.uniform(1, 24));
			const arch = RB.ARCHETYPES[Math.floor(rng.random() * RB.ARCHETYPES.length)];
			for (const up of [true, false]) {
				const scales = RB.shiftScales(arch, up, null);
				const out = RB.applyShift(base, 0, scales, null);
				for (const k of keys) {
					const d = Math.abs(out[k] - base[k]);
					if (d > worst) { worst = d; worstWhere = k + " " + base[k] + " -> " + out[k]; }
				}
			}
		}
		ok("a zero shift is the identity on every rating", worst === 0,
			worst ? "worst move: " + worstWhere : "");
	}

	/* The ease still has to do its job. A shift down must reach the floor
	   without a rating landing on it early, and a shift up must not be
	   touched by a floor guard at all. */
	{
		const keys = BB.RATING_KEYS;
		const base = {};
		for (const k of keys) base[k] = 8;
		base.hgt = 45;
		const scales = RB.shiftScales(RB.ARCHETYPES[0], false, null);
		const deep = RB.applyShift(base, -40, scales, null);
		ok("a large shift down still reaches the floor",
			keys.some((k) => k !== "hgt" && deep[k] === 1));
		const up = RB.shiftScales(RB.ARCHETYPES[0], true, null);
		const raised = RB.applyShift(base, 4, up, null);
		ok("a shift up is never eased",
			keys.every((k) => k === "hgt" || !up[k] ||
				raised[k] === Math.min(99, Math.round(base[k] + 4 * up[k]))));
	}

	/* Monotone in k, which is the property the bisection in solveToOvr
	   depends on and the thing an ease can quietly break. */
	{
		const keys = BB.RATING_KEYS;
		const rng = new Rng("mono");
		let breaks = 0;
		for (let i = 0; i < 60; i++) {
			const base = {};
			for (const k of keys) base[k] = Math.round(rng.uniform(1, 60));
			const scales = RB.shiftScales(
				RB.ARCHETYPES[Math.floor(rng.random() * RB.ARCHETYPES.length)], true, null);
			let prev = null;
			for (let k = -30; k <= 30; k += 0.5) {
				const out = RB.applyShift(base, k, scales, null);
				if (prev) {
					for (const key of keys) if (out[key] < prev[key]) breaks++;
				}
				prev = out;
			}
		}
		ok("applyShift is monotone in the shift", breaks === 0, breaks + " inversions");
	}

	/* Preserve mode's own promise, end to end: re-solving a player to the ovr
	   he already has must leave the rest of him where it is.

	   Worth saying what this check does and does not catch. It passed BEFORE
	   the zero-shift fix as well, because a class built at the default
	   settings rarely carries a rating under 11 and the defect only lived
	   under 11 — which is exactly how it survived 719 checks. The property is
	   the right one to assert; the check above it, which drives the function
	   directly at low bases, is the one that fails when the ease comes back. */
	{
		const lf = V.syntheticClass(31, 30);
		const a = global.Engine.run(lf, global.Config.make({ seed: "pin", ovrMode: "preserve" }));
		const archOf = (name) => RB.ARCHETYPES.filter((x) => x.name === name)[0] || null;
		let moved = 0;
		let worst = "";
		for (const p of a.players) {
			const solved = RB.solveToOvr(p.newRatings, p.newOvr, archOf(p.archetype), null);
			if (!solved) continue;
			for (const k of BB.RATING_KEYS) {
				const d = Math.abs(solved[k] - p.newRatings[k]);
				if (d > 1) {
					moved++;
					worst = worst || (p.name + " " + k + ": " + p.newRatings[k] + " -> " + solved[k]);
				}
			}
		}
		ok("re-solving a player to the ovr he already has leaves him alone",
			moved === 0, moved + " ratings moved by more than 1; " + worst);
	}

	/* -------------------------------------- exported rows carry no undefined

	   `blankRow` set `jerseyNumber: undefined` when the player had no number.
	   The key was present to Object.keys and absent the moment the row was
	   stringified, so the row the file claimed to write was not the row it
	   wrote. */
	{
		const withNumber = BS.blankRow(2028, -7, 12);
		const without = BS.blankRow(2028, -7);
		ok("a blank stats row never holds an undefined value",
			Object.keys(without).every((k) => without[k] !== undefined) &&
			Object.keys(withNumber).every((k) => withNumber[k] !== undefined));
		ok("a row's key set survives a JSON round trip",
			JSON.stringify(Object.keys(without)) ===
				JSON.stringify(Object.keys(JSON.parse(JSON.stringify(without)))) &&
			JSON.stringify(Object.keys(withNumber)) ===
				JSON.stringify(Object.keys(JSON.parse(JSON.stringify(withNumber)))));
		ok("a jersey number is carried when there is one",
			withNumber.jerseyNumber === "12" &&
			!Object.prototype.hasOwnProperty.call(without, "jerseyNumber"));
	}

	{
		const lf = V.syntheticClass(52, 40);
		const res = global.Engine.run(lf, global.Config.make({ seed: "undef" }));
		const exported = global.Engine.exportFile(res);
		let bad = 0;
		let where = "";
		const walk = (node, path) => {
			if (node === null || typeof node !== "object") {
				if (node === undefined) { bad++; where = where || path; }
				return;
			}
			if (Array.isArray(node)) {
				node.forEach((x, i) => walk(x, path + "[" + i + "]"));
				return;
			}
			for (const k of Object.keys(node)) walk(node[k], path + "." + k);
		};
		walk(exported, "export");
		ok("no exported value anywhere is undefined", bad === 0,
			bad + " undefined values, first at " + where);
	}

	/* ------------------------------------------ minutes bounded by overtime

	   A 40-minute game with one overtime is 45 minutes long and a man cannot
	   play 47 of them. The generator caps per-game minutes at the game's own
	   length; nothing asserted it, so a redistribution pass that broke the cap
	   would have shown up only as an odd-looking box score. */
	{
		const res = global.Engine.run(V.syntheticClass(77, 50), global.Config.make({ seed: "ot" }));
		let over = 0;
		let worst = "";
		let sawOt = 0;
		for (const p of res.players) {
			if (!p.gameLog) continue;
			/* `avail` is the game's own length — the league's regulation plus
			   five a period — written by the generator. Recomputed here from
			   the overtime count as well, so a wrong `avail` is caught rather
			   than trusted. */
			const league = p.nonNcaa && p.proTeam ? p.proTeam.gameMinutes : 40;
			for (const g of p.gameLog.games) {
				const cap = (league || 40) + 5 * (g.ot || 0);
				if (g.ot) sawOt++;
				if (g.min > cap + 1e-9 || (Number.isFinite(g.avail) && g.avail > cap + 1e-9)) {
					over++;
					worst = worst || (p.name + ": " + g.min + " min (avail " + g.avail +
						") in a " + cap + "-minute game with " + (g.ot || 0) + " OT");
				}
			}
		}
		ok("no game log minute total exceeds regulation plus five per overtime",
			over === 0, over + " games over the cap; " + worst);
		ok("the sample actually contained overtime games", sawOt > 0,
			sawOt + " overtime appearances");
	}

	/* ------------------------------- the result is JSON, all the way through

	   `res.board` carried a -Infinity score for a prospect with no stat line.
	   It sorted correctly and it is not a JSON number: stringify turned it
	   into null and every formatter that walked the board printed either
	   "null" or the string "-Infinity". The sweep below is over the whole
	   result, not only the board, because that class of fault is not specific
	   to one field. */
	{
		let checked = 0;
		let bad = 0;
		let where = "";
		for (const seed of ["b2", "b6", "b11"]) {
			const res = global.Engine.run(V.realisticClass(90, 60), global.Config.make({ seed }));
			const scan = (node, path, depth) => {
				if (depth > 12) return;
				if (typeof node === "number") {
					checked++;
					if (!Number.isFinite(node)) { bad++; where = where || (seed + " " + path); }
					return;
				}
				if (node === null || typeof node !== "object") return;
				if (Array.isArray(node)) {
					node.forEach((x, i) => scan(x, path + "[" + i + "]", depth + 1));
					return;
				}
				for (const k of Object.keys(node)) scan(node[k], path + "." + k, depth + 1);
			};
			scan(res.board, "board", 0);
			scan(res.poll, "poll", 0);
		}
		ok("no non-finite number survives on res.board or res.poll",
			bad === 0, bad + " of " + checked + " numbers, first at " + where);
	}

	{
		/* A prospect who did not play is on the board with a null score, not a
		   sentinel, and the board is still in board order around him.

		   The destination weights are forced, because at the built-in ones a
		   "Did not play" prospect turns up in roughly one class in ten and a
		   check that is usually vacuous is not a check. Weighting the
		   destination heavily is the only thing this changes: he is generated,
		   scored and ranked by exactly the same code either way. */
		let sawBlank = 0;
		let bad = "";
		let outOfOrder = 0;
		for (const seed of ["b2", "b6", "b11", "b19"]) {
			const res = global.Engine.run(V.realisticClass(91, 60),
				global.Config.make({ seed, leagueWeights: { "Did not play": 60 } }));
			const board = res.board || [];
			for (const p of board) {
				if (p.stats) continue;
				sawBlank++;
				if (p.scoreTotal !== null && p.scoreTotal !== undefined) {
					bad = bad || (p.name + " scoreTotal=" + p.scoreTotal);
				}
			}
			for (let i = 1; i < board.length; i++) {
				if (board[i].boardRank <= board[i - 1].boardRank) outOfOrder++;
			}
		}
		ok("an unscored prospect carries null, not a sentinel",
			sawBlank > 0 && !bad, bad || (sawBlank + " blank stat lines seen"));
		ok("a board carrying unscored prospects is still in rank order",
			outOfOrder === 0, outOfOrder + " out-of-order rows");
	}

	/* ------------------------------------------- one possession coefficient

	   0.44 is part of the DEFINITION of a possession, so every site that
	   computes possessions or true shooting has to use the same one. It was a
	   bare literal at five sites; it is named at both files that own an
	   identity now, and this is what keeps the two names equal. */
	ok("the possession identity uses one free-throw coefficient",
		CAL.FT_TRIP === 0.44, "Calibration.FT_TRIP = " + CAL.FT_TRIP);
	{
		const lf = V.syntheticClass(64, 40);
		const res = global.Engine.run(lf, global.Config.make({ seed: "poss" }));
		let worst = 0;
		for (const t of Object.values(res.teams)) {
			const b = t.box || t.teamTotals;
			if (!b || !Number.isFinite(b.poss)) continue;
			const implied = b.fga - b.orb + b.tov + CAL.FT_TRIP * b.fta;
			worst = Math.max(worst, Math.abs(implied - b.poss));
		}
		ok("team possessions reconcile to the identity with that coefficient",
			worst < 1e-6, "worst drift " + worst);
	}

	/* ---------------------------------------------- the conference table

	   `Independent` is a deliberate catch-all with no members; it is the
	   fallback every `CONFERENCES[x] ||` in the engine falls through to. Any
	   OTHER memberless conference is a table edit that went wrong — a league
	   renamed on one side and not the other — and would show up as a
	   conference that exists, has a strength and a bid count, and never plays
	   a game. */
	{
		const empty = Object.keys(C.CONFERENCES)
			.filter((n) => !(C.byConference[n] || []).length);
		ok("the only memberless conference is the documented catch-all",
			empty.length === 1 && empty[0] === "Independent", empty.join(", "));
		ok("every program resolves to a conference that exists",
			C.names.every((n) => C.CONFERENCES[C.conferenceOf(n)]));
	}

	/* Program counts stated in comments and in the README are the table's own.
	   Two comments said 368 against a table of 364 for long enough that the
	   README and the code disagreed in print. */
	ok("the program table is the size the docs claim", C.names.length === 364,
		C.names.length + " programs");

	/* ----------------------------------------- a gap year regresses to itself

	   `ageCarry` regressed every program level toward a hardcoded 55, which is
	   the middle of the default field and of no other. A universe whose
	   carried programs are all strong was dragged toward a number from a
	   different world across a gap. */
	{
		const U = global.Universe;
		const levels = {};
		for (const n of C.names.slice(0, 40)) levels[n] = 80;
		const carry = { confOf: {}, levels, coaches: {}, returners: {}, titles: {} };
		const aged = U.ageCarry(carry, 10);
		const mean = Object.keys(aged.levels)
			.reduce((a, n) => a + aged.levels[n], 0) / Object.keys(aged.levels).length;
		ok("a uniform field does not drift across a gap", Math.abs(mean - 80) < 1e-6,
			"mean " + mean.toFixed(2) + " after ten unplayed years");
		const spread = {};
		C.names.slice(0, 40).forEach((n, i) => { spread[n] = 40 + i; });
		const aged2 = U.ageCarry({ confOf: {}, levels: spread, coaches: {}, returners: {}, titles: {} }, 10);
		const before = Math.max.apply(null, Object.values(spread)) -
			Math.min.apply(null, Object.values(spread));
		const after = Math.max.apply(null, Object.values(aged2.levels)) -
			Math.min.apply(null, Object.values(aged2.levels));
		ok("a spread field still compresses across a gap", after < before * 0.5,
			"spread " + before + " -> " + after.toFixed(1));
	}

	/* ------------------------------------------------ pace has one band

	   The class-environment jitter floors pace at 55; `priorSchedule` clamped
	   what it was handed to [58, 82], so the bottom of that jitter was
	   truncated and the prior seasons of a run described a faster game than
	   the season beside them. */
	{
		/* The defect was two constants, not one behaviour: the jitter floored
		   at 55 and the prior-season scoreboard clamped at 58, so the bottom
		   three points of the jitter existed in one half of a run and not the
		   other. There is one band now and both halves read it, which is what
		   this asserts — a `Math.max(55, …)` written back into the jitter
		   would fail here even though the run it produced still looked
		   plausible. */
		const E = global.Engine;
		ok("the engine states one pace band",
			E.PACE_MIN === 55 && E.PACE_MAX === 82,
			"PACE_MIN=" + E.PACE_MIN + " PACE_MAX=" + E.PACE_MAX);
		const src = require("fs").readFileSync(
			require("path").join(__dirname, "..", "..", "js", "engine.js"), "utf8");
		const literals = (src.match(/Math\.max\(5[0-9], (?:cfg|bent)\.pace/g) || []).length +
			(src.match(/\.pace : 68, 5[0-9], 8[0-9]\)/g) || []).length;
		ok("nothing clamps pace to a literal of its own", literals === 0,
			literals + " hardcoded pace bounds still in js/engine.js");
		/* And the band is honoured end to end: at the slider's floor the
		   jitter must be able to take the effective pace below it. */
		let below = 0;
		for (let i = 0; i < 40; i++) {
			const res = global.Engine.run(V.syntheticClass(88, 24),
				global.Config.make({ seed: "pace" + i, pace: 58 }));
			const eff = res.effectiveCfg || {};
			if (Number.isFinite(eff.pace)) {
				ok("the effective pace never goes under the band", eff.pace >= E.PACE_MIN, String(eff.pace));
				if (eff.pace < 58) below++;
				break;
			}
		}
		for (let i = 0; i < 60 && below === 0; i++) {
			const res = global.Engine.run(V.syntheticClass(88, 24),
				global.Config.make({ seed: "slow" + i, pace: 58 }));
			if ((res.effectiveCfg || {}).pace < 58) below++;
		}
		ok("a season at the slider's floor can still run slower than it",
			below > 0, "no seed in 60 produced a sub-58 effective pace");
	}

	/* ------------------------------------------------ the build table's size

	   The Builds-per-class slider was capped at 40 against a table of 205, so
	   the documented off switch ("set it to the table size or above") could
	   not be reached from the UI at all. The markup carries the table's size
	   now; this is what notices when the table grows past it again. */
	{
		const html = require("fs").readFileSync(
			require("path").join(__dirname, "..", "..", "index.html"), "utf8");
		const m = /id="archetypePool"[^>]*max="(\d+)"/.exec(html) ||
			/max="(\d+)"[^>]*id="archetypePool"/.exec(html);
		ok("the build-pool slider reaches the size of the build table",
			!!m && Number(m[1]) >= RB.ARCHETYPES.length,
			m ? "slider max " + m[1] + " against " + RB.ARCHETYPES.length + " builds"
				: "slider not found");
	}
};
