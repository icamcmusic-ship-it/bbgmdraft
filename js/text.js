/* Small text helpers shared by every module that writes prose: the season
   events, the news desk, the scouting notes, the anomaly stories.

   There was no a/an helper anywhere, so every template that put an article in
   front of a program name did it by hand — and the first one that did,
   "a " + team.name + " dunk", produced "a Arizona State dunk" for every
   vowel-leading school in the country. Fifty-seven article kinds and dozens
   of event and note templates is fifty-seven places for the same bug to
   recur, so the rule lives here once and the text-QA sweep in
   tools/test.js reads every generated string looking for the class. */
(function (global) {
	"use strict";

	/* Words whose first letter lies about their first sound. The list is not
	   exhaustive English; it is the vocabulary this tool actually emits. */
	const AN_BEFORE_CONSONANT = /^(hour|honou?r|honest|heir)/i;
	const A_BEFORE_VOWEL = /^(uni|usa|use|usu|utah|utility|europe|euro|one|once|ou[ai])/i;
	// Initialisms read letter by letter: "an NBA", "an FBI", "a UCLA".
	const INITIALISM = /^[A-Z]{2,}\b/;
	const LETTER_SOUND_VOWEL = /^[AEFHILMNORSX]/;

	function article(word) {
		const w = String(word === undefined || word === null ? "" : word).trim();
		if (!w) return "a";
		if (INITIALISM.test(w)) return LETTER_SOUND_VOWEL.test(w) ? "an" : "a";
		if (AN_BEFORE_CONSONANT.test(w)) return "an";
		if (A_BEFORE_VOWEL.test(w)) return "a";
		return /^[aeiou]/i.test(w) ? "an" : "a";
	}

	/* "a Duke dunk" / "an Arizona State dunk". Capitalized when it opens a
	   sentence. */
	function withArticle(phrase, capital) {
		const art = article(phrase);
		return (capital ? art.charAt(0).toUpperCase() + art.slice(1) : art) + " " + phrase;
	}

	/* The faults a generated string can carry that no reader should see:
	   a leaked undefined/NaN/null, a doubled space, a wrong article before a
	   vowel, a stray "[object Object]", and an empty parenthesis. Returns
	   the list of fault labels (empty = clean) so a harness can name what
	   it found rather than only that it found something. */
	const FAULTS = [
		["undefined/NaN/null leaked", /\b(undefined|NaN|null)\b/],
		["object leaked", /\[object Object\]/],
		["double space", /  /],
		["empty parenthesis", /\(\s*\)/],
		/* "a Arizona", "a Ohio State", "a old-school disciplinarian". "a
		   one-and-done" and "a European" are legal, which is why this reads
		   the same list article() does: a vowel-led word after "a " that
		   article() would have given "an".

		   Lowercase words are checked too. They were not, on the theory that
		   the bug was a program name — but the templates put adjectives after
		   an article as often as they put schools there, and "a old-school
		   disciplinarian coach" shipped in the champion's-coach story for
		   exactly as long as the rule only looked at capitals. */
		/* A CAPITAL "A" MID-SENTENCE IS USUALLY NOT AN ARTICLE.

		   The single pattern above flagged "the LNB Pro A ends with a medal":
		   the league's own name ends in a capital A and the next word starts
		   with a vowel, so a correct sentence was reported as a text fault —
		   and a false positive in a harness that scans every article and every
		   note is worse than no rule, because it is the kind of failure a
		   developer learns to wave through. English does not put a capital
		   article in the middle of a sentence, so the capital form is checked
		   only where a sentence can start. */
		["a before a vowel sound", /\ba ([AEIOUaeiou][a-z]+)/],
		["a before a vowel sound", /(?:^|[.!?:;]\s+|\n)A ([AEIOUaeiou][a-z]+)/],
		["an before a consonant sound", /\ban ([B-DF-HJ-NP-TV-Zb-df-hj-np-tv-z][a-z]+)/],
		["an before a consonant sound", /(?:^|[.!?:;]\s+|\n)An ([B-DF-HJ-NP-TV-Zb-df-hj-np-tv-z][a-z]+)/],
		["space before punctuation", / [,.;:!?]/],
		["doubled punctuation", /([,.;:])\1/],
		/* "1 triple-doubles", "1 teams in the field": a count of one with a
		   plural noun after it. "No. 1 seeds" and "1 of 60 first-place
		   votes" are legal, which is what the lookbehind and the stop list
		   below are for. */
		["number agreement", /(?<![\d.]|No\. )\b1 ([a-z][a-z-]*[b-df-hj-np-tv-ze]s)\b/],
		/* "his 1th season", "a 2th-round pick": an ordinal written as n+"th"
		   by a template that did not have ordinal(). 11th/12th/13th are the
		   legal exceptions the lookbehind protects. */
		["bad ordinal", /(?<!1)[123]th\b/],
	];
	const ONE_OK = /^(is|was|has|vs|as|this|plus|its|his|does|goes|us|across|minus|less|unless|yes|thus|always|perhaps|seeds?|points?)$/;

	function textFaults(s) {
		const str = String(s === undefined || s === null ? "" : s);
		const out = [];
		for (const [label, re] of FAULTS) {
			const m = re.exec(str);
			if (!m) continue;
			// The article checks defer to article() itself, so the exception
			// lists live in one place.
			if (label === "a before a vowel sound" && article(m[1]) === "a") continue;
			if (label === "an before a consonant sound" && article(m[1]) === "an") continue;
			if (label === "number agreement" && ONE_OK.test(m[1])) continue;
			out.push(label);
		}
		return out;
	}

	/* "1 triple-double", "2 triple-doubles". Every stat-line pluralization
	   used to be written by hand, and the ones that were not ("1 teams in
	   the field", "1 triple-doubles") shipped. */
	function plural(n, word, pluralWord) {
		const num = Number(n);
		return num + " " + (num === 1 ? word : (pluralWord || word + "s"));
	}

	/* "1st", "2nd", "3rd", "11th". Every template that wanted an ordinal
	   wrote `n + "th"`, which is right for eight numbers in ten and produced
	   "his 1th season" and "a 2th-round pick" for the rest. */
	function ordinal(n) {
		const num = Number(n);
		if (!Number.isFinite(num)) return String(n);
		const v = Math.abs(num) % 100;
		if (v >= 11 && v <= 13) return num + "th";
		return num + (["th", "st", "nd", "rd"][Math.abs(num) % 10] || "th");
	}

	/* Capitalize the first letter of a sentence that begins with generated
	   text ("a Louisiana dunk was the most-watched clip" as a body). */
	function capitalize(s) {
		const str = String(s === undefined || s === null ? "" : s);
		return str.charAt(0).toUpperCase() + str.slice(1);
	}

	/* Close a sentence whose last word may already carry its own full stop
	   ("a step up from N.J.I.T.") without doubling it. */
	function endSentence(s) {
		const str = String(s === undefined || s === null ? "" : s).replace(/\s+$/, "");
		if (!str) return "";
		return /[.!?…]$/.test(str) ? str : str + ".";
	}

	/* Flatten the segment lists js/news.js produces into plain prose, so the
	   same sweep can read an article and a note. */
	function segsToText(segs) {
		if (typeof segs === "string") return segs;
		if (!Array.isArray(segs)) return "";
		return segs.map((x) => (x && x.v !== undefined ? String(x.v) : "")).join("");
	}

	global.Text = { article, withArticle, endSentence, textFaults, segsToText, plural, capitalize, ordinal };
})(typeof window !== "undefined" ? window : self);
