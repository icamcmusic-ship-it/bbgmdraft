/* The season / stats calculation fixes of the 2026-10-05 audit (C4-C8, C15).

   Each block pins the new behaviour AND the property that made the old one a
   defect, so a change that quietly restores it fails here and not in a
   player's hands:

     C4   a setting at its default can be pinned against flavors, storylines
          and the weirdness dial; a full config does not pin everything
     C5   the pace slider is monotone over its whole range and realises about
          the number it is labelled with
     C6   team steals, blocks and fouls scale with the game's possessions and
          the league level sits on the anchors
     C7   efficiencyEnv is symmetric, moves team points, and leaves
          possessions to the pace dial
     C8   no prior-season row carries real minutes beside all-zero advanced
          statistics
     C15  varySize moves weight only while heights are locked

   Shape: module.exports = function (ok, V), run after V.loadEngine(). */
"use strict";

module.exports = function (ok, V) {
	const E = global.Engine;
	const C = global.Config;
	const BS = global.BBGMStats;
	const T = global.TeamsSim;
	const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
	const corr = (a, b) => {
		const ma = mean(a);
		const mb = mean(b);
		let n = 0;
		let da = 0;
		let db = 0;
		for (let i = 0; i < a.length; i++) {
			n += (a[i] - ma) * (b[i] - mb);
			da += (a[i] - ma) ** 2;
			db += (b[i] - mb) ** 2;
		}
		return n / Math.sqrt(da * db);
	};
	const SEEDS = 5;
	const lfFor = (s) => V.realisticClass(7300 + s, 70);
	const run = (s, extra) => E.run(lfFor(s), C.make(Object.assign(
		{ seed: "cf" + s, narrative: false }, extra || {})));

	/* ------------------------------------------------------------------ C4 */
	{
		const D = C.DEFAULTS;
		ok("C4/make(DEFAULTS) pins nothing (a full snapshot is not a statement)",
			C.make(D).pinned.length === 0, JSON.stringify(C.make(D).pinned));
		ok("C4/make({}) pins nothing", C.make({}).pinned.length === 0);
		ok("C4/a spread of the defaults with one key set pins nothing (full object)",
			C.make(Object.assign({}, D, { pace: 68 })).pinned.length === 0);
		ok("C4/a full object missing a few newer keys is still a snapshot",
			(() => {
				const old = Object.assign({}, D);
				delete old.weirdness;
				delete old.traitCount;
				delete old.statNoise;
				return C.make(old).pinned.length === 0;
			})());
		ok("C4/a partial object pins the default-valued keys it names",
			JSON.stringify(C.make({ pace: 68, seed: "x", injuryRate: 1 }).pinned) ===
				JSON.stringify(["injuryRate", "pace"].sort((a, b) =>
					Object.keys(D).indexOf(a) - Object.keys(D).indexOf(b))),
			JSON.stringify(C.make({ pace: 68, seed: "x", injuryRate: 1 }).pinned));
		ok("C4/a key that differs from its default is not listed (the old rule covers it)",
			C.make({ pace: 70 }).pinned.indexOf("pace") === -1);
		ok("C4/an explicit null is a broken value, not a pin",
			C.make({ pace: null }).pinned.indexOf("pace") === -1 && C.make({ pace: null }).pace === 68);
		ok("C4/the seed is never pinned", C.make({ seed: "" }).pinned.indexOf("seed") === -1);
		const once = C.make({ pace: 68, upsetFactor: 1 });
		ok("C4/make is idempotent on its own output",
			JSON.stringify(C.make(once).pinned) === JSON.stringify(once.pinned));
		ok("C4/a JSON round trip keeps the pins (saved sessions, #c= links)",
			JSON.stringify(C.make(JSON.parse(JSON.stringify(once))).pinned) === JSON.stringify(once.pinned));
		ok("C4/an explicit pinned list is authoritative over the keys present",
			C.make({ pinned: ["pace"], upsetFactor: 1 }).pinned.join() === "pace");
		ok("C4/a pin on a key later moved off its default is dropped on rebuild",
			C.make(Object.assign({}, once, { pace: 72 })).pinned.indexOf("pace") === -1);
		ok("C4/no built-in preset pins anything",
			Object.keys(C.PRESETS).every((n) => C.make(C.PRESETS[n]).pinned.length === 0));

		/* The pace sweep the audit measured: 66/68/70 with a storyline drawn.
		   Same seed for all three, so the class jitter and the storyline are
		   the same draws; the only difference is the slider. */
		let exact = 0;
		let unpinnedMoved = 0;
		let monotone = 0;
		for (let s = 0; s < 8; s++) {
			const at = (pace, extra) => E.run(lfFor(s), C.make(Object.assign(
				{ seed: "c4-" + s, pace }, extra || {}))).effectiveCfg.pace;
			const a = at(66);
			const b = at(68);   // pinned: the partial object names it
			const c = at(70);
			if (Math.abs((c - b) - 2) < 1e-9 && Math.abs((b - a) - 2) < 1e-9) exact++;
			if (a < b && b < c) monotone++;
			// 68 left to the default is open to the storyline.
			const d = E.run(lfFor(s), C.make({ seed: "c4-" + s })).effectiveCfg.pace;
			if (Math.abs(d - b) > 1e-9) unpinnedMoved++;
		}
		ok("C4/with a storyline drawn, pinned 68 sits exactly between 66 and 70 (monotone sweep)",
			exact === 8 && monotone === 8, exact + " exact, " + monotone + " monotone of 8");
		ok("C4/the same 68 left at the default is bent by some storylines (the rule being pinned against)",
			unpinnedMoved >= 1, unpinnedMoved + " of 8");

		/* A full config round-tripped through make must not pin anything, or
		   every storyline would be locked out of a session that never touched a
		   slider. */
		let bent = 0;
		for (let s = 0; s < 8; s++) {
			const fresh = E.run(lfFor(s), C.make({ seed: "c4-" + s })).effectiveCfg;
			const trip = E.run(lfFor(s), C.make(JSON.parse(JSON.stringify(
				C.make({ seed: "c4-" + s }))))).effectiveCfg;
			if (JSON.stringify(fresh) === JSON.stringify(trip)) bent++;
		}
		ok("C4/a round-tripped full config plays the same season as the config it came from",
			bent === 8, bent + " of 8");

		/* The flavor path: "injury year" bends injuryRate to 2. */
		const inj = (extra) => E.run(lfFor(1), C.make(Object.assign(
			{ seed: "c4-flavor", narrative: false, flavorHint: "injury year" }, extra))).effectiveCfg.injuryRate;
		ok("C4/a flavor bends an unpinned injuryRate", inj({}) > 1.2, String(inj({})));
		ok("C4/injuryRate pinned at its default 1 is left alone by the flavor",
			inj({ injuryRate: 1 }) === 1, String(inj({ injuryRate: 1 })));

		/* The weirdness path: +3 widens upsetFactor (default 1) to 1.8. */
		const ups = (extra) => E.run(lfFor(2), C.make(Object.assign(
			{ seed: "c4-weird", narrative: false, weirdness: 3 }, extra))).effectiveCfg.upsetFactor;
		ok("C4/weirdness moves an unpinned upsetFactor", ups({}) > 1.5, String(ups({})));
		ok("C4/upsetFactor pinned at its default is left alone by weirdness",
			ups({ upsetFactor: 1 }) === 1, String(ups({ upsetFactor: 1 })));
		ok("C4/narrative pinned on survives weirdness -2",
			(() => {
				const r = E.run(lfFor(2), C.make({ seed: "c4-weird", weirdness: -2, narrative: true }));
				const r2 = E.run(lfFor(2), C.make(Object.assign({}, C.make({ seed: "c4-weird" }), { weirdness: -2 })));
				return r.narrative.length > 0 && r2.narrative.length === 0;
			})());

		/* A staged re-run must see the pin: toggling it changes the season. */
		{
			const runner = E.createRunner ? E.createRunner(lfFor(3)) : null;
			if (runner) {
				const cold = (extra) => E.run(lfFor(3), C.make(Object.assign({ seed: "c4-warm" }, extra)));
				runner.run(C.make({ seed: "c4-warm" }));
				const warm = runner.run(C.make({ seed: "c4-warm", pace: 68 }));
				ok("C4/a warm re-run honours a new pin exactly as a cold run does",
					warm.effectiveCfg.pace === cold({ pace: 68 }).effectiveCfg.pace);
			}
		}
	}

	/* ---------------------------------------------------------- C5 / C6 */
	const sweep = {};
	{
		const team = (res) => Object.values(res.teams).filter((t) => t.teamTotals).map((t) => t.teamTotals);
		for (const pace of [58, 68, 80, 82]) {
			const rows = [];
			for (let s = 0; s < SEEDS; s++) rows.push(...team(run(s, { pace })));
			sweep[pace] = rows;
		}
		const m = (pace, k) => mean(sweep[pace].map((t) => t[k]));

		ok("C5/realised possessions rise with the slider across the whole range",
			m(58, "poss") < m(68, "poss") && m(68, "poss") < m(80, "poss") && m(80, "poss") < m(82, "poss"),
			[58, 68, 80, 82].map((p) => m(p, "poss").toFixed(1)).join(" < "));
		ok("C5/80 and 82 are different seasons (they used to be clamped together)",
			m(82, "poss") - m(80, "poss") > 1.0,
			"gap " + (m(82, "poss") - m(80, "poss")).toFixed(2));
		ok("C5/the slider realises about the possessions it is labelled with (default 68)",
			Math.abs(m(68, "poss") - 68) < 2.0, m(68, "poss").toFixed(2));
		ok("C5/a slider of 82 realises about 82",
			Math.abs(m(82, "poss") - 82) < 2.5, m(82, "poss").toFixed(2));
		ok("C5/a slider of 58 realises about 58",
			Math.abs(m(58, "poss") - 58) < 2.5, m(58, "poss").toFixed(2));
		ok("C5/the default league scores near the modern anchor (73.6 on 57.5)",
			Math.abs(m(68, "pts") / 73.6 - 1) < 0.04 && Math.abs(m(68, "fga") / 57.5 - 1) < 0.05,
			m(68, "pts").toFixed(1) + " on " + m(68, "fga").toFixed(1));
		ok("C5/the effective tempo reaches past the slider's own ceiling when the dials stack",
			T.teamPace({ style: { pace: 0 } }, { pace: 82, scoringEnv: 3 }) > 84 &&
			T.teamPace({ style: { pace: 5.5 } }, { pace: 82, scoringEnv: 0 }) > 85 &&
			T.teamPace({ style: { pace: -4.5 } }, { pace: 58, scoringEnv: -3 }) < 50,
			[T.teamPace({ style: { pace: 0 } }, { pace: 82, scoringEnv: 3 }),
				T.teamPace({ style: { pace: 5.5 } }, { pace: 82, scoringEnv: 0 })].join(", "));
		ok("C5/the class jitter is not clamped back into the slider's band at 82",
			(() => {
				let above = 0;
				for (let s = 0; s < 12; s++) {
					if (run(s, { pace: 82 }).effectiveCfg.pace > C.CLAMP.pace.hi + 0.01) above++;
				}
				return above >= 3;
			})());

		/* C6: steals, blocks and fouls are per-possession events. */
		const ratio = (k) => m(82, k) / m(58, k);
		const possRatio = m(82, "poss") / m(58, "poss");
		for (const k of ["stl", "blk", "pf"]) {
			ok("C6/team " + k + " rises with the tempo (82 vs 58 is " + possRatio.toFixed(2) + "x the possessions)",
				ratio(k) > 1.0 + 0.5 * (possRatio - 1) && ratio(k) < possRatio * 1.25,
				k + " ratio " + ratio(k).toFixed(3));
		}
		const all68 = sweep[68];
		for (const k of ["stl", "pf"]) {
			const r = corr(all68.map((t) => t[k]), all68.map((t) => t.poss));
			ok("C6/" + k + " correlates with possessions at the default (was ~0)", r > 0.2, r.toFixed(3));
		}
		ok("C6/the league steal level is on the 6.3 anchor",
			Math.abs(m(68, "stl") / 6.3 - 1) < 0.05, m(68, "stl").toFixed(2));
		ok("C6/the league block level is on the 3.5 anchor (was 11% high)",
			Math.abs(m(68, "blk") / 3.5 - 1) < 0.06, m(68, "blk").toFixed(2));
		ok("C6/turnovers still scale with pace",
			corr(all68.map((t) => t.tov), all68.map((t) => t.poss)) > 0.6);
	}

	/* ------------------------------------------------------------------ C7 */
	{
		const at = {};
		for (const e of [-3, 0, 3]) {
			const rows = [];
			for (let s = 0; s < SEEDS; s++) {
				rows.push(...Object.values(run(s, { efficiencyEnv: e }).teams)
					.filter((t) => t.teamTotals).map((t) => t.teamTotals));
			}
			at[e] = {
				pts: mean(rows.map((t) => t.pts)),
				poss: mean(rows.map((t) => t.poss)),
				fga: mean(rows.map((t) => t.fga)),
				ts: mean(rows.map((t) => t.pts / (2 * (t.fga + 0.44 * t.fta)))),
			};
		}
		const f = (x) => x.toFixed(3);
		ok("C7/team points move with efficiencyEnv (they were fixed)",
			at[3].pts - at[-3].pts > 4, "+3 " + at[3].pts.toFixed(1) + ", -3 " + at[-3].pts.toFixed(1));
		ok("C7/possessions do not move with efficiencyEnv (pace is their only dial)",
			Math.abs(at[3].poss / at[-3].poss - 1) < 0.015, f(at[3].poss) + " vs " + f(at[-3].poss));
		ok("C7/attempts do not move with efficiencyEnv",
			Math.abs(at[3].fga / at[-3].fga - 1) < 0.02, f(at[3].fga) + " vs " + f(at[-3].fga));
		const up = at[3].ts - at[0].ts;
		const down = at[0].ts - at[-3].ts;
		ok("C7/true shooting moves by a real amount in both directions",
			up > 0.015 && down > 0.015, "up " + f(up) + ", down " + f(down));
		ok("C7/the response is symmetric (it was +1.2 / -2.0 points)",
			up / down > 0.7 && up / down < 1.45, "ratio " + (up / down).toFixed(2));
		ok("C7/the scoreboard carries the dial (efficiencyScale is symmetric about 1)",
			Math.abs(T.efficiencyScale({ efficiencyEnv: 3 }) - 1 + (T.efficiencyScale({ efficiencyEnv: -3 }) - 1)) < 1e-12 &&
			T.efficiencyScale({ efficiencyEnv: 0 }) === 1 && T.efficiencyScale({}) === 1);
	}

	/* -------------------------------------------------------------- C8 */
	{
		const adv = ["per", "ortg", "drtg", "usgp", "ows", "dws", "obpm", "vorp", "ewa"];
		for (const mode of ["simulate", "reconstruct"]) {
			let rows = 0;
			let zero = 0;
			let nonFinite = 0;
			const per = [];
			// The wrapper checks that adding the prior-season teams moved no
			// other row: the same field with and without them.
			let moved = 0;
			let extras = 0;
			const orig = BS.leagueAdvanced;
			BS.leagueAdvanced = function (teams, opts) {
				const out = orig.call(this, teams, opts);
				const field = teams.filter((t) => !t.extra);
				extras += teams.length - field.length;
				if (teams.length !== field.length) {
					const out2 = orig.call(this, field, opts);
					for (let i = 0; i < out2.length; i++) {
						for (const k of Object.keys(out2[i])) {
							if (out[i][k] !== out2[i][k]) moved++;
						}
					}
				}
				return out;
			};
			try {
				for (let s = 0; s < 3; s++) {
					const res = run(s, { priorSeasons: mode });
					const file = E.exportFile(res, { stats: true, prior: true });
					for (const p of file.players) {
						for (const st of p.stats || []) {
							if (!st.min || st.playoffs || st.season === res.season) continue;
							rows++;
							if (adv.every((k) => !st[k])) zero++;
							for (const k of BS.STATS.derived) if (!Number.isFinite(st[k])) nonFinite++;
							per.push(st.per);
						}
					}
				}
			} finally {
				BS.leagueAdvanced = orig;
			}
			ok("C8/" + mode + ": prior rows exist to check", rows > 50, String(rows));
			ok("C8/" + mode + ": no prior row has real minutes beside all-zero advanced statistics",
				zero === 0, zero + " of " + rows);
			ok("C8/" + mode + ": every derived statistic is finite", nonFinite === 0, String(nonFinite));
			ok("C8/" + mode + ": prior-season PER is a believable number (league mean 15)",
				mean(per) > 10 && mean(per) < 20, mean(per).toFixed(2));
			if (mode === "reconstruct") {
				ok("C8/reconstruct: the average-team rows are scored against the field without joining it",
					extras > 0 && moved === 0, extras + " extra teams, " + moved + " rows moved");
			}
		}
	}

	/* ------------------------------------------------------------- C15 */
	{
		const sizes = (extra, s) => {
			const res = E.run(lfFor(s), C.make(Object.assign({ seed: "c15-" + s, varySize: true }, extra)));
			let hgt = 0;
			let wgt = 0;
			for (const p of res.players) {
				if (p.newHgtInches !== p.hgtInches) hgt++;
				if (p.newWeight !== p.weight) wgt++;
			}
			return { hgt, wgt };
		};
		const locked = sizes({}, 1);
		const open = sizes({ lockHeights: false }, 1);
		ok("C15/varySize with the default lockHeights moves no height", locked.hgt === 0, String(locked.hgt));
		ok("C15/varySize with the default lockHeights still moves weight", locked.wgt > 20, String(locked.wgt));
		ok("C15/varySize with heights unlocked moves heights too", open.hgt > 10, String(open.hgt));
	}

	/* ---------------------------------------- identities, conservation */
	{
		const configs = [
			{}, { pace: 58 }, { pace: 82, scoringEnv: 3 }, { efficiencyEnv: 3 },
			{ efficiencyEnv: -3, scoringEnv: -3 }, { era: "2009-2021" }, { narrative: true, weirdness: 2 },
			{ priorSeasons: "reconstruct" },
		];
		let bad = 0;
		let nan = 0;
		let teams = 0;
		let first = "";
		const note = (msg) => { bad++; if (!first) first = msg; };
		const finite = (o, where) => {
			for (const [k, v] of Object.entries(o)) {
				if (typeof v === "number" && !Number.isFinite(v)) { nan++; if (!first) first = where + " " + k; }
			}
		};
		configs.forEach((cfg, ci) => {
			const res = run(ci % 3, cfg);
			for (const t of Object.values(res.teams)) {
				if (!t.lines || !t.box || !t.teamTotals) continue;
				teams++;
				const G = t.box.gp;
				const gm = t.box.gameMinutes || 40;
				const ot = t.log ? t.log.reduce((a, g) => a + (g.ot || 0), 0) : 0;
				const sum = (key) => t.lines.reduce((a, L) => a + L[key] * (L.gp / G), 0);
				// Minutes: five men for the whole game, overtime included.
				const minOff = Math.abs(sum("mpg") * G - 5 * (gm * G + 5 * ot)) / (5 * gm * G);
				if (minOff > 0.02) note("minutes " + ci + " " + minOff.toFixed(3));
				for (const [lk, bk] of [["ppg", "pts"], ["rpg", "trb"], ["apg", "ast"], ["spg", "stl"],
					["bpg", "blk"], ["topg", "tov"]]) {
					const want = t.teamTotals[bk];
					if (Math.abs(sum(lk) - want) > 0.02 * Math.max(1, want)) note(lk + " " + ci);
				}
				for (const L of t.lines) {
					finite(L, "line");
					if (L.fgp > 1.0001 || L.fga < -1e-9) note("fg% " + ci);
					const twoA = L.fga - L.tpa;
					if (twoA < -1e-6) note("tpa>fga " + ci);
					if (Math.abs(L.ppg - (L.fga * L.fgp * 2 + L.tpa * L.tpp + L.fta * L.ftp)) > 0.05 &&
						L.tpp !== null && L.ftp !== null) note("pts identity " + ci);
				}
				finite(t.box, "box");
				finite(t.teamTotals, "totals");
			}
			for (const p of res.players) {
				if (p.stats) finite(p.stats, "player");
			}
		});
		ok("calc/team minutes, points, rebounds, assists, steals, blocks, turnovers sum to the team box, on eight configs",
			bad === 0 && teams > 0, bad + " violations over " + teams + " teams; first: " + first);
		ok("calc/no non-finite value in any line, box or player stat line, on eight configs",
			nan === 0, nan + " non-finite; first: " + first);

		// fg <= fga, tp <= fg, ft <= fta, pts = 2fg + tp + ft on the exported rows.
		let ident = 0;
		let rowsN = 0;
		for (const cfg of [{}, { pace: 82, scoringEnv: 3 }, { efficiencyEnv: 3 }, { priorSeasons: "reconstruct" }]) {
			const res = run(4, cfg);
			const file = E.exportFile(res, { stats: true, prior: true });
			for (const p of file.players) {
				for (const st of p.stats || []) {
					rowsN++;
					if (st.fg > st.fga || st.tp > st.fg || st.tp > st.tpa || st.ft > st.fta ||
						st.pts !== 2 * st.fg + st.tp + st.ft) ident++;
				}
			}
		}
		ok("calc/exported stat rows keep fg<=fga, tp<=fg, tp<=tpa, ft<=fta, pts=2fg+tp+ft",
			ident === 0 && rowsN > 100, ident + " broken of " + rowsN);
	}
};
