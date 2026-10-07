/* Moved verbatim from tools/test.js so it can run in its own process (see
   tools/test-parallel.js): Audit regressions, Audit regressions (September 2026).

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

	console.log("\nAudit regressions");
	{
		/* --- archetype redundancy -------------------------------------------
		   Cosine similarity over the authored 15-rating offset vectors. There
		   were 96 pairs above 0.85 and sixteen above 0.95, with Rim Protector
		   and Shot-Blocking Anchor identical in shape (1.00) and differing only
		   in height gate — 121 names for about 65 distinct shapes, which is why
		   a 17-build pool still read as repetition. */
		/* A BUILD IS A SHAPE AND A SIZE.

		   This compared offset vectors alone, and the audit that produced it said
		   so in the same breath: "a Boom-or-Bust Tools guard and a Boom-or-Bust
		   Tools center are the same offset vector, which the cosine-similarity
		   test cannot see because it compares builds, not build x height." The
		   consequence is a test that reports redundancy where there is none — a
		   post-up guard gated 24-46 and a post-up wing gated 40-68 are not the
		   same player and never appear as alternatives for one prospect — while
		   still missing the case it was written for.

		   So similarity is scaled by height OVERLAP. Two builds a prospect can
		   never choose between are not redundant however parallel their vectors;
		   two builds that share their whole gate are compared exactly as before. */
		const keys = BB.RATING_KEYS;
		const specs = RB.ARCHETYPES.filter((a) => a.name !== "Balanced");
		const vec = (a) => keys.map((k) => RB.RAW_OFFSETS[a.name][k] || 0);
		const cosine = (u, v) => {
			let d = 0;
			let nu = 0;
			let nv = 0;
			for (let i = 0; i < u.length; i++) { d += u[i] * v[i]; nu += u[i] * u[i]; nv += v[i] * v[i]; }
			return nu && nv ? d / Math.sqrt(nu * nv) : 0;
		};
		/* Jaccard over the two height gates: 1 when they are the same band, 0
		   when they do not touch. */
		const overlap = (a, b) => {
			const lo = Math.max(a.min, b.min);
			const hi = Math.min(a.max, b.max);
			if (hi <= lo) return 0;
			const union = Math.max(a.max, b.max) - Math.min(a.min, b.min);
			return union > 0 ? (hi - lo) / union : 0;
		};
		let maxCos = 0;
		let maxPair = "";
		let above85 = 0;
		let maxRaw = 0;
		let maxRawPair = "";
		for (let i = 0; i < specs.length; i++) {
			for (let j = i + 1; j < specs.length; j++) {
				const raw = cosine(vec(specs[i]), vec(specs[j]));
				const c = raw * overlap(specs[i], specs[j]);
				if (c > 0.85) above85++;
				if (c > maxCos) { maxCos = c; maxPair = specs[i].name + " / " + specs[j].name; }
				if (raw > maxRaw) {
					maxRaw = raw;
					maxRawPair = specs[i].name + " / " + specs[j].name;
				}
			}
		}
		ok("no two archetypes share a shape AND a height band (max cosine < 0.93)",
			maxCos < 0.93, maxPair + " at " + maxCos.toFixed(3));
		/* THE BOUND IS A DENSITY, NOT A COUNT.

		   "Under 30" was fitted when the table had 204 specialist builds, which is
		   20,706 pairs — a rate of about 0.07% of pairs above the line. The pair
		   count grows with the SQUARE of the table, so at 354 builds the identical
		   table (same shapes, same gates, same density of near-duplication) scores
		   about 45 and the row goes red on arithmetic rather than on anything
		   being wrong. That is the same fault the coverage sweep above was fixed
		   for, and it is fixed the same way: the claim worth testing is that
		   near-duplicate pairs stay RARE, so the threshold is stated as a share of
		   the pairs actually compared. 0.1% of pairs is comfortably tighter than
		   the table has ever run and still scales. */
		const pairCount = (specs.length * (specs.length - 1)) / 2;
		const dupBudget = Math.max(30, Math.round(pairCount * 0.001));
		ok("near-duplicate pairs (cosine x height overlap > 0.85) stay rare",
			above85 <= dupBudget,
			above85 + " of " + pairCount + " pairs, budget " + dupBudget);
		/* The raw figure is still reported, because a pair at 0.99 in offset space
		   is worth a comment in the table even when the gates keep them apart —
		   and every such pair in the table carries one. */
		ok("the closest pair in offset space is separated by its height gate",
			maxRaw < 0.995 || overlap(
				specs.filter((a) => a.name === maxRawPair.split(" / ")[0])[0],
				specs.filter((a) => a.name === maxRawPair.split(" / ")[1])[0]) < 0.5,
			maxRawPair + " at " + maxRaw.toFixed(3));
		const durability = RB.ARCHETYPES.filter((a) => (a.t || []).indexOf("durability") !== -1).length;
		ok("the durability tag has a pool to draw from", durability >= 6, durability + " members");

		/* --- the seven-footers' own builds ----------------------------------- */
		{
			let tall = 0;
			let own = 0;
			let poolsShort = 0;
			for (let s = 0; s < 16; s++) {
				const res = global.Engine.run(V.realisticClass(s % 8, 70),
					global.Config.make({ seed: "center" + s }));
				const pool = res.archetypePool || [];
				const centers = pool.filter((n) => {
					const a = RB.ARCHETYPES.filter((x) => x.name === n)[0];
					return a && a.min >= RB.CENTER_MIN;
				}).length;
				if (centers < RB.CENTER_IN_POOL) poolsShort++;
				for (const p of res.players) {
					if (!p.newRatings || p.newRatings.hgt < RB.CENTER_MIN) continue;
					tall++;
					const a = RB.ARCHETYPES.filter((x) => x.name === p.archetype)[0];
					if (a && a.min >= RB.CENTER_MIN) own++;
				}
			}
			ok("every pool carries the genuine-center builds", poolsShort === 0, poolsShort + " short");
			ok("a seven-footer usually draws a build made for him",
				tall > 40 && own / tall >= 0.30, own + " of " + tall);
		}

		/* --- FT-rate and foul identity --------------------------------------- */
		{
			const S = global.StatsSim;
			const id = (n) => S.archetypeIdentity(n, { specialization: 1 });
			ok("Free-Throw Merchant and Rim-Pressure Bruiser draw fouls the composite cannot see",
				id("Free-Throw Merchant").ftr > 0.02 && id("Rim-Pressure Bruiser").ftr > 0.03 &&
				id("Sharpshooter").ftr < 0);
			ok("Foul-Prone Enforcer fouls, a Sharpshooter does not",
				id("Foul-Prone Enforcer").pf > 1.15 && id("Sharpshooter").pf < 1.0);
			ok("Balanced sits at the anchor",
				Math.abs(id("Balanced").ftr) < 0.015 && Math.abs(id("Balanced").pf - 1) < 0.05);
			ok("the identity vanishes at specialization 0",
				S.archetypeIdentity("Foul-Prone Enforcer", { specialization: 0 }).ftr === 0);
			// Simulated: the builds the identity says draw fouls do, on the field.
			const hi = [];
			const rest = [];
			const foulers = [];
			const calm = [];
			for (let s = 0; s < 10; s++) {
				const res = global.Engine.run(V.realisticClass(s % 5, 70),
					global.Config.make({ seed: "ftr" + s, specialization: 1.5 }));
				for (const p of res.players) {
					if (p.nonNcaa || !p.stats || p.stats.fga < 4) continue;
					const i = S.archetypeIdentity(p.archetype, { specialization: 1.5 });
					(i.ftr > 0.04 ? hi : rest).push(p.stats.fta / p.stats.fga);
					(i.pf > 1.2 ? foulers : calm).push(p.stats.pfpg);
				}
			}
			const m = (v) => v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);
			ok("foul-drawing builds draw more fouls on the floor",
				hi.length >= 15 && m(hi) - m(rest) > 0.03,
				hi.length + " players, FTr " + m(hi).toFixed(3) + " vs " + m(rest).toFixed(3));
			ok("foul-prone builds commit more fouls on the floor",
				foulers.length >= 10 && m(foulers) - m(calm) > 0.15,
				foulers.length + " players, PF " + m(foulers).toFixed(2) + " vs " + m(calm).toFixed(2));
		}

		/* --- settings copy is derived, not typed ----------------------------- */
		{
			const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
			const m = /<p class="hint" id="archHint">([^<]*)<\/p>/.exec(html);
			ok("the archetype hint in index.html carries no numbers of its own",
				!!m && !/\d/.test(m[1]));
			const readme = fs.readFileSync(path.join(__dirname, "..", "README.md"), "utf8");
			const span = /Rarity weights span ([\d.]+) to ([\d.]+)/.exec(readme);
			const ws = specs.map((a) => (a.w === undefined ? 1 : a.w));
			ok("the README's stated weight span matches the table",
				!!span && Number(span[1]) === Math.min.apply(null, ws) &&
				Number(span[2]) === Math.max.apply(null, ws),
				span ? span[0] + " vs " + Math.min.apply(null, ws) + "-" + Math.max.apply(null, ws) : "no span line");
			ok("the README's build count matches the table",
				new RegExp("one of " + RB.ARCHETYPES.length + " archetypes").test(readme));
		}

		/* --- coach names ------------------------------------------------------ */
		{
			const names = new Set();
			let n = 0;
			for (let s = 0; s < 8; s++) {
				const res = global.Engine.run(V.realisticClass(s, 70), global.Config.make({ seed: "cn" + s }));
				for (const t of Object.values(res.teams)) {
					if (!t || !t.coach) continue;
					n++;
					names.add(t.coach.name);
				}
			}
			ok("the coach-name pool is big enough for a universe",
				names.size >= 0.75 * n, names.size + " distinct in " + n + " team-seasons");
		}

		/* --- age is measured from one year for the whole class -------------- */
		{
			const lf = V.realisticClass(9, 20);
			lf.players[3].draft.year = lf.startingSeason + 1;
			const res = global.Engine.run(lf, global.Config.make({ seed: "age" }));
			const p = res.players[3];
			ok("a player's age is measured from the class's season, not his own draft year",
				p.age === lf.startingSeason - lf.players[3].born.year);
			const v = global.Engine.validateLeagueFile(lf);
			ok("and the file check says so", v.warnings.some((w) => /draft year/.test(w)));
		}

		/* --- a file's own young ages are floored, not taken at face value ---

		   A source file whose born.year varies enough to be trusted
		   (ageIsInformative) used to be trusted completely: a sixteen-year-old
		   in the file played a normal Freshman season with a normal stat line
		   every single time, which is the opposite of the rarity this tool
		   otherwise reserves for a seventeen-year-old (see "reclassified
		   prodigy" in js/engine.js). realisticAge folds anything under
		   eighteen into that same rare band. */
		{
			const lf = V.realisticClass(12, 70);
			const season = lf.startingSeason;
			// A spread wide enough to keep ageIsInformative on, with a third of
			// the class planted well under the real-world floor.
			lf.players.forEach((p, i) => {
				const age = i < 24 ? 16 : 19 + (i % 8);
				p.born = { year: season - age, loc: "USA" };
			});
			const seventeens = { yes: 0, no: 0 };
			let under17 = 0;
			let exportMismatches = 0;
			for (let s = 0; s < 20; s++) {
				const res = global.Engine.run(lf, global.Config.make({ seed: "youngage" + s }));
				ok("ageIsInformative stayed on for this spread (seed " + s + ")",
					res.ageIsInformative, String(res.ageIsInformative));
				for (const p of res.players) {
					if (p.age < 17) under17++;
					if (p.age === 17) seventeens.yes++; else seventeens.no++;
				}
				const exported = global.Engine.exportFile(res, {});
				for (let i = 0; i < res.players.length; i++) {
					/* Only THE PLAYERS realisticAge actually corrected: with
					   ageIsInformative on, an anomaly can already move p.age
					   away from born.year on its own (a medical-redshirt grad
					   transfer reads older than his birth year says, which the
					   export deliberately leaves alone — see the comment on the
					   skip condition itself) and that divergence is not this
					   fix's to police. */
					if (!res.players[i].ageFloored) continue;
					const impliedAge = season - exported.players[i].born.year;
					if (impliedAge !== res.players[i].age) exportMismatches++;
				}
			}
			ok("nobody in the class is younger than seventeen",
				under17 === 0, under17 + " players under 17");
			const total = seventeens.yes + seventeens.no;
			ok("seventeen stays a rare outcome, not the default for a young file age",
				seventeens.yes > 0 && seventeens.yes / total < 0.15,
				seventeens.yes + " of " + total);
			ok("an exported file's implied age agrees with the age for every player this fix corrected",
				exportMismatches === 0, exportMismatches + " mismatches");
		}

		/* --- the paper is not the same paper every year --------------------- */
		{
			const seen = {};
			const N = 24;
			for (let s = 0; s < N; s++) {
				const res = global.Engine.run(V.realisticClass(s % 6, 70),
					global.Config.make({ seed: "paper" + s }));
				for (const k of new Set(global.News.build(res).map((a) => a.kind))) {
					seen[k] = (seen[k] || 0) + 1;
				}
			}
			const kinds = Object.keys(seen);
			const always = kinds.filter((k) => seen[k] === N).length;
			ok("fewer than a third of article kinds run in every class",
				kinds.length >= 40 && always <= kinds.length / 3,
				always + " of " + kinds.length + " kinds fire every time");
		}

		/* --- the box score's playmaking and lineup side --------------------- */
		{
			const res = global.Engine.run(V.realisticClass(2, 70), global.Config.make({ seed: "pm" }));
			const ncaa = res.players.filter((p) => !p.nonNcaa && p.stats);
			ok("every stat line carries an assisted rate and a transition share",
				ncaa.every((p) => p.stats.astdRate >= 0.12 && p.stats.astdRate <= 0.96 &&
					p.stats.transShare >= 0.03 && p.stats.transShare <= 0.45));
			ok("creators are assisted less than finishers",
				(function () {
					const by = (name) => ncaa.filter((p) => p.archetype === name);
					const hubs = ncaa.filter((p) => /Floor General|Heliocentric|Point|Playmaker|Sparkplug|Maestro/.test(p.archetype));
					const finishers = ncaa.filter((p) => /Cutter|Lob Threat|Rim Runner|Spot-Up|Catch-and-Shoot|Corner/.test(p.archetype));
					void by;
					if (hubs.length < 2 || finishers.length < 2) return true;
					const m = (v) => v.reduce((a, p) => a + p.stats.astdRate, 0) / v.length;
					return m(hubs) < m(finishers);
				})());
			ok("plus/minus, on/off and a close-game split exist on the log",
				ncaa.every((p) => Number.isFinite(p.stats.pm) && Number.isFinite(p.stats.onOff) &&
					p.gameLog && (p.gameLog.clutch === null || Number.isFinite(p.gameLog.clutch.ppg))));
			const lefties = res.players.filter((p) => p.hand === "left").length;
			ok("handedness is drawn and mostly right-handed",
				res.players.every((p) => p.hand === "left" || p.hand === "right") &&
				lefties >= 2 && lefties <= 20, lefties + " left-handers of " + res.players.length);
			const note = global.Engine.run(V.realisticClass(2, 70), global.Config.make({
				seed: "pm", noteLines: ["playmaking", "archetype"] })).players.filter((p) => !p.nonNcaa && p.note)[0];
			ok("the note can say all of it", !!note && /assisted on/.test(note.note) && /per game/.test(note.note));
		}

		/* --- the pro achievement layer -------------------------------------- */
		{
			let leagueHonors = 0;
			let continental = 0;
			let pros = 0;
			for (let s = 0; s < 12; s++) {
				const res = global.Engine.run(V.realisticClass(s % 4, 70),
					global.Config.make({ seed: "pro" + s, proAwardStrictness: 0.8 }));
				for (const p of res.players) {
					if (!p.nonNcaa) continue;
					pros++;
					if ((p.awards || []).some((a) => / MVP$| First Team$/.test(a))) leagueHonors++;
					if (p.continental) continental++;
				}
			}
			ok("prospects abroad can win their league's own honors",
				pros > 50 && leagueHonors > 0, leagueHonors + " of " + pros);
			ok("clubs in the domestic leagues play a continental competition",
				continental > 0, continental + " of " + pros);
			const stages = ["group stage", "round of 16", "quarterfinals", "Final Four", "final", "champions"];
			const res = global.Engine.run(V.realisticClass(1, 70), global.Config.make({ seed: "pro1" }));
			ok("a continental result is a named stage",
				res.players.filter((p) => p.continental).every((p) =>
					stages.indexOf(p.continental.result) !== -1));
		}

		/* --- universe: the same star returner, a year older ----------------- */
		{
			const a = global.Engine.run(V.realisticClass(3, 70), global.Config.make({ seed: "ret1" }));
			const carry = global.Universe.harvest(a);
			const schools = Object.keys(carry.returners || {});
			ok("harvest carries the named star returners", schools.length >= 6, schools.length + " programs");
			const b = global.Engine.run(V.realisticClass(4, 70),
				global.Config.make({ seed: "ret2", carryOver: carry }));
			let expected = 0;
			let back = 0;
			let gone = 0;
			for (const school of schools) {
				for (const r of carry.returners[school]) {
					const t = b.teams[school];
					if (!t) continue;
					const found = t.members.filter((m) => m.filler && m.name === r.name)[0];
					if (r.classYear === "Senior" || r.classYear === "Graduate") {
						if (!found) gone++;
						continue;
					}
					expected++;
					if (found && found.starReturner === r.starReturner &&
						found.classYear !== r.classYear) back++;
				}
			}
			ok("a returner with eligibility left is back on the same program, a year on",
				expected > 0 && back === expected, back + " of " + expected);
			ok("a senior has left", gone > 0, String(gone));
		}

		/* --- the league fragment ---------------------------------------------- */
		{
			const res = global.Engine.run(V.realisticClass(5, 70), global.Config.make({ seed: "frag" }));
			const frag = global.Engine.exportLeagueFragment(res);
			const abbrevs = new Set(frag.teams.map((t) => t.abbrev));
			ok("the league fragment carries every program once, in BBGM's field names",
				frag.startingSeason === res.season && frag.teams.length >= 360 &&
				frag.teamSeasons.length === frag.teams.length &&
				frag.coaches.length === frag.teams.length &&
				abbrevs.size === frag.teams.length &&
				frag.teams.every((t, i) => t.tid === i && Number.isFinite(t.cid)) &&
				frag.teamSeasons.every((ts) => Number.isFinite(ts.won) && Number.isFinite(ts.lost)));
			ok("the fragment serializes (no circular references)",
				(function () { try { JSON.stringify(frag); return true; } catch (e) { return false; } })());
		}

		/* --- declared scoring intent ----------------------------------------- */
		{
			ok("scorers are meant to score and stoppers are not",
				RB.roleIntentOf("Score-First Point") > 0.8 && RB.roleIntentOf("Rim Protector") < -0.8 &&
				RB.roleIntentOf("Balanced") === 0);
			/* Measured: at equal overall, the scoring-tagged builds sit above
			   the class's own ovr fit and the defense-tagged ones below it. */
			const all = [];
			for (let s = 0; s < 12; s++) {
				const res = global.Engine.run(V.realisticClass(s % 6, 70),
					global.Config.make({ seed: "intent" + s }));
				for (const p of res.players) if (!p.nonNcaa && p.stats) all.push(p);
			}
			const xs = all.map((p) => p.newOvr);
			const ys = all.map((p) => p.stats.ppg);
			const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
			const my = ys.reduce((a, b) => a + b, 0) / ys.length;
			let num = 0;
			let den = 0;
			for (let i = 0; i < xs.length; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) * (xs[i] - mx); }
			const slope = num / den;
			const icpt = my - slope * mx;
			const resid = (p) => p.stats.ppg - (icpt + slope * p.newOvr);
			const tagged = (t) => all.filter((p) => {
				const a = RB.ARCHETYPES.filter((x) => x.name === p.archetype)[0];
				return a && (a.t || []).indexOf(t) !== -1;
			});
			const m = (v) => v.reduce((a, p) => a + resid(p), 0) / Math.max(1, v.length);
			const gap = m(tagged("scoring")) - m(tagged("defense"));
			ok("scoring builds out-score defensive builds at equal overall",
				gap >= 1.2, "gap " + gap.toFixed(2) + " points");
		}

		ok("endSentence() does not double a full stop",
			global.Text.endSentence("from N.J.I.T.") === "from N.J.I.T." &&
			global.Text.endSentence("a step up") === "a step up." &&
			global.Text.endSentence("") === "");
	}

	console.log("\nAudit regressions (September 2026)");
	{
		/* The September 2026 audit ran independent probes over ~120 classes and
		   found faults the suite did not assert: game-log variance (50-point
		   nights once in a thousand games, a 31% foul-out rate), recruiting
		   ranks that collided (every class had two No. 1 recruits), a preseason
		   poll with almost no signal (No. 1 missed the tournament in 7 of 30
		   seasons), a News dateline that split December across two years,
		   signing-day articles for sophomores, and number-agreement faults the
		   text sweep did not catch. Each is a check now. */
		const T = global.Text;
		const mean = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
		const N = 12;
		let games = 0;
		let forty = 0;
		let foulOuts = 0;
		let idBad = 0;
		let attBad = 0;
		let makesBad = 0;
		let minBad = 0;
		const sdHi = [];
		let dupRanks = 0;
		let no1Miss = 0;
		let top25 = 0;
		let top25In = 0;
		let decemberWrong = 0;
		let januaryWrong = 0;
		let signingNonFresh = 0;
		let lowerBody = 0;
		let headMismatch = 0;
		let realignArticles = 0;
		let confArticlesMax = 0;
		let moves = 0;
		let overlapping = 0;
		let ratingsN = 0;
		let ratingsFloor = 0;
		let origN = 0;
		let origFloor = 0;
		let summaryBad = 0;
		let priorYearsOf = null;
		for (let s = 0; s < N; s++) {
			const res = global.Engine.run(V.realisticClass(s % 7, 70),
				global.Config.make({ seed: "audit" + s, realignmentRate: 1 }));
			const season = res.leagueFile.startingSeason;
			const cohorts = {};
			priorYearsOf = (y) => {
				const str = String(y || "");
				return (str.indexOf("Sophomore") !== -1 ? 1 : str.indexOf("Junior") !== -1 ? 2
					: str.indexOf("Graduate") !== -1 ? 4 : str.indexOf("Senior") !== -1 ? 3 : 0);
			};
			for (const p of res.players) {
				if (p.newRatings) {
					for (const k of Object.keys(p.newRatings)) {
						if (k === "hgt" || k === "fuzz") continue;
						ratingsN++;
						if (p.newRatings[k] <= 1) ratingsFloor++;
						if (typeof p.origRatings[k] !== "number") continue;
						origN++;
						if (p.origRatings[k] <= 1) origFloor++;
					}
				}
				const first = String(p.note || "").split("\n")[0];
				if (!/^[A-Z]/.test(first) || !/\.$/.test(first)) summaryBad++;
				if (p.nonNcaa) continue;
				if (p.recruiting) {
					const c = (priorYearsOf(p.classYear) + (p.redshirt ? 1 : 0)) + "|" + p.recruiting.rank;
					cohorts[c] = (cohorts[c] || 0) + 1;
				}
				if (!p.gameLog) continue;
				const st = p.stats;
				const gl = p.gameLog.games;
				let fga = 0;
				let fgm = 0;
				let tpa = 0;
				let tpm = 0;
				let fta = 0;
				let ftm = 0;
				for (const g of gl) {
					games++;
					if (g.pts >= 40) forty++;
					if (g.fouls >= 5) foulOuts++;
					if (g.pts !== 2 * (g.fgm - g.tpm) + 3 * g.tpm + g.ftm) idBad++;
					if (!(g.min >= 0 && g.min <= 40 + 5 * (g.ot || 0))) minBad++;
					fga += g.fga; fgm += g.fgm; tpa += g.tpa; tpm += g.tpm; fta += g.fta; ftm += g.ftm;
				}
				if (fga !== Math.round(st.fga * gl.length) || tpa !== Math.round(st.tpa * gl.length) ||
					fta !== Math.round(st.fta * gl.length)) attBad++;
				if (Math.abs(fgm - fga * st.fgp) > 2.5 + 0.02 * fga ||
					Math.abs(tpm - tpa * st.tpp) > 2.5 + 0.02 * tpa ||
					Math.abs(ftm - fta * st.ftp) > 2.5 + 0.02 * fta) makesBad++;
				if (st.ppg >= 20) {
					const m = mean(gl.map((g) => g.pts));
					sdHi.push(Math.sqrt(mean(gl.map((g) => (g.pts - m) * (g.pts - m)))));
				}
			}
			for (const k of Object.keys(cohorts)) if (cohorts[k] > 1) dupRanks += cohorts[k] - 1;
			const pre = res.pollHistory[0].ranks;
			if (!res.teams[pre[0].team].ncaaSeed) no1Miss++;
			for (const r of pre.slice(0, 25)) { top25++; if (res.teams[r.team].ncaaSeed) top25In++; }
			for (const m of res.realignment || []) {
				moves++;
				if (global.TeamsSim.regionsOverlap(m.from, m.to)) overlapping++;
			}
			const news = global.News.build(res);
			let confArticles = 0;
			for (const a of news) {
				const dl = a.dateline;
				if (/^December/.test(dl) && a.year !== season - 1) decemberWrong++;
				if (/^(January|February|March|Championship)/.test(dl) && a.year !== season) januaryWrong++;
				if (/^November/.test(dl) && a.year !== season - 1) januaryWrong++;
				/* The kinds that are ABOUT a high-school recruit. Matched
				   exactly rather than by substring: "undrafted signing" contains
				   "signing" and is a story about a fourth-year senior. */
				if (/^(signing day|early signing period|five-star commit|decommitment|recruiting class)$/
					.test(a.kind)) {
					for (const seg of a.headline.concat(a.body)) {
						if (seg.t !== "player") continue;
						const p = res.players.filter((x) => x.key === seg.key)[0];
						if (p && (p.classYear !== "Freshman" || (p.transfer && p.transfer.from))) signingNonFresh++;
					}
				}
				const body = T.segsToText(a.body);
				if (/^[a-z]/.test(body)) lowerBody++;
				const head = T.segsToText(a.headline);
				// A headline that names a month or a class year has to agree
				// with the dateline and the body under it.
				// March is a word headlines use ("March starts early"); the
				// other months only ever name a date.
				const month = /\b(November|December|January|February)\b/.exec(head);
				if (month && dl.indexOf(month[1]) !== 0) headMismatch++;
				const year = /\b(freshman|sophomore|junior|senior|graduate)\b/i.exec(head);
				if (year && a.kind === "field honors" && body.toLowerCase().indexOf(year[1].toLowerCase()) === -1) headMismatch++;
				if (a.kind === "realignment") realignArticles++;
				if (a.kind === "conf tourney") confArticles++;
			}
			confArticlesMax = Math.max(confArticlesMax, confArticles);
		}
		ok("no more than one game in five hundred is a 40-point night",
			forty / games < 0.005, (forty / games * 100).toFixed(2) + "% of " + games);
		/* The README said "about 7%" for years while the model measured 1.7%,
		   and this band, at "under 10%", could not tell the two apart. Real
		   Division I is near 2% of player-games; the README says so now. */
		ok("foul-outs are rare, not routine (0.5-4% of player-games)",
			foulOuts / games >= 0.005 && foulOuts / games < 0.04,
			(foulOuts / games * 100).toFixed(1) + "%");
		ok("a 20-point scorer's night-to-night spread is 4.5-9 points",
			sdHi.length > 10 && mean(sdHi) > 4.5 && mean(sdHi) < 9, mean(sdHi).toFixed(1));
		ok("every game's points equal 2*(FGM-3PM) + 3*3PM + FTM", idBad === 0, String(idBad));
		ok("the log's attempts sum to the season's attempts exactly", attBad === 0, String(attBad));
		ok("the log's makes reproduce the season's percentages", makesBad === 0, String(makesBad));
		ok("no game's minutes exceed the game", minBad === 0, String(minBad));
		ok("recruiting ranks are unique within a recruiting class",
			dupRanks === 0, dupRanks + " collisions in " + N + " classes");
		ok("the preseason No. 1 makes the tournament in nearly every season",
			no1Miss <= 2, no1Miss + " of " + N + " missed");
		ok("preseason top-25 teams make the field at a real rate (65%+)",
			top25In / top25 >= 0.65, (top25In / top25 * 100).toFixed(0) + "%");
		ok("December belongs to the year before the season, January to the season",
			decemberWrong === 0 && januaryWrong === 0, decemberWrong + " / " + januaryWrong);
		ok("signing-day stories are about freshmen", signingNonFresh === 0, String(signingNonFresh));
		ok("no article body opens in lower case", lowerBody === 0, String(lowerBody));
		ok("a headline's month or class year agrees with its article",
			headMismatch === 0, String(headMismatch));
		ok("a realignment raid runs as one roundup article",
			realignArticles <= N, realignArticles + " realignment articles in " + N + " classes");
		ok("conference tournaments run as at most four articles",
			confArticlesMax <= 4, String(confArticlesMax));
		ok("realignment moves a program into a league it shares a map with",
			moves > 0 && overlapping / moves >= 0.9, overlapping + " of " + moves);
		/* The realistic fixture itself carries ratings at 1 (its bottom third
		   is shifted down to a draft-slot curve), so the claim is about what
		   the builder ADDS: a negative offset scaled by its room, and the
		   ovr-preserving shift, together put well under a point of the class's
		   ratings on the floor beyond what arrived there. */
		ok("the builder adds few ratings on the floor of 1 (under 0.6% over the input)",
			ratingsFloor / ratingsN - origFloor / origN < 0.006,
			(ratingsFloor / ratingsN * 100).toFixed(2) + "% against " +
			(origFloor / origN * 100).toFixed(2) + "% in the input");
		ok("every default note opens with a scouting sentence", summaryBad === 0, String(summaryBad));

		/* Number agreement in the text sweep. */
		ok("textFaults() sees a count of one with a plural noun",
			T.textFaults("has 1 triple-doubles this season").length === 1 &&
			T.textFaults("put 1 teams in the field").length === 1 &&
			T.textFaults("No. 1 seeds went 4-0 and 1 of 60 votes").length === 0 &&
			T.textFaults("has 1 triple-double and 2 double-doubles").length === 0);
		ok("plural() agrees", T.plural(1, "triple-double") === "1 triple-double" &&
			T.plural(3, "team") === "3 teams");
		ok("a team honor is named to, a trophy is won",
			/^is named a Consensus/.test(global.News.honorPhrase("Consensus First Team All-American")) &&
			/^wins the /.test(global.News.honorPhrase("Wooden Award")));

		/* The potential gap is derived from the build. */
		ok("every build has a derived potential gap",
			RB.ARCHETYPES.every((a) => Number.isFinite(RB.POT_BY_ARCHETYPE[a.name])));
		ok("a build never seen before gets a potential gap without a table entry",
			Number.isFinite(RB.computePotGap({ name: "Novel", t: ["raw"], o: { jmp: 12, tp: -10 } })) &&
			RB.computePotGap({ name: "Novel", t: ["raw"], o: { jmp: 12, tp: -10 } }) > 0);
		ok("finished skill is a ceiling, raw tools are a bet",
			RB.POT_BY_ARCHETYPE["Raw Project"] > RB.POT_BY_ARCHETYPE["Floor General"] &&
			RB.POT_BY_ARCHETYPE["Boom-or-Bust Tools"] > RB.POT_BY_ARCHETYPE["Sharpshooter"]);

		/* The injury axis: a build's rating profile reaches the injury roll. */
		{
			const rates = {};
			for (const arch of ["Injury-Prone Talent", "Iron Man"]) {
				let hurt = 0;
				let n = 0;
				for (let s = 0; s < 4; s++) {
					const overrides = {};
					for (let i = 0; i < 70; i++) overrides[i] = { archetype: arch };
					const res = global.Engine.run(V.realisticClass(s % 7, 70),
						global.Config.make({ seed: "inj" + s, overrides }));
					for (const p of res.players) {
						if (p.nonNcaa || p.archetype !== arch) continue;
						n++;
						if (p.availability && p.availability.injury) hurt++;
					}
				}
				rates[arch] = n ? hurt / n : 0;
			}
			ok("an Injury-Prone Talent is hurt far more often than an Iron Man",
				rates["Injury-Prone Talent"] > 2 * rates["Iron Man"] && rates["Iron Man"] < 0.25,
				JSON.stringify(rates));
		}

		/* The two builds the audit never saw in forty classes are drawn. */
		{
			let crafty = 0;
			let system = 0;
			const pools = 400;
			for (let i = 0; i < pools; i++) {
				const pool = RB.pickClassPool(new Rng("pool" + i), { archetypePool: 17 }, null) || [];
				if (pool.some((a) => a.name === "Crafty Finisher")) crafty++;
				if (pool.some((a) => a.name === "System Player")) system++;
			}
			/* THE BAR IS A SHARE OF THE UNIFORM RATE, not a constant.

			   A 17-build pool drawn from a table of N gives any particular build
			   about 17/N draws before its rarity weight is applied, so a fixed 3%
			   is a claim about the table's SIZE rather than about these two
			   builds: at 205 builds the uniform rate is 8.3% and at 355 it is
			   4.8%, and the row went red on arithmetic. What is worth testing is
			   that neither build is effectively absent — that its weight has not
			   pushed it far below what an unweighted draw would give it. Both sit
			   at w 0.9-1.0, so half the uniform rate is a bar they clear
			   comfortably and a build nobody ever sees would fail. */
			const uniform = 17 / RB.ARCHETYPES.length;
			ok("Crafty Finisher and System Player each make the pool",
				crafty / pools > uniform * 0.4 && system / pools > uniform * 0.4,
				(crafty / pools * 100).toFixed(1) + "% / " + (system / pools * 100).toFixed(1) +
					"%, against a uniform rate of " + (uniform * 100).toFixed(1) + "%");
		}

		/* Renamed programs and the sample class. */
		ok("a file that says IUPUI lands on IU Indianapolis",
			global.Colleges.canonical("IUPUI") === "IU Indianapolis" &&
			global.Colleges.canonical("Louisiana-Lafayette") === "Louisiana" &&
			global.Colleges.COLLEGES["East Texas A&M"] && !global.Colleges.COLLEGES["IUPUI"]);
		{
			const lf = V.realisticClass(3, 12);
			lf.players[0].college = "Louisiana-Lafayette";
			const res = global.Engine.run(lf, global.Config.make({ seed: "alias" }));
			ok("an aliased college runs and exports under its current name",
				res.players[0].newCollege === "Louisiana" &&
				global.Engine.exportFile(res).players[0].college === "Louisiana");
		}
		{
			const lf = global.Sample.makeClass(5, 70, 2026);
			const check = global.Engine.validateLeagueFile(lf);
			const res = global.Engine.run(lf, global.Config.make({ seed: "sample" }));
			ok("the sample class validates and runs",
				check.season === 2026 && res.players.length === 70 &&
				res.players.every((p) => p.name && Number.isFinite(p.newOvr)));
			ok("the sample class is deterministic from its seed",
				JSON.stringify(global.Sample.makeClass(5, 70, 2026)) === JSON.stringify(lf));
		}

		/* Returning players can be reached. */
		{
			const res = global.Engine.run(V.realisticClass(1, 70), global.Config.make({ seed: "field" }));
			const withKey = Object.values(res.teams).flatMap((t) => t.fieldPlayers || [])
				.filter((f) => f.key);
			ok("every returning rotation player carries a key", withKey.length > 3000);
			ok("a field honor names the player it can link to",
				(res.fieldHonors || []).every((h) => !h.key || withKey.some((f) => f.key === h.key)));
		}

		/* The §8.13 export options (stats/prior/highs).

		   Two separate faults have been reported against these, and the tests
		   below cover both. The first: nothing shows up after Import -> Draft
		   class, which is BBGM's own doing — handleUploadedDraftClass does
		   `delete p.stats` on every uploaded player unconditionally. The route
		   that does keep them is Tools -> Import players with "include stats"
		   checked (importPlayers in the same file), so the dialog names it.

		   The second: the rows that route DID import came out mostly blank,
		   because they were thirteen counting stats and five bare numbers where
		   BBGM writes seventy-four keys and stores a season high as
		   [value, gameId]. The checks below are the schema half of that fix —
		   a row this tool writes has to be a row BBGM could have written. */
		{
			const res = global.Engine.run(V.realisticClass(2, 70), global.Config.make({ seed: "statsopt" }));
			const withStats = res.players.filter((p) => !p.nonNcaa && p.stats && p.stats.gp > 0)[0];
			const plain = global.Engine.exportFile(res);
			const idx = res.players.indexOf(withStats);
			ok("no opts writes exactly the original stats field",
				JSON.stringify(plain.players[idx].stats) ===
				JSON.stringify(withStats.src.stats));
			const withOpts = global.Engine.exportFile(res, { stats: true, prior: true, highs: true, awards: true });
			const row = withOpts.players[idx];
			const draftRow = row.stats[row.stats.length - 1];
			const BS = global.BBGMStats;
			ok("stats:true appends a draft-year row with tid DNE and this season",
				Array.isArray(row.stats) && row.stats.length >= 1 &&
				draftRow.tid === BS.TID_DOES_NOT_EXIST &&
				draftRow.season === res.leagueFile.startingSeason && draftRow.gp > 0);
			ok("every written row carries BBGM's whole stats key set, in its order",
				row.stats.every((r) =>
					JSON.stringify(Object.keys(r)) === JSON.stringify(BS.KEYS)));
			ok("the counting stats reconcile: points, the glass and the shot chart",
				row.stats.every((r) =>
					r.pts === 2 * (r.fg - r.tp) + 3 * r.tp + r.ft &&
					r.fg >= r.tp && r.fga >= r.tpa && r.ft <= r.fta &&
					r.fgAtRim + r.fgLowPost + r.fgMidRange === r.fg - r.tp &&
					r.fgaAtRim + r.fgaLowPost + r.fgaMidRange === r.fga - r.tpa &&
					r.fgAtRim <= r.fgaAtRim && r.fgLowPost <= r.fgaLowPost &&
					r.fgMidRange <= r.fgaMidRange));
			ok("highs:true writes every high as [value, gameId], not a bare number",
				BS.STATS.max.every((k) => Array.isArray(draftRow[k]) &&
					Number.isFinite(draftRow[k][0]) && draftRow[k][1] < 0));
			ok("a season high is one night out of the season it sits on",
				draftRow.ptsMax[0] >= draftRow.trbMax[0] &&
				draftRow.ptsMax[0] <= draftRow.pts &&
				draftRow.astMax[0] <= draftRow.ast &&
				draftRow.minMax[0] <= 40 + 25);
			ok("the derived statistics are all finite, and PER is on BBGM's scale",
				BS.STATS.derived.every((k) => Number.isFinite(draftRow[k])) &&
				draftRow.per > 5 && draftRow.per < 45);
			ok("a row with no game log behind it writes null highs, not zeroes",
				row.stats.every((r) => BS.STATS.max.every((k) =>
					r[k] === null || Array.isArray(r[k]))));
			if (Array.isArray(withStats.priorSeasons) && withStats.priorSeasons.length) {
				ok("prior:true adds a row per simulated earlier season",
					row.stats.length > 1 + (withOpts.players[idx].awards ? 0 : 0) &&
					row.stats.length - 1 <= withStats.priorSeasons.length);
			}
			ok("exporting twice writes the same rows, byte for byte",
				JSON.stringify(global.Engine.exportFile(res,
					{ stats: true, prior: true, highs: true, awards: true })
					.players[idx].stats) === JSON.stringify(row.stats));
			/* The players file: what Tools -> Import players wants. Its shape is
			   load-bearing — see exportPlayersFile on why there is no
			   exportedSeason and why tid has to say UNDRAFTED. */
			{
				const pf = global.Engine.exportPlayersFile(res,
					{ stats: true, prior: true, highs: true, awards: true });
				/* ...plus the tool's own `bbgmdraft` mark at the root (audit B6):
				   Import players reads the file through the same keyed parser
				   as Create League, which looks only for the stores it knows
				   and skips every other root key. */
				ok("the players file is version, startingSeason, the tool's mark and players, nothing else",
					JSON.stringify(Object.keys(pf)) ===
					JSON.stringify(["version", "startingSeason", "bbgmdraft", "players"]) &&
					pf.players.length === res.leagueFile.players.length);
				ok("every player in it is an undrafted prospect with no exportedSeason",
					pf.players.every((x) => x.tid === -2 && x.exportedSeason === undefined));
				ok("it strips the fields BBGM's own player export strips",
					pf.players.every((x) => ["statsTids", "value", "watch", "ptModifier",
						"rosterOrder", "yearsFreeAgent"].every((k) => x[k] === undefined)));
				ok("and it still carries the statline",
					pf.players.some((x) => Array.isArray(x.stats) && x.stats.length > 0));
				/* awards is not on importPlayers' field list and note is, so a
				   player whose honors are exported has them in his note too. */
				const honored = pf.players.filter((x) => x.awards && x.awards.length);
				ok("an exported honor is also written into the note, which does survive",
					honored.length > 0 &&
					honored.every((x) => /Honors:/.test(String(x.note || "")) && x.noteBool === 1));
				const plain = global.Engine.exportFile(res, {});
				const noteByPid = new Map(plain.players.map((x) => [x.pid, String(x.note || "")]));
				const noAwards = global.Engine.exportPlayersFile(res, { stats: true });
				ok("with awards off the note is exactly what the template wrote",
					noAwards.players.every((x) =>
						String(x.note || "") === noteByPid.get(x.pid)));
				/* The guarantee has to hold when the note template is the thing
				   that dropped the honors line, which is the case it exists for. */
				const bare = global.Engine.run(res.leagueFile, global.Config.make({
					seed: "statsopt", noteLines: ["summary", "stats"],
				}));
				const bareOut = global.Engine.exportPlayersFile(bare, { awards: true });
				const bareHonored = bareOut.players.filter((x) => x.awards && x.awards.length);
				ok("a note template with no honors line still gets one when awards export",
					bareHonored.length > 0 &&
					bareHonored.every((x) => /^Honors: /m.test(String(x.note || ""))));
				/* The class file and the league merge both keep `awards`, so on
				   those routes an unticked honors line means what it says: the
				   honors used to land in every note anyway. */
				const bareClass = global.Engine.exportFile(bare, { awards: true });
				ok("the class file respects a template with the honors line off",
					bareClass.players.some((x) => x.awards && x.awards.length) &&
					bareClass.players.every((x) => !/^Honors: /m.test(String(x.note || ""))));
				const bareMerge = global.Engine.mergeIntoLeague(bare, {
					players: [], startingSeason: bare.season,
				}, { awards: true });
				ok("and so does the league merge",
					bareMerge.file.players.some((x) => x.awards && x.awards.length) &&
					bareMerge.file.players.every((x) => !/^Honors: /m.test(String(x.note || ""))));
				ok("while a template WITH the honors line still writes it into the class file",
					honored.length > 0 && global.Engine.exportFile(res, { awards: true }).players
						.filter((x) => x.awards && x.awards.length)
						.every((x) => /^Honors: /m.test(String(x.note || ""))));
			}

			/* Merging the class into a whole league file, which is the only route
			   into the game that keeps a statline: the Draft Scouting import
			   deletes p.stats, and Tools -> Import players adds to the class
			   rather than replacing it. */
			{
				const maxPid = Math.max.apply(null, res.leagueFile.players.map((x) => x.pid));
				const ghost = {
					pid: maxPid + 1, tid: -2, firstName: "Ghost", lastName: "Prospect",
					draft: { year: res.season }, ratings: [{ season: res.season }],
				};
				const roster = {
					pid: maxPid + 2, tid: 3, firstName: "Real", lastName: "Player",
					draft: { year: res.season - 4 }, ratings: [{ season: res.season }],
					stats: [{ season: res.season, tid: 3, gp: 10 }],
				};
				const league = {
					version: res.leagueFile.version,
					startingSeason: res.season,
					gameAttributes: { season: res.season },
					teams: [{ tid: 0, region: "A", name: "B" }],
					/* A real league export always says what a player's team is;
					   the fixture class file does not, and the match is
					   deliberately strict about it. */
					players: res.leagueFile.players
						.map((x) => Object.assign({ tid: -2 }, x))
						.concat([ghost, roster]),
				};
				const merged = global.Engine.mergeIntoLeague(res, league,
					{ stats: true, prior: true, highs: true, awards: true });
				ok("merge replaces the class in place and drops the generated rest",
					merged.replaced === res.leagueFile.players.length &&
					merged.added === 0 && merged.removed === 1 &&
					!merged.file.players.some((x) => x.lastName === "Prospect"));
				ok("merge leaves everything else in the league file alone",
					merged.file.gameAttributes === league.gameAttributes &&
					merged.file.teams === league.teams &&
					merged.file.players.includes(roster));
				ok("the merged prospects carry the statline",
					merged.file.players.filter((x) => Array.isArray(x.stats) &&
						x.stats.some((r) => r.tid === global.BBGMStats.TID_DOES_NOT_EXIST)
					).length > 0);
				// A class from a different league: the pids mean other people, so
				// nothing may be overwritten on the strength of a pid alone.
				const foreign = {
					version: res.leagueFile.version,
					startingSeason: res.season,
					players: res.leagueFile.players.map((x) => ({
						pid: x.pid, tid: 3, firstName: "Someone", lastName: "Else",
						draft: { year: res.season - 5 }, ratings: [{ season: res.season }],
					})),
				};
				const m2 = global.Engine.mergeIntoLeague(res, foreign, { stats: true });
				ok("a pid that belongs to somebody else is appended, never overwritten",
					m2.replaced === 0 && m2.added === res.leagueFile.players.length &&
					m2.file.players.filter((x) => x.lastName === "Else").length ===
						foreign.players.length &&
					new Set(m2.file.players.map((x) => x.pid)).size === m2.file.players.length);
				/* THE ONE THAT ATE LEAGUES.

				   A class whose players are drafted in a year other than the
				   file's startingSeason (BBGM writes exactly that for a class
				   exported a year ahead) used to match the league's prospects on
				   startingSeason: every player in THAT class was dropped as "the
				   class being replaced", and the class actually being merged was
				   left in place with a duplicate appended beside it. */
				{
					const ahead = JSON.parse(JSON.stringify(res.leagueFile));
					ahead.startingSeason = res.season;
					for (const p of ahead.players) p.draft = { year: res.season + 1 };
					const r2 = global.Engine.run(ahead, global.Config.make({ seed: "ahead" }));
					const other = [];
					for (let i = 0; i < 5; i++) {
						other.push({
							pid: 90000 + i, tid: -2, firstName: "This", lastName: "Year" + i,
							draft: { year: res.season }, ratings: [{ season: res.season }],
						});
					}
					const lg = {
						version: res.leagueFile.version, startingSeason: res.season,
						gameAttributes: { season: res.season }, teams: [],
						players: other.concat([roster]),
					};
					const m3 = global.Engine.mergeIntoLeague(r2, lg, {});
					ok("a class drafted after the file's season leaves this year's class alone",
						m3.season === res.season + 1 && m3.removed === 0 &&
						m3.file.players.filter((x) => x.lastName &&
							/^Year\d$/.test(x.lastName)).length === 5 &&
						m3.file.players.includes(roster));

					/* Two classes, one league file, one pass — and the first
					   class's players are not swept away by the second. */
					const many = global.Engine.mergeManyIntoLeague([res, r2], lg, {});
					const in1 = many.file.players.filter((x) =>
						Number(x.tid) === -2 && Number(x.draft.year) === res.season).length;
					const in2 = many.file.players.filter((x) =>
						Number(x.tid) === -2 && Number(x.draft.year) === res.season + 1).length;
					ok("two classes merge into one file without eating each other",
						in1 === res.leagueFile.players.length &&
						in2 === res.leagueFile.players.length &&
						many.file.players.includes(roster) &&
						many.seasons.length === 2);
					ok("two classes for the same draft year are refused", (() => {
						try { global.Engine.mergeManyIntoLeague([res, res], lg, {}); return false; }
						catch (e) { return /same .*draft|both for the/.test(e.message); }
					})());
				}
				ok("a file with no players array is refused with a sentence", (() => {
					try { global.Engine.mergeIntoLeague(res, { teams: [] }, {}); return false; }
					catch (e) { return /league file/.test(e.message); }
				})());
			}
			ok("awards:true writes every honor as {season, type}",
				row.awards.length >= (withStats.awards || []).length &&
				row.awards.every((a) => Number.isFinite(a.season) && typeof a.type === "string"));
		}
	}
};
