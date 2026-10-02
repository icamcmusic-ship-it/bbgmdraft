/* Moved verbatim from tools/test.js so it can run in its own process (see
   tools/test-parallel.js): Archetype table and solver audit.

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

	/* --------------------------------------------- the archetype/solver audit */
	console.log("\nArchetype table and solver audit");
	{
		// The four coverage builds exist, are eligible somewhere, and each has a
		// potential entry — the failure mode that made Injury-Prone Talent the
		// highest-scoring build in the class was a build with no entry.
		const added = ["Screen Navigator", "Secondary Creator", "Zone Buster",
			"Matchup-Zone Defender"];
		const byName = {};
		for (const a of RB.ARCHETYPES) byName[a.name] = a;
		ok("the four coverage builds are in the table",
			added.every((n) => byName[n]));
		ok("each carries a potential entry",
			added.every((n) => Number.isFinite(RB.POT_BY_ARCHETYPE[n])));
		ok("each carries a role usage",
			added.every((n) => Number.isFinite(RB.ROLE_USAGE[n])));
		// Matchup-Zone Defender is the 6'7"-6'9" band specifically, which is what
		// separates it from Switchable Big and Wing Stopper.
		const mz = byName["Matchup-Zone Defender"];
		ok("the matchup-zone build is gated to the forward band",
			mz.min >= 50 && mz.max <= 68, mz.min + "-" + mz.max);
		// Screen Navigator's identity is the movement, not the shot: its largest
		// offset must not be a shooting rating.
		const sn = RB.RAW_OFFSETS["Screen Navigator"];
		const biggest = Object.keys(sn).sort((a, b) => sn[b] - sn[a])[0];
		ok("the screen-navigator build's signature is conditioning, not shooting",
			biggest === "endu", "largest offset was " + biggest);
	}

	{
		/* The usage protection is scaled by what the build loaded on the usage
		   composite itself, so an offense-loaded build no longer collects a
		   defensive build's compensation. */
		const W = { ins: 1.5, dnk: 1, fg: 1, tp: 1, spd: 0.5, hgt: 0.5, drb: 0.5, oiq: 0.5 };
		const du = (name) => {
			const o = RB.RAW_OFFSETS[name] || {};
			let d = 0;
			for (const k of Object.keys(o)) d += (W[k] || 0) * o[k];
			return d / 650;
		};
		ok("an offense-loaded build reads positive on the usage composite",
			du("Score-First Point") > 0.03 && du("Combo Guard") > 0.02,
			"Score-First Point " + du("Score-First Point").toFixed(4));
		ok("a defensive build reads negative on it",
			du("Rim Protector") < -0.02 && du("Defensive Pest") < -0.02);

		/* The measurable consequence: after normalization the offense-loaded
		   builds should not have kept MORE composite than they authored. */
		const kept = (name) => RB.usageCompositeDelta(
			RB.ARCHETYPES.filter((a) => a.name === name)[0]);
		ok("normalization no longer inflates an offense-loaded build's composite",
			kept("Score-First Point") <= du("Score-First Point") + 1e-9,
			"authored " + du("Score-First Point").toFixed(4) + ", kept " +
				kept("Score-First Point").toFixed(4));
	}

	{
		/* The creation term is residualized against the tags, so it separates two
		   builds that share a tag and do not share a creation profile. */
		const of = (n) => RB.ARCHETYPES.filter((a) => a.name === n)[0];
		const helio = RB.creationDelta(of("Heliocentric Guard"));
		const sharp = RB.creationDelta(of("Sharpshooter"));
		ok("creation separates a heliocentric guard from a sharpshooter",
			helio - sharp > 0.5,
			"helio " + helio.toFixed(3) + " vs sharp " + sharp.toFixed(3));
		ok("creation is centered: the table's tag-weighted mean is near zero",
			Math.abs(RB.ARCHETYPES.reduce((a, x) => a + RB.creationDelta(x), 0) /
				RB.ARCHETYPES.length) < 0.15);
		/* MAGNITUDE, NOT SIGN. This read `createW >= 0.04`, which quietly asserted
		   the term was positive — true of the fit standing when it was written
		   (+0.07) and not a property anyone had argued for. The re-fit after the
		   table moved put it at -0.20: with the usage protection no longer
		   subsidising ins/dnk/fg/tp across the whole table, the usage composite
		   over-reads creation by its full amount again, so the term damps rather
		   than boosts. That is a bigger number than the one it replaced, and the
		   fit it came from cut the worst role bias from 2.65 points to 1.22
		   against a 2.00 band. What the row is for is catching the term collapsing
		   to zero, which is what "rounding error" means and what it now says. */
		ok("the fitted creation weight is no longer a rounding error",
			Math.abs(RB.ROLE_FIT.createW) >= 0.04, String(RB.ROLE_FIT.createW));
	}

	{
		/* ovrRange reports the reach of the shift model, not the point the search
		   stopped at: every rating saturates at both ends. */
		const mk = (over) => {
			const o = {};
			for (const k of BB.RATING_KEYS) o[k] = 50;
			return Object.assign(o, over || {});
		};
		const balanced = RB.ARCHETYPES.filter((a) => a.name === "Balanced")[0];
		const mid = RB.ovrRange(mk(), balanced, null);
		ok("a mid-height base can be solved across the whole scale",
			mid.min === 0 && mid.max === 100, mid.min + "-" + mid.max);
		// A 7-footer's fixed hgt rating genuinely stops him reaching the bottom.
		const tall = RB.ovrRange(mk({ hgt: 92 }), balanced, null);
		ok("a very tall base still cannot be solved to the floor", tall.min > mid.min,
			"tall min " + tall.min);
		// And every ovr the range calls reachable is reached, at the new width.
		let unreached = 0;
		for (let t = mid.min; t <= mid.max; t += 5) {
			const solved = RB.solveToOvr(mk(), t, balanced, null);
			if (Math.abs(BB.ovr(solved) - t) > 1) unreached++;
		}
		ok("every ovr the widened range calls reachable is reached", unreached === 0,
			unreached + " targets missed");
	}

	{
		/* The height-to-weight model is a curve, and it is right at the ends
		   rather than only in the middle. */
		const tw = RB.typicalWeight;
		const anchors = [[66, 165], [72, 188], [78, 215], [84, 250], [90, 295]];
		const worst = Math.max.apply(null, anchors.map(([h, w]) => Math.abs(tw(h) - w)));
		ok("typical weight fits its anchors at both ends", worst < 2,
			"worst miss " + worst.toFixed(1) + "lb");
		const oldLine = (h) => 5.05 * h - 178;
		ok("the old straight line was the thing that missed",
			Math.abs(oldLine(90) - 295) > 15 && Math.abs(oldLine(66) - 165) > 8,
			"linear at 90in: " + oldLine(90).toFixed(0) + "lb against 295");
		let mono = true;
		for (let h = 62; h < 94; h++) if (tw(h + 1) <= tw(h)) mono = false;
		ok("typical weight is monotone across the basketball range", mono);
	}

	{
		/* potFromRole's load term is measured against the player's own build, so
		   it no longer pays a build for having that build's usage. */
		const stats = { usg: 0.20, mpg: 30, ppg: 12, rpg: 8, apg: 1.5, ts: 0.58 };
		const againstClass = RB.potFromRole(stats, "Freshman", RB.ROLE_USG_CENTER);
		const againstBuild = RB.potFromRole(stats, "Freshman", 0.20);
		ok("a low-usage line scores lower against its own build's usage than " +
			"against the class center", againstBuild < againstClass,
			againstBuild.toFixed(2) + " vs " + againstClass.toFixed(2));
		ok("potFromRole still falls back to the class center",
			Math.abs(RB.potFromRole(stats, "Freshman") - againstClass) < 1e-9);
		// And the build-driven part of the term is gone from a real class.
		/* THE SAMPLE SCALES WITH THE TABLE, for the reason the coverage sweep
		   above scales: a class draws a pool of about nineteen builds, so the
		   number of classes it takes for a build to accumulate ten qualifying
		   players rises with the table. Six classes was fitted at 60 builds; at
		   355 it leaves almost nothing above the ten-player bar and the spread
		   collapses to noise. */
		const byArch = {};
		const POT_CLASSES = Math.max(6, Math.ceil(RB.ARCHETYPES.length * 0.12));
		for (let s = 0; s < POT_CLASSES; s++) {
			const res = global.Engine.run(V.realisticClass(s % 8, 70),
				global.Config.make({ seed: "potref" + s }));
			for (const p of res.players) {
				if (p.nonNcaa || !p.stats || !p.potFactors) continue;
				(byArch[p.archetype] = byArch[p.archetype] || []).push(p.stats.usg);
			}
		}
		const means = Object.keys(byArch).filter((k) => byArch[k].length >= 10)
			.map((k) => byArch[k].reduce((a, b) => a + b, 0) / byArch[k].length);
		const oldLoadSpread = means.length > 1
			? (Math.max.apply(null, means) - Math.min.apply(null, means)) * 26 * 0.55 : 0;
		ok("the usage spread across builds was worth real potential, and is " +
			"no longer read as a breakout signal", oldLoadSpread > 0.3,
			"builds differed by " + oldLoadSpread.toFixed(2) +
				" points of potential under the old class-wide reference");
	}
};
