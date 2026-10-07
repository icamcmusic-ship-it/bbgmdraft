/* Universe model realism, 2026-10-05 audit section 5: program strength (UV11)
   and conference realignment (UV12).

   UV11: a carried program persists. Year-over-year level change used to be
   p90 +10.8 / p99 +20.2 with 50 teams in 14 seasons jumping 20 or more
   ("Mercer 14.0 -> 43.5"); it is now bounded by carriedLevel in js/teams.js.
   UV12: realignment is geographic (a school joins a league whose members are
   in its own region or the next), a school moves at most once a pass and not
   again for REALIGN_COOLDOWN seasons, and the big leagues' sizes wander
   instead of all ending at eighteen.

   Both changes are scoped to universe seasons (cfg.carryOver is null or an
   object); a standalone class run must not move, which is checked here
   against tools/golden.json and against digests recorded from HEAD before
   the change.

   One 14-season synthetic chain is built once and shared. */
"use strict";

module.exports = function (ok, V) {
	const fs = require("fs");
	const path = require("path");
	const crypto = require("crypto");
	const E = global.Engine;
	const CFG = global.Config;
	const U = global.Universe;
	const T = global.TeamsSim;
	const C = global.Colleges;
	const { Rng } = global.BBGMRng;

	const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
	const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) * (x - m)))); };
	const q = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

	/* A chain, recording each season's program levels (the program's own,
	   coach adjustment removed), conferences and realignment moves. */
	const chainOf = (n, seed) => {
		const files = U.synthFiles(seed, 2030, n);
		const runners = files.map((f) => E.createRunner(f.data));
		const levels = [];
		const conf = [];
		const moves = [];
		const c = U.beginChain({
			mode: "cold", files,
			runnable: files.map((f, i) => ({ index: i, name: f.name, season: f.data.startingSeason })),
			settings: CFG.make({ seed }), baseSeed: seed,
			make: (s) => CFG.make(s), runnerFor: (i) => runners[i],
			dataChanged: (i) => { runners[i] = E.createRunner(files[i].data); },
			extrapolateGaps: false,
			store: (i, r) => {
				const lv = {};
				const cf = {};
				for (const t of Object.values(r.teams)) {
					lv[t.name] = t.level - ((t.coach && t.coach.levelAdj) || 0);
					cf[t.name] = t.conf;
				}
				levels[i] = lv; conf[i] = cf; moves[i] = r.realignment || [];
			},
		});
		for (let k = 0; k < c.runnable.length; k++) c.step(k);
		c.finish({});
		return { u: c.universe, levels, conf, moves };
	};

	/* ---- UV11: program strength persists ---------------------------------- */
	const chain = chainOf(14, "uvr-programs");
	{
		const names = Object.keys(chain.levels[0]);
		const change = [];
		const absChange = [];
		let teleports = 0;
		for (let i = 1; i < chain.levels.length; i++) {
			for (const n of names) {
				const d = chain.levels[i][n] - chain.levels[i - 1][n];
				change.push(d); absChange.push(Math.abs(d));
				if (Math.abs(d) >= 20) teleports++;
			}
		}
		const p90 = q(absChange, 0.9);
		const p99 = q(absChange, 0.99);
		ok("uv11/year-over-year level change: |p90| at most 6.5 points (was 13.6)",
			p90 <= 6.5, "p90 " + p90.toFixed(2));
		ok("uv11/year-over-year level change: |p99| at most 12 points (was 21.8)",
			p99 <= 12, "p99 " + p99.toFixed(2));
		ok("uv11/signed p90 and p99 are in the same band (were +10.8 and +20.2)",
			q(change, 0.9) <= 6.5 && q(change, 0.99) <= 12 && q(change, 0.01) >= -12,
			q(change, 0.9).toFixed(2) + " " + q(change, 0.99).toFixed(2) + " " + q(change, 0.01).toFixed(2));
		ok("uv11/no program teleports 20 points in a year across 14 seasons",
			teleports === 0, teleports + " jumps of 20 or more");
		ok("uv11/programs still move: the median change is not frozen",
			q(absChange, 0.5) >= 1.5, "median " + q(absChange, 0.5).toFixed(2));

		// The league's level distribution stays sane.
		const all = [];
		const tiers = { top: [], mid: [], low: [] };
		for (let i = 0; i < chain.levels.length; i++) {
			for (const n of names) {
				const v = chain.levels[i][n];
				all.push(v);
				const p = C.prestigeOrLowMajor(n);
				tiers[p >= 70 ? "top" : p >= 35 ? "mid" : "low"].push(v);
			}
		}
		ok("uv11/league mean level stays near the middle", mean(all) > 42 && mean(all) < 54,
			mean(all).toFixed(1));
		ok("uv11/league spread stays wide (sd 12-19; was 16.8)", sd(all) > 12 && sd(all) < 19,
			sd(all).toFixed(1));
		ok("uv11/blue bloods stay above mid-majors above the cellar",
			mean(tiers.top) - mean(tiers.mid) > 8 && mean(tiers.mid) - mean(tiers.low) > 8,
			[mean(tiers.top), mean(tiers.mid), mean(tiers.low)].map((x) => x.toFixed(1)).join(" / "));
		const corr = [];
		for (let i = 1; i < chain.levels.length; i++) {
			const a = names.map((n) => chain.levels[i - 1][n]);
			const b = names.map((n) => chain.levels[i][n]);
			const ma = mean(a); const mb = mean(b);
			let c = 0; let va = 0; let vb = 0;
			for (let j = 0; j < a.length; j++) {
				c += (a[j] - ma) * (b[j] - mb); va += (a[j] - ma) ** 2; vb += (b[j] - mb) ** 2;
			}
			corr.push(c / Math.sqrt(va * vb));
		}
		ok("uv11/lag-1 level autocorrelation is high but not frozen (0.90-0.99; was 0.88)",
			mean(corr) > 0.9 && mean(corr) < 0.99, mean(corr).toFixed(3));
	}

	/* carriedLevel and the prestige gain that rides on it. */
	{
		ok("uv11/a carried program that draws its own level stays put",
			Math.abs(T.carriedLevel(60, 60) - 60) < 1e-9);
		ok("uv11/a +25 fresh draw moves a carried program under 10 points",
			T.carriedLevel(85, 60) - 60 > 0 && T.carriedLevel(85, 60) - 60 < 10);
		ok("uv11/a -25 fresh draw moves a carried program under 10 points",
			60 - T.carriedLevel(35, 60) > 0 && 60 - T.carriedLevel(35, 60) < 10);
		ok("uv11/the step is monotone in the fresh draw",
			T.carriedLevel(40, 60) < T.carriedLevel(55, 60) &&
			T.carriedLevel(55, 60) < T.carriedLevel(70, 60) &&
			T.carriedLevel(70, 60) < T.carriedLevel(90, 60));
		ok("uv11/the fresh weight is below one half for a carried program",
			T.CARRY_FRESH_WEIGHT > 0 && T.CARRY_FRESH_WEIGHT < 0.5);
		ok("uv11/the result stays inside the 12-95 level range",
			T.carriedLevel(99, 94) <= 95 && T.carriedLevel(0, 13) >= 12);
	}

	/* The story text: no claim of a cause the data does not show. */
	{
		const src = fs.readFileSync(path.join(__dirname, "..", "..", "js", "news.js"), "utf8");
		ok("uv11/'program on the rise' no longer says it is not one recruiting class",
			src.indexOf("it is not one recruiting class doing it") === -1);
		ok("uv11/'program on the rise' reads the program's own level, not the coached one",
			/programGain\(t, carry\) >= 5/.test(src) && /t\.level - adj/.test(src));
	}

	/* ---- UV12: realignment ------------------------------------------------ */
	/* Passes straight through TeamsSim.realign, carrying the map and the
	   cooldown the way a universe does (harvest: confOf, moved[school] =
	   season). 40 passes cost milliseconds, so the geography checks run on
	   several seeds and two rates. */
	const passes = (n, seed, rate, first) => {
		let carry = { confOf: null, moved: {} };
		const out = [];
		for (let i = 0; i < n; i++) {
			const season = (first || 2030) + i;
			const cfg = { carryOver: i === 0 ? null : carry, realignmentRate: rate,
				realignmentMemory: 100, __season: season };
			const before = i === 0 ? null : carry.confOf;
			const map = T.realign(new Rng("uvr-real|" + seed + "|" + i), cfg);
			const moved = Object.assign({}, carry.moved);
			for (const m of map.moves) moved[m.school] = season;
			out.push({ season, before, map });
			carry = { confOf: Object.assign({}, map.confOf), moved };
		}
		return out;
	};
	const sizesOf = (confOf) => {
		const s = {};
		for (const n of C.names) s[confOf[n]] = (s[confOf[n]] || 0) + 1;
		return s;
	};
	const BIG = ["ACC", "SEC", "Big Ten", "Big 12", "Big East", "Pac-12"];
	const seeds = ["a", "b", "c", "d"];
	const runs = {};
	for (const rate of [0.35, 1]) {
		runs[rate] = seeds.map((s) => passes(40, s + rate, rate));
	}

	{
		ok("uv12/every school has a region and the table names no stranger",
			C.names.every((n) => T.SCHOOL_REGION[n]) &&
			Object.keys(T.SCHOOL_REGION).every((n) => C.isKnown(n)));
		ok("uv12/region hops are symmetric, zero on the diagonal and at most five",
			Object.keys(T.REGION_ADJ).every((a) => Object.keys(T.REGION_ADJ).every((b) =>
				T.regionHops(a, b) === T.regionHops(b, a) && (a !== b || T.regionHops(a, b) === 0) &&
				T.regionHops(a, b) <= 5)));
		ok("uv12/Detroit Mercy is far from the Pacific coast and Gonzaga is not",
			T.regionHops(T.regionOfSchool("Detroit Mercy"), "W") >= 3 &&
			T.regionHops(T.regionOfSchool("Gonzaga"), "W") === 0);

		let moves = 0;
		let doubleHop = 0;
		let cooldownBreach = 0;
		let unreachable = 0;
		let far = 0;
		let sizeBad = 0;
		let bigBad = 0;
		let rowShape = 0;
		for (const rate of Object.keys(runs)) {
			for (const run of runs[rate]) {
				const last = {};
				run.forEach((p, i) => {
					const seen = new Set();
					p.map.moves.forEach((m, mi) => {
						moves++;
						if (seen.has(m.school)) doubleHop++;
						seen.add(m.school);
						if (m.school in last && p.season - last[m.school] < T.REALIGN_COOLDOWN) cooldownBreach++;
						const keys = Object.keys(m).sort().join(",");
						if (keys !== "from,school,to" && keys !== "down,from,school,to") rowShape++;
						/* The league as the pass found it: last season's members
						   (the base table in the first season), less any who had
						   already left earlier in this pass. */
						const gone = new Set(p.map.moves.slice(0, mi).map((x) => x.school));
						const found = C.names.filter((n) => n !== m.school && !gone.has(n) &&
							(i === 0 ? (C.conferenceOf(n) || "Independent") : p.before[n]) === m.to);
						const mine = T.regionOfSchool(m.school);
						const near = found.filter((n) => T.regionHops(mine, T.regionOfSchool(n)) <= 1).length;
						if (!found.length || near / found.length < 0.3) unreachable++;
						const cnt = {};
						for (const n of found) { const r = T.regionOfSchool(n); cnt[r] = (cnt[r] || 0) + 1; }
						const modal = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a] || (a < b ? -1 : 1))[0];
						if (modal && T.regionHops(mine, modal) >= 3) far++;
					});
					for (const m of p.map.moves) last[m.school] = p.season;
					const sizes = sizesOf(p.map.confOf);
					for (const c of Object.keys(sizes)) if (sizes[c] < 7 || sizes[c] > 18) sizeBad++;
					for (const c of BIG) if (!(sizes[c] >= 8 && sizes[c] <= 18)) bigBad++;
				});
			}
		}
		ok("uv12/realignment moves schools (the checks below are not vacuous)", moves >= 60, String(moves));
		ok("uv12/no school moves twice in one pass (was: Bowling Green, Tulsa)",
			doubleHop === 0, doubleHop + " double hops");
		ok("uv12/no school moves again inside the " + T.REALIGN_COOLDOWN + "-season cooldown",
			cooldownBreach === 0, cooldownBreach + " breaches");
		ok("uv12/every move lands in a league at least 30% of whose members are within one region hop",
			unreachable === 0, unreachable + " of " + moves);
		ok("uv12/under 1% of moves land 3+ region hops from the league's modal region (was 14 of 59 = 24% on a 20-season chain)",
			far <= Math.ceil(0.01 * moves), far + " of " + moves);
		ok("uv12/every league stays within 7-18 members and the big six within 8-18",
			sizeBad === 0 && bigBad === 0, sizeBad + " / " + bigBad);
		ok("uv12/the stored move row keeps its shape: school, from, to (and down for a release)",
			rowShape === 0, rowShape + " odd rows");
	}

	{
		// Big-league sizes wander instead of all ending at eighteen.
		const four = ["ACC", "SEC", "Big Ten", "Big 12"];
		let allEighteen = 0;
		let wandered = 0;
		for (const run of runs[0.35].concat(runs[1])) {
			const fin = sizesOf(run[run.length - 1].map.confOf);
			if (four.every((c) => fin[c] === 18)) allEighteen++;
			const seen = new Set();
			for (const p of run) { const s = sizesOf(p.map.confOf); for (const c of four) seen.add(c + s[c]); }
			// each of the four spends time at more than one size
			if (four.every((c) => Array.from(seen).filter((x) => x.indexOf(c) === 0).length >= 2)) wandered++;
		}
		ok("uv12/the four big leagues do not all end a 40-season run at 18",
			allEighteen === 0, allEighteen + " of 8 runs");
		ok("uv12/sizes keep moving: in most runs every one of the four leagues is at 2+ sizes",
			wandered >= 4, wandered + " of 8 runs");
		let climbed = 0;
		let contracted = 0;
		for (const run of runs[0.35]) {
			const sN = sizesOf(run[run.length - 1].map.confOf)["Pac-12"];
			if (sN > 9) climbed++;
			if (four.some((c) => sizesOf(run[run.length - 1].map.confOf)[c] < 18)) contracted++;
		}
		ok("uv12/the Pac-12 (9 in the data) rebuilds toward ten", climbed >= 3, climbed + " of 4");
		ok("uv12/a big league contracted by the end of most 40-season runs", contracted >= 3,
			contracted + " of 4");
		// Backfill: a league that lost a member to a raid takes one in from below in the same pass.
		let backfilled = 0;
		for (const run of runs[1]) {
			for (const p of run) {
				p.map.moves.forEach((m, mi) => {
					if (!m.down && p.map.moves.slice(0, mi).some((x) => !x.down && x.from === m.to)) backfilled++;
				});
			}
		}
		ok("uv12/a league that lost members to a raid takes some back from below in the same pass",
			backfilled >= 1, String(backfilled));
	}

	{
		// Determinism, and off means off.
		const again = passes(40, "a0.35", 0.35);
		ok("uv12/the same seed gives the same 40 maps",
			JSON.stringify(again.map((p) => p.map.moves)) === JSON.stringify(runs[0.35][0].map((p) => p.map.moves)));
		const off = passes(10, "off", 0);
		ok("uv12/a realignment rate of 0 moves nobody", off.every((p) => !p.map.moves.length));
		ok("uv12/a first universe season (carryOver null) takes the geographic path",
			runs[1].every((run) => run[0].map.moves.every((m) =>
				T.regionHops(T.regionOfSchool(m.school), "W") >= 0)));
	}

	/* The chain itself: moves, the cooldown, and the carry. */
	{
		const last = {};
		let doubleHop = 0;
		let breaches = 0;
		let moves = 0;
		chain.u.rows.forEach((r) => {
			const seen = new Set();
			for (const s of r.realignment || []) {
				const name = String(s).split(" → ")[0];
				moves++;
				if (seen.has(name)) doubleHop++;
				seen.add(name);
				if (name in last && r.season - last[name] < T.REALIGN_COOLDOWN) breaches++;
			}
			for (const name of seen) last[name] = r.season;
		});
		ok("uv12/a 14-season chain realigns", moves >= 5, String(moves));
		ok("uv12/in a 14-season chain no school moves twice in a pass or within the cooldown",
			doubleHop === 0 && breaches === 0, doubleHop + " / " + breaches);
		let carried = 0;
		let want = 0;
		chain.moves.forEach((mv, i) => {
			const nextCfg = chain.u.cfgs[i + 1];
			if (!nextCfg || !mv.length) return;
			for (const m of mv) {
				want++;
				if (nextCfg.carryOver && nextCfg.carryOver.moved &&
					nextCfg.carryOver.moved[m.school] === 2030 + i) carried++;
			}
		});
		ok("uv12/the carry hands the next season each mover's season (the cooldown's memory)",
			want > 0 && carried === want, carried + " of " + want);
		const sizes = chain.conf.map((cf) => {
			const s = {};
			for (const n of Object.keys(cf)) s[cf[n]] = (s[cf[n]] || 0) + 1;
			return s;
		});
		ok("uv12/conference sizes in the chain stay within 7-18",
			sizes.every((s) => Object.keys(s).every((c) => s[c] >= 7 && s[c] <= 18)));
	}

	/* ---- determinism of the whole chain ----------------------------------- */
	{
		const again = chainOf(4, "uvr-det");
		const other = chainOf(4, "uvr-det");
		ok("determinism/the same 4-season chain gives identical levels, maps and moves",
			JSON.stringify([again.levels, again.conf, again.moves]) ===
			JSON.stringify([other.levels, other.conf, other.moves]));
	}

	/* ---- a standalone class must not move --------------------------------- */
	{
		const hash = (o) => crypto.createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 16);
		const GOLDEN_CASES = [
			{ name: "defaults", cfg: {} },
			{ name: "curve-loaded", cfg: { ovrMode: "curve", classQuality: 2, eliteCount: 4 } },
			{ name: "specialists", cfg: { specialization: 1.8, archetypeDiversity: 95, varySize: true } },
		];
		const golden = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "golden.json"), "utf8"));
		for (const c of GOLDEN_CASES) {
			const res = E.run(V.syntheticClass(7, 40), CFG.make(Object.assign({ seed: "golden" }, c.cfg)));
			ok("standalone/golden export hash '" + c.name + "' is unchanged",
				hash(E.exportFile(res)) === golden[c.name]);
		}
		/* The golden hashes cover the exported players, not the program table
		   or the realignment, so the team table and the moves are pinned too:
		   these two digests were recorded from HEAD before the UV11/UV12
		   change (a standalone class, default settings and realignmentRate 1,
		   which moves programs on the legacy path). */
		const digest = (over) => {
			const res = E.run(V.syntheticClass(7, 40), CFG.make(Object.assign({ seed: "golden" }, over)));
			const rows = Object.values(res.teams).map((t) => [t.name, t.conf, t.level, t.w, t.l, t.cw, t.cl]);
			return hash([rows, res.realignment,
				res.tourney && res.tourney.champion && res.tourney.champion.team.name]);
		};
		ok("standalone/team table and records are byte-identical to HEAD (defaults)",
			digest({}) === "9bedab539cc5037c");
		const raided = E.run(V.syntheticClass(7, 40), CFG.make({ seed: "golden", realignmentRate: 1 }));
		ok("standalone/realignment on the legacy path is byte-identical to HEAD (rate 1)",
			digest({ realignmentRate: 1 }) === "3feb04f5094734ff" && raided.realignment.length === 2);
	}
};
