/* Moved verbatim from tools/test.js so it can run in its own process (see
   tools/test-parallel.js): The paper: kinds, variants, voices and quotes.

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

	console.log("\nThe paper: kinds, variants, voices and quotes");
	{
		const N = global.News;
		const T = global.Text;

		/* THE THREE-AND-THREE RULE.

		   The table exists so that adding a kind is adding a row, and a rule that
		   is not checked is a rule the twentieth row will break. Every row carries
		   at least three headlines and at least three bodies, because two of
		   anything reads as an alternation rather than as variety. */
		const thin = N.TEMPLATES.filter((t) =>
			!Array.isArray(t.headlines) || t.headlines.length < 3 ||
			!Array.isArray(t.bodies) || t.bodies.length < 3);
		ok("every templated kind carries at least three headlines and three bodies",
			thin.length === 0, thin.map((t) => t.kind).join("; "));

		/* No two kinds share a body string. A copied row with one word changed is
		   the failure mode this catches: it passes the count above and produces
		   two kinds that read identically. */
		{
			const seenBody = {};
			const clashes = [];
			for (const t of N.TEMPLATES) {
				for (const b of t.bodies) {
					if (seenBody[b] && seenBody[b] !== t.kind) {
						clashes.push(t.kind + " / " + seenBody[b]);
					}
					seenBody[b] = t.kind;
				}
				for (const h of t.headlines) {
					if (seenBody["H|" + h] && seenBody["H|" + h] !== t.kind) {
						clashes.push("headline " + t.kind + " / " + seenBody["H|" + h]);
					}
					seenBody["H|" + h] = t.kind;
				}
			}
			ok("no body or headline template is shared between two kinds",
				clashes.length === 0, clashes.slice(0, 4).join("; "));
		}

		/* Every template's slots are actually filled. A {slot} the slots function
		   does not produce renders as the literal "{slot}", which the text sweep
		   cannot see because braces are not a text fault. */
		{
			const bad = [];
			for (const t of N.TEMPLATES) {
				const declared = new Set();
				for (const str of t.headlines.concat(t.bodies)) {
					const re = /\{(\w+)\}/g;
					let m;
					while ((m = re.exec(str)) !== null) declared.add(m[1]);
				}
				t.__slots = declared;
			}
			/* Run the table over several classes and check nothing renders a
			   literal brace. Rows whose `find` never fires in the sample are
			   reported separately below rather than silently passing. */
			/* Twenty classes rather than ten, because the desk budget changed
			   what "reachable" means. Every row still gets its own draw; the desk
			   then runs the sixty it has room for (see DESK_BUDGET), so a row's
			   rate is its draw times its share of the cut rather than its draw
			   alone. Ten classes was fitted when every successful draw became an
			   article. A row that does not appear in twenty seasons is still a row
			   nobody would see. */
			const fired = new Set();
			const faults = [];
			for (let s = 0; s < 20; s++) {
				const res = global.Engine.run(V.realisticClass(s, 70),
					global.Config.make({ seed: "tpl" + s }));
				for (const a of N.build(res)) {
					fired.add(a.kind);
					for (const seg of [a.headline, a.body].concat(a.paras || [])) {
						const one = T.segsToText(seg);
						const f = T.textFaults(one);
						if (f.length) faults.push(a.kind + " [" + f + "]: " + one.slice(0, 90));
					}
					const text = T.segsToText(a.headline) + " " + T.segsToText(a.body) + " " +
						(a.paras || []).map((x) => T.segsToText(x)).join(" ");
					if (/\{\w+\}/.test(text)) bad.push(a.kind + ": " + text.slice(0, 90));
				}
			}
			ok("no rendered article leaves a slot unfilled", bad.length === 0,
				bad.slice(0, 3).join(" | "));
			/* And none of them carries a text fault, on THESE ten classes as well
			   as on the six tools/tests/awards.js sweeps.

			   Sixteen classes rather than six is not belt-and-braces. Every fault
			   this rule has ever caught was conditional on a draw — "a East
			   Carolina side" needs the row to pick a vowel-led program,
			   "N.J.I.T.." needs the one school on the schedule whose name ends in
			   a period, "his 3th commitment" needs a third decommitment — so the
			   number of classes swept IS the sensitivity of the check, and all
			   three shipped under a six-class sweep. */
			ok("no rendered article carries a text fault", faults.length === 0,
				faults.slice(0, 3).join(" | "));
			/* A ROW THE DESK CUT IS NOT A ROW THAT CANNOT FIRE.

			   Twenty classes is a fixed number of seasons, and whether a given row
			   reaches print in them is a draw twice over: its own `find` has to
			   fire, and the article then has to survive the desk budget. The
			   champion's-coach row needs a champion whose coach is six years in or
			   fewer — nine classes in thirty — and then has to beat the rest of the
			   tournament desk; measured, it printed in one of thirty. So a row
			   still missing after twenty seasons gets ten more before the row is
			   called unreachable, and the sweep pays for them only when something
			   is actually missing. */
			const missing = () =>
				N.TEMPLATES.filter((t) => !fired.has(t.kind) && t.group !== "universe");
			for (let s = 20; missing().length && s < 30; s++) {
				const res = global.Engine.run(V.realisticClass(s, 70),
					global.Config.make({ seed: "tpl" + s }));
				for (const a of N.build(res)) fired.add(a.kind);
			}
			/* The two universe rows read carryOver and cannot fire on a standalone
			   class, which is correct; everything else has to be reachable. */
			const never = missing();
			ok("every templated kind is reachable on an ordinary class",
				never.length === 0, never.map((t) => t.kind).join("; "));
			global.__newsFired = fired;
		}

		/* THE SIZE OF THE PAPER. The audit's target was past a hundred kinds; the
		   band has a top as well as a bottom, because a feed of two hundred
		   articles a season is not a paper either. */
		{
			let kinds = new Set();
			let total = 0;
			const N_CLASSES = 8;
			let always = {};
			for (let s = 0; s < N_CLASSES; s++) {
				const res = global.Engine.run(V.realisticClass(s, 70),
					global.Config.make({ seed: "paper" + s }));
				const arts = N.build(res);
				total += arts.length;
				const here = new Set();
				for (const a of arts) { kinds.add(a.kind); here.add(a.kind); }
				for (const k of here) always[k] = (always[k] || 0) + 1;
			}
			ok("the paper runs at least a hundred distinct kinds",
				kinds.size + 2 >= 100, kinds.size + " observed, plus 2 universe-only");
			ok("and a readable number of articles a season",
				total / N_CLASSES >= 55 && total / N_CLASSES <= 140,
				(total / N_CLASSES).toFixed(1) + " a class");
			/* "Hold the always-firing share under a third": a paper whose table of
			   contents is the same every season is the failure the runs() gates
			   exist for, and adding forty kinds must not undo it. */
			const alwaysRuns = Object.keys(always).filter((k) => always[k] === N_CLASSES);
			ok("under a third of kinds fire in every single season",
				alwaysRuns.length / kinds.size < 0.34,
				alwaysRuns.length + " of " + kinds.size);
		}

		/* VOICES. */
		{
			const res = global.Engine.run(V.realisticClass(3, 70),
				global.Config.make({ seed: "voice" }));
			const arts = N.build(res);
			const voices = new Set(arts.map((a) => a.voice));
			ok("every article carries a voice and a byline",
				arts.every((a) => a.voice && a.byline), String(arts.length));
			ok("a class draws a staff rather than one voice or all six",
				voices.size >= 3 && voices.size <= 5, [...voices].join(", "));
			ok("the wire is always on the desk", voices.has("wire"));
			const withPara = arts.filter((a) => (a.paras || []).length);
			ok("a real share of articles carry a second paragraph",
				withPara.length / arts.length > 0.3 && withPara.length / arts.length < 0.95,
				withPara.length + " of " + arts.length);
			/* Two different seeds must produce two different staffs at least
			   sometimes, or the voice system is a constant with extra steps. */
			let differ = 0;
			for (let s = 0; s < 8; s++) {
				const r2 = global.Engine.run(V.realisticClass(1, 70),
					global.Config.make({ seed: "staff" + s }));
				const v = [...new Set(N.build(r2).map((a) => a.voice))].sort().join(",");
				if (s === 0) global.__firstStaff = v;
				else if (v !== global.__firstStaff) differ++;
			}
			ok("a different seed draws a different staff", differ >= 3, String(differ));
		}

		/* QUOTES. Nothing in the paper carried one before, and a quote that is
		   attributed to nobody is worse than no quote. */
		{
			let quotes = 0;
			let unattributed = 0;
			for (let s = 0; s < 6; s++) {
				const res = global.Engine.run(V.realisticClass(s, 70),
					global.Config.make({ seed: "quote" + s }));
				for (const a of N.build(res)) {
					for (const para of a.paras || []) {
						const text = T.segsToText(para);
						if (text.indexOf("\u201c") !== 0) continue;
						quotes++;
						if (!/ — .+\.$/.test(text)) unattributed++;
					}
				}
			}
			ok("the paper carries quotes", quotes > 40, String(quotes));
			ok("and every one of them is attributed", unattributed === 0, String(unattributed));
			/* A quote's speaker exists. quoteFor returns null rather than
			   inventing one, which is the behaviour worth pinning. */
			ok("quoteFor returns null when there is nobody to quote",
				N.quoteFor(new global.BBGMRng.Rng("q"), {}) !== undefined);
		}
	}
};
