/* Regressions for the build/trait layer — one per fault found in the audit of
   js/ratings.js, js/traits.js and the build phase of js/engine.js. Each of
   these was measured wrong before the fix; the numbers in the comments are the
   before/after. */
module.exports = function (ok, V) {
	const RB = global.RatingsBuilder;
	const TR = global.Traits;
	const E = global.Engine;
	const C = global.Config;
	const BB = global.BBGM;
	const { Rng } = global.BBGMRng;

	/* 1. A size anomaly re-solved the ratings and kept the build, and every
	   build is gated on a height band: five of six outliers over 30 classes
	   came out outside their own build's gate (a Shot-Blocking Anchor, min
	   76, at 5'8"). */
	{
		let outliers = 0, offBand = 0, worst = "";
		for (let s = 0; s < 24; s++) {
			const res = E.run(V.realisticClass(500 + s, 70), C.make({ seed: "o" + s }));
			for (const p of res.players) {
				if (!p.sizeOutlier) continue;
				outliers++;
				const a = RB.ARCHETYPES.filter((x) => x.name === p.archetype)[0];
				if (!a || p.newRatings.hgt < a.min || p.newRatings.hgt > a.max) {
					offBand++;
					worst = p.archetype + " at hgt " + p.newRatings.hgt;
				}
			}
		}
		ok("a physical outlier ends on a build his new height allows",
			outliers >= 4 && offBand === 0,
			outliers + " outliers, " + offBand + " outside the band " + worst);
	}

	/* 2. A source row with no ovr/pot made the ovr->pot gap NaN, which
	   exported ratings.pot, draft.pot and newPot as NaN for every player. */
	{
		const lf = V.realisticClass(11, 40);
		for (const p of lf.players) {
			const r = p.ratings[p.ratings.length - 1];
			delete r.ovr; delete r.pot;
		}
		const v = E.validateLeagueFile(lf);
		const res = E.run(lf, C.make({ seed: "np" }));
		const nan = res.players.filter((p) => !Number.isFinite(p.newPot) ||
			!Number.isFinite(p.newOvr)).length;
		ok("a file with no ovr/pot still builds finite players", nan === 0,
			nan + " players came out NaN");
		ok("a file with no ovr/pot is warned about",
			(v.warnings || []).some((w) => /ovr or pot/.test(w)),
			JSON.stringify(v.warnings || []));
	}

	/* 3. The pool's rare slot filtered on the AUTHORED weight, so a build the
	   user had zeroed made the pool in 23 of 40 classes. */
	{
		const off = { "Point Center": 0, "Jumbo Playmaker": 0, "Iron Man": 0 };
		let hit = 0;
		for (let i = 0; i < 40; i++) {
			const cfg = C.make({ seed: "w" + i, archetypeWeights: off });
			const flavor = RB.pickFlavor(new Rng("f" + i), cfg);
			const pool = RB.pickClassPool(new Rng("p" + i), cfg, flavor).map((a) => a.name);
			if (Object.keys(off).some((n) => pool.indexOf(n) !== -1)) hit++;
		}
		ok("a build the user zeroed never reaches the pool", hit === 0,
			hit + "/40 classes carried one");
	}

	/* 4. The normalizer subtracted uniformly and reversed small authored
	   boosts: Matchup-Zone Defender stre +4 -> -2.25, Wing Stopper stre +6 ->
	   0, Point-of-Attack Menace stre +6 -> -0.25 — while the editor's tooltip
	   showed the authored intent. */
	{
		let flips = 0, example = "";
		for (const a of RB.ARCHETYPES) {
			const raw = RB.RAW_OFFSETS[a.name] || {};
			for (const k of Object.keys(raw)) {
				const now = a.o[k] || 0;
				if ((raw[k] > 0 && now < 0) || (raw[k] < 0 && now > 0)) {
					flips++;
					example = a.name + " " + k + " " + raw[k] + " -> " + now;
				}
			}
		}
		ok("the normalizer never reverses an authored sign", flips === 0,
			flips + " flips, e.g. " + example);
		let worst = 0;
		for (const a of RB.ARCHETYPES) {
			let push = 0;
			for (const k of Object.keys(a.o)) push += RB.OVR_W[k] * a.o[k];
			worst = Math.max(worst, Math.abs(push));
		}
		ok("and the vectors are still ovr-neutral", worst < 0.35,
			"largest residual push " + worst.toFixed(3));
	}

	/* 5. Traits had no gate on the build's own offsets: "genuinely strong" was
	   drawable on 19 builds authoring stre -8 or worse, "explosive first step"
	   on 38 with spd -8 or worse, "chronic knee" on Iron Man (inj 0.45). */
	{
		const gates = [
			["genuinely strong", "stre", -8],
			["explosive first step", "spd", -8],
			["lateral quickness", "spd", -8],
			["two-foot leaper", "jmp", -10],
			["quick off one foot", "jmp", -10],
			["slow, high release", "tp", -12],
			["two-motion jumper", "tp", -12],
			["chases his own miss", "reb", -10],
		];
		let bad = 0, example = "";
		for (const a of RB.ARCHETYPES) {
			const raw = RB.RAW_OFFSETS[a.name] || {};
			const p = { archetype: a.name, newRatings: { hgt: Math.max(a.min, 40) },
				newOvr: 50, classYear: "Junior" };
			for (const [name, key, limit] of gates) {
				const t = TR.TRAITS.filter((x) => x.name === name)[0];
				if (!t) continue;
				if ((raw[key] || 0) <= limit && TR.matches(t, p)) {
					bad++; example = name + " on " + a.name;
				}
			}
			const inj = Number.isFinite(a.inj) ? a.inj : 1;
			const knee = TR.TRAITS.filter((x) => x.name === "chronic knee")[0];
			if (inj < 0.7 && knee && TR.matches(knee, p)) {
				bad++; example = "chronic knee on " + a.name;
			}
		}
		ok("no trait contradicts the build it is drawn onto", bad === 0,
			bad + " build/trait pairs, e.g. " + example);
	}

	/* 6. The rare slot, the three forced centers and the band probes were
	   added ON TOP of the pool size, so "19 builds" realized 20-23 and a
	   flavor asking for 8 got 10-12. */
	{
		const sizes = [];
		for (const want of [8, 19, 30]) {
			for (let i = 0; i < 8; i++) {
				const cfg = C.make({ seed: "z" + i, archetypePool: want });
				const flavor = RB.pickFlavor(new Rng("f" + i), cfg);
				sizes.push(RB.pickClassPool(new Rng("p" + i), cfg, flavor).length - want);
			}
		}
		const worst = Math.max(...sizes.map(Math.abs));
		ok("the pool is the size the setting asks for", worst <= 1,
			"worst overshoot " + worst);
	}

	/* 7. One build could own a class: Athletic Freak 50 appearances and Raw
	   Project 43 over 2,100 players, and 12 classes in 30 had the same build
	   twice inside the top five. */
	{
		let dup = 0, biggest = 0, who = "";
		for (let s = 0; s < 20; s++) {
			const res = E.run(V.realisticClass(100 + s, 70), C.make({ seed: "bal" + s }));
			const ranked = res.players.slice().sort((a, b) => b.newOvr - a.newOvr);
			const top = ranked.slice(0, 5).map((p) => p.archetype);
			if (new Set(top).size < top.length) dup++;
			const cnt = {};
			for (const p of res.players) {
				if (p.archetype === "Balanced") continue;
				cnt[p.archetype] = (cnt[p.archetype] || 0) + 1;
				if (cnt[p.archetype] > biggest) { biggest = cnt[p.archetype]; who = p.archetype; }
			}
		}
		ok("no single build owns a class", biggest <= 10,
			"most of one build in a 70-man class: " + biggest + " (" + who + ")");
		ok("the top five rarely repeat a build", dup <= 6,
			dup + "/20 classes had a duplicate in the top five");
	}

	/* 8. Sharpshooter ran to hgt 62 and Slasher to 64 — 6'8" and 6'9" — and
	   were tagged `guard` only, so no wing-leaning flavor could reach them. */
	{
		let bad = 0, example = "";
		for (const a of RB.ARCHETYPES) {
			const t = a.t || [];
			if (t.indexOf("guard") !== -1 && t.indexOf("wing") === -1 &&
				t.indexOf("big") === -1 && a.max > 60) {
				bad++; example = a.name + " max " + a.max;
			}
		}
		ok("a build's tags agree with its height gate", bad === 0,
			bad + " disagree, e.g. " + example);
	}

	/* 9. solveToOvr and ovrRange read only the KEYS of `pinned`, so
	   solveToOvr(base, 50, Sharpshooter, {tp: 100, ft: 0}) returned tp 45. */
	{
		const base = {};
		for (const k of BB.RATING_KEYS) base[k] = 45;
		const arch = RB.ARCHETYPES.filter((a) => a.name === "Sharpshooter")[0];
		const r = RB.solveToOvr(base, 50, arch, { tp: 100, ft: 0 });
		ok("solveToOvr writes the pinned VALUES, not just their keys",
			r.tp === 100 && r.ft === 0, "tp " + r.tp + ", ft " + r.ft);
	}

	/* 10. cfg reaches the builder from a URL and from localStorage: a string
	   "85" made every weight NaN and every player in the class Balanced. */
	{
		const cfg = C.make({ seed: "d" });
		cfg.archetypeDiversity = "85";
		let bal = 0;
		for (let i = 0; i < 200; i++) {
			if (RB.pickArchetype(new Rng("d" + i), 45, cfg, null, null, null, {})
				.name === "Balanced") bal++;
		}
		ok("a non-numeric archetypeDiversity does not make the class Balanced",
			bal < 60, bal + "/200 Balanced");
	}

	/* 12. At specialization 3 the room-scaling on negative offsets stopped
	   biting, and 6.2% of a class's ratings sat on exactly 1. */
	{
		let n = 0, floor = 0;
		for (let s = 0; s < 6; s++) {
			const res = E.run(V.realisticClass(300 + s, 70),
				C.make({ seed: "f" + s, specialization: 3 }));
			for (const p of res.players) {
				for (const k of BB.RATING_KEYS) {
					if (k === "hgt") continue;
					n++;
					if (p.newRatings[k] <= 1) floor++;
				}
			}
		}
		ok("specialization 3 does not pile ratings onto the floor",
			floor / n < 0.02, (100 * floor / n).toFixed(2) + "% of ratings on 1");
	}

	/* 13. lockUnreachable only fired when ov.ovr was set, so pinning all
	   fifteen ratings silently replaced the class's target overall. */
	{
		const lf = V.realisticClass(13, 12);
		const first = lf.players[0];
		const r = first.ratings[first.ratings.length - 1];
		const pin = {};
		for (const k of BB.RATING_KEYS) if (k !== "hgt") pin[k] = 20;
		const cfg = C.make({ seed: "lk", ovrMode: "curve" });
		cfg.overrides = { [first.pid]: { ratings: pin } };
		const res = E.run(lf, cfg);
		const p = res.players.filter((x) => x.pid === first.pid)[0];
		ok("pinning every rating reports the overall it could not reach",
			!!p.lockUnreachable, "lockUnreachable " + JSON.stringify(p.lockUnreachable));
	}

	/* 15. archetypePool was clamped at 60 against a 145-build table, so the
	   documented "a size at or above the table turns the pool off" could not
	   be said. */
	{
		const cfg = C.make({ seed: "big", archetypePool: RB.ARCHETYPES.length });
		const flavor = RB.pickFlavor(new Rng("f"), cfg);
		ok("a pool size at the table size turns the pool off",
			RB.pickClassPool(new Rng("p"), cfg, flavor) === null,
			"got a pool back instead of null");
	}
};
