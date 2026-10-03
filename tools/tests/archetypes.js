/* Moved verbatim from tools/test.js so it can run in its own process (see
   tools/test-parallel.js): Archetypes.

   The sections above and below it in the old file shared nothing with it but
   the helpers declared below, which are the same ones test.js declares. */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const TOOLS = path.join(__dirname, "..");

module.exports = function (ok, V) {
	const __dirname = TOOLS;
	const { Rng } = global.BBGMRng;
	const BB = global.BBGM;
	const RB = global.RatingsBuilder;
	void fs; void path; void crypto; void Rng; void BB; void RB; void __dirname;

	/* ----------------------------------------------------- archetype identity */
	console.log("\nArchetypes");
	{
		/* An archetype's offset vector is made ovr-neutral before the solver runs.
		   The old normalizer did that by subtracting uniformly, which took the
		   points out of exactly the ratings BBGM's usage composite reads — so a
		   defensive build came out ovr-neutral by construction and offense-negative
		   by side effect, and "the best defensive big in the class" was a player
		   nobody would draft. */
		const usageKeys = ["ins", "dnk", "fg", "tp"];
		const OVR_W = RB.OVR_W;
		const SHIFT_SCALE = RB.SHIFT_SCALE;
		// What the old uniform normalizer would have produced, for comparison.
		let shiftW = 0;
		for (const k of BB.RATING_KEYS) shiftW += OVR_W[k] * SHIFT_SCALE[k];
		const uniformNormalize = (raw) => {
			let push = 0;
			for (const k of Object.keys(raw)) push += OVR_W[k] * raw[k];
			const u = push / shiftW;
			const out = {};
			for (const k of BB.RATING_KEYS) {
				if (k === "hgt") continue;
				out[k] = (raw[k] || 0) - u * SHIFT_SCALE[k];
			}
			return out;
		};
		const usageHit = (o) => usageKeys.reduce((x, k) => x + Math.min(0, o[k] || 0), 0);
		for (const name of ["Switchable Big", "Defensive Pest", "Wing Stopper",
			"Rim Protector", "Mobile Shot-Swatter"]) {
			const a = RB.ARCHETYPES.filter((x) => x.name === name)[0];
			const was = usageHit(uniformNormalize(RB.RAW_OFFSETS[name]));
			const now = usageHit(a.o);
			ok(name + " keeps more of its offense than a uniform shift would",
				now > was + 1.5,
				"usage ratings shifted " + now.toFixed(1) + ", against " +
					was.toFixed(1) + " under a uniform shift");
		}
		// And it is still ovr-neutral, which is the whole point of normalizing.
		let worstPush = 0;
		for (const a of RB.ARCHETYPES) {
			let push = 0;
			for (const k of Object.keys(a.o)) push += OVR_W[k] * a.o[k];
			worstPush = Math.max(worstPush, Math.abs(push));
		}
		ok("every archetype is still ovr-neutral", worstPush < 0.35,
			"largest residual push " + worstPush.toFixed(3));

		/* THE TABLE'S OWN SHAPE, WHICH NOTHING CHECKED AT ALL.

		   361 entries hand-authored across several thousand lines, and there was
		   no validation of any of it. `{ rbd: 20 }` for `{ reb: 20 }` would be
		   silently dropped by the normalizer — a build authored, shipped, and
		   doing nothing. `{ min: 70, max: 50 }` would produce a build eligible for
		   nobody, with no error. Neither is hypothetical in a table this size;
		   both are invisible without a check, because the failure mode of a
		   mis-authored archetype is a build that quietly never fires. */
		const KEYS = new Set(BB.RATING_KEYS.filter((k) => k !== "hgt"));
		const TAG_VOCAB = new Set([
			"guard", "wing", "big", "scoring", "shooting", "playmaking",
			"defense", "athletic", "rebounding", "raw", "durability",
		]);
		const badKey = [];
		const badGate = [];
		const badW = [];
		const badTag = [];
		const badPot = [];
		const nameSeen = new Set();
		const dupName = [];
		for (const a of RB.ARCHETYPES) {
			for (const k of Object.keys(a.o || {})) if (!KEYS.has(k)) badKey.push(a.name + "." + k);
			if (!(a.min >= 0 && a.max <= 100 && a.min < a.max)) badGate.push(a.name);
			if (!(a.w === undefined || a.w > 0)) badW.push(a.name);
			for (const t of a.t || []) if (!TAG_VOCAB.has(t)) badTag.push(a.name + ":" + t);
			if (a.pot !== undefined && !(a.pot >= -10 && a.pot <= 10)) badPot.push(a.name);
			if (nameSeen.has(a.name)) dupName.push(a.name);
			nameSeen.add(a.name);
		}
		ok("every archetype offset names a real rating", badKey.length === 0,
			badKey.join(", "));
		ok("every archetype height gate is a well-ordered range", badGate.length === 0,
			badGate.join(", "));
		ok("every archetype weight is positive", badW.length === 0, badW.join(", "));
		ok("every archetype tag is in the declared vocabulary", badTag.length === 0,
			badTag.join(", "));
		ok("every authored pot is within +/-10", badPot.length === 0, badPot.join(", "));
		ok("archetype names are unique", dupName.length === 0, dupName.join(", "));

		/* TAGS CANNOT CONTRADICT THE OFFSETS THEY DESCRIBE.

		   The flavor system multiplies a build's weight by up to 2.6x off its
		   tags, so a tag that disagrees with the vector is not cosmetic — it
		   decides which builds a themed class reaches. Measured before tags were
		   derived: 32 builds had three-point offsets and no `shooting` tag, so a
		   shooting-rich year silently skipped Combo Guard, Pull-Up Artist, Skilled
		   Big and 29 others; 19 carried `durability` with neither an injury value
		   nor any endurance offset, so "the year everybody got hurt" tilted toward
		   builds with nothing to say about availability.

		   deriveTags is now unioned into the hand list at load, so the direction
		   this catches is a hand tag the rules would never produce.

		   A contradiction here is a SIGN disagreement, not a threshold miss. 46
		   hand tags fall below deriveTags' cutoffs, but most of those are edge
		   cases — Slow-Twitch Skilled Big carries `playmaking` on pss 9.5 against
		   a rule that wants 10 — and banding those would be banding the
		   arbitrariness of the cutoff rather than a defect. What is a defect is a
		   tag whose dimension the vector does not support AT ALL: Body-Type
		   Outlier tagged `athletic` on spd -18, Eligibility-Waiver Case tagged
		   `defense` on diq -16, or the fourteen builds claiming `playmaking` with
		   pss exactly 0. Those are claims the build does not back, and the flavor
		   system pays out on them.

		   Read off the AUTHORED vector (RAW_OFFSETS), like deriveTags itself:
		   11 builds cross a cutoff only once normalized, and testing the
		   normalized form reports those as phantoms.

		   Pinned at the 19 that exist rather than 0, because removing a tag and
		   adding an offset are different design calls and each of these is one or
		   the other — see the list in the failure message. The row's job is to
		   stop the set growing while that is decided. */
		const SIGN_OF = {
			shooting: ["tp", "ft"], athletic: ["spd", "jmp"], defense: ["diq"],
			playmaking: ["pss"], rebounding: ["reb"],
		};
		const contradict = [];
		for (const a of RB.ARCHETYPES) {
			const raw = (RB.RAW_OFFSETS && RB.RAW_OFFSETS[a.name]) || a.o || {};
			for (const t of a.t || []) {
				const keys = SIGN_OF[t];
				if (!keys) continue;
				if (Math.max.apply(null, keys.map((k) => raw[k] || 0)) <= 0) {
					contradict.push(a.name + ":" + t);
				}
			}
		}
		ok("no archetype tag contradicts the sign of its own offsets",
			contradict.length <= 19,
			contradict.length + " contradictions: " + contradict.join(", "));

		/* THE TWO POTENTIAL POPULATIONS HAVE TO AGREE.

		   83 builds hand-author `pot`; the rest get a computed one. Measured
		   before the affine correction, the computed path ran 0.64 points more
		   pessimistic and 33% LESS dispersed (mean -0.87 sd 3.26 against hand
		   -0.23 sd 4.88) — so whether a build's upside was treated generously
		   depended on whether an author had happened to type the field, which is
		   what a miscalibrated fallback is. Banded loosely, since both populations
		   move whenever a build is added. */
		{
			const hand = [];
			const comp = [];
			for (const a of RB.ARCHETYPES) {
				const v = RB.POT_BY_ARCHETYPE[a.name];
				if (!Number.isFinite(v)) continue;
				(a.pot === undefined ? comp : hand).push(v);
			}
			const mn = (v) => v.reduce((s, x) => s + x, 0) / v.length;
			const sdv = (v) => {
				const m = mn(v);
				return Math.sqrt(v.reduce((s, x) => s + (x - m) * (x - m), 0) / v.length);
			};
			if (hand.length > 5 && comp.length > 5) {
				const dm = Math.abs(mn(hand) - mn(comp));
				const rs = sdv(comp) / sdv(hand);
				ok("hand-authored and computed potential agree on level", dm < 0.6,
					"means " + mn(hand).toFixed(2) + " vs " + mn(comp).toFixed(2));
				ok("hand-authored and computed potential agree on spread",
					rs > 0.8 && rs < 1.25,
					"sd ratio " + rs.toFixed(2) + " (" + sdv(hand).toFixed(2) +
						" vs " + sdv(comp).toFixed(2) + ")");
			}
		}

		/* The rarest builds have to be reachable. Raw Project once appeared in one
		   player out of 840, which is not rarity, it is absence.

		   Naming two builds and asserting each shows up made this a check on those
		   two, and it went red when the table grew from 72 builds to 98 for no
		   reason but arithmetic — each build's share of a fixed number of players
		   fell. The claim worth testing is about the table as a whole: nearly all
		   of it turns up, and the spread between the commonest specialist build and
		   the rarest is a rarity gradient rather than a cliff. (Full coverage in
		   twenty classes is not the claim: a 14-build pool drawn from ninety-eight
		   is roughly 300 draws against a coupon-collector requirement of 450, so a
		   handful of builds legitimately miss a run of twenty.) */
		/* THE SAMPLE SCALES WITH THE TABLE.

		   Twenty classes was fitted when the table had 98 builds and then held
		   while it grew: a class draws a pool of about nineteen builds, so twenty
		   classes is roughly 380 pool slots against a coupon-collector requirement
		   that rises with the table — at 205 builds, 1,400 sampled players cover
		   about 83% of it and the row went red on arithmetic rather than on
		   anything being wrong. The claim ("nearly all of it turns up") is worth
		   keeping, so the SAMPLE is scaled to the table instead of the threshold
		   being lowered to whatever the table happens to produce. */
		const counts = {};
		let total = 0;
		for (const a of RB.ARCHETYPES) counts[a.name] = 0;
		const CLASSES = Math.max(20, Math.ceil(RB.ARCHETYPES.length * 0.2));
		for (let s = 0; s < CLASSES; s++) {
			const res = global.Engine.run(V.syntheticClass(200 + s, 70),
				global.Config.make({ seed: "arch" + s }));
			for (const p of res.players) {
				counts[p.archetype] = (counts[p.archetype] || 0) + 1;
				total++;
			}
		}
		const seen = Object.keys(counts).filter((k) => counts[k] > 0);
		ok("nearly every build in the table turns up",
			seen.length >= Math.ceil(RB.ARCHETYPES.length * 0.9),
			seen.length + " of " + RB.ARCHETYPES.length + " builds in " + total + " players");
		const spec = seen.filter((k) => k !== "Balanced").map((k) => counts[k])
			.sort((a, b) => b - a);
		/* "A gradient, not a cliff" is a claim about the SHAPE of the frequency
		   distribution, and it used to be measured as commonest ÷ rarest-seen.
		   That is a ratio to an extreme order statistic over 144 builds: with a
		   145-row table and 1,400 sampled players the expected count of a
		   legitimately rare build is one or two, so Poisson noise alone swings
		   the ratio between about 20x and 50x with the model unchanged — and the
		   row duly failed and passed on the draw rather than on the table. It
		   also failed to test the actual claim: a distribution running
		   45, 30, 25, 23, 23, 22 … 2, 1 has no cliff in it anywhere, and one
		   running 45, 5, 4, 4 is nothing but cliff, and the old statistic could
		   not tell them apart.
	   
		   So the claim is measured twice, both on stable statistics: no single
		   STEP in the body of the distribution may be a drop of more than 2.5x,
		   and the commonest specialist may be no more than 25x the build at the
		   90th percentile of rarity. */
		const quantile = (p) => spec[Math.min(spec.length - 1, Math.floor(p * spec.length))];
		let worstStep = 1;
		let worstAt = "";
		const body = Math.floor(spec.length * 0.9);
		for (let i = 0; i + 1 < body; i++) {
			const r = spec[i] / Math.max(1, spec[i + 1]);
			if (r > worstStep) { worstStep = r; worstAt = spec[i] + " -> " + spec[i + 1]; }
		}
		ok("build rarity is a gradient, not a cliff",
			spec.length > 1 && worstStep <= 2.5,
			"biggest single step in the body: " + worstStep.toFixed(2) + "x (" + worstAt + ")");
		ok("and the rarity spread stays inside an order of magnitude and a half",
			spec.length > 1 && spec[0] / Math.max(1, quantile(0.9)) <= 25,
			"commonest specialist " + spec[0] + ", 90th percentile " + quantile(0.9) +
				" (" + (spec[0] / Math.max(1, quantile(0.9))).toFixed(1) + "x)");
		// The Balanced share is a promise the label on the slider makes.
		const balanced = (counts.Balanced || 0) / total;
		ok("the Balanced share matches what the diversity slider promises",
			Math.abs(balanced - 0.15) < 0.035,
			(100 * balanced).toFixed(1) + "% against a promised 15%");
	}
};
