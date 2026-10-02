/* Moved verbatim from tools/test.js so it can run in its own process (see
   tools/test-parallel.js): Mechanical anomalies and season narrative.

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

	/* --------------------------------------- anomalies, pipelines and events */
	console.log("\nMechanical anomalies and season narrative");
	{
		/* The six new anomalies change the numbers rather than only the note. Each
		   is measured against the SAME class with the anomaly system off, so what
		   is compared is one player's season against his own. */
		const dt = { tpp: [], defl: [], dd: [], gpElig: [], gpSusp: [] };
		for (let s = 0; s < 25; s++) {
			const on = global.Engine.run(V.realisticClass(s % 6, 70),
				global.Config.make({ seed: "anom" + s, surpriseBudget: 6 }));
			const off = global.Engine.run(V.realisticClass(s % 6, 70),
				global.Config.make({ seed: "anom" + s, surpriseBudget: 0 }));
			const byKey = {};
			for (const p of off.players) byKey[p.key] = p;
			for (const p of on.players) {
				const q = byKey[p.key];
				if (!q || !q.stats || !p.stats) continue;
				// Only compare a player the anomaly did not otherwise rebuild.
				if (Math.abs(p.newOvr - q.newOvr) >= 1) continue;
				if (p.shootingSlump) dt.tpp.push(p.stats.tpp - q.stats.tpp);
				if (p.defensiveBreakout) dt.defl.push(p.stats.deflpg - q.stats.deflpg);
				if (p.doubleDoubleMachine) {
					dt.dd.push((p.stats.rpg + p.stats.apg) - (q.stats.rpg + q.stats.apg));
				}
				/* Only against a baseline who PLAYED: if the same man drew an
				   ordinary ten-game injury in the anomaly-free run, the delta
				   measures one absence against another and says nothing about
				   the hold. */
				if (p.eligibilityHold && q.stats.gp >= 28) dt.gpElig.push(q.stats.gp - p.stats.gp);
				/* Same rule as the hold: against a baseline with no absence
				   of his own, or a sprained ankle in the anomaly-free run
				   reads as a suspension that GAINED him games. */
				if (p.surprise && p.surprise.name === "suspension" && !q.availability) {
					dt.gpSusp.push(q.stats.gp - p.stats.gp);
				}
			}
		}
		/* THE THINNEST EFFECT IS ASKED FOR RATHER THAN WAITED FOR.

		   The double-double machine is the rarest of the six kinds, and twenty-five
		   classes held four of them: a bar on the MEAN of four cases is a bar on
		   the draw. Drawing more classes until the sample fills only trades one
		   sampling problem for another — it stopped at seven cases against a cap,
		   and seven cases measured +0.87 locally and +0.64 on CI off nothing but
		   which prospects the kind happened to land on.

		   So the kind is requested instead. `anomalyChoices` draws a shortlist
		   wider than the class keeps and `anomalyPicks` says which of it to keep
		   (see assignSurprises), so naming this one puts it in nearly every class
		   and the row measures the anomaly rather than the lottery. The comparison
		   is unchanged: the same class with the anomaly system off, one player
		   against himself. */
		for (let s = 25; s < 37; s++) {
			const on = global.Engine.run(V.realisticClass(s % 6, 70), global.Config.make({
				seed: "anom" + s, surpriseBudget: 6,
				anomalyChoices: 8, anomalyPicks: ["double-double machine"],
			}));
			const off = global.Engine.run(V.realisticClass(s % 6, 70),
				global.Config.make({ seed: "anom" + s, surpriseBudget: 0 }));
			const byKey = {};
			for (const p of off.players) byKey[p.key] = p;
			for (const p of on.players) {
				const q = byKey[p.key];
				if (!q || !q.stats || !p.stats) continue;
				if (Math.abs(p.newOvr - q.newOvr) >= 1) continue;
				if (p.doubleDoubleMachine) {
					dt.dd.push((p.stats.rpg + p.stats.apg) - (q.stats.rpg + q.stats.apg));
				}
			}
		}
		const mean2 = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
		ok("a shooting slump actually costs three-point percentage",
			dt.tpp.length > 0 && mean2(dt.tpp) < -0.04,
			dt.tpp.length + " cases, mean " + (mean2(dt.tpp) * 100).toFixed(1) + " points");
		ok("a defensive breakout actually produces defensive plays",
			dt.defl.length > 0 && mean2(dt.defl) > 0.4,
			dt.defl.length + " cases, mean +" + mean2(dt.defl).toFixed(2) + " deflections");
		/* THE SIGN WITH A MARGIN, NOT A PRECISE MEAN ON NINE MEN.

		   `mean > 0.8` on however many cases the draw produced is a bar this
		   sample cannot carry: the same rule read +0.87 and +0.64 on two runs of
		   the same code, and a single man who barely played drags a nine-case
		   mean by a tenth of a rebound on his own. What the anomaly promises is
		   that the men who get it rebound or pass MORE — so the row asks for that
		   directly: enough cases to speak, nearly all of them improved, and a
		   mean clear of zero by half a rebound. */
		const ddUp = dt.dd.filter((d) => d > 0).length;
		ok("a double-double machine actually rebounds or passes more",
			dt.dd.length >= 6 && ddUp / dt.dd.length >= 0.7 && mean2(dt.dd) > 0.4,
			dt.dd.length + " cases, " + ddUp + " improved, mean +" +
				mean2(dt.dd).toFixed(2));
		ok("an eligibility hold actually costs games",
			dt.gpElig.length === 0 || mean2(dt.gpElig) > 5,
			dt.gpElig.length + " cases, mean " + mean2(dt.gpElig).toFixed(1) + " games");
		ok("a suspension costs games, and fewer of them than an injury",
			dt.gpSusp.length === 0 ||
				(mean2(dt.gpSusp) > 0.5 && mean2(dt.gpSusp) < 8),
			dt.gpSusp.length + " cases, mean " + mean2(dt.gpSusp).toFixed(1) + " games");

		// A suspension is an absence, not an injury: the team does not plan
		// around it, which is what `injury: false` means to applyOutages.
		const susp = global.Engine.SURPRISES.filter((k) => k.name === "suspension")[0];
		ok("the suspension anomaly exists and is not an injury", !!susp);
		// The double-double machine must never land on somebody who cannot do it.
		let implausible = 0;
		for (let s = 0; s < 20; s++) {
			const res = global.Engine.run(V.realisticClass(s % 5, 70),
				global.Config.make({ seed: "dd" + s, surpriseBudget: 6 }));
			for (const p of res.players) {
				if (p.doubleDoubleMachine && p.newRatings.hgt < 52 && p.newRatings.pss < 60) {
					implausible++;
				}
			}
		}
		ok("the double-double anomaly never lands on a player who could not do it",
			implausible === 0, implausible + " implausible cases");

		/* THE AGE AN ANOMALY WRITES HAS TO REACH THE EXPORTED FILE.

		   Four kinds set `p.age` outright, and the export derives born.year from
		   the CLASS YEAR (AGE_FOR_CLASS) — which cannot express any of them,
		   because a seventeen-year-old freshman and an ordinary one have the same
		   class year. So the tool called a man the youngest player in the class at
		   seventeen, on the board and in his note, and wrote nineteen into the
		   file BBGM imports; BBGM then developed him on a nineteen-year-old's
		   curve, which is the opposite of what the anomaly says about him.

		   Checked on the file rather than on the flag, because the flag is the
		   mechanism and the exported birth year is the promise. */
		let aged = 0;
		let mismatched = 0;
		for (let s = 0; s < 30; s++) {
			const res = global.Engine.run(V.realisticClass(s % 5, 60),
				global.Config.make({ seed: "age" + s, surpriseBudget: 6 }));
			const out = global.Engine.exportFile(res, {});
			const bySrc = new Map();
			out.players.forEach((row, i) => bySrc.set(i, row));
			res.players.forEach((p) => {
				if (!p.ageFromAnomaly) return;
				const row = bySrc.get(p.idx);
				if (!row || !row.born || !Number.isFinite(Number(row.born.year))) return;
				aged++;
				if (out.startingSeason - Number(row.born.year) !== p.age) mismatched++;
			});
		}
		ok("an anomaly that ages a prospect exports that age",
			aged > 0 && mismatched === 0,
			aged + " aged prospects, " + mismatched + " exported at another age");
		/* And the anomaly only ever ages a man. "Went pro and came back" read
		   `p.age`, which is 19 for everybody in a BBGM class, so it made a
		   graduate transfer who had spent a year abroad YOUNGER than the same man
		   without it. */
		{
			const kind = global.Engine.SURPRISES
				.filter((k) => k.name === "went pro and came back")[0];
			const grad = { age: 19, classYear: "Graduate", nonNcaa: false,
				transfer: { kind: "grad transfer", from: "Duke", fifthYear: true } };
			kind.apply(grad, new global.BBGMRng.Rng("pro"));
			ok("the pro-return anomaly never makes a graduate younger",
				grad.age >= 23, "age " + grad.age);
		}
	}

	{
		/* Flavor config bends reach the phases that own the settings they bend.
		   Four flavors exist mainly to move potBias and potSpread and phasePot
		   read state.cfg, so none of them did anything. */
		const gap = (hint) => {
			const all = [];
			for (let s = 0; s < 6; s++) {
				const res = global.Engine.run(V.realisticClass(s, 70),
					global.Config.make(hint
						? { seed: "bend" + s, flavorHint: hint }
						: { seed: "bend" + s, classFlavor: 0 }));
				for (const p of res.players) all.push(p.newPot - p.newOvr);
			}
			return all.reduce((a, b) => a + b, 0) / all.length;
		};
		const none = gap("");
		ok("a flavor that lowers potential actually lowers it",
			gap("veteran") < none - 1.5,
			"veteran " + gap("veteran").toFixed(2) + " vs none " + none.toFixed(2));
		ok("a flavor that raises potential actually raises it",
			gap("one-and-done") > none + 1.5,
			"one-and-done " + gap("one-and-done").toFixed(2));
	}

	{
		/* A flavor's DESTINATION bend reaches assignCollege.

		   Config.make folds the three legacy sliders (wEuroLeague, wGLeague, wNBL)
		   into `leagueWeights`, which is the only thing assignCollege reads — and
		   it does that at make() time, before any flavor bend runs. So a flavor
		   that set wEuroLeague wrote a number nothing read. The "unusually
		   international" flavor, whose entire purpose is to put more of the class
		   abroad, produced EuroLeague at 11.9% of non-NCAA prospects against 11.9%
		   with no flavor at all. */
		const euroShare = (over) => {
			let euro = 0;
			let abroad = 0;
			for (let s = 0; s < 8; s++) {
				const res = global.Engine.run(V.realisticClass(s, 70),
					global.Config.make(Object.assign({ seed: "dest" + s }, over)));
				for (const p of res.players) {
					if (!p.nonNcaa) continue;
					abroad++;
					if (p.newCollege === "EuroLeague") euro++;
				}
			}
			return abroad ? euro / abroad : 0;
		};
		const plain = euroShare({ classFlavor: 0 });
		const intl = euroShare({ flavorHint: "international" });
		ok("a flavor's destination bend reaches the college assignment",
			intl > plain * 1.3,
			"EuroLeague share: no flavor " + (plain * 100).toFixed(1) +
				"%, international " + (intl * 100).toFixed(1) + "%");
		// And a user who edited the destination table is not overruled by it.
		const mine = euroShare({ flavorHint: "international",
			leagueWeights: { EuroLeague: 0 } });
		ok("a destination the user set wins over the flavor", mine === 0,
			(mine * 100).toFixed(1) + "%");
	}

	{
		// The five new flavors exist and are distinguishable from the old ones by
		// the tilt they apply, which is the fault they were added to fix.
		const RBF = RB.CLASS_FLAVORS;
		const added = ["euro-influenced", "post-up renaissance", "three-and-d only",
			"feast or famine", "coaching carousel"];
		ok("the five new flavors are in the table",
			added.every((n) => RBF.some((f) => f.name === n)));
		// Every flavor carries either a distinct tilt or a distinct bend.
		const sig = (f) => JSON.stringify([f.m || {}, f.c || {}]);
		const sigs = RBF.map(sig);
		ok("no two flavors are the same flavor",
			new Set(sigs).size === sigs.length);
		// The post-up class really does shoot fewer threes than the big-heavy one.
		const threes = (hint) => {
			let tpa = 0;
			let n = 0;
			for (let s = 0; s < 4; s++) {
				const res = global.Engine.run(V.realisticClass(s, 70),
					global.Config.make({ seed: "fl" + s, flavorHint: hint }));
				for (const p of res.players) {
					if (p.nonNcaa || !p.stats) continue;
					tpa += p.stats.tpa;
					n++;
				}
			}
			return tpa / n;
		};
		ok("the post-up class shoots fewer threes than the big-heavy one",
			threes("post-up renaissance") < threes("big-heavy"),
			threes("post-up renaissance").toFixed(2) + " vs " + threes("big-heavy").toFixed(2));
		// The 3&D class really is made of fewer builds.
		const builds = (hint) => {
			const res = global.Engine.run(V.realisticClass(1, 70),
				global.Config.make({ seed: "fl", flavorHint: hint }));
			return new Set(res.players.filter((p) => !p.nonNcaa)
				.map((p) => p.archetype)).size;
		};
		ok("the three-and-D class really is a class of four or five things",
			builds("three-and-d only") < builds("balanced"),
			builds("three-and-d only") + " builds vs " + builds("balanced"));
	}

	{
		// Transfers know which way they went.
		const dirs = {};
		for (let s = 0; s < 8; s++) {
			const res = global.Engine.run(V.realisticClass(s, 70),
				global.Config.make({ seed: "tr" + s, transferShare: 60 }));
			for (const p of res.players) {
				if (p.transfer && p.transfer.direction) {
					dirs[p.transfer.direction] = (dirs[p.transfer.direction] || 0) + 1;
				}
			}
		}
		ok("transfers are classified up, lateral and down",
			dirs.up > 0 && dirs.lateral > 0 && dirs.down > 0, JSON.stringify(dirs));
		// And the classification is right: an up transfer really went up.
		let wrong = 0;
		for (let s = 0; s < 6; s++) {
			const res = global.Engine.run(V.realisticClass(s, 70),
				global.Config.make({ seed: "tr" + s, transferShare: 60 }));
			for (const p of res.players) {
				const t = p.transfer;
				if (!t || !t.direction) continue;
				const step = t.toPrestige - t.fromPrestige;
				if (t.direction === "up" && step <= 0) wrong++;
				if (t.direction === "down" && step >= 0) wrong++;
			}
		}
		ok("a transfer classified as a step up really went up", wrong === 0,
			wrong + " misclassified");
	}

	{
		// International prospects carry a development path.
		const res = global.Engine.run(V.realisticClass(2, 70),
			global.Config.make({ seed: "intl",
				leagueWeights: { "EuroLeague": 60, "Liga ACB": 30, "NBL": 20 } }));
		const abroad = res.players.filter((p) => p.nonNcaa && p.proPath);
		ok("prospects abroad carry a development path", abroad.length > 0,
			abroad.length + " of " + res.players.filter((p) => p.nonNcaa).length);
		ok("every path names a youth system and a debut age",
			abroad.every((p) => p.proPath.youth && p.proPath.debutAge));
		ok("a debut age is younger than the player is now",
			abroad.every((p) => p.proPath.debutAge <= (p.age || 19)));
		ok("national-team caps name a country the league actually plays in",
			abroad.every((p) => !p.proPath.caps || p.proPath.caps.country));
		// The G League is not this story and must not get a European pathway.
		const g = global.Engine.run(V.realisticClass(2, 70),
			global.Config.make({ seed: "gl", leagueWeights: { "NBA G League": 80 } }));
		ok("the G League gets no European academy pathway",
			g.players.filter((p) => p.newCollege === "NBA G League")
				.every((p) => !p.proPath));
	}

	{
		// Statistical ranks against the whole of Division I, which is what turns a
		// defensive number into a defensive fact.
		const res = global.Engine.run(V.realisticClass(1, 70),
			global.Config.make({ seed: "ranks" }));
		const AWm = global.Awards;
		const withRanks = res.players.filter((p) => !p.nonNcaa && p.statRanks &&
			Object.keys(p.statRanks).length);
		ok("prospects carry national and conference ranks", withRanks.length > 5,
			withRanks.length + " with ranks");
		ok("a rank is never worse than the cutoff that makes it worth saying",
			withRanks.every((p) => Object.keys(p.statRanks).every((k) => {
				const r = p.statRanks[k];
				return (!r.national || r.national <= 50) && (!r.conf || r.conf <= 10);
			})));
		ok("defensive statistics are among the ranked ones",
			AWm.RANKED_STATS.some((r) => r.key === "deflpg") &&
			AWm.RANKED_STATS.some((r) => r.key === "drtg"));
		// Defensive rating is ranked the right way round: low is good.
		const best = withRanks.filter((p) => p.statRanks.drtg &&
			p.statRanks.drtg.national === 1)[0];
		if (best) {
			const better = res.players.filter((p) => !p.nonNcaa && p.stats &&
				p.stats.mpg >= 15 && p.stats.drtg < best.stats.drtg).length;
			ok("defensive rating is ranked with low as good", better === 0,
				better + " prospects had a better DRtg than the class's No. 1");
		} else {
			ok("defensive rating is ranked with low as good", true,
				"no prospect led the country in DRtg in this class");
		}
		ok("rank highlights read as sentences",
			withRanks.some((p) => AWm.rankHighlights(p, 2).length > 0));
	}

	{
		// Mid-season events, all of them read off results that really happened.
		const res = global.Engine.run(V.realisticClass(3, 70),
			global.Config.make({ seed: "events" }));
		ok("a season produces events", res.seasonEvents.length >= 4,
			String(res.seasonEvents.length));
		ok("season events can be turned off",
			global.Engine.run(V.realisticClass(3, 70),
				global.Config.make({ seed: "events", seasonEvents: 0 }))
				.seasonEvents.length === 0);
		ok("every event names at least one real program",
			res.seasonEvents.every((e) => e.teams && e.teams.length &&
				e.teams.every((n) => !!res.teams[n])));
		ok("events are in calendar order",
			res.seasonEvents.every((e, i) =>
				i === 0 || (res.seasonEvents[i - 1].when || 0) <= (e.when || 0)));
		// A coaching change must name a team that really was losing. Judged on
		// the regular season the event was read off: a 10-21 team that then won
		// a conference-tournament game finishes 12-22, and that is not a
		// contradiction.
		for (const e of res.seasonEvents.filter((x) => x.kind === "coaching change")) {
			const t = res.teams[e.teams[0]];
			const rw = t && Number.isFinite(t.regW) ? t.regW : (t ? t.w : 0);
			const rl = t && Number.isFinite(t.regL) ? t.regL : (t ? t.l : 0);
			ok("a fired coach's team really was losing",
				t && rw / Math.max(1, rw + rl) < 0.35,
				t ? rw + "-" + rl : "no team");
		}
		// The longest-run helper reads the schedule in calendar order.
		ok("a winning streak is measured in calendar order",
			global.TeamsSim.longestRun({ log: [
				{ won: true, when: 0.9 }, { won: false, when: 0.5 },
				{ won: true, when: 0.1 }, { won: true, when: 0.2 },
			] }) === 2);
	}

	{
		/* 6.5 and 6.6 in the audit: the Pac-12 membership and the pro club
		   rosters. Both were already done in the tree, and a check is cheaper than
		   remembering that. */
		const CL = global.Colleges;
		const PAC12 = ["Boise State", "Colorado State", "Fresno State",
			"San Diego State", "Utah State", "Oregon State", "Washington State",
			"Gonzaga"];
		const misplaced = PAC12.filter((n) => CL.conferenceOf(n) !== "Pac-12");
		ok("the schools the Pac-12 rebuild moved really are in it",
			misplaced.length === 0, "still elsewhere: " + misplaced.join(", "));
		const placeholder = Object.keys(CL.NON_NCAA).filter((lg) => {
			if (lg === "Did not play") return false;
			const clubs = CL.PRO_CLUBS[lg];
			return !clubs || !clubs.length ||
				clubs.some(([name]) => / (Select|United)$/.test(name) &&
					name.indexOf(lg) === 0);
		});
		ok("no league falls back to placeholder club names",
			placeholder.length === 0, "placeholders: " + placeholder.join(", "));
		for (const lg of ["EuroLeague", "Liga ACB", "NBL"]) {
			ok(lg + " carries a real club roster",
				(CL.PRO_CLUBS[lg] || []).length >= 8);
		}
	}
};
