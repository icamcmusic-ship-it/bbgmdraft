#!/usr/bin/env node
/* Fit the derived role-usage model in js/ratings.js.

   ROLE_USAGE used to be 72 hand-fitted constants. It is a formula now (see
   ROLE_FIT in js/ratings.js), which means adding a build no longer requires
   adding a constant — but it also means the formula's own constants have to be
   fittable, or "derivable" is just a nicer word for "guessed once".

   This is that fit. It simulates nSeeds realistic draft classes, measures each
   build's mean scoring residual against the class's own ovr fit — i.e. how
   much of a player's scoring is decided by his BUILD rather than by how good
   he is, LESS the intent the build declares (ROLE_INTENT in js/ratings.js:
   a scorer is meant to score more at equal rating and a stopper less), which
   leaves the part the role multiplier exists to zero out — and then
   regresses those residuals on the same terms the formula uses (the usage
   composite delta, and the tags). The output is a drop-in ROLE_FIT block.

   Usage:
     node tools/rolefit.js [nSeeds]        report residuals and fitted constants
     node tools/rolefit.js [nSeeds] --iterate  apply the fit and re-measure

   tools/validate.js bands the worst residual, so this is the tool you reach
   for when that row fails or when you add builds. */
"use strict";

const path = require("path");
const V = require(path.join(__dirname, "validate.js"));
V.loadEngine();

const R = global.RatingsBuilder;
const mean = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);

/* Per-archetype mean PPG residual against the class's own ovr fit. */
function residuals(nSeeds) {
	const all = [];
	for (let s = 0; s < nSeeds; s++) {
		const res = global.Engine.run(
			V.realisticClass(s, 70), global.Config.make({ seed: "rf" + s }));
		for (const p of res.players) if (!p.nonNcaa && p.stats) all.push(p);
	}
	const xs = all.map((p) => p.newOvr);
	const ys = all.map((p) => p.stats.ppg);
	const mx = mean(xs);
	const my = mean(ys);
	let num = 0;
	let den = 0;
	for (let i = 0; i < xs.length; i++) {
		num += (xs[i] - mx) * (ys[i] - my);
		den += (xs[i] - mx) * (xs[i] - mx);
	}
	const slope = den > 0 ? num / den : 0;
	const icpt = my - slope * mx;
	const by = {};
	for (const p of all) (by[p.archetype] = by[p.archetype] || []).push(p);
	const out = [];
	for (const k of Object.keys(by)) {
		const raw = by[k].map((p) => p.stats.ppg - (icpt + slope * p.newOvr));
		// The residual the fit and the harness both work on is the raw one
		// LESS the build's declared intent (ROLE_INTENT in js/ratings.js).
		const intent = R.roleIntentOf(k);
		const rr = raw.map((x) => x - intent);
		const m = mean(rr);
		const se = Math.sqrt(mean(rr.map((x) => (x - m) * (x - m))) / rr.length);
		out.push({
			name: k, n: by[k].length, resid: m, se, intent, raw: mean(raw),
			// The same noise-adjusted figure tools/validate.js bands.
			excess: Math.abs(m) - 1.96 * se,
		});
	}
	out.sort((a, b) => a.excess - b.excess);
	return { rows: out, meanPpg: my, n: all.length };
}

/* Least squares with a small ridge, on log(correction) against the formula's
   own terms. A build scoring `r` points more than its rating says needs its
   role multiplier scaled by roughly exp(-r / meanPpg / DAMPING): usage
   saturates, so a change in the multiplier reaches scoring damped. */
const DAMPING = 0.55;
const TAGS = ["guard", "wing", "big", "scoring", "shooting", "playmaking",
	"defense", "athletic", "rebounding", "raw"];

function fit(rows, meanPpg, minN) {
	const byName = {};
	for (const a of R.ARCHETYPES) byName[a.name] = a;
	const design = [];
	for (const r of rows) {
		const a = byName[r.name];
		if (!a || r.n < minN) continue;
		const du = R.usageCompositeDelta(a);
		// Current log-multiplier, plus the correction the residual implies.
		const target = Math.log(R.ROLE_USAGE[r.name]) - (r.resid / meanPpg) / DAMPING;
		// The solver's own reference usage, not a copy of it that goes stale
		// the moment ROLE_U0 is retuned.
		const U0 = Number.isFinite(R.ROLE_U0) ? R.ROLE_U0 : 0.394;
		const x = [Math.log(U0 / Math.max(0.05, U0 + du)), R.creationDelta(a), 1];
		for (const t of TAGS) x.push(a.t.indexOf(t) !== -1 ? 1 : 0);
		design.push({ x, y: target });
	}
	// Nothing to fit: every row was filtered out by minN, or there were no
	// rows at all. Reporting that beats a TypeError on design[0].
	if (!design.length) return null;
	const P = design[0].x.length;
	const A = Array.from({ length: P }, () => new Array(P).fill(0));
	const B = new Array(P).fill(0);
	for (const d of design) {
		for (let i = 0; i < P; i++) {
			B[i] += d.x[i] * d.y;
			for (let j = 0; j < P; j++) A[i][j] += d.x[i] * d.x[j];
		}
	}
	for (let i = 0; i < P; i++) A[i][i] += 0.06;
	for (let i = 0; i < P; i++) {
		let piv = i;
		for (let k = i + 1; k < P; k++) if (Math.abs(A[k][i]) > Math.abs(A[piv][i])) piv = k;
		const ta = A[i]; A[i] = A[piv]; A[piv] = ta;
		const tb = B[i]; B[i] = B[piv]; B[piv] = tb;
		for (let k = i + 1; k < P; k++) {
			const f = A[k][i] / A[i][i];
			for (let j = i; j < P; j++) A[k][j] -= f * A[i][j];
			B[k] -= f * B[i];
		}
	}
	const c = new Array(P).fill(0);
	for (let i = P - 1; i >= 0; i--) {
		let acc = B[i];
		for (let j = i + 1; j < P; j++) acc -= A[i][j] * c[j];
		c[i] = acc / A[i][i];
	}
	const tags = {};
	TAGS.forEach((t, i) => { tags[t] = Math.exp(c[3 + i]); });
	return {
		compExp: c[0], createW: c[1], base: Math.exp(c[2]), tags, used: design.length,
	};
}

function main() {
	const args = process.argv.slice(2);
	const nSeeds = Number(args.filter((a) => !a.startsWith("--"))[0]) || 24;
	const minN = 10;
	const { rows, meanPpg, n } = residuals(nSeeds);
	console.log(nSeeds + " realistic classes, " + n + " player-seasons, " +
		"class mean " + meanPpg.toFixed(2) + " PPG\n");
	console.log("  build                          n    role     raw  intent   resid   excess");
	let worst = 0;
	for (const r of rows) {
		if (r.n < minN) continue;
		worst = Math.max(worst, r.excess);
		console.log("  " + r.name.padEnd(30) +
			String(r.n).padStart(4) + "  " +
			(R.ROLE_USAGE[r.name] || 1).toFixed(2).padStart(6) +
			r.raw.toFixed(2).padStart(8) + r.intent.toFixed(2).padStart(8) +
			r.resid.toFixed(2).padStart(8) + r.excess.toFixed(2).padStart(9));
	}
	console.log("\nworst bias beyond noise = " + worst.toFixed(2) +
		" points   (tools/validate.js bands this at 2.00)\n");
	const f = fit(rows, meanPpg, minN);
	if (!f) {
		console.log("No build cleared the minimum sample of " + minN +
			" — nothing to fit. Run more classes, or lower --min.");
		return;
	}
	console.log("Fitted ROLE_FIT over " + f.used + " builds — paste into js/ratings.js:\n");
	console.log("\t\tcreateW: " + f.createW.toFixed(2) + ",");
	console.log("\t\tcompExp: " + f.compExp.toFixed(2) + ",");
	console.log("\t\tbase: " + f.base.toFixed(2) + ",");
	console.log("\t\ttags: {");
	console.log("\t\t\tguard: " + f.tags.guard.toFixed(2) + ", wing: " + f.tags.wing.toFixed(2) +
		", big: " + f.tags.big.toFixed(2) + ",");
	console.log("\t\t\tscoring: " + f.tags.scoring.toFixed(2) + ", shooting: " +
		f.tags.shooting.toFixed(2) + ", playmaking: " + f.tags.playmaking.toFixed(2) + ",");
	console.log("\t\t\tdefense: " + f.tags.defense.toFixed(2) + ", athletic: " +
		f.tags.athletic.toFixed(2) + ", rebounding: " + f.tags.rebounding.toFixed(2) +
		", raw: " + f.tags.raw.toFixed(2) + ",");
	console.log("\t\t},");
}

module.exports = { residuals, fit };
if (require.main === module) main();
