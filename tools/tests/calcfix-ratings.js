/* Ratings-side calculation fixes from the 2026-10-05 audit (section 3).

   C1  the solver landed on the LEFT edge of the ovr rounding plateau, so the
       unrounded overall sat at target - 0.5 for four rebuilt prospects in
       five; touchUp always spent its point on the first keys and only moved
       up.
   C2  "Preserve each ovr" silently lowered high-ovr prospects, because the
       rookie skill/physical caps limited the reachable overall (a file ovr
       of 84-95 came back as 83) and nothing said so.
   C3  the same caps rewrote a strong prospect's ratings even at
       specialization 0 / noise 0 / diversity 0 (spd 95 came back 83).
   C14 output depended on the file's player order when overalls tie. */
"use strict";

module.exports = function (ok, V) {
	const E = global.Engine;
	const C = global.Config;
	const BB = global.BBGM;
	const RB = global.RatingsBuilder;
	const { Rng } = global.BBGMRng;
	const KEYS = BB.RATING_KEYS;

	const origFor = (hgt, rng, mean) => {
		const r = {};
		for (const k of KEYS) {
			r[k] = Math.max(1, Math.min(99, Math.round(rng.normal(mean || 40, 15))));
		}
		r.hgt = hgt;
		r.fuzz = 0;
		r.ovr = BB.ovr(r);
		r.pot = r.ovr + 5;
		r.pos = BB.pos(r);
		r.skills = [];
		return r;
	};

	/* ---- the unrounded overall the solver aims at ------------------------ */
	{
		const rng = new Rng("cf-exact");
		let bad = 0;
		for (let i = 0; i < 3000; i++) {
			const r = origFor(Math.round(rng.uniform(0, 100)), rng, rng.uniform(20, 80));
			const x = RB.ovrExact(r);
			if (Math.max(0, Math.min(100, Math.round(x))) !== BB.ovr(r)) bad++;
		}
		ok("calcfix/C1 ovrExact rounds to BB.ovr on 3,000 random vectors", bad === 0, bad + " differ");
	}

	/* ---- C1: the solve is centred, still exact ---------------------------- */
	{
		const rng = new Rng("cf-sweep");
		const archs = RB.ARCHETYPES.filter((a, i) => i % 11 === 0);
		let n = 0;
		let inRange = 0;
		let miss = 0;
		let nan = 0;
		let potBad = 0;
		let ovrField = 0;
		let sumOff = 0;
		let atEdge = 0;
		let overshoot = 0;
		for (const spec of [0, 1, 2.5]) {
			for (const noise of [0, 5, 14]) {
				const cfg = C.make({ specialization: spec, buildNoise: noise });
				for (const a of archs) {
					for (const h of [0, 30, 50, 80, 100]) {
						for (let t = 1; t <= 100; t += 4) {
							const orig = origFor(h, rng.child(a.name + h + t + spec + noise));
							const res = RB.rebuild(rng.child("r" + n), orig, t, t + 8, cfg,
								a.name, null, null, null, 5, null, null);
							n++;
							const o = BB.ovr(res.ratings);
							if (o !== res.ovr) ovrField++;
							if (!Number.isFinite(res.ovr) ||
								!KEYS.every((k) => Number.isFinite(res.ratings[k]) &&
									Number.isInteger(res.ratings[k]))) nan++;
							if (res.pot < res.ovr || res.pot > 100) potBad++;
							if (t >= res.ovrRange.min && t <= res.ovrRange.max) {
								inRange++;
								if (o !== t) miss++;
								/* Interior targets only: at 1 and 100 the plateau
								   is open-ended and a centred point is not defined. */
								if (t > 3 && t < 97) {
									const d = RB.ovrExact(res.ratings) - t;
									sumOff += d;
									if (d <= -0.45) atEdge++;
									if (Math.abs(d) > 0.5) overshoot++;
								}
							}
						}
					}
				}
			}
		}
		const interior = inRange; // close enough for a share; the ends are 2 of 25 targets
		ok("calcfix/C1 " + inRange + " reachable solves: 0 misses", miss === 0, miss + " missed");
		ok("calcfix/C1 no NaN, non-integer rating, ovr-field mismatch or pot < ovr",
			nan === 0 && ovrField === 0 && potBad === 0,
			nan + "/" + ovrField + "/" + potBad);
		ok("calcfix/C1 the mean unrounded overall is within 0.05 of the target (was -0.42)",
			Math.abs(sumOff / interior) < 0.05, (sumOff / interior).toFixed(3));
		ok("calcfix/C1 under 2% of solves sit on the left edge of the plateau (was 82%)",
			atEdge / interior < 0.02, (100 * atEdge / interior).toFixed(1) + "%");
		ok("calcfix/C1 the unrounded overall never leaves the rounding plateau",
			overshoot === 0, overshoot + " outside +-0.5");
	}

	/* ---- C1: a build that already hits the target is left alone ---------- */
	{
		const rng = new Rng("cf-same");
		let moved = 0;
		for (let i = 0; i < 300; i++) {
			const base = origFor(Math.round(rng.uniform(0, 100)), rng, rng.uniform(25, 60));
			const t = BB.ovr(base);
			const out = RB.solveToOvr(base, t, null, null, null, null);
			if (KEYS.some((k) => out[k] !== base[k])) moved++;
		}
		ok("calcfix/C1 solveToOvr to the overall a base already has returns the base",
			moved === 0, moved + " of 300 moved");
	}

	/* ---- C1: touchUp is not biased to the first keys, and goes both ways -- */
	{
		const rng = new Rng("cf-touch");
		const used = {};
		let n = 0;
		let fail = 0;
		let up = 0;
		let down = 0;
		for (let i = 0; i < 1500; i++) {
			const r = {};
			for (const k of KEYS) r[k] = Math.max(2, Math.min(98, Math.round(rng.normal(45, 16))));
			const o = BB.ovr(r);
			const dir = rng.random() < 0.5 ? 1 : -1;
			const t = o + dir;
			if (t < 1 || t > 99) continue;
			const out = RB.touchUp(Object.assign({}, r), t, null, null);
			const again = RB.touchUp(Object.assign({}, r), t, null, null);
			if (KEYS.some((k) => out[k] !== again[k])) fail++;
			if (BB.ovr(out) !== t) continue;
			n++;
			if (dir > 0) up++; else down++;
			for (const k of KEYS) if (out[k] !== r[k]) used[k] = (used[k] || 0) + 1;
		}
		const keysUsed = Object.keys(used).length;
		const top = Math.max.apply(null, Object.values(used));
		ok("calcfix/C1 touchUp is deterministic (same vector, same point)", fail === 0, fail + " differ");
		ok("calcfix/C1 touchUp moves ovr up and down", up > 100 && down > 100, up + " up, " + down + " down");
		ok("calcfix/C1 touchUp spreads over many ratings, no single key takes most of them",
			keysUsed >= 8 && top / n < 0.45,
			keysUsed + " keys, top share " + (100 * top / n).toFixed(0) + "% " + JSON.stringify(used));
		ok("calcfix/C1 touchUp keeps pinned ratings and the caps",
			(() => {
				const r = {};
				for (const k of KEYS) r[k] = 50;
				const pinned = { oiq: 50, diq: 50 };
				const t = BB.ovr(r) + 1;
				const out = RB.touchUp(Object.assign({}, r), t, pinned, { skill: 52, phys: 52 });
				return out.oiq === 50 && out.diq === 50 &&
					KEYS.every((k) => k === "hgt" || out[k] <= 52);
			})());
	}

	/* ---- fixtures for the engine-level checks ---------------------------- */
	// A class whose overalls run 25..95, built to the overall with no caps.
	const strongClass = (seed, n, lo, hi) => {
		const lf = V.realisticClass(seed, n);
		const rng = new Rng("cf-class-" + seed);
		for (const p of lf.players) {
			const r = p.ratings[0];
			const h = Math.max(0, Math.min(100, Math.round(rng.normal(50, 25))));
			const t = Math.round(lo + (hi - lo) * rng.random());
			const base = {};
			for (const k of KEYS) base[k] = Math.max(1, Math.min(99, Math.round(rng.normal(45, 18))));
			base.hgt = h;
			const sol = RB.solveToOvr(base, t, null, null, null, null);
			Object.assign(r, sol);
			r.hgt = h;
			r.fuzz = 0;
			r.ovr = BB.ovr(r);
			r.pot = Math.min(100, r.ovr + 8);
			r.pos = BB.pos(r);
			p.hgt = 66 + Math.round(h / 100 * 27);
		}
		return lf;
	};
	const run = (lf, extra) => E.run(JSON.parse(JSON.stringify(lf)),
		C.make(Object.assign({ seed: "calcfix", narrative: false }, extra || {})));

	/* ---- C2: preserve keeps the file's overall, whatever the caps -------- */
	{
		let n = 0;
		let miss = 0;
		let warned = 0;
		let high = 0;
		for (let s = 0; s < 3; s++) {
			const res = run(strongClass(s, 60, 25, 95), {});
			warned += res.warnings.filter((w) => /different overall/.test(w)).length;
			for (const p of res.players) {
				n++;
				if (p.origOvr >= 80) high++;
				if (p.newOvr !== p.origOvr) miss++;
				if (BB.ovr(p.newRatings) !== p.newOvr) miss++;
			}
		}
		ok("calcfix/C2 default preserve: every prospect (" + high + " of them 80+) keeps his file ovr",
			miss === 0 && high > 20, miss + " of " + n + " changed, " + high + " at 80+");
		ok("calcfix/C2 ...and nothing is warned about when nothing was missed", warned === 0, warned + "");

		/* Curve mode keeps the caps: a curve is the tool's own and the caps are
		   how a class does not open with superstars. */
		const lf = strongClass(7, 60, 70, 95);
		const curve = run(lf, { ovrMode: "curve" });
		const best = Math.max.apply(null, curve.players.map((p) => p.newOvr));
		ok("calcfix/C2 curve mode still caps the class (best ovr stays rookie-sized)",
			best < 70, "best " + best);
		const capped = curve.players.every((p) => KEYS.every((k) => k === "hgt" ||
			p.newRatings[k] <= (["stre", "spd", "jmp", "endu"].indexOf(k) >= 0 ? 80 : 70) + 8));
		ok("calcfix/C2 curve mode ratings still sit under the soft caps", capped);
	}

	/* ---- C2: whatever cannot be reached is warned about ------------------ */
	{
		const lf = V.syntheticClass(91, 40);
		let tallest = lf.players[0];
		for (const p of lf.players) if (p.ratings[0].hgt > tallest.ratings[0].hgt) tallest = p;
		// Ask for something below the floor his height sets.
		const probe = run(lf, {}).players.filter((x) => x.pid === tallest.pid)[0];
		const ask = Math.max(0, probe.ovrRange.min - 2);
		const res = run(lf, { overrides: { [String(tallest.pid)]: { ovr: ask, pot: 40 } } });
		const p = res.players.filter((x) => x.pid === tallest.pid)[0];
		ok("calcfix/C2 an overall the height cannot reach adds a res.warnings entry",
			probe.ovrRange.min >= 1 && p.newOvr !== ask &&
			res.warnings.some((w) => /different overall/.test(w) &&
				w.indexOf(p.name + " " + ask + " to " + p.newOvr) !== -1),
			"asked " + ask + " got " + p.newOvr + " " + JSON.stringify(res.warnings));
	}

	/* ---- C2: a hand-locked high ovr is reached in preserve mode ---------- */
	{
		const lf = V.realisticClass(11, 20);
		const pid = lf.players[0].pid;
		const res = run(lf, { overrides: { [String(pid)]: { ovr: 88 } } });
		const p = res.players.filter((x) => x.pid === pid)[0];
		ok("calcfix/C2 a locked ovr of 88 is reached in preserve mode, caps lifted as far as it takes",
			p.newOvr === 88 || (p.lockUnreachable && p.ovrRange.max < 88),
			"got " + p.newOvr + " range " + JSON.stringify(p.ovrRange));
		ok("calcfix/C2 the lifted caps travel with the player for a later re-solve",
			!p.buildCaps || p.buildCaps.preserve === true, JSON.stringify(p.buildCaps));
	}

	/* ---- C3: nothing is rewritten that already satisfies the target ------ */
	{
		const o = { specialization: 0, buildNoise: 0, archetypeDiversity: 0 };
		let n = 0;
		let changed = 0;
		let l1 = 0;
		for (let s = 0; s < 3; s++) {
			const res = run(strongClass(100 + s, 60, 40, 90), o);
			for (const p of res.players) {
				n++;
				let d = 0;
				for (const k of KEYS) d += Math.abs(p.newRatings[k] - p.origRatings[k]);
				if (d > 0) changed++;
				l1 += d;
			}
		}
		ok("calcfix/C3 spec 0 / noise 0 / diversity 0 at the default caps returns the file's ratings unchanged",
			changed === 0, changed + " of " + n + " changed, mean L1 " + (l1 / n).toFixed(2) +
				" (was 94.8% changed, L1 78.7)");

		// The audit's own player: spd 95, jmp 92, dnk 85, tp 85 at ovr 72.
		const lf = V.realisticClass(0, 12);
		const p0 = lf.players[0];
		const r = p0.ratings[0];
		Object.assign(r, { hgt: 40, stre: 70, spd: 95, jmp: 92, endu: 80, ins: 40, dnk: 85,
			ft: 70, fg: 70, tp: 85, oiq: 50, diq: 45, drb: 75, pss: 55, reb: 35, fuzz: 0 });
		r.ovr = BB.ovr(r);
		r.pot = r.ovr + 10;
		r.pos = BB.pos(r);
		const res = run(lf, o);
		const q = res.players.filter((x) => x.pid === p0.pid)[0];
		ok("calcfix/C3 the audit's spd 95 / jmp 92 / dnk 85 / tp 85 prospect keeps all four",
			q.newRatings.spd === 95 && q.newRatings.jmp === 92 &&
			q.newRatings.dnk === 85 && q.newRatings.tp === 85 && q.newOvr === q.origOvr,
			JSON.stringify(q.newRatings));
	}

	/* ---- C3: the lift is not a loophole in specialization ---------------- */
	{
		// At the defaults (specialization 1) a strong prospect still comes out
		// a rebuilt player: ovr kept, ratings re-shaped.
		const res = run(strongClass(200, 40, 50, 80), {});
		const moved = res.players.filter((p) =>
			KEYS.some((k) => p.newRatings[k] !== p.origRatings[k])).length;
		ok("calcfix/C3 at the default specialization the build is still re-shaped",
			moved > res.players.length * 0.8, moved + " of " + res.players.length);
	}

	/* ---- C14: file order does not change anybody's result ---------------- */
	{
		let tot = 0;
		let diff = 0;
		let tiedPairs = 0;
		for (let s = 0; s < 3; s++) {
			const lf = V.realisticClass(s, 70);
			const shuffled = JSON.parse(JSON.stringify(lf));
			shuffled.players = new Rng("cf-shuf" + s).shuffle(shuffled.players);
			const a = run(lf, { seed: "cf-order" + s });
			const b = run(shuffled, { seed: "cf-order" + s });
			const sig = (p) => JSON.stringify([p.archetype, p.newRatings, p.newOvr, p.newPot,
				p.newCollege, p.classYear, p.surprise || null, p.transfer || null]);
			const mb = {};
			for (const p of b.players) mb[p.pid] = sig(p);
			for (const p of a.players) {
				tot++;
				if (sig(p) !== mb[p.pid]) diff++;
			}
			const ov = a.players.map((p) => p.origOvr).sort((x, y) => x - y);
			for (let i = 1; i < ov.length; i++) if (ov[i] === ov[i - 1]) tiedPairs++;
		}
		ok("calcfix/C14 shuffling the file's players changes nobody's build, ratings, pot, school or year",
			diff === 0 && tiedPairs > 30,
			diff + " of " + tot + " changed (" + tiedPairs + " tied adjacent overalls)");
	}
};
