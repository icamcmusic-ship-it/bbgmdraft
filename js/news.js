/* The season as news. The raw material has always existed — mid-season events
   read off simulated results, draft-day events, the class anomalies, the poll,
   the bracket, the awards — and it was rendered as four walls of center-dots.
   This module turns it into dated articles with resolved entities, so every
   player and team mention can be a link in the view.

   An article is { when, dateline, kind, headline: segs, body: segs } where a
   seg is {t: "text"|"team"|"player", v, key?}. The view decides how a team or
   player seg renders; this module never touches the DOM.

   Template variants are drawn deterministically from the run's own seed, so
   the same class always writes the same paper. */
(function (global) {
	"use strict";

	const { Rng } = global.BBGMRng;

	const T = (v) => ({ t: "text", v });
	const TM = (v) => ({ t: "team", v });
	const PL = (name, key) => ({ t: "player", v: name, key });

	/* `when` runs 0..1 across the regular season and above 1 in March. */
	const MONTHS = ["November", "November", "December", "December",
		"January", "January", "February", "February", "March"];
	/* March runs 1.1 to about 1.25 and then the calendar keeps going: the
	   lottery is in May and the combine, the pro days and the draft itself are
	   in June. Everything above 1.1 used to be clamped to "March", so 171
	   articles across fifteen classes — every mock draft, every workout, the
	   draft night — filed from a month they did not happen in. */
	const LATE = [
		// The bracket, the awards and the all-America roundup.
		[1.25, "March"],
		// The lottery and the front half of the pre-draft circuit.
		[1.37, "May"],
	];
	function dateline(when) {
		if (when === undefined || when === null) return "Preseason";
		if (when < 0) return "Offseason";
		if (when > 1.1) {
			for (const [bound, name] of LATE) if (when <= bound) return name;
			return "June";
		}
		if (when > 1) return "Championship Week";
		return MONTHS[Math.min(MONTHS.length - 1,
			Math.floor(when * MONTHS.length))];
	}
	/* The calendar year a dateline belongs to. The season's own number is
	   the year it ends in; everything before New Year prints the year
	   before. The switch used to sit at `when > 0.35`, in the middle of
	   December's bucket, so a rendered feed carried a "December 2026"
	   section between "December 2025" and "January 2026". It happens at
	   the first January bucket now — the same bucket dateline() uses. */
	const NEW_YEAR = 4 / MONTHS.length;
	function yearOf(when, season) {
		if (!season) return null;
		if (when === undefined || when === null || when < NEW_YEAR) return season - 1;
		return season;
	}

	/* Substitute {name} slots in a template string with segments. */
	function fill(tpl, slots) {
		const out = [];
		const re = /\{(\w+)\}/g;
		let last = 0;
		let m;
		while ((m = re.exec(tpl)) !== null) {
			if (m.index > last) out.push(T(tpl.slice(last, m.index)));
			const seg = slots[m[1]];
			if (seg) out.push(seg);
			else out.push(T(m[0]));
			last = m.index + m[0].length;
		}
		if (last < tpl.length) out.push(T(tpl.slice(last)));
		return out;
	}

	/* ================================================================= VOICES

	   Every article in the paper was written by the same hand. The facts
	   varied and the register never did, which is the most obvious tell that
	   a machine wrote it: fifty-seven stories a season, all of them in the
	   flat declarative of a wire desk.

	   A voice is a REGISTER, not a set of facts. It decides how likely an
	   article is to carry a quote, whether it closes with a number or with an
	   opinion, and what the byline under it says. The facts are the same
	   either way — nothing here can contradict a box score, which is the
	   whole contract of this module — so the same event written by the wire
	   and by the local paper is the same event.

	   A class draws a MIX rather than assigning voices independently: a paper
	   has a staff, and the same three or four bylines recur through a season.
	   That is also what stops the voice system becoming its own kind of
	   sameness, where every paper is an even sixth of each. */
	const VOICES = [
		{
			name: "wire", byline: "wire report", w: 3.0,
			quote: 0.15, para: 0.35,
		},
		{
			name: "beat", byline: "beat writer", w: 2.6,
			quote: 0.55, para: 0.70,
		},
		{
			name: "columnist", byline: "column", w: 1.4,
			quote: 0.45, para: 0.85,
		},
		{
			name: "analytics", byline: "analytics blog", w: 1.2,
			quote: 0.05, para: 0.90,
		},
		{
			name: "local", byline: "local paper", w: 1.5,
			quote: 0.60, para: 0.65,
		},
		{
			name: "social", byline: "timeline", w: 0.8,
			quote: 0.20, para: 0.30,
		},
	];
	const VOICE_BY_NAME = {};
	for (const v of VOICES) VOICE_BY_NAME[v.name] = v;

	/* The staff this class's paper has. Three to five voices, drawn once per
	   class off the news rng, so a season reads like one publication. */
	function drawStaff(rng) {
		const pool = VOICES.slice();
		const n = rng.int(3, 5);
		const out = [];
		for (let i = 0; i < n && pool.length; i++) {
			const pick = rng.weighted(pool, (v) => v.w);
			out.push(pick);
			pool.splice(pool.indexOf(pick), 1);
		}
		// The wire is always on the desk: somebody has to file the plain one.
		if (!out.some((v) => v.name === "wire")) out.push(VOICE_BY_NAME.wire);
		return out;
	}

	/* ================================================================= QUOTES

	   No article in the paper carried a quote, and that is the second tell.
	   A quote is not a fact — it is a person's reaction to one — so these are
	   written to be true of ANY article they are attached to, and the speaker
	   is somebody the article already names.

	   Keyed on SITUATION rather than on kind, because "we got beat by a
	   better team tonight" is the same sentence whether the article is about
	   a bracket upset, a conference tournament or a Tuesday in January. The
	   situation is derived from the facts in factsOf(), so a kind added later
	   gets quotes for free. */
	const QUOTE_SPEAKERS = {
		coach: (f) => (f.team && f.team.coach ? f.team.coach.name : null),
		player: (f) => (f.player ? f.player.name : null),
		rival: () => null,      // filled with a generic attribution
		scout: () => null,
	};
	const QUOTES = [
		/* --- a win, or a good season ----------------------------------- */
		{ s: "good", who: "coach", lines: [
			"We guarded, and when we guard we are a different team.",
			"I told them in November this group had it in them. They believed it before I did.",
			"Nobody outside this building picked us. That is fine. It is a good thing.",
			"We are not finished. That is the whole message.",
			"You win a game like that with your bench, and ours was terrific.",
			"I have coached a long time. That is as connected as a team of mine has been.",
		] },
		{ s: "good", who: "player", lines: [
			"I just try to play the right way and let the game come to me.",
			"My teammates found me. That is the whole story.",
			"We have been in this position before. Nobody flinched.",
			"Coach has been on me about my shot selection all year. Tonight it paid off.",
			"I do not care about the numbers. Ask me about the numbers in April.",
		] },
		/* --- a loss, or a bad season ----------------------------------- */
		{ s: "bad", who: "coach", lines: [
			"We got beat by a better team tonight. That is the honest answer.",
			"That is on me. I did not have them ready.",
			"We will look at the tape and we will be better on Saturday.",
			"I like this group. The record does not say what I see every day in practice.",
			"There is no shortcut out of this. You work.",
		] },
		{ s: "bad", who: "player", lines: [
			"We stopped moving the ball. That is all it was.",
			"I have to be better. It starts with me.",
			"Nobody in that locker room is quitting on anybody.",
			"It stings. It is supposed to sting.",
		] },
		/* --- a big individual performance ------------------------------ */
		{ s: "big", who: "coach", lines: [
			"He is the best player in this league and it is not particularly close.",
			"I have stopped being surprised. That is the honest truth.",
			"What people do not see is the twenty minutes he puts in before we practise.",
			"You can build a program around a young man like that.",
		] },
		{ s: "big", who: "rival", attribution: "an opposing coach", lines: [
			"We had a plan for him. The plan lasted about four minutes.",
			"You do not stop him. You hope he misses.",
			"He is the toughest cover we have seen this season, and we have played some people.",
			"I would take him on my team tomorrow, and so would everybody else in this league.",
		] },
		{ s: "big", who: "scout", attribution: "an NBA scout in the building", lines: [
			"That is a first-round night in a mid-major gym. They count the same.",
			"The tools have never been the question. The feel is what has changed.",
			"I have him higher than the boards do. I have had him higher all year.",
			"There is a version of him in two years that nobody in this building is imagining.",
		] },
		/* --- what the scouting file says ------------------------------
		   The trait layer (js/traits.js) is the richest thing on a player and
		   no quote in the paper had ever read it: every scout in these pages
		   talked about tools and feel in general terms whatever the man's
		   actual file said. These are keyed to the trait GROUP, so a trait
		   added there falls into the right bucket without a new pool. */
		{ s: "trait:motor", who: "scout", attribution: "an NBA scout in the building", lines: [
			"The talent has never been in question. The other twenty-eight minutes are.",
			"When he decides the game matters, he is the best player on the floor. That is the whole scouting report.",
			"You are drafting the nights he plays like that, and hoping there are more of them.",
		] },
		{ s: "trait:medical", who: "scout", attribution: "an NBA scout in the building", lines: [
			"Everybody's doctors will have an opinion. Ours is that he is worth the risk.",
			"He has played through it all season, which tells you something the imaging will not.",
			"The medical is the whole conversation in our room. The player is not in dispute.",
		] },
		{ s: "trait:shooting", who: "scout", attribution: "an NBA scout in the building", lines: [
			"The release is the same every time. That travels.",
			"If the shot is real, he is a rotation player in October. That is the bet.",
			"He is going to have to make them from further out. He knows that better than we do.",
		] },
		{ s: "trait:frame", who: "scout", attribution: "an NBA scout in the building", lines: [
			"He measured better than he looks on tape, which happens more than people think.",
			"The frame is going to hold more weight, and everything gets easier when it does.",
			"You cannot teach the arms. Everything else on the list you can.",
		] },
		{ s: "trait:defense", who: "rival", attribution: "an opposing coach", lines: [
			"We could not get our best action off against him. That is not normal at this level.",
			"He guarded three positions for us tonight and did not complain about any of them.",
			"Take him off the floor and it is a different game. We counted.",
		] },
		{ s: "trait:passing", who: "coach", lines: [
			"He sees it a half-second before everybody else. You cannot coach the half-second.",
			"The pass he made in the second half is one most people in this league do not see.",
		] },
		{ s: "trait:character", who: "coach", lines: [
			"He is the first one in the gym and he has been all year. The younger ones have noticed.",
			"You would want him around your program whatever he averaged.",
		] },
		{ s: "trait:background", who: "coach", lines: [
			"Where he has come from to be standing here is the part nobody writes about.",
			"He has had to do this the long way, and it shows in how he plays.",
		] },
		/* --- an underdog, a surprise ----------------------------------- */
		{ s: "surprise", who: "coach", lines: [
			"Our guys have been reading what everybody wrote about us. They can read.",
			"We belong here. We have belonged here since November.",
			"I do not think it is an upset. I understand why you do.",
			"They have been the underdog their whole lives. This is nothing new to them.",
		] },
		{ s: "surprise", who: "player", lines: [
			"Everybody keeps calling it a shock. It is not a shock to us.",
			"We knew what we had. Now everybody else does.",
			"Nobody recruited most of us. That is the fuel.",
		] },
		/* --- an injury, an absence ------------------------------------- */
		{ s: "injury", who: "coach", lines: [
			"He will be back. I am not going to put a date on it.",
			"Next man up. That is not a cliche here, it is the plan.",
			"You do not replace a player like that. You replace him with five guys.",
			"The medical people will tell me when. I do not get a vote.",
		] },
		{ s: "injury", who: "player", lines: [
			"I will be back for March. Write that down.",
			"It is frustrating. I have never sat out anything in my life.",
			"I am still the loudest guy on that bench.",
		] },
		/* --- the draft, the future ------------------------------------- */
		{ s: "future", who: "scout", attribution: "one Eastern Conference scout", lines: [
			"He is going in the first round. The only question is how early.",
			"Everybody in the league has watched the same film. Not everybody read it the same way.",
			"If he shoots it the way he shot it in February, this is a lottery conversation.",
			"The measurements will matter more for him than for anybody else in this class.",
		] },
		{ s: "future", who: "player", lines: [
			"I have not thought about it. I am thinking about Saturday.",
			"Whatever happens happens. I love it here.",
			"My family will decide with me. It is not a decision I make alone.",
		] },
		{ s: "future", who: "coach", lines: [
			"I have told him I will support whatever he chooses, and I mean it.",
			"He owes this program nothing. He has given us everything.",
			"If he comes back we are a top-ten team. If he does not, good for him.",
		] },
	];

	/* Which situations an article is in. More than one is normal — a
	   Cinderella's win is "good" and "surprise" — and the drawer picks among
	   them, which is itself a source of variety. */
	function situationsOf(f) {
		const out = [];
		if (f.won === true) out.push("good");
		if (f.won === false) out.push("bad");
		if (f.team && Number.isFinite(f.team.w)) {
			const pct = f.team.w / Math.max(1, f.team.w + f.team.l);
			if (pct >= 0.72) out.push("good");
			if (pct <= 0.38) out.push("bad");
		}
		if (f.player && f.player.stats && f.player.stats.ppg >= 17) out.push("big");
		if (f.player && Number.isFinite(f.player.boardRank) && f.player.boardRank <= 20) {
			out.push("future");
		}
		if (f.underdog) out.push("surprise");
		if (f.injury) out.push("injury");
		// The scouting file, when the article is about somebody who has one.
		for (const t of (f.player && f.player.traits) || []) {
			if (t && t.group) out.push("trait:" + t.group);
		}
		if (!out.length) out.push(f.player ? "big" : "good");
		return out;
	}

	/* One quote, as segments. Returns null when there is nobody to attribute
	   it to, which is the honest outcome for an article that names no team
	   and no player. */
	function quoteFor(rng, f) {
		const sits = situationsOf(f);
		const pool = QUOTES.filter((q) => sits.indexOf(q.s) !== -1);
		if (!pool.length) return null;
		// Shuffle so a speaker with no name available falls through to one
		// that has a name rather than dropping the quote.
		const order = pool.slice().sort(() => rng.random() - 0.5);
		for (const q of order) {
			const who = QUOTE_SPEAKERS[q.who] ? QUOTE_SPEAKERS[q.who](f) : null;
			if (!who && !q.attribution) continue;
			const line = rng.pick(q.lines);
			const segs = [T("“" + line + "” ")];
			if (who && q.who === "coach") {
				segs.push(T("— "));
				segs.push(T(who));
				if (f.team) { segs.push(T(", ")); segs.push(TM(f.team.name)); }
				segs.push(T("."));
			} else if (who && q.who === "player") {
				segs.push(T("— "));
				segs.push(PL(f.player.name, f.player.key));
				segs.push(T("."));
			} else {
				segs.push(T("— " + q.attribution + "."));
			}
			return segs;
		}
		return null;
	}

	/* ============================================================= PARAGRAPHS

	   A body was one paragraph, so three body templates read as three bodies.
	   A body that is a lede plus one or two paragraphs drawn from a pool
	   reads as many more than three, and the arithmetic is the point: five
	   ledes and six second paragraphs is thirty articles, not eleven.

	   Every paragraph here is built from facts the article already names —
	   see factsOf, which reads the player and team segments back out of the
	   headline and body rather than making each of the fifty-six existing
	   article sites pass them in. So a paragraph cannot contradict the story
	   above it, and a kind added later gets paragraphs without asking.

	   `need` is what the paragraph requires to be true. A paragraph whose
	   need fails is not drawn; it is not written with an "if available"
	   hedge, because a hedged sentence is worse than no sentence. */
	function ordinal(n) {
		const s = ["th", "st", "nd", "rd"];
		const v = n % 100;
		return n + (s[(v - 20) % 10] || s[v] || s[0]);
	}
	function pctText(x) { return (x * 100).toFixed(1) + "%"; }

	const PARAGRAPHS = [
		/* --- the stat paragraph ---------------------------------------- */
		{
			/* Four voices drew from ONE sentence, so the second paragraph of
			   every article a beat writer filed opened the same way — fifteen
			   times a class. The facts are identical; the sentence is not. */
			id: "line", voices: ["wire", "beat", "local", "analytics"],
			need: (f) => f.player && f.player.stats && f.player.stats.gp > 0,
			build: (f, rng) => {
				const s = f.player.stats;
				const gp = global.Text.plural(Math.round(s.gp), "game");
				const p = PL(f.player.name, f.player.key);
				return rng.pick([
					() => [p, T(" is at " + statBlurb(s) + " in " + gp + ".")],
					() => [T("The season, in one line: "), p,
						T(", " + statBlurb(s) + " over " + gp + ".")],
					() => [T("Through " + gp + ", "), p,
						T(" has been at " + statBlurb(s) + ".")],
					() => [p, T(" has played " + gp + " and is at " + statBlurb(s) + ".")],
					() => [T("His numbers say " + statBlurb(s) + ", across " + gp +
						". They are "), p, T("'s.")],
					() => [p, T(": " + statBlurb(s) + ", " + gp + " into it.")],
				])();
			},
		},
		{
			id: "efficiency", voices: ["analytics", "beat"],
			need: (f) => f.player && f.player.stats && f.player.stats.fga >= 6,
			build: (f) => [T("The efficiency behind it: "),
				PL(f.player.name, f.player.key),
				T(" is shooting " + pctText(f.player.stats.fgp) + " from the field and " +
					pctText(f.player.stats.tpp) + " from three on " +
					f.player.stats.tpa.toFixed(1) + " attempts, for a true shooting " +
					"percentage of " + pctText(f.player.stats.ts) + ".")],
		},
		{
			id: "usage", voices: ["analytics"],
			need: (f) => f.player && f.player.stats && Number.isFinite(f.player.stats.usg),
			build: (f) => [T("He uses " + pctText(f.player.stats.usg) +
				" of his team's chances while he is on the floor, which is " +
				(f.player.stats.usg > 0.28 ? "a heliocentric share for a college offense"
					: f.player.stats.usg < 0.18 ? "a low number for a player of his profile"
					: "about what a first option carries") + ".")],
		},
		{
			id: "defensive line", voices: ["analytics", "beat"],
			need: (f) => f.player && f.player.stats &&
				(f.player.stats.spg + f.player.stats.bpg) >= 2,
			build: (f) => [T("Defensively he is at " +
				f.player.stats.spg.toFixed(1) + " steals and " +
				f.player.stats.bpg.toFixed(1) + " blocks a game" +
				(Number.isFinite(f.player.stats.drtg)
					? ", with a defensive rating of " + Math.round(f.player.stats.drtg) : "") +
				".")],
		},
		{
			id: "season high", voices: ["beat", "local", "social"],
			need: (f) => f.player && f.player.gameLog && f.player.gameLog.best &&
				f.player.gameLog.best.pts >= 20,
			build: (f) => {
				const b = f.player.gameLog.best;
				return [T("His best night of the season is still the " + b.pts +
					" he put up against "), TM(b.opp),
					T(" — " + b.fgm + " of " + b.fga + " from the floor in a " +
						(b.won ? "win" : "loss") + ", " + b.pf + "-" + b.pa + ".")];
			},
		},
		/* --- the team context paragraph -------------------------------- */
		{
			id: "record", voices: ["wire", "beat", "local"],
			need: (f) => f.team && Number.isFinite(f.team.w) && f.team.w + f.team.l >= 5,
			build: (f, rng) => [TM(f.team.name),
				T(rng.pick([" is ", " sits at ", " has gone ", " stands "]) +
					f.team.w + "-" + f.team.l +
					(Number.isFinite(f.team.cw)
						? " overall and " + f.team.cw + "-" + f.team.cl + " in the " + f.team.conf
						: " in the " + f.team.conf) +
					(f.team.apRank ? ", ranked No. " + f.team.apRank + " in the AP poll" : "") +
					".")],
		},
		{
			id: "resume", voices: ["analytics"],
			need: (f) => f.team && Number.isFinite(f.team.netRank),
			build: (f) => [T("The résumé: No. " + f.team.netRank + " in the NET" +
				(f.team.quads && Number.isFinite(f.team.quads.q1w)
					? ", " + f.team.quads.q1w + "-" + f.team.quads.q1l + " in Quadrant 1"
					: "") +
				(Number.isFinite(f.team.sosAvg)
					? ", against a schedule rated " + f.team.sosAvg.toFixed(1) : "") + ".")],
		},
		{
			id: "coach", voices: ["beat", "local", "columnist"],
			need: (f) => f.team && f.team.coach && f.team.coach.name,
			build: (f) => [T(f.team.coach.name + " is in his " +
				ordinal(f.team.coach.tenure || 1) + " season at "), TM(f.team.name),
				T((f.team.coach.situationLabel ? ", " + f.team.coach.situationLabel : "") +
					(philosophyPhrase(f.team.coach, "staff")
						? " — " + philosophyPhrase(f.team.coach, "staff") : "") + ".")],
		},
		{
			id: "style", voices: ["analytics", "columnist"],
			need: (f) => f.team && f.team.style && f.team.style.name,
			build: (f) => [TM(f.team.name),
				T(" plays " + f.team.style.name +
					(Number.isFinite(f.team.offRtg)
						? ", scoring " + f.team.offRtg.toFixed(1) +
							" points per hundred possessions" : "") + ".")],
		},
		/* --- the opinion paragraph ------------------------------------- */
		{
			id: "column take", voices: ["columnist"],
			need: (f) => f.player,
			build: (f, rng) => [T(rng.pick([
				"The board will catch up. It always does, and it is usually late.",
				"There is a version of this season people will misremember in five years. This is not it.",
				"Nobody is going to write the definitive sentence about him in March. That is fine.",
				"He is not a prospect in the abstract. He is a basketball player, right now, tonight.",
				"Watch what the second defender does when he catches it. That is the tell.",
			]))],
		},
		{
			id: "column team take", voices: ["columnist"],
			need: (f) => f.team && !f.player,
			build: (f, rng) => [T(rng.pick([
				"Seasons like this one are why the bracket exists.",
				"There is nothing lucky about being good in February.",
				"They will be favoured next time, and that is its own kind of problem.",
				"A program does not turn a corner in one night. It turns it in about forty of them.",
			]))],
		},
		{
			id: "social", voices: ["social"],
			need: () => true,
			build: (f, rng) => [T(rng.pick([
				"The clip has been reposted about four thousand times by the time the buses leave.",
				"Everybody in the building had a phone up. Some of the footage is even watchable.",
				"The student section got there two hours early and did not sit down once.",
				"It was trending before the horn — which is not, strictly, a basketball fact.",
			]))],
		},
		/* --- the draft-stock paragraph --------------------------------- */
		{
			id: "board", voices: ["wire", "beat", "analytics", "columnist"],
			need: (f) => f.player && Number.isFinite(f.player.boardRank),
			build: (f) => [PL(f.player.name, f.player.key),
				T(" sits " + ordinal(f.player.boardRank) + " on the board" +
					(f.player.mockRound
						? ", projected in round " + f.player.mockRound +
							(f.player.mockPick ? " at pick " + f.player.mockPick : "")
						: "") +
					(f.player.stockMove
						? " — " + (f.player.stockMove > 0 ? "up " : "down ") +
							Math.abs(f.player.stockMove) + " from the preseason"
						: "") + ".")],
		},
		/* The trait layer, in the paper. A scouting note says a prospect is
		   long-armed with a relentless motor; the paper is where that becomes
		   a sentence somebody wrote. See js/traits.js. */
		{
			id: "scouting traits", voices: ["beat", "columnist", "local", "wire"],
			need: (f) => f.player && f.player.traits && f.player.traits.length >= 2,
			build: (f, rng) => {
				const t = f.player.traits;
				const two = rng.random() < 0.5 ? [t[0], t[1]] : [t[1], t[0]];
				return [T("What the scouts write about "),
					PL(f.player.name, f.player.key),
					T(": " + two[0].note + ", and " + two[1].note + ".")];
			},
		},
		{
			id: "trait adjective", voices: ["columnist", "social", "local"],
			need: (f) => f.player && f.player.traits && f.player.traits.length,
			build: (f, rng) => {
				const adj = global.Traits.adjective(f.player.traits);
				return [T(rng.pick([
					"He is the most " + adj + " player in his conference and it is " +
						"not an argument anybody is having.",
					"Every report on him opens with the same word: " + adj + ".",
					"Scouts have written " + adj + " on the same page of the same " +
						"notebook eleven times this season.",
				]))];
			},
		},
		{
			id: "biography", voices: ["beat", "local"],
			need: (f) => f.player && (f.player.transfer || f.player.redshirt ||
				f.player.reclassified),
			build: (f) => {
				const bits = [];
				if (f.player.transfer) {
					bits.push(f.player.transfer.from
						? "arrived from " + f.player.transfer.from + " as a " +
							f.player.transfer.kind
						: "is a " + f.player.transfer.kind);
				}
				/* "an academic redshirt" and "a medical redshirt" are both
				   kinds this can be handed, so the article is the shared
				   rule's rather than a letter typed in front of it. */
				if (f.player.redshirt) {
					bits.push("took " +
						global.Text.withArticle(f.player.redshirt + " year"));
				}
				if (f.player.reclassified) bits.push(f.player.reclassified);
				return [PL(f.player.name, f.player.key),
					T(" " + bits.join(", ") + ". He is " +
						global.Text.withArticle(String(f.player.classYear || "college player")) +
						".")];
			},
		},
	];

	/* The facts an article is about, read back out of the article itself.

	   Every article already carries PL(name, key) and TM(name) segments,
	   because those are what the view turns into links. So rather than making
	   all fifty-six existing article sites pass a facts object — an edit at
	   every one of them, and an omission at whichever one somebody forgets —
	   the decoration reads the first player and the first team the article
	   names and looks them up. */
	function firstSeg(article, type) {
		for (const list of [article.headline, article.body]) {
			for (const seg of list || []) if (seg && seg.t === type) return seg;
		}
		return null;
	}
	function factsOf(article, ctx) {
		const ps = firstSeg(article, "player");
		const ts = firstSeg(article, "team");
		const player = ps && ps.key ? ctx.byKey[ps.key] : null;
		let team = ts ? ctx.teams[ts.v] : null;
		if (!team && player && ctx.teams[player.newCollege]) team = ctx.teams[player.newCollege];
		return {
			player, team,
			kind: article.kind,
			injury: /injur/i.test(article.kind),
			underdog: /cinderella|upset|bid stealer|snub|sleeper|mid-major/i.test(article.kind) ||
				(team && team.ncaaSeed >= 10),
			won: /champion|title hero|wins|classic/i.test(article.kind) ? true : undefined,
		};
	}

	/* One article, given a voice, a possible extra paragraph and a possible
	   quote. Returns the article. */
	function decorate(article, ctx, rng) {
		const voice = rng.pick(ctx.staff);
		article.voice = voice.name;
		article.byline = voice.byline;
		const f = factsOf(article, ctx);
		article.paras = [];
		if (rng.random() < voice.para) {
			const options = PARAGRAPHS.filter((pp) =>
				pp.voices.indexOf(voice.name) !== -1 && pp.need(f));
			/* Never the same paragraph an article already used, and never two
			   in one article that say the same thing — the pool is keyed by
			   id and one draw is enough for a second paragraph. */
			if (options.length) {
				const pick = rng.pick(options);
				article.paras.push(pick.build(f, rng));
			}
		}
		if (rng.random() < voice.quote) {
			const q = quoteFor(rng, f);
			if (q) article.paras.push(q);
		}
		return article;
	}

	/* Headline variants per season-event kind. Several variants per kind is
	   what stops twenty-five classes reading like one class re-run. */
	const EVENT_HEADS = {
		"upset": [
			"{winner} stuns {loser}",
			"{loser} falls to {winner} in the shock of the season",
			"The bracket busters arrived early: {winner} over {loser}",
		],
		"game of the year": [
			"An instant classic between {winner} and {loser}",
			"{winner} outlasts {loser} in the game of the year",
			"One for the ages: {winner} edges {loser}",
		],
		"coaching change": [
			"The seat finally gave way",
			"A {month} divorce on the sideline",
			"Coaching carousel spins early",
		],
		"blowout": [
			"No mercy: {winner} demolishes {loser}",
			"{winner} runs {loser} out of the gym",
		],
		"streak": [
			"The streak nobody saw coming",
			"They simply will not lose",
		],
		"collapse": [
			"The wheels have come off",
			"From ranked to reeling",
			"Nothing is working any more",
			"A season coming apart in public",
		],
		/* The color kinds used to fall through to GENERIC_HEADS, so every
		   postponement, every viral clip and every bench-clearing shared the
		   same three "Around the country" headlines with each other and with
		   any kind added later. */
		"postponement": [
			"Postponed",
			"{winner} will have to wait",
			"No basketball tonight at {loser}",
			"The weather wins one",
		],
		"viral": [
			"The clip everybody has seen",
			"{winner} is on every timeline this morning",
			"Forty seconds that got four million views",
			"You have already watched this",
		],
		"altercation": [
			"It got out of hand",
			"Benches clear at {winner}",
			"Four ejections and a long review",
			"That is not going to be popular with the league office",
		],
		"storm": [
			"A brutal week for {winner}",
			"Three ranked teams in eight days",
			"The hardest stretch on anybody's schedule",
			"{winner} survives the gauntlet",
		],
		"attendance": [
			"A full house at {winner}",
			"They queued overnight for {winner}",
			"{winner} plays in front of a record crowd",
			"The building has not been like that in years",
		],
		"officiating": [
			"Nobody is happy with how that ended",
			"The last call at {winner}",
			"{loser} wants an explanation",
			"Six minutes of review, and one very unpopular answer",
		],
	};

	const GENERIC_HEADS = [
		"Around the country",
		"Midweek notebook",
		"The week in college basketball",
	];

	/* Turn a plain sentence into segments with every mention of every named
	   team linked.

	   The old loop walked the team list once and took the FIRST occurrence of
	   each name, so "Duke beat Duke's own record" left the second Duke plain,
	   and — worse for the common case — a body that names the loser before the
	   winner linked whichever the loop reached first and then searched the
	   REMAINDER of the string for the other, missing it entirely when it
	   appeared earlier.

	   Scanning left to right and, at each position, taking the LONGEST team
	   name that matches there fixes both, and the longest-match rule is what
	   keeps "Miami" from being linked inside "Miami (OH)". */
	function linkTeams(text, names, teams) {
		const known = (names || []).filter((nm) => nm && String(nm).length)
			.slice().sort((a, b) => b.length - a.length);
		const segs = [];
		let buf = "";
		let i = 0;
		while (i < text.length) {
			let hit = null;
			for (const nm of known) {
				if (text.startsWith(nm, i)) { hit = nm; break; }
			}
			if (hit) {
				if (buf) { segs.push(T(buf)); buf = ""; }
				segs.push(teams && teams[hit] ? TM(hit) : T(hit));
				i += hit.length;
			} else {
				buf += text[i];
				i++;
			}
		}
		if (buf) segs.push(T(buf));
		if (!segs.length) segs.push(T(text));
		return segs;
	}

	function pushEvent(articles, rng, e, teams) {
		const heads = EVENT_HEADS[e.kind] || GENERIC_HEADS;
		const names = e.teams || [];
		const slots = {
			winner: names[0] && teams[names[0]] ? TM(names[0]) : T(names[0] || ""),
			loser: names[1] && teams[names[1]] ? TM(names[1]) : T(names[1] || ""),
			// The month the event actually happened in, so a headline that
			// names one agrees with the dateline under it.
			month: T(dateline(e.when === undefined ? 0.5 : e.when)),
		};
		const bodySegs = linkTeams(e.text + ".", names, teams);
		// A body that opens with generated text opens a sentence.
		if (bodySegs[0].t === "text") bodySegs[0].v = global.Text.capitalize(bodySegs[0].v);
		articles.push({
			when: e.when === undefined ? 0.5 : e.when,
			kind: e.kind,
			headline: fill(rng.pick(heads), slots),
			body: bodySegs,
		});
	}

	const SURPRISE_HEADS = [
		"The story writes itself: {player}",
		"Scouts keep circling back to {player}",
		"Every class has one: {player}",
		"The name on everybody's board notes: {player}",
		"Nobody has a clean read on {player}",
		"{player} is the argument in every war room",
		"The one they cannot agree on: {player}",
		"Four scouts, four answers on {player}",
		"{player} does not fit the file",
	];

	/* Keyed to what actually happened to him. Three headlines shared four
	   draft-day events a class, so "The pick that made the room gasp" ran 23
	   times over fifteen classes and sat above slides, rises and trades alike
	   — a headline that describes a surprise, printed over a man who tested
	   well in May. */
	const DRAFT_HEADS_BY_KIND = {
		fall: [
			"The green room got quiet for {player}",
			"{player} waited, and waited",
			"The slide nobody in the building wanted to watch: {player}",
			"Fourteen picks of silence for {player}",
			"{player} fell, and somebody got a bargain",
			"The longest night belonged to {player}",
		],
		rise: [
			"{player} tested his way into the first round",
			"The workout circuit made {player} a lot of money",
			"Nobody climbed like {player}",
			"{player} was not in this range a month ago",
			"Six weeks of gym work, and {player} goes early",
			"The pre-draft riser cashes in: {player}",
		],
		trade: [
			"Somebody wanted {player} badly enough to pay a first",
			"A trade up, and the board reads {player}",
			"They moved for {player} and did not blink",
			"The phone call that cost a first-rounder: {player}",
			"{player} was the target all along",
			"A war room jumped the queue for {player}",
		],
		reach: [
			"The pick that made the room gasp",
			"A reach on {player}, and they know it",
			"Nobody had {player} here",
			"{player} goes well before the board said",
			"They took {player} on the tools",
			"The boldest pick of the night: {player}",
		],
	};
	const DRAFT_HEADS = [
		"Draft day: {player} moves the board",
		"War rooms react to {player}",
		"The name called next is {player}",
		"{player}, and the room turns over",
	];

	const CONF_TOURNEY_HEADS = [
		"{champ} cut down the {conf} nets",
		"{champ} win the {conf} tournament",
		"March starts early for {champ}",
	];

	const CONF_TOURNEY_UPSET_HEADS = [
		"{champ} crash the {conf} tournament",
		"Nobody had {champ} winning the {conf}",
	];

	const NIT_HEADS = [
		"{champ} take the NIT",
		"{champ} win the consolation bracket that still means something",
	];

	const FINAL_FOUR_HEADS = [
		"The Final Four is set",
		"Four teams left standing",
	];

	const CINDERELLA_HEADS = [
		"{team}'s run has the whole bracket talking",
		"Nobody picked {team} to be here",
		"The Cinderella of this tournament: {team}",
	];

	const FIELD_HONOR_HEADS = [
		"{name} beats the class to the trophy",
		"The award the class didn't win: {name}",
		// Filled from the class year the body asserts, so the headline
		// never calls a junior a senior.
		"{year} spoils the party: {name}",
	];
	/* A trophy is won; a team is named to. "wins the Consensus First Team
	   All-American" treated a selection like a cup. */
	function honorPhrase(award) {
		if (/All-American|All-America|Team\b|All-Defensive|All-Freshman|All-Newcomer/.test(award)) {
			return "is named " + global.Text.withArticle(award);
		}
		// A title is worn, not won as a trophy: "is crowned NCAA National
		// Champion", "is a EuroLeague Cup Winner".
		if (/Champion$/.test(award)) return "is crowned " + award;
		if (/Cup Winner$/.test(award)) return "is " + global.Text.withArticle(award);
		if (/Runner-Up$/.test(award)) return "finishes as " + award;
		return "wins the " + award;
	}

	const RETURNING_STAR_HEADS = [
		"The best player in the country isn't in this class",
		"{name} doesn't need the draft to matter",
		"Scouting report on a player nobody can draft: {name}",
	];

	const FRESHMAN_HEADS = [
		"{player} named the country's top freshman",
		"{player} sweeps freshman honors",
	];

	const DPOY_HEADS = [
		"{player} locks down the Defensive Player of the Year award",
		"The country's best defender: {player}",
	];

	const ALL_AMERICA_HEADS = [
		"The All-America team is out",
		"Consensus first team revealed",
	];

	const SIGNING_HEADS = [
		"{player} signs with {college}",
		"The nation's top recruit picks {college}",
		"{college} lands the class's biggest name",
	];

	const TRANSFER_HEADS = [
		"{player} finds a new home at {college}",
		"Portal move: {player} to {college}",
	];

	const ANALYTICS_HEADS = [
		"The computers see {team} differently",
		"{team}: the poll and the metrics disagree",
	];

	const CLASS_FLAVOR_HEADS = [
		"Scouts agree: this is {label}",
		"The scouting consensus on this class: {label}",
	];

	const INJURY_HEADS = [
		"{player}'s injury changes the picture at {college}",
		"{college} deals with life without {player}",
		"The absence that hurt most: {player}",
	];

	const INJURY_RETURN_HEADS = [
		"{player} is back for {college}",
		"The wait is over at {college}: {player} returns",
		"{college} get their man back",
	];

	const EARLY_SIGNING_HEADS = [
		"The early signing period closes the book on the top of the class",
		"Signing day, part one: the blue-chippers put pen to paper",
		"The letters are in",
	];

	const DECOMMIT_HEADS = [
		"{player} flips again — this time it sticks at {college}",
		"The recruitment that would not end: {player} lands at {college}",
		"{college} win the tug-of-war for {player}",
	];

	const FIVE_STAR_HEADS = [
		"Another five-star off the board: {player} to {college}",
		"{player} ends his recruitment — it's {college}",
		"{college} add a five-star in {player}",
	];

	const TOP_CLASS_HEADS = [
		"{college} assembled the class of the cycle",
		"On paper, nobody recruited like {college}",
		"The haul at {college} has rivals grumbling",
	];

	const STAY_HEADS = [
		"{name} is coming back to {college}",
		"The biggest signing of the offseason: {name}, staying put",
		"{college} keep their star: {name} returns",
	];

	const GRAD_TRANSFER_HEADS = [
		"One year to give: {player} grad-transfers to {college}",
		"{player} spends his last season at {college}",
		"{college} land the graduate market's biggest name",
	];

	const HOMECOMING_HEADS = [
		"{player} comes home to {college}",
		"The portal brings {player} back to {college}",
	];

	const COACH_HIRE_HEADS = [
		"A new era at {college}",
		"{college} hand the whistle to {coach}",
		"The biggest bench hire of the offseason: {coach} to {college}",
	];

	const RANKED_CLASH_HEADS = [
		"No. {ws} {winner} take the top-25 showdown from No. {ls} {loser}",
		"Heavyweights: {winner} beat {loser} in the game the rankings promised",
		"{winner} settle the argument with {loser}",
	];

	const OT_CLASSIC_HEADS = [
		"{winner} outlast {loser} in {ot} overtimes",
		"An epic: {winner} and {loser} go to {ot}OT",
		"Nobody wanted it to end: {winner} beat {loser} in {ot}OT",
	];

	const LOSING_STREAK_HEADS = [
		"{team} cannot buy a win",
		"The bottom falls out at {team}",
		"{team}'s season is unravelling",
	];

	const SCORING_TITLE_HEADS = [
		"Nobody scores like {player}",
		"{player} runs away with the scoring title",
		"The nation's leading scorer: {player}",
	];

	const FORTY_HEADS = [
		"{player} drops {pts} on {opp}",
		"A {pts}-point night for {player}",
		"{player} couldn't miss: {pts} against {opp}",
	];

	const TRIPLE_DOUBLE_HEADS = [
		"{player} does everything",
		"The stat sheet belongs to {player}",
		"Another triple-double for {player}",
	];

	const CONF_RACE_TIGHT_HEADS = [
		"The {conf} race comes down to the wire",
		"{a} and {b} are trading punches for the {conf} title",
		"One game separates the top of the {conf}",
	];

	const CONF_RACE_CLINCH_HEADS = [
		"{a} run away with the {conf}",
		"The {conf} race is over — {a} made sure of it early",
	];

	const BID_STEALER_HEADS = [
		"{champ} steal a bid from the {conf}",
		"The bubble groans: {champ} crash the field",
		"A bid thief in the {conf}: {champ}",
	];

	const TOP_SEED_SCARE_HEADS = [
		"No. 1 {winner} survive {loser} by a whisker",
		"The scare of the first round: {winner} escape {loser}",
		"{winner} nearly made the wrong kind of history against {loser}",
	];

	const NATIONAL_SEMIS_HEADS = [
		"The championship game is set",
		"Semifinal Saturday delivers",
		"Two survive the Final Four",
	];

	const TITLE_HERO_HEADS = [
		"{player} carried {college} to the title",
		"The tournament belonged to {player}",
		"One shining player: {player}",
	];

	const NIT_SEMIS_HEADS = [
		"The NIT final is set",
		"Semifinal night in the NIT",
	];

	const SNUB_HEADS = [
		"The snub everyone is arguing about: {player}",
		"{player} did everything but win the argument",
		"No hardware for {player}, and nobody can explain why",
	];

	const CONF_POY_HEADS = [
		"{player} wins the {award}",
		"The {award} goes to {player}",
	];

	const MOCK_DRAFT_HEADS = [
		"Every mock now starts the same way: {player}",
		"The consensus No. 1: {player}",
		"The top of the draft has stopped moving — it's {player}",
	];

	const STOCK_RISER_HEADS = [
		"The workout circuit loves {player}",
		"{player} keeps climbing draft boards",
		"Nobody rose further than {player}",
	];

	const STOCK_FALLER_HEADS = [
		"What happened to {player}'s draft stock?",
		"{player} is sliding, and the war rooms have noticed",
	];

	const SLEEPER_HEADS = [
		"The second round's worst-kept secret: {player}",
		"Late riser: {player} is sneaking up draft boards",
		"Somebody is getting a steal in {player}",
	];

	/* One line of numbers a story can carry: the scoring average and the one
	   other thing his line is about.

	   Four branches and a fallback is not enough shapes. A player who is not a
	   7-rebound big, a 4.5-assist guard or a shot-blocker fell through to the
	   true-shooting sentence — 162 of 1,050 scouting notes across fifteen
	   classes opened with the identical sentence, because the opener is built
	   on this. The branches below are the other things a college line is
	   actually about, in the order of how much they distinguish him: the
	   offensive glass, a real three-point season, a guard who does not turn it
	   over, a man who lives at the line, thirty-six minutes a night, and the
	   low-usage finisher whose case IS his efficiency. */
	function statBlurb(s) {
		const n1 = (x) => x.toFixed(1);
		const pct = (x) => (x * 100).toFixed(1) + "%";
		const pts = n1(s.ppg) + " points";
		const pair = (x) => pts + " and " + x + " a game";
		if (s.rpg >= 7 && s.bpg >= 1.2) {
			return pts + ", " + n1(s.rpg) + " rebounds and " + n1(s.bpg) +
				" blocks a game";
		}
		if (s.rpg >= 7 && s.orpg >= 2.6) {
			return pts + " and " + n1(s.rpg) + " rebounds a game, " + n1(s.orpg) +
				" of them offensive";
		}
		if (s.rpg >= 7) return pair(n1(s.rpg) + " rebounds");
		if (s.apg >= 6) {
			return pts + " a game while running the offense, at " + n1(s.apg) +
				" assists a night";
		}
		if (s.apg >= 4.5) return pair(n1(s.apg) + " assists");
		if (s.bpg >= 1.8) return pair(n1(s.bpg) + " blocks");
		if (s.spg >= 1.8) return pair(n1(s.spg) + " steals");
		if (s.orpg >= 2.0) return pair(n1(s.orpg) + " offensive rebounds");
		if (s.tpp >= 0.375 && s.tpa >= 3.5) {
			return pts + " a game on " + pct(s.tpp) + " from three, on " +
				n1(s.tpa) + " attempts";
		}
		if (s.apg >= 2.5 && s.topg <= 1.5) {
			return pts + " a game with " + n1(s.apg) + " assists against " +
				n1(s.topg) + " turnovers";
		}
		if (s.fta >= 5) {
			return pts + " a game on " + n1(s.fta) + " free-throw attempts a night";
		}
		if (s.mpg >= 33) {
			return pts + " a game in " + n1(s.mpg) + " minutes, which is nearly all of them";
		}
		if (s.usg <= 0.20 && s.ts >= 0.56) {
			return pts + " a game on " + pct(s.usg) + " usage and " + pct(s.ts) +
				" true shooting";
		}
		if (s.rpg >= 4 && s.apg >= 2) {
			return pts + " a game with " + n1(s.rpg) + " rebounds and " +
				n1(s.apg) + " assists";
		}
		if (s.usg >= 0.26) {
			return pts + " a game on " + pct(s.usg) + " of his team's possessions";
		}
		if (s.fga >= 10) {
			return pts + " a game on " + n1(s.fga) + " shots";
		}
		if (Number.isFinite(s.ts)) {
			return pts + " a game on " + pct(s.ts) + " true shooting";
		}
		return pts + " a game";
	}

	/* ============================================================== TEMPLATES

	   THE KINDS THAT ARE A TABLE.

	   The fifty-six kinds above are code: each one reaches into the result,
	   works out whether it has a story, and pushes an article. That is the
	   right shape for a kind whose FACTS are hard to find — the selection
	   show, the bracket, the awards — and the wrong shape for a kind whose
	   facts are one filter and a sort, which most kinds are. Writing the
	   next fifty that way would be fifteen hundred lines of near-identical
	   plumbing, and every one of them a place to forget a variant.

	   So a kind is a row: what it needs (`find`), what it fills in (`slots`),
	   and three or more of each of `headlines` and `bodies`. tools/test.js
	   asserts the three-and-three, that no two kinds share a body string, and
	   sweeps every rendered article for text faults — so a row added later is
	   held to the same standard without anybody remembering to check.

	   `find` returns the facts, an array of facts for a kind that can fire
	   more than once, or null for "no story this year". Returning null is the
	   normal case and is not a failure: a season does not have a 16-over-1 in
	   it, and a paper that runs one anyway is the machine showing.

	   Every fact here is read off results the simulation already produced.
	   Nothing in this table can contradict a box score, which is the same
	   contract the hand-written kinds keep. */

	const TEMPLATES = [];
	const TPL = (row) => { TEMPLATES.push(row); return row; };

	/* Small helpers the rows share. Each one is a query over the finished
	   season, and each is deliberately total: they return null rather than
	   throwing when a season does not contain what they look for. */
	function bestBy(list, score) {
		let best = null;
		let bestScore = -Infinity;
		for (const x of list || []) {
			const v = score(x);
			if (Number.isFinite(v) && v > bestScore) { bestScore = v; best = x; }
		}
		return best;
	}
	function gamesOf(team) { return (team && team.log) || []; }
	function scoreText(g) {
		return g.pf + "-" + g.pa + (g.ot ? (g.ot > 1 ? " (" + g.ot + "OT)" : " (OT)") : "");
	}
	/* A prospect's own game log entries, which carry both his line and the
	   game's result — the two facts most of these stories are made of. */
	function logGames(p) { return (p && p.gameLog && p.gameLog.games) || []; }

	/* The coaching-philosophy labels are model keys, not prose: "neutral" is
	   the do-nothing archetype and it was printing as "He is a neutral coach",
	   which is a leaked internal name and not a sentence about anybody. The
	   ones that read fine keep their own words; the article in front of them
	   goes through Text so "a old-school disciplinarian" cannot happen. */
	const PHILOSOPHY_WORDS = {
		"player-developer": "player-development",
		"Xs-and-Os tactician": "tactically-minded",
		"recruiter-first": "recruiting-first",
		"defensive-minded": "defensive-minded",
		"uptempo innovator": "uptempo",
		"old-school disciplinarian": "old-school",
		"stars-and-scrubs": "stars-and-scrubs",
		"egalitarian": "egalitarian",
		"analytics-driven": "analytics-driven",
		// "neutral" is deliberately absent: there is nothing to say.
	};
	function philosophyPhrase(coach, noun) {
		const word = coach && PHILOSOPHY_WORDS[coach.philosophy];
		if (!word) return null;
		return global.Text.withArticle(word + " " + (noun || "coach"));
	}

	// ---------------------------------------------------------------- offseason

	TPL({
		kind: "portal commitment", group: "offseason", p: 0.75, when: -0.46,
		find: (ctx) => {
			const cand = ctx.ncaa.filter((p) => p.transfer && p.transfer.from &&
				!p.transfer.fifthYear);
			if (!cand.length) return null;
			return ctx.rng.pick(cand.sort((a, b) => (a.boardRank || 999) - (b.boardRank || 999))
				.slice(0, 6));
		},
		slots: (p, ctx) => ({
			player: PL(p.name, p.key), to: TM(p.newCollege), from: T(p.transfer.from),
			kind: T(p.transfer.kind),
			dir: T(p.transfer.direction === "up" ? "a step up"
				: p.transfer.direction === "down" ? "a step down" : "a lateral move"),
		}),
		headlines: [
			"{player} commits to {to} out of the portal",
			"{to} lands {player}",
			"Portal: {player} leaves {from} for {to}",
			"{player} picks {to}",
		],
		bodies: [
			"{player} is on his way to {to} from {from} — {dir}, and the kind of addition that changes a rotation rather than filling one out.",
			"The portal's biggest name of the week is off the board: {player} has committed to {to}. He arrives from {from} as a {kind}.",
			"{to} has landed {player}, who spent last season at {from}. Everything about the fit says he plays immediately.",
			"{player} to {to}. {from} loses a rotation player and a name; the coaching staff that recruited him has known for a fortnight.",
		],
	});

	TPL({
		kind: "grad transfer landing", group: "offseason", p: 0.7, when: -0.42,
		find: (ctx) => {
			const cand = ctx.ncaa.filter((p) => p.transfer && p.transfer.fifthYear &&
				p.transfer.from);
			return cand.length ? ctx.rng.pick(cand) : null;
		},
		slots: (p) => ({
			player: PL(p.name, p.key), to: TM(p.newCollege), from: T(p.transfer.from),
		}),
		headlines: [
			"{player} takes his last year to {to}",
			"Graduate transfer {player} lands at {to}",
			"{to} adds a fifth-year in {player}",
			"One year, one shot: {player} chooses {to}",
		],
		bodies: [
			"{player} graduated at {from} and will spend his last season of eligibility at {to}. Nobody in this transaction is pretending it is about anything but March.",
			"A fifth-year with a diploma and one year left is the most efficient addition in the sport, and {to} has just made it: {player} arrives from {from}.",
			"{to} has {player} for one season. He has played more college basketball than anyone else on the roster and it will show in the first week of practice.",
			"The graduate market closed for {to} with {player}, out of {from}. He does not need to be taught anything; he needs to be given the ball.",
		],
	});

	TPL({
		kind: "coaching staff hire", group: "offseason", p: 0.6, when: -0.5,
		find: (ctx) => {
			const cand = ctx.teamList.filter((t) => t.coach && t.coach.tenure === 1 &&
				t.prestige >= 45);
			return cand.length ? ctx.rng.pick(cand) : null;
		},
		slots: (t) => ({
			team: TM(t.name), coach: T(t.coach.name), conf: T(t.conf),
			philosophy: T(philosophyPhrase(t.coach) || "a hands-on coach"),
			style: T(t.coach.style && t.coach.style.name ? t.coach.style.name : "two-way"),
		}),
		headlines: [
			"{team} completes its staff under {coach}",
			"A first-year staff takes shape at {team}",
			"{coach} finishes his hires at {team}",
			"New voices in the {conf}: {team}'s staff is set",
		],
		bodies: [
			"{coach} has filled out his first staff at {team}. He is {philosophy} and the practice plan will look like one inside a fortnight.",
			"The last assistant is hired and {team} can get to work. {coach} inherits a roster he did not recruit and a system, {style}, that he did.",
			"{team} spent six weeks on the search and three days on the staff. {coach} takes over in the {conf} with the people he wanted.",
			"There is a version of a first year that is all installation and no results, and {coach} has said out loud that {team} will not be having one.",
		],
	});

	TPL({
		kind: "schedule release", group: "offseason", p: 0.55, when: -0.34,
		find: (ctx) => {
			const t = ctx.ranked[0] && ctx.teams[ctx.ranked[0]];
			if (!t) return null;
			const nonConf = gamesOf(t).filter((g) => !g.conference && g.stage === "reg");
			if (nonConf.length < 3) return null;
			return { t, opps: nonConf.slice(0, 3).map((g) => g.opp) };
		},
		slots: (f) => ({
			team: TM(f.t.name), a: TM(f.opps[0]), b: TM(f.opps[1]), c: TM(f.opps[2]),
			conf: T(f.t.conf),
		}),
		headlines: [
			"{team}'s non-conference schedule is out",
			"{team} will play {a}, {b} and {c} before Christmas",
			"No easy start for {team}",
			"The schedule drops: {team} loads up",
		],
		bodies: [
			"{team} opens against {a}, then {b} and {c}. Nobody schedules like that unless they think they are good.",
			"The non-conference is public: {a}, {b}, {c}. Three games that will be worth something to a committee in March, whichever way they go.",
			"{team} could have played nobody until the {conf} season. Instead: {a}, {b} and {c}.",
			"Three real games before the league starts — {a}, {b}, {c} — and a schedule that will be either a résumé or an alibi by February.",
		],
	});

	TPL({
		kind: "preseason all-conference", group: "preseason", p: 0.7, when: -0.26,
		find: (ctx) => {
			const byConf = {};
			for (const p of ctx.ncaa) {
				if (!p.conf) continue;
				(byConf[p.conf] = byConf[p.conf] || []).push(p);
			}
			const confs = Object.keys(byConf).filter((c) => byConf[c].length >= 3);
			if (!confs.length) return null;
			const conf = ctx.rng.pick(confs);
			const five = byConf[conf].slice()
				.sort((a, b) => (b.newOvr + b.newPot) - (a.newOvr + a.newPot)).slice(0, 3);
			return { conf, five };
		},
		slots: (f) => ({
			conf: T(f.conf),
			a: PL(f.five[0].name, f.five[0].key),
			b: PL(f.five[1].name, f.five[1].key),
			c: PL(f.five[2].name, f.five[2].key),
			school: TM(f.five[0].newCollege),
		}),
		headlines: [
			"The preseason all-{conf} team is out",
			"{conf} coaches put {a} on the first team",
			"Preseason {conf}: {a}, {b}, {c}",
			"{conf} media day names its five",
		],
		bodies: [
			"The preseason all-{conf} first team: {a}, {b} and {c} lead it. Three of them will be in an NBA gym by June and the league knows it.",
			"{conf} coaches voted, and {a} of {school} was the only unanimous name. {b} and {c} joined him on the first team.",
			"A preseason team is a list of the players everybody has already seen. The {conf}'s is {a}, {b} and {c}, and it is not a controversial list.",
			"Media day in the {conf} produced the usual five names — {a}, {b}, {c} among them — and the usual promise that the vote means nothing in March.",
		],
	});

	TPL({
		kind: "preseason player of the year", group: "preseason", p: 0.65, when: -0.24,
		find: (ctx) => {
			const p = ctx.ncaa.filter((x) => Number.isFinite(x.preseasonRank))
				.sort((a, b) => a.preseasonRank - b.preseasonRank)[0];
			return p || null;
		},
		slots: (p, ctx) => ({
			player: PL(p.name, p.key), team: TM(p.newCollege), conf: T(p.conf || "his league"),
			year: T(String(p.classYear || "returner").toLowerCase()),
			rank: T(String(p.preseasonRank)),
		}),
		headlines: [
			"{player} is the preseason pick for player of the year",
			"Everybody's preseason ballot has {player} on it",
			"The season starts with {player} on top",
			"{team}'s {player} opens as the favourite",
		],
		bodies: [
			"{player} is the preseason player of the year on most ballots, which is a fact about last season as much as this one. He is a {year} at {team}.",
			"The vote was not close. {player} of {team} enters the season as the {conf}'s and the country's presumptive best player, and No. {rank} on the preseason draft boards.",
			"Preseason awards are predictions, and this one is safe: {player} returns to {team} as the most productive player in the sport.",
			"A season needs a favourite and this one has {player}. What he does with the label is a different question, and one the {conf} will be asking by January.",
		],
	});

	TPL({
		kind: "jersey retirement", group: "preseason", p: 0.4, when: -0.06,
		find: (ctx) => {
			const cand = ctx.teamList.filter((t) => t.prestige >= 68);
			return cand.length ? ctx.rng.pick(cand) : null;
		},
		slots: (t, ctx) => ({
			team: TM(t.name), conf: T(t.conf),
			era: T(String((ctx.season || 2026) - ctx.rng.int(12, 34))),
		}),
		headlines: [
			"{team} will raise a jersey at the opener",
			"A number goes up at {team}",
			"{team} honours a {era} team at halftime",
			"The rafters get busier at {team}",
		],
		bodies: [
			"{team} will retire a number before the opener. The man it belongs to last played here in {era} and has not missed a home game since.",
			"There is a ceremony at halftime of the opener at {team}, and a {era} roster in the front row for it. The current team will watch from the bench, which is the point of doing it then.",
			"{team} is raising a jersey into the rafters. The {conf} has spent thirty years trying to produce another one like him.",
			"A programme's history is a thing it does on purpose, and {team} is doing it on opening night: one number, one banner, one very long ovation.",
		],
	});

	// ------------------------------------------------------------ regular season

	TPL({
		kind: "buzzer beater", group: "regular season", p: 0.7,
		when: (f) => f.g.when,
		find: (ctx) => {
			const out = [];
			for (const p of ctx.ncaa) {
				for (const g of logGames(p)) {
					if (g.stage !== "reg" || !g.won || g.ot) continue;
					if (g.pf - g.pa > 2 || g.pts < 14) continue;
					out.push({ p, g });
				}
			}
			return out.length ? ctx.rng.pick(out) : null;
		},
		slots: (f) => ({
			player: PL(f.p.name, f.p.key), team: TM(f.p.newCollege), opp: TM(f.g.opp),
			score: T(scoreText(f.g)), pts: T(String(f.g.pts)),
			margin: T(String(f.g.pf - f.g.pa)),
		}),
		headlines: [
			"{player} wins it at the horn",
			"{team} survives {opp} by {margin}",
			"One possession, and {team} had the last one",
			"{player}'s {pts} carry {team} past {opp}",
		],
		bodies: [
			"{team} beat {opp} {score} on a possession that started with nine seconds left. {player} finished with {pts}.",
			"There were two ways that game ended and {team} got the better one. {player} scored {pts} in the {score} win over {opp}.",
			"{opp} had the ball, the lead and the clock, and lost all three inside a minute. {team} wins {score}; {player} had {pts}.",
			"A game of one possession, decided by one shot. {team} {score} over {opp}, with {pts} from {player}.",
		],
	});

	TPL({
		kind: "double overtime", group: "regular season", p: 0.6,
		when: (f) => f.g.when,
		find: (ctx) => {
			const out = [];
			for (const t of ctx.teamList) {
				for (const g of gamesOf(t)) {
					if (g.stage === "reg" && g.ot >= 2 && g.won) out.push({ t, g });
				}
			}
			return out.length ? ctx.rng.pick(out) : null;
		},
		slots: (f) => ({
			team: TM(f.t.name), opp: TM(f.g.opp), score: T(scoreText(f.g)),
			ot: T(String(f.g.ot)),
		}),
		headlines: [
			"{ot} overtimes, and {team} outlasts {opp}",
			"{team} and {opp} needed {ot} extra periods",
			"Nobody wanted to leave: {team} {score}",
			"A marathon at {team}",
		],
		bodies: [
			/* The score text already carries "(3OT)", so "beat {opp} {score}
			   after {ot} overtimes" said it twice in the same clause. */
			"{team} beat {opp} {score}. Six players fouled out between them and neither bench had anything left.",
			"{ot} extra periods, and {team} finally put {opp} away {score}. The last twenty minutes of it were played by whoever was still standing.",
			"There is a kind of game where the basketball gets worse and the theatre gets better. {team} and {opp} played one; the final was {score}.",
			"{score}. {opp} led in each of the extra periods and {team} won anyway.",
		],
	});

	TPL({
		kind: "first twenty", group: "regular season", p: 0.7,
		when: (f) => f.g.when,
		find: (ctx) => {
			const out = [];
			for (const p of ctx.ncaa) {
				if (!p.isFreshman) continue;
				const gs = logGames(p);
				const i = gs.findIndex((g) => g.pts >= 20);
				if (i >= 0 && i <= 12) out.push({ p, g: gs[i], n: i + 1 });
			}
			return out.length ? ctx.rng.pick(out) : null;
		},
		slots: (f) => ({
			player: PL(f.p.name, f.p.key), team: TM(f.p.newCollege), opp: TM(f.g.opp),
			pts: T(String(f.g.pts)), n: T(String(f.n)), nth: T(global.Text.ordinal(f.n)),
			games: T(global.Text.plural(f.n, "game")), score: T(scoreText(f.g)),
		}),
		headlines: [
			"{player}'s first twenty",
			"The freshman arrives: {pts} for {player}",
			"{player} scores {pts} in game {n}",
			"{team}'s freshman finds the floor",
		],
		bodies: [
			"{player} scored {pts} against {opp}, his first twenty-point game in college and his {nth} game in it. {team} won by the margin he provided.",
			"It took {games}. {player} put {pts} on {opp} and looked, for the first time, like the player the recruiting rankings said he was.",
			"There is a night in every freshman season where the speed of it stops being a problem. {player} had his against {opp}: {pts} points, {score}.",
			"{team} has been waiting for this since November. {player}, {pts} points, and a shot chart that finally looks like a plan.",
		],
	});

	TPL({
		kind: "double-double streak", group: "regular season", p: 0.6, when: 0.62,
		find: (ctx) => {
			const p = bestBy(ctx.ncaa, (x) => (x.gameLog && x.gameLog.doubleDoubles) || 0);
			return p && p.gameLog && p.gameLog.doubleDoubles >= 8 ? p : null;
		},
		slots: (p) => ({
			player: PL(p.name, p.key), team: TM(p.newCollege),
			n: T(String(p.gameLog.doubleDoubles)),
			rpg: T(p.stats.rpg.toFixed(1)), ppg: T(p.stats.ppg.toFixed(1)),
		}),
		headlines: [
			"{player} has {n} double-doubles",
			"The most reliable line in the country belongs to {player}",
			"{n} and counting for {team}'s {player}",
			"{player} keeps filling both columns",
		],
		bodies: [
			"{player} has {n} double-doubles for {team}. He is averaging {ppg} points and {rpg} rebounds and has not had a quiet night since December.",
			"There are more spectacular players in the country and there is nobody more certain: {n} double-doubles, {ppg} and {rpg} a night for {team}.",
			"{team} knows what it is getting from {player} every time out — {ppg} points, {rpg} rebounds, and {n} double-doubles in the book.",
			"A double-double is a threshold, not a performance, and {player} has cleared it {n} times. The rest of his line is the story: {ppg} and {rpg}.",
		],
	});

	TPL({
		kind: "twenty rebounds", group: "regular season", p: 0.55,
		when: 0.48,
		find: (ctx) => {
			const p = bestBy(ctx.ncaa, (x) => (x.gameLog && x.gameLog.highs
				? x.gameLog.highs.reb : 0));
			return p && p.gameLog.highs.reb >= 17 ? p : null;
		},
		slots: (p) => {
			const g = logGames(p).filter((x) => x.reb === p.gameLog.highs.reb)[0] || {};
			return {
				player: PL(p.name, p.key), team: TM(p.newCollege),
				opp: g.opp ? TM(g.opp) : T("a conference opponent"),
				reb: T(String(p.gameLog.highs.reb)), pts: T(String(g.pts || 0)),
			};
		},
		headlines: [
			"{player} pulls down {reb}",
			"{reb} rebounds for {team}'s {player}",
			"Nobody else touched the glass: {player}",
			"{player} owns the boards against {opp}",
		],
		bodies: [
			"{player} had {reb} rebounds against {opp}, which is a number that has stopped appearing in this sport. He added {pts} points.",
			"{team} was out-shot and out-rebounded by one man. {player}: {reb} boards, {pts} points, and a second-chance count that decided it.",
			"There were {reb} rebounds for {player} against {opp}. Several of them were over two people.",
			"{reb} in one night. {player} spent the second half in a part of the floor {opp} had apparently agreed to concede.",
		],
	});

	TPL({
		kind: "assist night", group: "regular season", p: 0.55, when: 0.42,
		find: (ctx) => {
			const p = bestBy(ctx.ncaa, (x) => (x.gameLog && x.gameLog.highs
				? x.gameLog.highs.ast : 0));
			return p && p.gameLog.highs.ast >= 11 ? p : null;
		},
		slots: (p) => {
			const g = logGames(p).filter((x) => x.ast === p.gameLog.highs.ast)[0] || {};
			return {
				player: PL(p.name, p.key), team: TM(p.newCollege),
				opp: g.opp ? TM(g.opp) : T("a league opponent"),
				ast: T(String(p.gameLog.highs.ast)),
				// "1 turnovers", "turned it over 1 times".
				tov: T(global.Text.plural(g.tov || 0, "turnover")),
				times: T((g.tov || 0) === 1 ? "once" : (g.tov || 0) + " times"),
				giveaways: T(global.Text.plural(g.tov || 0, "giveaway")),
			};
		},
		headlines: [
			"{ast} assists for {player}",
			"{player} runs {team} to a rout of {opp}",
			"The passing night of the season belongs to {player}",
			"{player}: {ast} assists, {tov}",
		],
		bodies: [
			"{player} had {ast} assists against {opp} and turned it over {times}. {team}'s offence has looked like his idea for a month.",
			"{ast} assists is a season for some point guards. {player} had them in one night against {opp}.",
			"There is a way to score twenty and a way to create thirty, and {player} did the second one: {ast} assists, {giveaways}, {team} in cruise control.",
			"{team} shot the ball well because {player} decided when they would. {ast} assists against {opp}, most of them at the rim.",
		],
	});

	TPL({
		kind: "foul trouble", group: "regular season", p: 0.5, when: 0.55,
		find: (ctx) => {
			const p = bestBy(ctx.ncaa, (x) => (x.gameLog && x.gameLog.foulOuts) || 0);
			return p && p.gameLog.foulOuts >= 3 ? p : null;
		},
		slots: (p) => ({
			player: PL(p.name, p.key), team: TM(p.newCollege),
			n: T(String(p.gameLog.foulOuts)), pf: T(p.stats.pfpg.toFixed(1)),
			mpg: T(p.stats.mpg.toFixed(1)),
		}),
		headlines: [
			"{player} cannot stay on the floor",
			"{n} foul-outs and counting for {player}",
			"{team}'s best player keeps sitting down",
			"The foul problem at {team}",
		],
		bodies: [
			"{player} has fouled out {n} times and averages {pf} personals in {mpg} minutes. {team} is a different team in the eight minutes he spends on the bench.",
			"There is a version of {player} who plays thirty-four minutes and a version who plays {mpg}, and the difference is entirely the whistle: {n} foul-outs already.",
			"{n} disqualifications. {team}'s staff has tried a different starting matchup, a different help scheme and a conversation, and {player} still averages {pf} fouls.",
			"Nothing about {player}'s game needs fixing except the {pf} fouls, which have taken him out of {n} games entirely.",
		],
	});

	TPL({
		kind: "rivalry", group: "regular season", p: 0.65,
		when: (f) => f.g.when,
		find: (ctx) => {
			const out = [];
			for (const t of ctx.teamList) {
				if (!t.apRank) continue;
				for (const g of gamesOf(t)) {
					if (g.stage !== "reg" || !g.conference) continue;
					const opp = ctx.teams[g.opp];
					if (!opp || !opp.apRank) continue;
					if (Math.abs(g.pf - g.pa) <= 6 && g.won) out.push({ t, opp, g });
				}
			}
			return out.length ? ctx.rng.pick(out) : null;
		},
		slots: (f) => ({
			team: TM(f.t.name), opp: TM(f.opp.name), score: T(scoreText(f.g)),
			conf: T(f.t.conf), rank: T("No. " + f.t.apRank), oppRank: T("No. " + f.opp.apRank),
		}),
		headlines: [
			"{team} takes the rivalry game from {opp}",
			"{rank} {team} beats {oppRank} {opp}",
			"The {conf}'s best night: {team} {score}",
			"Nothing between them: {team} edges {opp}",
		],
		bodies: [
			"{rank} {team} beat {oppRank} {opp} {score} in a building that had been sold out since October.",
			"Two ranked teams, one league, and a six-point game: {team} {score} over {opp}. The {conf} race is now a matter of tiebreakers.",
			"They will play again, and everybody in the building already knows it. {team} took the first one {score} from {opp}.",
			"{team} and {opp} played the game the {conf} schedule was built around, and {team} won it {score}.",
		],
	});

	TPL({
		kind: "coach milestone", group: "regular season", p: 0.45, when: 0.5,
		find: (ctx) => {
			const cand = ctx.teamList.filter((t) => t.coach && (t.coach.tenure || 0) >= 14 &&
				t.w >= 18);
			return cand.length ? ctx.rng.pick(cand) : null;
		},
		slots: (t) => ({
			team: TM(t.name), coach: T(t.coach.name),
			years: T(String(t.coach.tenure)), w: T(String(t.w)), l: T(String(t.l)),
			conf: T(t.conf),
		}),
		headlines: [
			"{coach} reaches a milestone at {team}",
			"{years} years, and {coach} is not slowing down",
			"{team} celebrates its coach",
			"A number for {coach}",
		],
		bodies: [
			"{coach} has been at {team} for {years} seasons and this one is {w}-{l}. The milestone was marked with a handshake and a timeout he did not want.",
			"There are three coaches in the {conf} who have been anywhere {years} years. {coach} is one of them, and {team} is {w}-{l}.",
			"{years} seasons in one place is a career now rather than a tenure. {coach} passed a round number at {team} this week and spent the postgame talking about the players.",
			"{team} stopped the game to honour {coach}, who looked as though he would rather have been substituting.",
		],
	});

	TPL({
		kind: "first ranked win", group: "regular season", p: 0.6,
		when: (f) => f.g.when,
		find: (ctx) => {
			const out = [];
			for (const t of ctx.teamList) {
				if (t.prestige >= 55) continue;
				for (const g of gamesOf(t)) {
					if (g.stage !== "reg" || !g.won) continue;
					const opp = ctx.teams[g.opp];
					if (opp && opp.apRank && opp.apRank <= 20) out.push({ t, opp, g });
				}
			}
			return out.length ? ctx.rng.pick(out) : null;
		},
		slots: (f) => ({
			team: TM(f.t.name), opp: TM(f.opp.name), score: T(scoreText(f.g)),
			rank: T("No. " + f.opp.apRank), conf: T(f.t.conf),
			confArticle: T(global.Text.withArticle(f.t.conf, true)),
		}),
		headlines: [
			/* The tool simulates ONE season. It has no record of the last
			   time this programme beat a ranked team, how many it had lost in
			   a row, or when it was last in the second weekend — so the
			   templates that asserted those invented them. What the model
			   does know is the prestige gap it selected on, and that is what
			   these say now. */
			"{team} beats a ranked team it had no business beating",
			"{team} {score} over {rank} {opp}",
			"The court came down at {team}",
			"{rank} {opp} goes down at {team}",
		],
		bodies: [
			"{team} beat {rank} {opp} {score}, and the students were on the floor before the horn finished.",
			"{confArticle} programme with no business winning that game won it {score}. {rank} {opp} shot it badly and {team} did not care why.",
			"{team} does not beat ranked teams. It beat this one: {score} over {rank} {opp}.",
			"They will replay the last ninety seconds at {team} for a decade. {score}, over {rank} {opp}, on a Tuesday.",
		],
	});

	TPL({
		kind: "road struggles", group: "regular season", p: 0.85, when: 0.66,
		find: (ctx) => {
			/* A winning team that cannot win away from home. The bar was ten
			   wins and six road losses, which was ordinary while the schedule
			   handed the better program the home game every time and a team
			   could play twenty-seven of them; once home dates were balanced
			   that combination turned up in two seasons of twelve, and a kind
			   that rare is one nobody ever reads. Nine and five is the same
			   story on a schedule that is now half away. */
			const cand = ctx.teamList.filter((t) => t.roadW === 0 && t.roadL >= 5 &&
				t.w >= 9);
			return cand.length ? ctx.rng.pick(cand) : null;
		},
		slots: (t) => ({
			team: TM(t.name), l: T(String(t.roadL)), w: T(String(t.w)),
			home: T(String(t.w - (t.roadW || 0))), conf: T(t.conf),
		}),
		headlines: [
			"{team} still has not won away from home",
			"{l} road games, {l} road losses",
			"The bus is the problem at {team}",
			"{team}'s split season",
		],
		bodies: [
			"{team} is {w}-{l} and has not won a road game. Every one of its wins has come in its own building.",
			"A team can be good and unrecognisable in a different gym, and {team} is the season's proof: {l} road losses, {home} home wins.",
			"The {conf} plays half its games away and {team} has lost all {l} of them. Nobody on the staff has a theory that survives contact with the tape.",
			"{team} shoots eight points a hundred possessions worse on the road, which is a lot of ways of saying {l} straight.",
		],
	});

	TPL({
		kind: "mid-major statement", group: "regular season", p: 0.6,
		when: (f) => f.g.when,
		find: (ctx) => {
			const out = [];
			for (const t of ctx.teamList) {
				const conf = ctx.confOf(t.name);
				if (!conf || conf.tier === "high") continue;
				for (const g of gamesOf(t)) {
					if (g.stage !== "reg" || g.conference || !g.won) continue;
					const opp = ctx.teams[g.opp];
					const oc = opp && ctx.confOf(opp.name);
					if (oc && oc.tier === "high" && g.pf - g.pa >= 8) out.push({ t, opp, g });
				}
			}
			return out.length ? ctx.rng.pick(out) : null;
		},
		slots: (f) => ({
			team: TM(f.t.name), opp: TM(f.opp.name), score: T(scoreText(f.g)),
			conf: T(f.t.conf), oppConf: T(f.opp.conf),
			margin: T(String(f.g.pf - f.g.pa)),
		}),
		headlines: [
			"{team} goes into the {oppConf} and wins by {margin}",
			"{team} {score} over {opp}",
			"The {conf} has a team: {team}",
			"{opp} learns about {team}",
		],
		bodies: [
			"{team} beat {opp} {score} on the road. The {conf} does not get many of these and did not get this one by accident.",
			"A {margin}-point win at {opp}. {team} guarded, made shots and spent the last four minutes making free throws.",
			"Everybody who watched {team} beat {opp} {score} came away with the same note: that is a tournament team, and it plays in the {conf}.",
			"The guarantee game got away from {opp}. {team} won {score} and will be a name on a bracket by March.",
		],
	});

	TPL({
		kind: "senior night", group: "regular season", p: 0.6, when: 0.94,
		find: (ctx) => {
			const cand = ctx.ncaa.filter((p) => /Senior|Graduate/.test(String(p.classYear)) &&
				p.stats && p.stats.mpg >= 24);
			return cand.length ? ctx.rng.pick(cand) : null;
		},
		slots: (p) => ({
			player: PL(p.name, p.key), team: TM(p.newCollege),
			ppg: T(p.stats.ppg.toFixed(1)), gp: T(String(Math.round(p.stats.gp))),
			year: T(String(p.classYear).toLowerCase()),
		}),
		headlines: [
			"Senior night for {player}",
			"{team} says goodbye to {player}",
			"The last home game for {player}",
			"{player} walks out one more time",
		],
		bodies: [
			"{player} played his last home game for {team}. He is a {year} averaging {ppg} a night and has appeared in {gp} games this season alone.",
			"They read his name last, which is how {team} does it. {player} finishes his home career averaging {ppg}.",
			"Senior night is the one occasion in the sport where the scoreboard is beside the point. {player} scored anyway — he has all season, {ppg} a game.",
			"{player}'s parents walked him to centre court at {team} and the building did not sit down for two minutes.",
		],
	});

	// ------------------------------------------------------------- polls, analytics

	TPL({
		kind: "most underrated", group: "analytics", p: 0.6, when: 0.72,
		find: (ctx) => {
			const cand = ctx.teamList.filter((t) => Number.isFinite(t.netRank) &&
				t.netRank <= 30 && (!t.apRank || t.apRank > t.netRank + 8));
			return cand.sort((a, b) => a.netRank - b.netRank)[0] || null;
		},
		slots: (t) => ({
			team: TM(t.name), net: T("No. " + t.netRank),
			ap: T(t.apRank ? "No. " + t.apRank : "unranked"),
			conf: T(t.conf), w: T(String(t.w)), l: T(String(t.l)),
		}),
		headlines: [
			"{team} is {net} in the NET and {ap} in the AP poll",
			"The most underrated team in the country plays in the {conf}",
			"Nobody is voting for {team}",
			"{team}: the numbers and the ballots disagree",
		],
		bodies: [
			"{team} is {net} in the NET and {ap} in the poll at {w}-{l}. Voters watch games; the NET watches possessions, and they are not looking at the same team.",
			"The gap between {net} and {ap} is the largest in the country, and {team} has done nothing wrong to earn it except play in the {conf} on weeknights.",
			"{w}-{l}, {net} by the numbers, {ap} by the ballot. Somebody is wrong about {team} and the committee will settle it in March.",
			"Efficiency margin is not a beauty contest and {team} is winning it. The poll has them {ap}.",
		],
	});

	TPL({
		kind: "most overrated", group: "analytics", p: 0.55, when: 0.74,
		find: (ctx) => {
			const cand = ctx.teamList.filter((t) => t.apRank && t.apRank <= 20 &&
				Number.isFinite(t.netRank) && t.netRank > t.apRank + 14);
			return cand.sort((a, b) => a.apRank - b.apRank)[0] || null;
		},
		slots: (t) => ({
			team: TM(t.name), net: T("No. " + t.netRank), ap: T("No. " + t.apRank),
			conf: T(t.conf), sos: T(Number.isFinite(t.sosAvg) ? t.sosAvg.toFixed(1) : "soft"),
		}),
		headlines: [
			"{team} is {ap} in the poll and {net} in the NET",
			"The poll likes {team} more than the numbers do",
			"A word of caution about {team}",
			"{team}'s record is better than {team} is",
		],
		bodies: [
			"{team} is {ap} in the AP poll and {net} in the NET. The record is real; the schedule that produced it rates {sos}.",
			"Every metric that adjusts for opponent has {team} outside its poll ranking, and the {conf} slate ahead is where that gets settled.",
			"There is nothing wrong with winning the games in front of you. {team} has, and is {ap}. The NET, which asks how, has them {net}.",
			"{team} has not lost, which is the case for {ap}. {team} has not beaten anybody, which is the case for {net}.",
		],
	});

	TPL({
		kind: "strength of schedule", group: "analytics", p: 0.5, when: 0.58,
		find: (ctx) => {
			const t = bestBy(ctx.teamList.filter((x) => x.w + x.l >= 15),
				(x) => (Number.isFinite(x.sosAvg) ? x.sosAvg : -1));
			return t || null;
		},
		slots: (t) => ({
			team: TM(t.name), sos: T(t.sosAvg.toFixed(1)), conf: T(t.conf),
			w: T(String(t.w)), l: T(String(t.l)),
			q1: T(t.quads ? t.quads.q1w + "-" + t.quads.q1l : "no Quadrant 1 record"),
		}),
		headlines: [
			"Nobody has played a harder schedule than {team}",
			"{team}'s schedule rates {sos}",
			"The hardest road in the country runs through the {conf}",
			"{team} has been in the deep end all season",
		],
		bodies: [
			"{team} has played the toughest schedule in the country at {sos}, and is {w}-{l} against it with a Quadrant 1 record of {q1}.",
			"A {w}-{l} record means one thing at {team} and another somewhere softer. The schedule rates {sos}; nobody else is close.",
			"{team} scheduled up in November, drew the {conf}'s hardest rotation, and will arrive in March having been tested more than anyone.",
			"Selection committees look at {q1} before they look at {w}-{l}. {team}'s schedule, rated {sos}, is why.",
		],
	});

	TPL({
		kind: "bracketology", group: "analytics", p: 0.7, when: 0.83,
		find: (ctx) => {
			const bub = (ctx.res.tourney && ctx.res.tourney.selection &&
				ctx.res.tourney.selection.bubble) || [];
			if (bub.length < 4) return null;
			return { in: bub.slice(0, 2), out: bub.slice(2, 4) };
		},
		slots: (f) => ({
			a: TM(f.in[0].name), b: TM(f.in[1].name),
			c: TM(f.out[0].name), d: TM(f.out[1].name),
		}),
		headlines: [
			"Bracketology: {a} and {b} are the last four in",
			"The bubble this week: {a} in, {c} out",
			"Four teams, two spots: {a}, {b}, {c}, {d}",
			"February bracket watch",
		],
		bodies: [
			"This week's bracket has {a} and {b} among the last four in, with {c} and {d} among the first four out. Three weeks and about nine games will settle it.",
			"{a} and {b} are in the field this morning. {c} and {d} are not, and each of them has one Quadrant 1 chance left.",
			"The bubble is four teams deep and one result wide. {a}, {b}, {c} and {d} are separated by margins nobody would defend in writing.",
			"Nothing about {a}, {b}, {c} or {d} is settled. The committee will not see this week's bracket; it will see the last one.",
		],
	});

	// ------------------------------------------------- conference tournaments

	TPL({
		kind: "top seed falls", group: "conference tournament", p: 0.7, when: 1.004,
		find: (ctx) => {
			const out = [];
			for (const conf of Object.keys(ctx.res.confTourneys || {})) {
				const ct = ctx.res.confTourneys[conf];
				if (!ct || !ct.seeds || !ct.seeds.length || !ct.champ) continue;
				const top = ct.seeds[0];
				if (!top || top.name === ct.champ.name) continue;
				const loss = (ct.log || []).filter((g) =>
					(g.a === top.name || g.b === top.name) && g.winner !== top.name)[0];
				if (loss) out.push({ conf, top, ct, loss });
			}
			return out.length ? ctx.rng.pick(out) : null;
		},
		slots: (f) => ({
			team: TM(f.top.name), conf: T(f.conf),
			opp: TM(f.loss.winner === f.loss.a ? f.loss.a : f.loss.b),
			score: T(f.loss.score), champ: TM(f.ct.champ.name),
		}),
		headlines: [
			"The {conf}'s top seed is out",
			"{opp} knocks out {team}",
			"{team} loses early in the {conf}",
			"Chaos in the {conf}: {team} goes home",
		],
		bodies: [
			"{team} was the {conf}'s regular-season champion and is out of its tournament, beaten {score} by {opp}. {champ} took the bid.",
			"The {conf} title went to {champ} because {team} lost {score} to {opp} on the second day. A season of work, and a bid decided in forty minutes.",
			"{opp} beat {team} {score}. For a regular-season champion in a one-bid league that is the whole season, and everybody in the arena knew it while it was happening.",
			"{team} shot it badly, {opp} did not, and the {conf}'s bracket lost its top line before the semifinals.",
		],
	});

	TPL({
		kind: "first ever bid", group: "conference tournament", p: 0.5, when: 1.008,
		find: (ctx) => {
			const out = [];
			for (const conf of Object.keys(ctx.res.confTourneys || {})) {
				const ct = ctx.res.confTourneys[conf];
				if (!ct || !ct.champ) continue;
				const t = ctx.teams[ct.champ.name];
				if (t && t.prestige <= 32) out.push({ conf, t });
			}
			return out.length ? ctx.rng.pick(out) : null;
		},
		slots: (f) => ({
			team: TM(f.t.name), conf: T(f.conf), w: T(String(f.t.w)), l: T(String(f.t.l)),
			seed: T(f.t.ncaaSeed ? "a No. " + f.t.ncaaSeed + " seed" : "a place in the field"),
		}),
		headlines: [
			/* Selected on prestige <= 32, which is "a programme nobody has
			   heard of" and not "a programme that has never been". */
			"{team} is going to the tournament, which nobody predicted",
			"The {conf} bid belongs to {team}",
			"{team} cuts down a net nobody expected",
			"A first for {team}",
		],
		bodies: [
			"{team} won the {conf} tournament at {w}-{l} and will play in the NCAA tournament as {seed}, which nobody in the league had them doing in November.",
			"Nobody at {team} is pretending this was the plan — not the coach, not the players, not the athletic director who hired him. The {conf} bid is theirs anyway.",
			"{w}-{l}, a conference nobody outside it watches, and a bid. {team} is in, as {seed}.",
			"The nets came down at {team} and the celebration went on long enough that the trophy presentation started late. {conf} champions.",
		],
	});

	// ----------------------------------------------------------- NCAA tournament

	TPL({
		kind: "fifteen over two", group: "NCAA tournament", p: 0.9, when: 1.06,
		find: (ctx) => {
			const out = [];
			for (const r of Object.keys((ctx.res.tourney || {}).regions || {})) {
				for (const round of ctx.res.tourney.regions[r].rounds || []) {
					for (const g of round) {
						if (!g.winner || !g.a || !g.b) continue;
						const lo = g.winner.seed;
						const hi = (g.a === g.winner ? g.b : g.a).seed;
						if (lo >= 13 && hi <= 4) out.push({ g, r, lo, hi });
					}
				}
			}
			return out.length ? out : null;
		},
		slots: (f) => ({
			team: TM(f.g.winner.team.name),
			opp: TM((f.g.a === f.g.winner ? f.g.b : f.g.a).team.name),
			lo: T("No. " + f.lo), hi: T("No. " + f.hi),
			score: T(f.g.score || ""), region: T(f.r),
		}),
		headlines: [
			"{lo} {team} beats {hi} {opp}",
			"The bracket is already broken: {team} over {opp}",
			"{team} shocks the {region}",
			"{hi} {opp} is out on the first day",
		],
		bodies: [
			"{lo} seed {team} beat {hi} seed {opp} {score} in the {region}. Every bracket in the country is now worth less than the paper.",
			"{opp} was a {hi} seed and is out. {team}, seeded {lo}, won {score} and did not trail in the second half.",
			"There is one of these most years and this is this year's: {team}, {lo}, over {opp}, {hi}, by a score of {score}.",
			"The {region} lost its {hi} seed to {team} on the opening day. Nobody who watched it will describe it as a fluke.",
		],
	});

	TPL({
		kind: "tournament thriller", group: "NCAA tournament", p: 0.8, when: 1.09,
		find: (ctx) => {
			const out = [];
			for (const r of Object.keys((ctx.res.tourney || {}).regions || {})) {
				for (const round of ctx.res.tourney.regions[r].rounds || []) {
					for (const g of round) {
						if (!g.winner || !g.score) continue;
						const parts = String(g.score).split("-").map(Number);
						if (parts.length === 2 && Math.abs(parts[0] - parts[1]) <= 2) {
							out.push({ g, r });
						}
					}
				}
			}
			return out.length ? ctx.rng.pick(out) : null;
		},
		slots: (f) => ({
			team: TM(f.g.winner.team.name),
			opp: TM((f.g.a === f.g.winner ? f.g.b : f.g.a).team.name),
			score: T(f.g.score), region: T(f.r),
			seed: T("No. " + f.g.winner.seed),
		}),
		headlines: [
			"{team} survives {opp} by a possession",
			"One shot decides it in the {region}",
			"{team} {score} — and it took everything",
			"{opp} goes out on the last possession",
		],
		bodies: [
			"{seed} {team} beat {opp} {score} in the {region}. The last four minutes contained six lead changes and no defensive stops worth the name.",
			"A tournament game decided by two points: {team} over {opp}, {score}. {opp}'s season ends on a shot that went in and out.",
			"{team} is through {score}. There is no version of that game where {opp} did anything wrong; they simply did not have the last possession.",
			"The {region} produced the game of the first weekend. {team} {score}, and both benches were on the floor before the officials could clear it.",
		],
	});

	TPL({
		kind: "sweet sixteen preview", group: "NCAA tournament", p: 0.6, when: 1.10,
		find: (ctx) => {
			const alive = ctx.teamList.filter((t) => (t.ncaaWins || 0) >= 2 && t.ncaaSeed);
			if (alive.length < 2) return null;
			const s = alive.slice().sort((a, b) => (b.rating || 0) - (a.rating || 0));
			return { a: s[0], b: s[1] };
		},
		slots: (f) => ({
			a: TM(f.a.name), b: TM(f.b.name),
			aSeed: T("No. " + f.a.ncaaSeed), bSeed: T("No. " + f.b.ncaaSeed),
			aRegion: T(f.a.ncaaRegion || "its region"),
		}),
		headlines: [
			"Sixteen left, and {a} looks like the best of them",
			"{a} and {b} are the two nobody wants",
			"The second weekend starts with {a}",
			"What is left of the bracket",
		],
		bodies: [
			"{aSeed} {a} is the strongest team still playing and {bSeed} {b} is not far behind. Neither is in the other's half of the {aRegion}.",
			"The field is sixteen. On efficiency margin it is {a} and {b} and then a gap, which is not how the bracket will treat it.",
			"{a} has been the best team in the country for a month and the bracket has finally noticed. {b} is the only survivor with a comparable profile.",
			"Two of the sixteen have separated themselves — {a} and {b} — and both of them have to get through somebody who has already beaten a better seed.",
		],
	});

	TPL({
		kind: "elite eight classic", group: "NCAA tournament", p: 0.7, when: 1.12,
		find: (ctx) => {
			const out = [];
			for (const r of Object.keys((ctx.res.tourney || {}).regions || {})) {
				const rounds = ctx.res.tourney.regions[r].rounds || [];
				const last = rounds[rounds.length - 1];
				for (const g of last || []) if (g.winner && g.score) out.push({ g, r });
			}
			return out.length ? ctx.rng.pick(out) : null;
		},
		slots: (f) => ({
			team: TM(f.g.winner.team.name),
			opp: TM((f.g.a === f.g.winner ? f.g.b : f.g.a).team.name),
			score: T(f.g.score), region: T(f.r),
			seed: T("No. " + f.g.winner.seed),
		}),
		headlines: [
			"{team} wins the {region} and a trip to the Final Four",
			"{seed} {team} takes down {opp}",
			"{region} final: {team} {score}",
			"{opp}'s season ends one game short",
		],
		bodies: [
			"{seed} {team} beat {opp} {score} to win the {region}. They will cut down a regional net and fly out on a Sunday night.",
			"The {region} belongs to {team}, {score} over {opp}. One team gets a week to prepare for a national semifinal and the other gets an offseason.",
			"{opp} led with four minutes left and lost {score}. {team} is going to the Final Four out of the {region}.",
			"There is no consolation in a regional final and {opp} did not look for one. {team} won {score} and is a weekend from a title.",
		],
	});

	TPL({
		kind: "title game story", group: "NCAA tournament", p: 0.95, when: 1.19,
		find: (ctx) => {
			const t = ctx.res.tourney;
			if (!t || !t.champion || !t.runnerUp) return null;
			const champ = ctx.teams[t.champion.team.name];
			const best = ctx.ncaa.filter((p) => p.newCollege === t.champion.team.name)
				.sort((a, b) => (b.stats ? b.stats.ppg : 0) - (a.stats ? a.stats.ppg : 0))[0];
			return { t, champ, best };
		},
		slots: (f) => ({
			champ: TM(f.t.champion.team.name), runner: TM(f.t.runnerUp.team.name),
			seed: T("No. " + f.t.champion.seed),
			runnerSeed: T("No. " + f.t.runnerUp.seed),
			coach: T(f.champ && f.champ.coach ? f.champ.coach.name : "the staff"),
			star: f.best ? PL(f.best.name, f.best.key) : T("its best player"),
			record: T(f.champ ? f.champ.w + "-" + f.champ.l : ""),
		}),
		headlines: [
			"{champ} wins the national championship",
			"{seed} {champ} beats {runnerSeed} {runner} for the title",
			"One night, one net: {champ}",
			"{coach} has his championship",
		],
		bodies: [
			"{champ} beat {runner} to win the national championship and finish {record}. {star} was the best player on the floor in the last ten minutes, which is when it was decided.",
			"{seed} {champ} is the national champion. {runnerSeed} {runner} led at the half and did not score for six minutes after it.",
			"{coach} took {champ} to {record} and a title. The confetti was still coming down when the questions about who is coming back started.",
			"A season of thirty-odd games and one net. {champ} over {runner}, with {star} carrying the offence when the possessions got short.",
		],
	});

	TPL({
		kind: "coach of the year", group: "awards", p: 0.85, when: 1.22,
		find: (ctx) => {
			const ch = (ctx.res.coachHonors || []).filter((h) => h.award === "AP Coach of the Year");
			if (!ch.length) return null;
			const h = ch[0];
			const t = ctx.teams[h.school];
			if (!t || !t.coach) return null;
			const others = (ctx.res.coachHonors || [])
				.filter((x) => x.coach === h.coach && x.award !== h.award &&
					!/ Coach of the Year$/.test(x.award.replace(/^(Naismith|AP) /, "")))
				.map((x) => x.award);
			return { h, t, others };
		},
		slots: (f) => ({
			team: TM(f.t.name), coach: T(f.h.coach), record: T(f.h.record),
			conf: T(f.t.conf), years: T(String(f.t.coach.tenure)),
			sweep: T(f.others.length ? " He also took the " + f.others.join(" and the ") + "." : ""),
			situation: T(f.t.coach.situationLabel || "a fixture"),
		}),
		headlines: [
			"{coach} is the AP Coach of the Year",
			"Coach of the Year: {coach}, {team}",
			"{team} went {record}, and the voters noticed the man on the sideline",
		],
		bodies: [
			"{coach} took {team} to {record} in a season nobody outside the building expected, and the AP named him Coach of the Year.{sweep}",
			"The AP Coach of the Year is {coach} of {team}, {record} in the {conf} in his year {years}.{sweep}",
			"{team} was picked for the middle of the {conf} and finished {record}. {coach} is the AP Coach of the Year for it.{sweep}",
		],
	});

	TPL({
		kind: "champion's coach", group: "NCAA tournament", p: 0.6, when: 1.20,
		find: (ctx) => {
			const t = ctx.res.tourney;
			if (!t || !t.champion) return null;
			const champ = ctx.teams[t.champion.team.name];
			if (!champ || !champ.coach) return null;
			return champ.coach.tenure <= 6 ? champ : null;
		},
		slots: (t) => ({
			team: TM(t.name), coach: T(t.coach.name),
			years: T(String(t.coach.tenure)), conf: T(t.conf),
			// "{years} years" gave "1 years" and "{years}th season" gave
			// "1th season"; both are one helper away from right.
			yearsPl: T(global.Text.plural(t.coach.tenure, "year")),
			seasonsPl: T(global.Text.plural(t.coach.tenure, "season")),
			nth: T(global.Text.ordinal(t.coach.tenure)),
			philosophy: T(philosophyPhrase(t.coach) || "a coach who does not " +
				"advertise a system"),
		}),
		headlines: [
			"{coach} wins a title in year {years}",
			"{seasonsPl}, and {coach} has a championship",
			"The fastest build in the sport belongs to {coach}",
			"{team} hired right",
		],
		bodies: [
			"{coach} has been at {team} for {seasonsPl} and has a national championship. The programme he inherited was not winning games like this one when he took it.",
			"It took {coach} {yearsPl}. He is {philosophy} and the roster he won with is mostly people he recruited himself.",
			"There will be four athletic directors in the {conf} watching {coach} lift that trophy and thinking about their own search process.",
			"{team} is a national champion in {coach}'s {nth} season, which is not how this is supposed to work and is exactly how it happened.",
		],
	});

	// ------------------------------------------------------------------- awards

	TPL({
		kind: "all-america roundup", group: "awards", p: 0.8, when: 1.24,
		find: (ctx) => {
			const first = ctx.ncaa.filter((p) =>
				(p.awards || []).indexOf("Consensus First Team All-American") !== -1);
			if (!first.length) return null;
			const snub = ctx.ncaa.filter((p) => first.indexOf(p) === -1 &&
				p.stats && p.stats.ppg >= 17 &&
				!(p.awards || []).some((a) => /All-American/.test(a)))
				.sort((a, b) => (b.stats.ppg) - (a.stats.ppg))[0];
			return { first, snub };
		},
		slots: (f) => ({
			a: PL(f.first[0].name, f.first[0].key),
			b: f.first[1] ? PL(f.first[1].name, f.first[1].key)
				: PL(f.first[0].name, f.first[0].key),
			n: T(global.Text.plural(f.first.length, "player")),
			snub: f.snub ? PL(f.snub.name, f.snub.key) : T("nobody with a real case"),
			snubPpg: T(f.snub ? f.snub.stats.ppg.toFixed(1) : "0"),
			snubTeam: f.snub ? TM(f.snub.newCollege) : T("his programme"),
		}),
		headlines: [
			"The All-America teams are out",
			"{a} headlines the first team",
			"{n} consensus first-teamers, and one argument",
			"All-America: the five, and the sixth man",
		],
		bodies: [
			"The consensus first team is led by {a} and {b}. The loudest omission is {snub}, who averaged {snubPpg} for {snubTeam} and did not make any of the three.",
			"{a} was unanimous. Everybody else on the first team had to be argued for, and {snub} — {snubPpg} a game at {snubTeam} — lost the argument.",
			"{n} of them are consensus first-team All-Americans this season. {snub} is not, which is the only part of the announcement anybody will discuss.",
			"All-America season produces a list and a grievance. The list starts with {a}; the grievance is {snub}, at {snubPpg} a night.",
		],
	});

	TPL({
		kind: "all-defensive team", group: "awards", p: 0.7, when: 1.25,
		find: (ctx) => {
			const d = ctx.ncaa.filter((p) => p.stats &&
				(p.stats.spg + p.stats.bpg) >= 2.4 && p.stats.mpg >= 24)
				.sort((a, b) => (b.stats.spg + b.stats.bpg) - (a.stats.spg + a.stats.bpg));
			return d.length >= 2 ? { a: d[0], b: d[1] } : null;
		},
		slots: (f) => ({
			a: PL(f.a.name, f.a.key), b: PL(f.b.name, f.b.key),
			aTeam: TM(f.a.newCollege), bTeam: TM(f.b.newCollege),
			aStl: T(f.a.stats.spg.toFixed(1)), aBlk: T(f.a.stats.bpg.toFixed(1)),
			bStl: T(f.b.stats.spg.toFixed(1)), bBlk: T(f.b.stats.bpg.toFixed(1)),
		}),
		headlines: [
			"{a} and {b} lead the all-defensive team",
			"The all-defensive five is announced",
			"{a} is the defensive pick of the year",
			"Two names nobody argued about: {a}, {b}",
		],
		bodies: [
			"{a} of {aTeam} and {b} of {bTeam} head the all-defensive team. {a} averaged {aStl} steals and {aBlk} blocks; {b} was at {bStl} and {bBlk}.",
			"The defensive team is the one nobody campaigns for and everybody agrees with. {a} and {b} were on every ballot.",
			"Steals and blocks are the only defensive statistics a ballot can see, and {a} — {aStl} and {aBlk} for {aTeam} — led in both.",
			"{b} guarded four positions for {bTeam} and averaged {bStl} steals doing it. He and {a} are the first two names on the all-defensive team.",
		],
	});

	TPL({
		kind: "freshman all-america", group: "awards", p: 0.6, when: 1.26,
		find: (ctx) => {
			const f = ctx.ncaa.filter((p) => p.isFreshman && p.stats && p.stats.ppg >= 12)
				.sort((a, b) => b.stats.ppg - a.stats.ppg);
			return f.length >= 2 ? { a: f[0], b: f[1], n: f.length } : null;
		},
		slots: (f) => ({
			a: PL(f.a.name, f.a.key), b: PL(f.b.name, f.b.key),
			aTeam: TM(f.a.newCollege), bTeam: TM(f.b.newCollege),
			aPpg: T(f.a.stats.ppg.toFixed(1)), bPpg: T(f.b.stats.ppg.toFixed(1)),
			n: T(String(f.n)),
		}),
		headlines: [
			"The freshman All-America team",
			"{a} is the freshman of the year on most ballots",
			"{n} freshmen scored in double figures this season",
			"First-year honours go to {a} and {b}",
		],
		bodies: [
			"{a} of {aTeam} averaged {aPpg} as a freshman and heads the first-year All-America team. {b} of {bTeam} was at {bPpg}.",
			"{n} freshmen finished in double figures. The two who separated themselves were {a} at {aPpg} and {b} at {bPpg}.",
			"A freshman team is half a scouting report on next season and half on the draft. {a} and {b} lead this one, and neither is expected back.",
			"{b} was the higher-rated recruit and {a} was the better freshman, at {aPpg} to {bPpg}. Both made the team.",
		],
	});

	TPL({
		kind: "conference awards roundup", group: "awards", p: 0.7, when: 1.0,
		find: (ctx) => {
			const winners = ctx.ncaa.filter((p) =>
				(p.awards || []).some((a) => / Player of the Year$/.test(a) &&
					!/^(AP|NABC|Sporting News)/.test(a)));
			return winners.length >= 2
				? { a: winners[0], b: winners[1], n: winners.length } : null;
		},
		slots: (f) => ({
			a: PL(f.a.name, f.a.key), b: PL(f.b.name, f.b.key),
			aTeam: TM(f.a.newCollege), bTeam: TM(f.b.newCollege),
			aConf: T(f.a.conf || "his league"), bConf: T(f.b.conf || "his league"),
			n: T(String(f.n)),
		}),
		headlines: [
			"Conference awards: {a} takes the {aConf}",
			"{n} leagues named a player of the year this week",
			"{a} and {b} sweep their conferences",
			"Awards week around the country",
		],
		bodies: [
			"{a} of {aTeam} is the {aConf} player of the year and {b} of {bTeam} took the {bConf}. {n} leagues have now voted.",
			"Awards week produced {n} conference players of the year. {a} and {b} were the two who will also feature on national ballots.",
			"The {aConf} gave it to {a}; the {bConf} gave it to {b}. Both votes were reported as unanimous and neither was close enough to need reporting.",
			"{n} conferences, {n} players of the year, and about four of them who will hear their names again in April. {a} and {b} are two.",
		],
	});

	// -------------------------------------------------------------------- draft

	TPL({
		kind: "combine measurements", group: "draft", p: 0.7, when: 1.42,
		find: (ctx) => {
			const cand = ctx.ncaa.filter((p) => Number.isFinite(p.boardRank) &&
				p.boardRank <= 40);
			return cand.length ? ctx.rng.pick(cand) : null;
		},
		slots: (p) => {
			const ft = Math.floor(p.newHgtInches / 12);
			const inch = p.newHgtInches % 12;
			return {
				player: PL(p.name, p.key), team: TM(p.newCollege),
				hgt: T(ft + "'" + inch + "\""), wt: T(String(p.newWeight) + " pounds"),
				rank: T("No. " + p.boardRank), pos: T(p.newPos),
			};
		},
		headlines: [
			"{player} measures {hgt} at the combine",
			"The tape does not lie: {player} at {hgt}, {wt}",
			"Combine day for {player}",
			"{player}'s measurements are in",
		],
		bodies: [
			"{player} measured {hgt} and {wt} at the combine. He played {pos} for {team} and every team in the gym has an opinion about whether he still will.",
			"The measurements came in at {hgt} and {wt} for {player}, which is what he was listed at and is not always what happens.",
			"{rank} on the board and {hgt} in socks. {player} did not scrimmage; nobody at his slot does any more.",
			"There is a version of the combine that matters and it is the part with the tape measure. {player}: {hgt}, {wt}, and no change to his projection.",
		],
	});

	TPL({
		kind: "pro day", group: "draft", p: 0.55, when: 1.44,
		find: (ctx) => {
			const cand = ctx.ncaa.filter((p) => Number.isFinite(p.boardRank) &&
				p.boardRank >= 25 && p.boardRank <= 70);
			return cand.length ? ctx.rng.pick(cand) : null;
		},
		slots: (p) => ({
			player: PL(p.name, p.key), team: TM(p.newCollege),
			rank: T("No. " + p.boardRank),
			tpp: T(p.stats ? (p.stats.tpp * 100).toFixed(1) + "%" : "his college number"),
		}),
		headlines: [
			"{player} shoots for scouts",
			"Pro day at {team}",
			"{player} works out in front of eleven teams",
			"The pre-draft circuit reaches {player}",
		],
		bodies: [
			"{player} worked out at {team} in front of scouts from eleven teams. He shot {tpp} from three in college and made a great many more than that in an empty gym.",
			"A pro day is a controlled environment and everybody in it knows so. {player}, {rank} on the board, did what he was supposed to do.",
			"{team} opened its facility for {player}. The interviews took longer than the workout, which is usually the point.",
			"{rank} on most boards, and a morning of shooting drills to move it. {player} was efficient, unhurried and exactly as advertised.",
		],
	});

	TPL({
		kind: "withdraws and returns", group: "draft", p: 0.6, when: 1.46,
		find: (ctx) => {
			const cand = ctx.ncaa.filter((p) => p.mockRound === 2 &&
				!/Senior|Graduate/.test(String(p.classYear)));
			return cand.length ? ctx.rng.pick(cand) : null;
		},
		slots: (p) => ({
			player: PL(p.name, p.key), team: TM(p.newCollege),
			rank: T(p.boardRank ? "No. " + p.boardRank : "the second round"),
			ppg: T(p.stats ? p.stats.ppg.toFixed(1) : "his scoring"),
			year: T(String(p.classYear || "underclassman").toLowerCase()),
		}),
		headlines: [
			"{player} withdraws and returns to {team}",
			"{team} gets {player} back",
			"{player} pulls his name out",
			"One more year for {player}",
		],
		bodies: [
			"{player} has withdrawn from the draft and will return to {team}. He was projected around {rank} and averaged {ppg} as a {year}.",
			"The feedback was second round and the decision followed it. {player} is back at {team} for another season.",
			"{team} spent six weeks recruiting its own player and got him. {player} withdraws, and a roster that looked thin is suddenly a preseason top-twenty.",
			"{player} is coming back. At {ppg} a game he was the best player on his team; at {rank} on a board he was a maybe. He chose the first one.",
		],
	});

	TPL({
		kind: "international stash", group: "draft", p: 0.5, when: 1.47,
		find: (ctx) => {
			const cand = (ctx.res.players || []).filter((p) => p.nonNcaa && p.leaguePro &&
				Number.isFinite(p.boardRank));
			return cand.length ? ctx.rng.pick(cand) : null;
		},
		slots: (p) => ({
			player: PL(p.name, p.key), club: T(p.proClub || p.newCollege),
			rank: T(p.boardRank ? "No. " + p.boardRank : "the second round"),
			age: T(String(p.age)),
		}),
		headlines: [
			"{player} could be a stash pick",
			"Nobody is in a hurry with {player}",
			"{player} stays at {club} either way",
			"The draft-and-stash case for {player}",
		],
		bodies: [
			"{player} is {rank} on the board and under contract at {club}. A team picking there gets a roster spot back for two years, which is worth as much as the player.",
			"At {age}, {player} does not need an NBA bench. He needs minutes, and {club} will give him thirty of them a week.",
			"The stash is the most underrated asset in a second round, and {player} — {rank}, contracted to {club} — is this class's version of it.",
			"{player} will be drafted and will not appear for two seasons. Everybody involved considers that the plan rather than the risk.",
		],
	});

	TPL({
		kind: "undrafted signing", group: "draft", p: 0.6, when: 1.49,
		find: (ctx) => {
			const cand = ctx.ncaa.filter((p) => !p.mockRound && p.stats &&
				p.stats.ppg >= 13);
			return cand.length ? ctx.rng.pick(cand) : null;
		},
		slots: (p) => ({
			player: PL(p.name, p.key), team: TM(p.newCollege),
			ppg: T(p.stats.ppg.toFixed(1)),
			line: T(statBlurb(p.stats)),
		}),
		headlines: [
			"{player} goes undrafted and signs anyway",
			"No pick for {player}, and a camp invitation within the hour",
			"{player} takes the harder road",
			"Undrafted: {player}",
		],
		bodies: [
			"{player} was not drafted. He put up {line} for {team} and had three two-way offers before the broadcast finished.",
			"Sixty names, and {player} — {ppg} a game — was not one of them. He signed a camp deal that night.",
			"Going undrafted at {ppg} a game says more about a class than a player. {player} will be in a summer league and everybody who watched {team} expects him to stick.",
			"{player} spent draft night at home and had a contract by midnight. The list of players who took that route and stayed is longer than the draft.",
		],
	});

	TPL({
		kind: "first round grades", group: "draft", p: 0.6, when: 1.52,
		find: (ctx) => {
			const one = ctx.ncaa.filter((p) => p.mockRound === 1)
				.sort((a, b) => (a.boardRank || 99) - (b.boardRank || 99));
			return one.length >= 3 ? { one, n: one.length } : null;
		},
		slots: (f) => ({
			a: PL(f.one[0].name, f.one[0].key),
			b: PL(f.one[1].name, f.one[1].key),
			c: PL(f.one[2].name, f.one[2].key),
			n: T(String(f.n)),
			aTeam: TM(f.one[0].newCollege),
		}),
		headlines: [
			"Grading the first round",
			"{n} first-rounders, and one class",
			"{a} goes first, and the rest is argument",
			"The first round, reviewed",
		],
		bodies: [
			"{n} players from this class went in the first round. {a} of {aTeam} went first; {b} and {c} followed inside ten picks.",
			"The top of the board held. {a}, {b} and {c} came off in the order the boards had them, which happens about one year in four.",
			"A first round is graded on the fifth pick and the twenty-fifth, not the first. {a} was never in doubt; the rest of the {n} were.",
			"{n} names, one class, and the same three at the top all season: {a}, {b}, {c}.",
		],
	});

	TPL({
		kind: "lottery order", group: "draft", p: 0.5, when: 1.38,
		find: (ctx) => {
			const one = ctx.ncaa.filter((p) => Number.isFinite(p.boardRank) &&
				p.boardRank <= 14);
			return one.length >= 2 ? { top: one[0], n: one.length } : null;
		},
		slots: (f) => ({
			player: PL(f.top.name, f.top.key), team: TM(f.top.newCollege),
			n: T(String(f.n)),
		}),
		headlines: [
			"The lottery is set",
			"{n} of this class project inside the lottery",
			"Where {player} lands is now a question of ping-pong balls",
			"Lottery night",
		],
		bodies: [
			"The lottery is drawn and the order is out. {n} players from this class project inside it, with {player} of {team} the consensus first name.",
			"{player} will go first or second depending on a set of numbered balls, which is a strange way to decide a career and is how it has always worked.",
			"{n} lottery-grade prospects is a good class rather than a great one. {player} is the only one nobody wants to trade down past.",
			"Fourteen picks, {n} of them earmarked for this class, and one team that got the result it needed in a room with no basketball in it.",
		],
	});

	// ------------------------------------------------------------------ universe

	TPL({
		kind: "one year later", group: "universe", p: 0.7, when: -0.52,
		find: (ctx) => {
			const carry = ctx.res.cfg && ctx.res.cfg.carryOver;
			if (!carry || !carry.coaches) return null;
			const gone = Object.keys(carry.coaches)
				.filter((n) => carry.coaches[n].fired && ctx.teams[n]);
			if (!gone.length) return null;
			const name = ctx.rng.pick(gone);
			return { t: ctx.teams[name], prev: carry.coaches[name] };
		},
		slots: (f) => ({
			team: TM(f.t.name), coach: T(f.t.coach ? f.t.coach.name : "the new man"),
			old: T(f.prev.coach ? f.prev.coach.name : "his predecessor"),
			reason: T(f.prev.reason === "retired" ? "retired"
				: f.prev.reason === "hired away" ? "left for a bigger job"
				: f.prev.reason === "not retained" ? "was not retained" : "was fired"),
			conf: T(f.t.conf),
		}),
		headlines: [
			"A new voice at {team}",
			"{coach} takes over from {old}",
			"{team} moves on",
			"The {conf} has a new coach at {team}",
		],
		bodies: [
			"{old} {reason} at {team} after last season. {coach} takes over a roster that returns most of its minutes and none of its certainty.",
			"{team} has {coach} on the sideline this season. {old} {reason} in April and the players found out from a group message.",
			"A coaching change is the one roster move a programme cannot undo quietly. {old} {reason}; {coach} inherits the {conf} schedule that broke him.",
			"{coach} is the new coach at {team}, where {old} {reason}. The first thing he changed was the practice start time.",
		],
	});

	TPL({
		kind: "program on the rise", group: "universe", p: 0.6, when: -0.18,
		find: (ctx) => {
			const carry = ctx.res.cfg && ctx.res.cfg.carryOver;
			if (!carry || !carry.levels) return null;
			const up = ctx.teamList.filter((t) =>
				Number.isFinite(carry.levels[t.name]) &&
				t.level - carry.levels[t.name] >= 6);
			return up.length ? ctx.rng.pick(up) : null;
		},
		slots: (t, ctx) => {
			const carry = ctx.res.cfg.carryOver;
			return {
				team: TM(t.name), conf: T(t.conf),
				gain: T(String(Math.round(t.level - carry.levels[t.name]))),
				coach: T(t.coach ? t.coach.name : "the staff"),
			};
		},
		headlines: [
			"{team} is better than it was a year ago",
			"The climb continues at {team}",
			"{gain} points of programme strength for {team}",
			"Nobody in the {conf} wants to play {team} now",
		],
		bodies: [
			"{team} is measurably stronger than last season — about {gain} points of programme strength — and it is not one recruiting class doing it.",
			"{coach} has moved {team} up {gain} points in a year. The {conf} noticed some time around January.",
			"A programme improves in one of two ways and {team} has done the slower one: everybody who was here last year is better.",
			"{gain} points in a season. {team} has gone from a team that could beat you to a team that is supposed to.",
		],
	});

	// ------------------------------------------------------- more of the paper

	/* Twenty more kinds, most of them reading things the model has carried
	   for a while and never put in print: the earlier seasons (a two-time
	   all-conference pick, a sophomore leap), the game log's nights (a
	   perfect night at the line, a duel, a defensive masterpiece, a cold
	   night from a lottery pick), the schedule's shape (a fortress, road
	   warriors, an overtime team, a blowout), the map (a program's first year
	   in a new league), and the season abroad (a cup, a relegation, a
	   continental run). Every one reads off results already produced. */

	const gamesWith = (p, pred) => logGames(p).filter(pred);
	const nightText = (g) => (g.won ? "a win over " : "a loss to ") + g.opp;

	TPL({
		kind: "two-time honor", group: "awards", p: 0.85, when: 1.23,
		find: (ctx) => {
			const cand = ctx.ncaa.filter((p) => p.priorAwards && p.priorAwards.length &&
				p.awards && p.awards.some((a) => p.priorAwards.some((x) => x.award === a &&
					/First Team|Player of the Year|All-American/.test(a))));
			if (!cand.length) return null;
			return cand.sort((a, b) => (a.boardRank || 999) - (b.boardRank || 999))[0];
		},
		slots: (p) => {
			const award = p.awards.filter((a) => p.priorAwards.some((x) => x.award === a &&
				/First Team|Player of the Year|All-American/.test(a)))[0];
			const first = p.priorAwards.filter((x) => x.award === award)
				.sort((a, b) => a.season - b.season)[0];
			const times = 1 + p.priorAwards.filter((x) => x.award === award).length;
			return {
				player: PL(p.name, p.key), team: TM(p.newCollege), award: T(award),
				first: T(String(first.season)), times: T(times === 2 ? "second" : times === 3 ? "third" : "fourth"),
				year: T(String(p.classYear || "").toLowerCase()),
			};
		},
		headlines: [
			"{player} repeats: {award} for the {times} time",
			"Again: {player} named {award}",
			"{player} keeps the {award} in the family",
			"A {times} {award} for {player}",
		],
		bodies: [
			"{player} was named {award} for the {times} time on Tuesday, having first won it in {first}. The {year} at {team} is the rare player who did it as an underclassman and then did it again.",
			"There is one name on the {award} that was there last time: {player} of {team}, who first took it in {first} and has now done it {times} time over.",
			"{team}'s {player} is a repeat winner of the {award}. Voters who watched him win it in {first} saw the same player, a year older and harder to guard.",
		],
	});

	TPL({
		kind: "sophomore leap", group: "regular season", p: 0.7, when: 0.58,
		find: (ctx) => {
			const cand = ctx.ncaa.filter((p) => p.stats && p.stats.mpg >= 22 &&
				(p.priorSeasons || []).some((r) => r.simulated && !r.redshirt &&
					r.season === ctx.season - 1 && p.stats.ppg - r.ppg >= 7));
			if (!cand.length) return null;
			return bestBy(cand, (p) => p.stats.ppg -
				p.priorSeasons.filter((r) => r.season === ctx.season - 1)[0].ppg);
		},
		slots: (p, ctx) => {
			const r = p.priorSeasons.filter((x) => x.season === ctx.season - 1)[0];
			return {
				player: PL(p.name, p.key), team: TM(p.newCollege),
				then: T(r.ppg.toFixed(1)), now: T(p.stats.ppg.toFixed(1)),
				year: T(String(p.classYear || "").toLowerCase()),
				last: T(String(r.classYear || "").toLowerCase()),
			};
		},
		headlines: [
			"{player} has made the leap",
			"From {then} to {now}: the rise of {player}",
			"{team}'s {player} is a different player this year",
			"The jump: {player}'s {now} a night",
		],
		bodies: [
			"A year ago {player} averaged {then} points as a {last}. He is at {now} now, and the {team} offense runs through him in a way nobody planned in October.",
			"{player}'s scoring has nearly doubled from his {last} year — {then} then, {now} now — and the difference is not the shots so much as who is taking them.",
			"Nobody at {team} will say {player} surprised them. The numbers will: {then} points a game last season, {now} this one, on more minutes and a lot more trust.",
		],
	});

	TPL({
		kind: "perfect at the line", group: "regular season", p: 0.6,
		when: (g) => Math.min(0.98, g.when || 0.5),
		find: (ctx) => {
			let best = null;
			for (const p of ctx.ncaa) {
				for (const g of gamesWith(p, (x) => Number.isFinite(x.ftm) && x.ftm >= 10 && x.ftm === x.fta)) {
					if (!best || g.ftm > best.g.ftm) best = { p, g };
				}
			}
			return best;
		},
		slots: ({ p, g }) => ({
			player: PL(p.name, p.key), team: TM(p.newCollege), n: T(String(g.ftm)),
			pts: T(String(g.pts)), opp: TM(g.opp), result: T(nightText(g)),
		}),
		headlines: [
			"{n}-for-{n}: {player} does not miss at the line",
			"Perfect from the stripe: {player} goes {n} of {n}",
			"{player} makes every free throw in {pts}-point night",
		],
		bodies: [
			"{player} went to the line {n} times against {opp} and made every one of them, the spine of a {pts}-point night in {result}.",
			"{n} free throws, {n} makes. {player} did most of his damage against {opp} from the line, and {team} needed all of it.",
			"The box score says {n}-for-{n} beside {player}'s name. {opp} fouled him on purpose late, and he made them pay for every trip.",
		],
	});

	TPL({
		kind: "cold night", group: "regular season", p: 0.55,
		when: (g) => Math.min(0.98, g.when || 0.5),
		find: (ctx) => {
			const tops = ctx.ncaa.filter((p) => p.boardRank && p.boardRank <= 12 && p.stats && p.stats.ppg >= 13);
			let worst = null;
			for (const p of tops) {
				for (const g of gamesWith(p, (x) => x.min >= 22 && x.pts <= 4 && Number.isFinite(x.fga) && x.fga >= 8)) {
					if (!worst || g.pts < worst.g.pts) worst = { p, g };
				}
			}
			return worst;
		},
		slots: ({ p, g }) => ({
			player: PL(p.name, p.key), team: TM(p.newCollege), opp: TM(g.opp),
			pts: T(g.pts + (g.pts === 1 ? " point" : " points")),
			shooting: T(g.fgm + "-of-" + g.fga), result: T(nightText(g)),
			rank: T(String(p.boardRank)),
		}),
		headlines: [
			"The night {player} could not buy one",
			"{pts}: a rough evening for {player}",
			"{player} goes {shooting} against {opp}",
		],
		bodies: [
			"Projected No. {rank} on most boards, {player} had the kind of night scouts file away: {pts} on {shooting} shooting in {result}. One game. They will still watch the next one.",
			"{opp} made {player} work for everything and he finished with {pts}. {team} will remember the {shooting} line longer than he will.",
			"Every prospect has one of these. {player}'s came against {opp}: {shooting} from the floor, {pts}, and a long bus ride home.",
		],
	});

	TPL({
		kind: "prospect duel", group: "regular season", p: 0.65,
		when: (d) => Math.min(0.98, d.g.when || 0.5),
		find: (ctx) => {
			let best = null;
			for (const p of ctx.ncaa) {
				for (const g of gamesWith(p, (x) => x.pts >= 24)) {
					const q = ctx.ncaa.filter((o) => o !== p && o.newCollege === g.opp)[0];
					if (!q) continue;
					const og = logGames(q).filter((x) => x.opp === p.newCollege &&
						Math.abs((x.when || 0) - (g.when || 0)) < 1e-9)[0];
					if (!og || og.pts < 22) continue;
					if (!best || g.pts + og.pts > best.g.pts + best.og.pts) best = { p, g, q, og };
				}
			}
			return best;
		},
		slots: ({ p, g, q, og }) => ({
			a: PL(p.name, p.key), b: PL(q.name, q.key), ateam: TM(p.newCollege), bteam: TM(q.newCollege),
			apts: T(String(g.pts)), bpts: T(String(og.pts)), score: T(scoreText(g)),
			winner: TM(g.won ? p.newCollege : q.newCollege),
		}),
		headlines: [
			"{a} and {b} trade blows in a scouts' dream",
			"{apts} for {a}, {bpts} for {b}: the duel of the season",
			"Two first-rounders, one floor: {a} against {b}",
		],
		bodies: [
			"Every NBA front office had somebody in the building. {a} scored {apts} for {ateam}, {b} answered with {bpts} for {bteam}, and {winner} took it {score}.",
			"{a} versus {b} was billed as a duel and played like one — {apts} and {bpts} points respectively, and a {score} result that {winner} will remember.",
			"For forty minutes the game was two prospects going at each other: {a} with {apts}, {b} with {bpts}. {winner} won, {score}, but nobody in the stands was watching the score.",
		],
	});

	TPL({
		kind: "defensive masterpiece", group: "regular season", p: 0.6,
		when: (d) => Math.min(0.98, d.g.when || 0.5),
		find: (ctx) => {
			let best = null;
			for (const p of ctx.ncaa) {
				for (const g of gamesWith(p, (x) => x.blk + x.stl >= 7 && x.blk >= 3)) {
					if (!best || g.blk + g.stl > best.g.blk + best.g.stl) best = { p, g };
				}
			}
			return best;
		},
		slots: ({ p, g }) => ({
			player: PL(p.name, p.key), team: TM(p.newCollege), opp: TM(g.opp),
			blk: T(String(g.blk)), stl: T(g.stl + (g.stl === 1 ? " steal" : " steals")),
			pts: T(String(g.pts)), result: T(nightText(g)),
		}),
		headlines: [
			"{blk} blocks, {stl}: {player} shuts the door on {opp}",
			"A defensive masterpiece from {player}",
			"{player} turns {opp} away at the rim, again and again",
		],
		bodies: [
			"{player} finished with {blk} blocks and {stl} in {result}. {opp} stopped driving by the second half; there was nowhere to go.",
			"The {pts} points were incidental. {player}'s night was {blk} blocked shots and {stl}, the kind of line that gets a defensive coordinator to send a text.",
			"{team} won the game on the defensive end and {player} was most of the reason: {blk} blocks, {stl}, and a paint {opp} never got comfortable in.",
		],
	});

	TPL({
		kind: "bench spark", group: "regular season", p: 0.55,
		when: (d) => Math.min(0.98, d.g.when || 0.5),
		find: (ctx) => {
			let best = null;
			for (const p of ctx.ncaa.filter((x) => x.stats && x.stats.mpg <= 27 &&
				(x.isReserve || x.minutesRank >= 5))) {
				for (const g of gamesWith(p, (x) => x.pts >= 17)) {
					if (!best || g.pts > best.g.pts) best = { p, g };
				}
			}
			return best;
		},
		slots: ({ p, g }) => ({
			player: PL(p.name, p.key), team: TM(p.newCollege), opp: TM(g.opp),
			pts: T(String(g.pts)), min: T(String(g.min)), result: T(nightText(g)),
			avg: T(p.stats.ppg.toFixed(1)),
		}),
		headlines: [
			"Off the bench, {player} drops {pts}",
			"{player} gives {team} {pts} in {min} minutes",
			"The sixth man steals the show: {player}",
		],
		bodies: [
			"{player} does not start for {team}. He scored {pts} in {min} minutes against {opp} anyway, in {result}, and the rotation question will be asked at practice tomorrow.",
			"A {avg}-a-game reserve had the night of his season: {player}, {pts} points off the bench against {opp}.",
			"{team} got {pts} points from {player} in {min} minutes, which is more than the starters managed in twice the time. {opp} never adjusted.",
		],
	});

	TPL({
		kind: "iron man", group: "regular season", p: 0.5, when: 0.96,
		find: (ctx) => {
			const cand = ctx.ncaa.filter((p) => p.stats && p.stats.mpg >= 34.5 &&
				p.gameLog && !p.gameLog.injury && p.stats.gp >= 30);
			return cand.length ? bestBy(cand, (p) => p.stats.mpg) : null;
		},
		slots: (p) => ({
			player: PL(p.name, p.key), team: TM(p.newCollege), mpg: T(p.stats.mpg.toFixed(1)),
			gp: T(String(p.stats.gp)),
		}),
		headlines: [
			"{player} has not sat down all year",
			"{mpg} minutes a night: the iron man of {team}",
			"{player}, every game, nearly every minute",
		],
		bodies: [
			"{player} has played all {gp} of {team}'s games at {mpg} minutes a night. The coaching staff has stopped pretending there is a plan to rest him.",
			"There is a version of {team} without {player} on the floor and nobody has seen it: {gp} games, {mpg} minutes each, no nights off.",
			"{mpg} minutes a game over {gp} games. {player} is the reason {team}'s bench is short and the reason it does not matter.",
		],
	});

	TPL({
		kind: "home fortress", group: "regular season", p: 0.6, when: 0.97,
		find: (ctx) => {
			const cand = ctx.teamList.filter((t) => {
				const home = gamesOf(t).filter((g) => g.home > 0 && g.stage === "reg");
				return home.length >= 12 && home.every((g) => g.won);
			});
			return cand.length ? bestBy(cand, (t) => t.w) : null;
		},
		slots: (t) => ({
			team: TM(t.name), n: T(String(gamesOf(t).filter((g) => g.home > 0 && g.stage === "reg").length)),
			record: T(t.w + "-" + t.l), conf: T(t.conf),
		}),
		headlines: [
			"Nobody wins at {team}",
			"{team} finishes {n}-0 at home",
			"A perfect home season for {team}",
		],
		bodies: [
			"{team} did not lose a home game this season: {n} of them, {n} wins. The {conf} schedule brought everybody through the building and everybody left the same way.",
			"{n}-0 at home. {team}'s {record} season was built on a floor where the visitors never had a chance.",
			"The last team to win at {team} did it last season. This year the count is {n} games, {n} wins, and a crowd that expects it now.",
		],
	});

	TPL({
		kind: "road warriors", group: "regular season", p: 0.55, when: 0.95,
		find: (ctx) => {
			const cand = ctx.teamList.map((t) => {
				const away = gamesOf(t).filter((g) => g.home < 0 && g.stage === "reg");
				const w = away.filter((g) => g.won).length;
				return { t, w, l: away.length - w };
			}).filter((x) => x.w + x.l >= 8 && x.w / (x.w + x.l) >= 0.8 && x.w >= 8);
			return cand.length ? bestBy(cand, (x) => x.w - x.l) : null;
		},
		slots: ({ t, w, l }) => ({
			team: TM(t.name), road: T(w + "-" + l), conf: T(t.conf),
			coach: T(t.coach ? t.coach.name : "the staff"),
		}),
		headlines: [
			"{team} would rather play away",
			"{road} on the road: {team} travels well",
			"The best road team in the {conf} is {team}",
		],
		bodies: [
			"{team} is {road} away from home this season, which is the best road record in the {conf} and better than most teams manage at home.",
			"{coach} has a team that does not mind a hostile gym: {team} went {road} on the road, and the wins were not the easy ones.",
			"A {road} road record is the kind of number the committee looks at twice. {team} earned every one of those wins somewhere else.",
		],
	});

	TPL({
		kind: "overtime specialists", group: "regular season", p: 0.55, when: 0.94,
		find: (ctx) => {
			const cand = ctx.teamList.map((t) => {
				const ot = gamesOf(t).filter((g) => g.ot);
				return { t, n: ot.length, w: ot.filter((g) => g.won).length };
			}).filter((x) => x.n >= 3 && x.w === x.n);
			return cand.length ? bestBy(cand, (x) => x.n) : null;
		},
		slots: ({ t, n }) => ({
			team: TM(t.name), n: T(String(n)), record: T(t.w + "-" + t.l),
		}),
		headlines: [
			"{team} does not lose in overtime",
			"{n} overtime games, {n} wins for {team}",
			"Extra time belongs to {team}",
		],
		bodies: [
			"{team} has gone to overtime {n} times this season and won all {n}. A {record} team that plays its best basketball after the fortieth minute.",
			"{n}-0 in overtime. Whatever {team} does in the huddle before the extra period, the rest of the league would like the notes.",
			"Every overtime game {team} has played this year it has won — {n} of them. The record says {record}; the overtime record says something about the nerve.",
		],
	});

	TPL({
		kind: "blowout of the year", group: "regular season", p: 0.5,
		when: (d) => Math.min(0.98, d.g.when || 0.5),
		find: (ctx) => {
			let best = null;
			for (const t of ctx.teamList) {
				for (const g of gamesOf(t)) {
					if (!g.won || g.stage !== "reg" || !Number.isFinite(g.pf)) continue;
					if (g.pf - g.pa >= 40 && (!best || g.pf - g.pa > best.g.pf - best.g.pa)) best = { t, g };
				}
			}
			return best;
		},
		slots: ({ t, g }) => ({
			team: TM(t.name), opp: TM(g.opp), score: T(g.pf + "-" + g.pa),
			margin: T(String(g.pf - g.pa)),
		}),
		headlines: [
			"{team} wins by {margin}",
			"{score}: {team} runs {opp} out of the building",
			"The rout of the year: {team} over {opp}",
		],
		bodies: [
			"{team} beat {opp} {score} on a night when nothing went the visitors' way. The starters sat for the last twelve minutes and the margin still grew.",
			"A {margin}-point win. {team} led {opp} from the first possession and the second half was a scrimmage with the clock running.",
			"{opp} will want to forget {score}. {team} will not let them: it is the largest margin in the country this season.",
		],
	});

	TPL({
		kind: "new league debut", group: "regular season", p: 0.7, when: 0.9,
		find: (ctx) => {
			const moved = ctx.teamList.filter((t) => t.movedFrom);
			if (!moved.length) return null;
			return bestBy(moved, (t) => t.cw - t.cl);
		},
		slots: (t, ctx) => {
			const pool = ctx.teamList.filter((x) => x.conf === t.conf)
				.sort((a, b) => (b.cw - b.cl) - (a.cw - a.cl) || b.rating - a.rating);
			return {
				team: TM(t.name), from: T(t.movedFrom), to: T(t.conf),
				fromProg: T(global.Text.withArticle(t.movedFrom + " program")),
				place: T(ordinal(pool.indexOf(t) + 1)), conf: T(t.cw + "-" + t.cl),
			};
		},
		headlines: [
			"{team}'s first year in the {to}: {place}",
			"Welcome to the {to}: {team} finishes {conf}",
			"{team} settles in after leaving the {from}",
		],
		bodies: [
			"{team} left the {from} for the {to} and finished {place} in its first season, {conf} in league play. The move was about money; the standings say it was also about basketball.",
			"A year ago {team} was {fromProg}. It finished {place} in the {to} at {conf}, which is about where the people who made the move said it would.",
			"The {to} added {team} this season and got a {conf} team that finished {place}. Nobody in the old league is surprised.",
		],
	});

	TPL({
		kind: "cup winner abroad", group: "abroad", p: 0.7, when: 0.85,
		find: (ctx) => {
			const cand = (ctx.res.players || []).filter((p) => p.nonNcaa && p.proTeam &&
				p.proTeam.cupChamp && p.stats);
			return cand.length ? bestBy(cand, (p) => p.stats.ppg) : null;
		},
		slots: (p) => ({
			player: PL(p.name, p.key), club: T(p.proClub), league: T(p.newCollege),
			ppg: T(p.stats.ppg.toFixed(1)),
		}),
		headlines: [
			"{player} wins a cup with {club}",
			"Silverware for {player}: {club} take the cup",
			"{club}, and {player}, lift the domestic cup",
		],
		bodies: [
			"{club} won the domestic cup, and {player} — averaging {ppg} points in the {league} this season — was on the floor for the final. A trophy on a draft résumé at nineteen.",
			"{player}'s season in the {league} ends with a medal: {club} beat the field in the cup, and the American scouts in the building got a look at a prospect who plays in finals.",
			"The cup final was the biggest game {player} has played in, and {club} won it. {ppg} points a night in the league; the final was about the other things.",
		],
	});

	TPL({
		kind: "season abroad, no playoffs", group: "abroad", p: 0.65, when: 0.9,
		find: (ctx) => {
			/* A club that missed the playoffs, was relegated, or finished in
			   the bottom two of a league with no drop: the same season either
			   way, and the numbers of a prospect on it should be read that way. */
			const cand = (ctx.res.players || []).filter((p) => p.nonNcaa && p.proTeam &&
				p.stats && p.proTeam.standing && (p.proTeam.relegated ||
					/missed the playoffs|relegated/.test(String(p.proTeam.finish || ""))));
			return cand.length ? bestBy(cand, (p) => p.stats.mpg) : null;
		},
		slots: (p) => ({
			player: PL(p.name, p.key), club: T(p.proClub), league: T(p.newCollege),
			record: T(p.proTeam.w + "-" + p.proTeam.l),
			place: T(ordinal(p.proTeam.standing)),
			fate: T(p.proTeam.relegated ? "and were relegated from" : "and missed the playoffs in"),
			fate2: T(p.proTeam.relegated ? "the drop" : "no playoffs"),
		}),
		headlines: [
			"{club} sink, and {player} goes to the draft",
			"A season at the wrong end of the table for {club}: {player}'s difficult year",
			"{player} spent his draft year on a losing club",
			"{place} in the {league}: no postseason for {player}",
		],
		bodies: [
			"{club} finished {record}, {fate} the {league}. {player} played through all of it, which scouts count for something — a prospect who has lost a lot of games and kept working.",
			"A {record} season and {fate2}. {player}'s draft year came at a club that was never going to give him a winning environment, and his numbers should be read that way.",
			"{player} will not be back at {club} whatever happens on draft night; the club finished {place}, {record}, {fate} the {league}. The tape survives the standings.",
		],
	});

	TPL({
		kind: "continental run", group: "abroad", p: 0.7, when: 0.88,
		find: (ctx) => {
			const cand = (ctx.res.players || []).filter((p) => p.nonNcaa && p.proTeam &&
				p.proTeam.continental && p.proTeam.continental.result !== "group stage" &&
				p.stats);
			return cand.length ? bestBy(cand, (p) => p.stats.ppg) : null;
		},
		slots: (p) => ({
			player: PL(p.name, p.key), club: T(p.proClub), comp: T(p.proTeam.continental.competition),
			compRun: T(global.Text.withArticle(p.proTeam.continental.competition + " run")),
			result: T(p.proTeam.continental.result), ppg: T(p.stats.ppg.toFixed(1)),
		}),
		headlines: [
			"{club} reach the {comp} {result} with {player} aboard",
			"{player} plays on the continental stage",
			"{compRun} for {club} and its teenage prospect",
		],
		bodies: [
			"{club}'s {comp} season ended at the {result}, and {player} was part of it — the biggest games of his young career, against the best clubs on the continent.",
			"{player} averaged {ppg} points domestically this season. The {comp} was the harder test, and {club} took it as far as the {result}.",
			"For a draft prospect, {compRun} is a scouting event: {player} and {club} went to the {result}, and the tape from those nights will be watched more than anything from the league.",
		],
	});

	TPL({
		kind: "career night in a loss", group: "regular season", p: 0.5,
		when: (d) => Math.min(0.98, d.g.when || 0.5),
		find: (ctx) => {
			let best = null;
			for (const p of ctx.ncaa) {
				const g = p.gameLog && p.gameLog.best;
				if (!g || g.won || !Number.isFinite(g.pf) || g.pts < 27 || g.pa - g.pf < 12) continue;
				if (!best || g.pts > best.g.pts) best = { p, g };
			}
			return best;
		},
		slots: ({ p, g }) => ({
			player: PL(p.name, p.key), team: TM(p.newCollege), opp: TM(g.opp),
			pts: T(String(g.pts)), score: T(g.pa + "-" + g.pf), margin: T(String(g.pa - g.pf)),
		}),
		headlines: [
			"{pts} for {player}, and nobody else showed up",
			"{player}'s season high wasted in {margin}-point loss",
			"A career night for {player}, a bad one for {team}",
		],
		bodies: [
			"{player} scored {pts}, the best night of his season, and {team} lost to {opp} by {margin}, {score}. It is a line scouts will keep and a game his coach will not.",
			"{opp} beat {team} {score} on a night {player} scored {pts}. The rest of the roster combined for not much more.",
			"{pts} points from {player} and a {margin}-point loss to {opp}. There is no version of that box score that reads well for the other four starters.",
		],
	});

	TPL({
		kind: "walk-on to starter", group: "class notebook", p: 0.7, when: -0.1,
		find: (ctx) => {
			const cand = ctx.ncaa.filter((p) => p.transfer && /walk-on/i.test(p.transfer.kind) &&
				p.stats && p.stats.mpg >= 20);
			return cand.length ? bestBy(cand, (p) => p.stats.mpg) : null;
		},
		slots: (p) => ({
			player: PL(p.name, p.key), team: TM(p.newCollege), mpg: T(p.stats.mpg.toFixed(1)),
			ppg: T(p.stats.ppg.toFixed(1)),
		}),
		headlines: [
			"{player} came to {team} without a scholarship. He leaves as a draft pick",
			"The walk-on who started: {player}",
			"No offer, no problem: {player}'s road at {team}",
		],
		bodies: [
			"{player} walked on at {team}. He played {mpg} minutes a night this season, scored {ppg}, and will hear his name on draft night, which is not how the story usually goes.",
			"There is a locker at {team} that was supposed to be a practice player's. {player} turned it into {mpg} minutes and {ppg} points a game.",
			"{player} was not recruited. He is, at {mpg} minutes and {ppg} points for {team}, the best story in the class and one of its better prospects.",
		],
	});

	TPL({
		kind: "double-double machine", group: "regular season", p: 0.55, when: 0.8,
		find: (ctx) => {
			const cand = ctx.ncaa.filter((p) => p.gameLog && p.gameLog.doubleDoubles >= 16);
			return cand.length ? bestBy(cand, (p) => p.gameLog.doubleDoubles) : null;
		},
		slots: (p) => ({
			player: PL(p.name, p.key), team: TM(p.newCollege), n: T(String(p.gameLog.doubleDoubles)),
			rpg: T(p.stats.rpg.toFixed(1)), ppg: T(p.stats.ppg.toFixed(1)),
		}),
		headlines: [
			"{n} double-doubles and counting for {player}",
			"{player} has a double-double most nights",
			"The machine: {player}'s {n} double-doubles",
		],
		bodies: [
			"{player} has {n} double-doubles this season for {team}, on {ppg} points and {rpg} rebounds a night. The nights he does not get one are the news.",
			"{n} double-doubles. {player} is not the flashiest prospect in the class; he is the most reliable line in it.",
			"{team} pencils in {player} for ten and ten before the bus leaves — {n} times this season it has been right.",
		],
	});

	TPL({
		kind: "underclassman award", group: "universe", p: 0.85, when: 1.235,
		find: (ctx) => {
			const fh = (ctx.res.fieldHonors || []).filter((h) => h.futureClass);
			if (!fh.length) return null;
			return fh.sort((a, b) => (global.Awards.awardRank(a.award) - global.Awards.awardRank(b.award)))[0];
		},
		slots: (h) => ({
			player: h.key ? PL(h.name, h.key) : T(h.name), team: TM(h.school), award: T(h.award),
			year: T(String(h.classYear || "").toLowerCase()), cls: T(String(h.futureClass)),
		}),
		headlines: [
			"{player} wins {award} — and he is not draft-eligible yet",
			"The {cls} class already has a winner: {player}",
			"{award} goes to a {year}: {player}",
		],
		bodies: [
			"{player}, a {year} at {team}, was named {award}. He is not in this year's draft — his class is {cls} — which is the kind of thing the scouts already knew and the rest of the country is finding out.",
			"The {award} went to {player} of {team}, a {year} who will not be eligible until {cls}. Front offices have started their file early.",
			"{team}'s {player} took the {award} as a {year}. Circle {cls}: that is the draft he belongs to, and it just got a headline.",
		],
	});

	/* ================================================== eighteen more rows

	   The paper could describe a season and could not describe several of the
	   things a season actually produces. A national champion crowned nobody:
	   the bracket ran, the trophy was handed to a team, and no prospect's
	   page said he was on it. A league title abroad was the same. A national
	   statistical lead — rebounds, assists, blocks — existed in the model
	   (see the rank layer in js/awards.js) and only scoring was ever written
	   up. And the single-game feats the game log already carries — five
	   blocks, a perfect night from the field, a game with no turnovers —
	   were computed every season and never read.

	   Each row below reads something the season already produced. None of
	   them invent a fact. */

	TPL({
		kind: "champion's prospect", group: "postseason", p: 1, when: 1.14,
		find: (ctx) => {
			const champs = ctx.ncaa.filter((p) =>
				(p.awards || []).indexOf("NCAA National Champion") !== -1);
			if (!champs.length) return null;
			return champs.sort((a, b) => (b.stats.ppg || 0) - (a.stats.ppg || 0))[0];
		},
		slots: (p) => ({
			player: PL(p.name, p.key), team: TM(p.newCollege),
			line: T(statBlurb(p.stats)),
			year: T(String(p.classYear).toLowerCase()),
		}),
		headlines: [
			"{player} leaves {team} a national champion",
			"A title, and a draft board: {player}",
			"{player} has a ring and a decision",
		],
		bodies: [
			"{player} finishes the season as a national champion. He averaged {line} for {team}, and the scouts who spent the year arguing about him now have to do it about a player with a title.",
			"The last shot of the season belonged to {team}, and {player} was on the floor for it. A {year} averaging {line}, he goes into the draft with the one line on a résumé nobody can take back.",
			"{team} are national champions and {player} is the prospect who came out of it. {line} across the season; a ring at the end of it.",
		],
	});

	TPL({
		kind: "champion abroad", group: "postseason", p: 1, when: 1.02,
		find: (ctx) => {
			const won = (ctx.res.players || []).filter((p) => p.nonNcaa && p.stats &&
				(p.awards || []).some((a) => / Champion$/.test(a)));
			if (!won.length) return null;
			return ctx.rng.pick(won);
		},
		slots: (p) => ({
			player: PL(p.name, p.key), club: T(p.proClub || p.newCollege),
			league: T(p.newCollege), line: T(statBlurb(p.stats)),
			title: T((p.awards || []).filter((a) => / Champion$/.test(a))[0] || "a league title"),
		}),
		headlines: [
			"{player} wins the {league} with {club}",
			"{club} are champions, and {player} was in the rotation",
			"A title abroad for {player}",
		],
		bodies: [
			"{club} finished the season as {league} champions. {player}, on the roster all year at {line}, is the prospect who comes out of it with {title} beside his name.",
			"The {league} title went to {club}. {player} played his draft year there and averaged {line} doing it.",
			"{player} is a champion before he is a draft pick: {club} took the {league}, and he was part of the rotation that did it.",
		],
	});

	TPL({
		kind: "rebounding title", group: "regular season", p: 0.55, when: 0.99,
		find: (ctx) => {
			const cand = ctx.ncaa.filter((p) => p.stats.gp >= 18 && p.stats.rpg >= 9);
			return cand.length ? bestBy(cand, (p) => p.stats.rpg) : null;
		},
		slots: (p) => ({
			player: PL(p.name, p.key), team: TM(p.newCollege),
			rpg: T(p.stats.rpg.toFixed(1)), orpg: T((p.stats.orpg || 0).toFixed(1)),
		}),
		headlines: [
			"{player} owns the glass: {rpg} a game",
			"Nobody rebounds like {player}",
			"{rpg} rebounds a night for {player}",
		],
		bodies: [
			"{player} finished the season at {rpg} rebounds a game for {team}, {orpg} of them on the offensive end. Rebounding is the one skill scouts believe translates without an argument.",
			"{rpg} a game. {player} spent the season taking the glass away from {team}'s opponents, and the offensive-rebounding number — {orpg} — is the one that will be quoted in the draft room.",
			"The country's leading rebounder plays for {team}. {player} averaged {rpg}, which is the kind of season that survives a bad shooting year.",
		],
	});

	TPL({
		kind: "assist title", group: "regular season", p: 0.55, when: 0.99,
		find: (ctx) => {
			const cand = ctx.ncaa.filter((p) => p.stats.gp >= 18 && p.stats.apg >= 5.5);
			return cand.length ? bestBy(cand, (p) => p.stats.apg) : null;
		},
		slots: (p) => ({
			player: PL(p.name, p.key), team: TM(p.newCollege),
			apg: T(p.stats.apg.toFixed(1)),
			ratio: T((p.stats.apg / Math.max(0.4, p.stats.topg)).toFixed(1)),
		}),
		headlines: [
			"{player} leads the country in assists",
			"{apg} a game: {player} runs everything",
			"The passer of the year plays at {team}",
		],
		bodies: [
			"{player} averaged {apg} assists for {team}, against an assist-to-turnover ratio of {ratio}. A passer who does not give it away is a rarer thing than a passer.",
			"{apg} assists a game. Everything {team} ran went through {player}, and the turnover column — a ratio of {ratio} — says he could carry it.",
			"Nobody in the country set up more shots than {player}. {apg} a game for {team}, at {ratio} assists per turnover.",
		],
	});

	TPL({
		kind: "shot-blocking title", group: "regular season", p: 0.55, when: 0.98,
		find: (ctx) => {
			const cand = ctx.ncaa.filter((p) => p.stats.gp >= 18 && p.stats.bpg >= 2.2);
			return cand.length ? bestBy(cand, (p) => p.stats.bpg) : null;
		},
		slots: (p) => ({
			player: PL(p.name, p.key), team: TM(p.newCollege),
			bpg: T(p.stats.bpg.toFixed(1)), drtg: T(Number.isFinite(p.stats.drtg)
				? p.stats.drtg.toFixed(1) : "an elite number"),
		}),
		headlines: [
			"{player} blocks {bpg} a game",
			"The rim belongs to {player}",
			"{team} give up nothing at the rim",
		],
		bodies: [
			"{player} averaged {bpg} blocks a game for {team}. The defensive rating that came with it — {drtg} — says the shots he did not block were the ones that mattered.",
			"{bpg} blocks a night. {player} spent the season deciding what {team}'s opponents were allowed to attempt, which is worth more than the column says.",
			"Nobody protected a rim like {player} this season: {bpg} a game, and a defensive rating of {drtg} behind it.",
		],
	});

	TPL({
		kind: "block party", group: "regular season", p: 0.6,
		when: (g) => g.when,
		find: (ctx) => {
			let best = null;
			for (const p of ctx.ncaa) {
				for (const g of logGames(p)) {
					if (g.blk >= 5 && (!best || g.blk > best.blk)) {
						best = Object.assign({}, g, { p });
					}
				}
			}
			return best;
		},
		slots: (g) => ({
			player: PL(g.p.name, g.p.key), team: TM(g.p.newCollege),
			opp: T(g.opp), n: T(String(g.blk)), score: T(scoreText(g)),
			result: T(g.won ? "won" : "lost"),
		}),
		headlines: [
			"{player} blocks {n} against {opp}",
			"{n} blocks in one night for {player}",
			"{player} turns the paint into a wall",
		],
		bodies: [
			"{player} blocked {n} shots against {opp}, a game {team} {result} {score}. Nights like that are why a rim protector is scouted on tape rather than on averages.",
			"{n} blocks. {team} {result} {score} against {opp}, and {player} spent the second half daring them to come inside anyway.",
			"Against {opp}, {player} put up {n} blocks in a {score} game {team} {result}. The number is real; the deterrence is the part nobody counts.",
		],
	});

	TPL({
		kind: "steal spree", group: "regular season", p: 0.6,
		when: (g) => g.when,
		find: (ctx) => {
			let best = null;
			for (const p of ctx.ncaa) {
				for (const g of logGames(p)) {
					if (g.stl >= 5 && (!best || g.stl > best.stl)) {
						best = Object.assign({}, g, { p });
					}
				}
			}
			return best;
		},
		slots: (g) => ({
			player: PL(g.p.name, g.p.key), team: TM(g.p.newCollege),
			opp: T(g.opp), n: T(String(g.stl)), score: T(scoreText(g)),
			result: T(g.won ? "won" : "lost"),
		}),
		headlines: [
			"{player} takes {n} away from {opp}",
			"{n} steals for {player}",
			"{player} spends the night in the passing lanes",
		],
		bodies: [
			"{player} had {n} steals against {opp} in a game {team} {result} {score}. Hands like that decide possessions before a defense has to make a decision.",
			"{n} steals in one game. {team} {result} {score} against {opp}, and {player} was the reason the ball kept changing ends.",
			"{opp} could not get the ball where they wanted it: {player} finished with {n} steals in a {score} game {team} {result}.",
		],
	});

	TPL({
		kind: "perfect from the field", group: "regular season", p: 0.55,
		when: (g) => g.when,
		find: (ctx) => {
			let best = null;
			for (const p of ctx.ncaa) {
				for (const g of logGames(p)) {
					if (g.fga >= 6 && g.fgm === g.fga &&
						(!best || g.fga > best.fga)) {
						best = Object.assign({}, g, { p });
					}
				}
			}
			return best;
		},
		slots: (g) => ({
			player: PL(g.p.name, g.p.key), team: TM(g.p.newCollege),
			opp: T(g.opp), n: T(g.fgm + "-for-" + g.fga), pts: T(String(g.pts)),
			score: T(scoreText(g)), result: T(g.won ? "won" : "lost"),
		}),
		headlines: [
			"{player} does not miss: {n} against {opp}",
			"A perfect night for {player}",
			"{n} from the floor for {player}",
		],
		bodies: [
			"{player} went {n} from the field against {opp}, finishing with {pts} points in a game {team} {result} {score}. A perfect shooting night is usually a shot-selection story before it is a shooting one.",
			"{n}. {player} did not miss a shot against {opp}, scored {pts}, and {team} {result} {score}.",
			"Against {opp}, {player} took what the defense gave him and made all of it: {n} for {pts} points in a {score} game {team} {result}.",
		],
	});

	TPL({
		kind: "turnover-free night", group: "regular season", p: 0.5,
		when: (g) => g.when,
		find: (ctx) => {
			let best = null;
			for (const p of ctx.ncaa) {
				for (const g of logGames(p)) {
					if (g.tov === 0 && g.ast >= 5 && g.min >= 24 &&
						(!best || g.ast > best.ast)) {
						best = Object.assign({}, g, { p });
					}
				}
			}
			return best;
		},
		slots: (g) => ({
			player: PL(g.p.name, g.p.key), team: TM(g.p.newCollege),
			opp: T(g.opp), ast: T(String(g.ast)), min: T(String(g.min)),
			score: T(scoreText(g)), result: T(g.won ? "won" : "lost"),
		}),
		headlines: [
			"{ast} assists, no turnovers for {player}",
			"{player} plays a clean {min} minutes",
			"Nothing given away: {player} against {opp}",
		],
		bodies: [
			"{player} played {min} minutes against {opp} with {ast} assists and not a single turnover. {team} {result} {score}. Front offices keep that box score.",
			"{ast} and none. {player}'s line against {opp} carried no turnovers in {min} minutes, in a game {team} {result} {score}.",
			"A guard's cleanest possible night: {ast} assists, zero turnovers, {min} minutes. {team} {result} {score} against {opp}.",
		],
	});

	TPL({
		kind: "double-figure streak", group: "regular season", p: 0.5, when: 0.93,
		find: (ctx) => {
			const cand = ctx.ncaa.filter((p) => {
				const g = logGames(p);
				return g.length >= 18 && g.every((x) => x.pts >= 10);
			});
			return cand.length ? bestBy(cand, (p) => p.stats.ppg) : null;
		},
		slots: (p) => ({
			player: PL(p.name, p.key), team: TM(p.newCollege),
			n: T(String(logGames(p).length)), ppg: T(p.stats.ppg.toFixed(1)),
			low: T(String(Math.min.apply(null, logGames(p).map((g) => g.pts)))),
		}),
		headlines: [
			"{player} has not been held under ten all season",
			"{n} games, {n} double figures for {player}",
			"The most reliable scorer in the country: {player}",
		],
		bodies: [
			"{player} scored in double figures in every one of his {n} games for {team}. His worst night was {low} points; his average is {ppg}. Consistency is the part of a scoring average nobody prints.",
			"{n} for {n}. {player} has not had a single-figure night this season, on {ppg} a game, with a floor of {low}.",
			"{team} know exactly what they are getting: {player} averaged {ppg} and never once finished below ten, across all {n} games.",
		],
	});

	TPL({
		kind: "one-man team", group: "regular season", p: 0.55, when: 0.9,
		find: (ctx) => {
			const cand = ctx.ncaa.filter((p) => p.shareOf &&
				p.shareOf.pts >= 0.28 && p.stats.gp >= 18);
			return cand.length ? bestBy(cand, (p) => p.shareOf.pts) : null;
		},
		slots: (p) => ({
			player: PL(p.name, p.key), team: TM(p.newCollege),
			share: T((p.shareOf.pts * 100).toFixed(0)),
			ppg: T(p.stats.ppg.toFixed(1)), usg: T((p.stats.usg * 100).toFixed(1)),
		}),
		headlines: [
			"{share}% of {team}'s offense is {player}",
			"{player} is the whole plan at {team}",
			"One man, one offense: {player}",
		],
		bodies: [
			"{player} scored {share}% of {team}'s points this season, on a usage rate of {usg}%. {ppg} a game is the headline; the share is the scouting question — nobody knows what he looks like next to other good players.",
			"{share}% of everything. {player} averaged {ppg} for {team} at {usg}% usage, which is a workload almost nobody carries into the league intact.",
			"The tape on {player} is the tape on {team}: {share}% of the points, {usg}% of the possessions, {ppg} a game.",
		],
	});

	TPL({
		kind: "league romp", group: "regular season", p: 0.6, when: 0.99,
		find: (ctx) => {
			const cand = ctx.teamList.filter((t) => t.cw + t.cl >= 14 && t.cl <= 1);
			return cand.length ? bestBy(cand, (t) => t.cw - t.cl) : null;
		},
		slots: (t) => ({
			team: TM(t.name), conf: T(t.conf),
			record: T(t.cw + "-" + t.cl), overall: T(t.regW + "-" + t.regL),
		}),
		headlines: [
			"{team} go {record} in the {conf}",
			"The {conf} was not a race",
			"{team} run through their league",
		],
		bodies: [
			"{team} finished {record} in the {conf}, {overall} overall. A league title decided in February is a résumé the committee reads in one line.",
			"{record}. Nobody in the {conf} came close to {team}, who are {overall} on the season and have been the answer since the schedule turned over.",
			"The {conf} title went to {team} at {record}. At {overall} overall, the only remaining question about them is a bracket one.",
		],
	});

	TPL({
		kind: "one-bid league", group: "postseason", p: 0.5, when: 1.03,
		find: (ctx) => {
			const sel = ctx.res.tourney && ctx.res.tourney.selection;
			if (!sel || !sel.byConf) return null;
			const single = Object.keys(sel.byConf).filter((c) => sel.byConf[c] === 1);
			if (!single.length) return null;
			const conf = ctx.rng.pick(single);
			const team = sel.field.filter((t) => t.conf === conf)[0];
			return team ? { conf, team } : null;
		},
		slots: (x) => ({
			team: TM(x.team.name), conf: T(x.conf),
			seed: T(String(x.team.ncaaSeed || 16)),
			record: T(x.team.regW + "-" + x.team.regL),
		}),
		headlines: [
			"The {conf} sends one, and it is {team}",
			"{team} carry the {conf} alone",
			"A one-bid league gets its bid: {team}",
		],
		bodies: [
			"{team} are the {conf}'s only team in the field, a No. {seed} seed at {record}. For a one-bid league the conference tournament is the season, and this is what winning it is for.",
			"One bid, one team: {team} at {record}, seeded {seed}. The rest of the {conf} is watching.",
			"The {conf} got exactly one team into the bracket. {team}, {record}, a No. {seed} seed, and a scouting audience they have not had all year.",
		],
	});

	TPL({
		kind: "efficiency king", group: "regular season", p: 0.5, when: 0.96,
		find: (ctx) => {
			const cand = ctx.ncaa.filter((p) => p.stats.gp >= 18 &&
				p.stats.ppg >= 13 && Number.isFinite(p.stats.ts) && p.stats.ts >= 0.60);
			return cand.length ? bestBy(cand, (p) => p.stats.ts) : null;
		},
		slots: (p) => {
			/* Effective field-goal percentage is DERIVED (see DERIVED in
			   js/views.js), not a field on the stat line — reading
			   `stats.efg` printed "NaN% effective field-goal percentage" in
			   a finished article. */
			const st = p.stats;
			const efg = st.fga > 0
				? (st.fgp * st.fga + 0.5 * st.tpp * st.tpa) / st.fga : st.fgp;
			return {
				player: PL(p.name, p.key), team: TM(p.newCollege),
				ts: T((st.ts * 100).toFixed(1)), ppg: T(st.ppg.toFixed(1)),
				efg: T((efg * 100).toFixed(1)),
			};
		},
		headlines: [
			"{player} scores {ppg} on {ts}% true shooting",
			"The most efficient scorer in the country: {player}",
			"{player} does not waste a possession",
		],
		bodies: [
			"{player} averaged {ppg} points a game for {team} at {ts}% true shooting and {efg}% effective field-goal percentage. Volume with that efficiency behind it is the combination that survives a level jump.",
			"{ts}% true shooting on {ppg} a game. Whatever {team} asked {player} to do, he did it without giving anything back.",
			"Efficiency at volume is the rarest thing on a draft board, and {player} has it: {ppg} a game on {ts}% true shooting for {team}.",
		],
	});

	TPL({
		kind: "living at the line", group: "regular season", p: 0.5, when: 0.94,
		find: (ctx) => {
			const cand = ctx.ncaa.filter((p) => p.stats.gp >= 18 && p.stats.fta >= 5 &&
				p.stats.fga >= 6 && p.stats.fta / p.stats.fga >= 0.44);
			return cand.length ? bestBy(cand, (p) => p.stats.fta / p.stats.fga) : null;
		},
		slots: (p) => ({
			player: PL(p.name, p.key), team: TM(p.newCollege),
			fta: T(p.stats.fta.toFixed(1)), ftr: T((100 * p.stats.fta / p.stats.fga).toFixed(0)),
			ftp: T((p.stats.ftp * 100).toFixed(1)),
		}),
		headlines: [
			"{player} lives at the free-throw line",
			"{fta} free throws a game for {player}",
			"Nobody gets fouled like {player}",
		],
		bodies: [
			"{player} attempted {fta} free throws a game for {team} — {ftr} of them for every hundred field-goal attempts — and made {ftp}% of them. Drawing fouls is a skill that does not appear in a highlight package and never stops working.",
			"{fta} a game from the line, at {ftp}%. {player} spends the second half of games at {team} turning contact into points.",
			"The most-fouled player in the country plays for {team}: {player}, at a free-throw rate of {ftr} and {ftp}% once he gets there.",
		],
	});

	TPL({
		kind: "national team call-up", group: "offseason", p: 0.6, when: -0.15,
		find: (ctx) => {
			const cand = (ctx.res.players || []).filter((p) => p.nonNcaa &&
				p.proPath && p.proPath.caps);
			return cand.length ? ctx.rng.pick(cand) : null;
		},
		slots: (p) => ({
			player: PL(p.name, p.key), club: T(p.proClub || p.newCollege),
			country: T(p.proPath.caps.country), n: T(String(p.proPath.caps.n)),
			level: T(p.proPath.caps.level === "senior"
				? "the senior side" : "the " + p.proPath.caps.level + " side"),
		}),
		headlines: [
			"{player} called up by {country}",
			"{country} name {player} to {level}",
			"An international summer for {player}",
		],
		bodies: [
			"{player} has {n} caps for {country} at {level}. A prospect who has played competitive international basketball has done something the college calendar cannot show a scout.",
			"{country} called {player} in again: {n} caps now, with {level}, alongside his season at {club}.",
			"The summer file on {player} is longer than the winter one. {n} appearances for {country} with {level}, and a club season at {club} either side of it.",
		],
	});

	TPL({
		kind: "loan spell", group: "offseason", p: 0.55, when: -0.25,
		find: (ctx) => {
			const cand = (ctx.res.players || []).filter((p) => p.nonNcaa &&
				p.proPath && p.proPath.loan);
			return cand.length ? ctx.rng.pick(cand) : null;
		},
		slots: (p) => ({
			player: PL(p.name, p.key), club: T(p.proClub || p.newCollege),
			where: T(p.proPath.loan.where), league: T(p.newCollege),
			span: T(p.proPath.loan.season === 1 ? "a season" : "two seasons"),
		}),
		headlines: [
			"{player} spent {span} on loan",
			"The minutes {player} could not get at {club}",
			"{player}'s development took a detour",
		],
		bodies: [
			"{player} was loaned to {where} for {span} before returning to {club}. A loan is how a European club admits a nineteen-year-old needs to play, and it is usually the most informative year on the file.",
			"Before this season at {club}, {player} spent {span} at {where}. Scouts who followed the {league} only will have missed the year that made him.",
			"A detour of {span} at {where}, then back to {club}. {player}'s route through the {league} is the ordinary one, and the loan tape is the tape worth watching.",
		],
	});

	TPL({
		kind: "portal regret", group: "regular season", p: 0.5, when: 0.88,
		find: (ctx) => {
			const cand = ctx.ncaa.filter((p) => p.transfer && p.transfer.from &&
				p.transfer.direction === "up" && p.stats.gp >= 12);
			const bad = cand.filter((p) => {
				const t = ctx.teams[p.newCollege];
				return t && t.regL > t.regW;
			});
			return bad.length ? bestBy(bad, (p) => p.stats.ppg) : null;
		},
		slots: (p, ctx) => {
			const t = ctx.teams[p.newCollege];
			return {
				player: PL(p.name, p.key), to: TM(p.newCollege), from: T(p.transfer.from),
				record: T(t.regW + "-" + t.regL), ppg: T(p.stats.ppg.toFixed(1)),
			};
		},
		headlines: [
			"{player} moved up and the season went down",
			"A hard first year at {to} for {player}",
			"{player} left {from} for this",
		],
		bodies: [
			"{player} transferred up to {to} and averaged {ppg} for a team that finished {record}. The portal is a bet on a situation, and this one did not come in.",
			"{ppg} a game, on a {record} team. {player}'s move from {from} to {to} was the right kind of move and the wrong year to make it.",
			"{to} finished {record}. {player} came from {from} for a bigger stage and got {ppg} a game on a losing one, which is a harder year to scout than a good one.",
		],
	});

	TPL({
		kind: "recruiting battle", group: "offseason", p: 0.7, when: -0.75,
		find: (ctx) => {
			const cand = ctx.ncaa.filter((p) => p.recruiting &&
				p.classYear === "Freshman" && !(p.transfer && p.transfer.from) &&
				p.recruiting.finalists && p.recruiting.finalists.length >= 3);
			if (!cand.length) return null;
			return cand.sort((a, b) => a.recruiting.rank - b.recruiting.rank)[0];
		},
		slots: (p) => {
			const rec = p.recruiting;
			const lost = rec.finalists.slice(1);
			return {
				player: PL(p.name, p.key), to: TM(rec.committed),
				rank: T(String(rec.rank)), stars: T(String(rec.stars)),
				lost: T(lost.join(", ")), first: T(lost[0] || "the field"),
				offers: T(String(rec.offerCount || rec.finalists.length)),
			};
		},
		headlines: [
			"{to} win the race for {player}",
			"{player} picks {to} over {first}",
			"The No. {rank} recruit is off the board",
		],
		bodies: [
			"{player}, the No. {rank} player in his class, chose {to} over {lost}. He held {offers} offers and cut it to four before Christmas; the staff that got him has been on him since his sophomore year.",
			"{offers} offers, a final list of {to}, {lost}, and a {stars}-star committing to {to}. {player} is the kind of signing a program points at for a decade.",
			"It came down to {to} and {lost}. {player} picked {to}, which is the answer the recruiting industry expected and the one the other staffs will spend the summer explaining.",
		],
	});

	TPL({
		kind: "all-star game", group: "offseason", p: 0.65, when: -0.62,
		find: (ctx) => {
			const cand = ctx.ncaa.filter((p) => p.recruiting &&
				p.recruiting.allStar && p.recruiting.allStar.length);
			if (!cand.length) return null;
			return cand.sort((a, b) =>
				(b.recruiting.allStar.length - a.recruiting.allStar.length) ||
				(a.recruiting.rank - b.recruiting.rank))[0];
		},
		slots: (p) => ({
			player: PL(p.name, p.key), to: TM(p.newCollege),
			games: T(p.recruiting.allStar.join(" and the ")),
			first: T(p.recruiting.allStar[0]),
			rank: T(String(p.recruiting.rank)),
		}),
		headlines: [
			"{player} named to the {first}",
			"April's all-star circuit runs through {player}",
			"{player} plays his way through the showcase season",
		],
		bodies: [
			"{player} was selected for the {games}. The showcase games are the last time a class is seen together before it scatters, and he arrives at {to} having been measured against all of it.",
			"The No. {rank} player in his class, {player} played in the {games} before enrolling at {to}. Scouts who saw him there saw him against the only defenders his own age who could stay with him.",
			"{first} selection for {player}, on his way to {to}. The all-star games decide nothing and everybody watches them anyway.",
		],
	});

	/* ---------------------------------------------------------------------
	   EIGHT KINDS THE MODEL HAD THE FACTS FOR AND NEVER PRINTED.

	   Every one of these reads something the engine already computes and
	   nothing else wrote about: the Final Four's own award (assigned in
	   js/awards.js and never mentioned in the paper), the earlier seasons on
	   a fourth-year senior, the game log's per-game rows, the coach's tenure
	   and record, the transfer's old school on the schedule, the conference
	   player-of-the-year races the class lost to returning players, the
	   twelve games somebody missed with a shoulder, and the night a bad team
	   beat a good one. */

	TPL({
		kind: "final four mop", group: "ncaa tournament", p: 0.85, when: 1.21,
		find: (ctx) => {
			const mop = ctx.ncaa.filter((p) =>
				(p.awards || []).indexOf("Final Four Most Outstanding Player") !== -1)[0];
			if (!mop) return null;
			const team = ctx.ncaa.filter((p) => p !== mop &&
				(p.awards || []).indexOf("NCAA All-Tournament Team") !== -1)
				.sort((a, b) => b.stats.ppg - a.stats.ppg);
			return { mop, team };
		},
		slots: (f) => ({
			player: PL(f.mop.name, f.mop.key), team: TM(f.mop.newCollege),
			line: T(statBlurb(f.mop.stats)),
			march: T(f.mop.gameLog && f.mop.gameLog.postseason
				? f.mop.gameLog.postseason.ppg.toFixed(1) + " a game in the tournament"
				: "his best basketball in March"),
			others: T(f.team.length
				? f.team.slice(0, 2).map((p) => p.name).join(" and ")
				: "the rest of the floor"),
		}),
		headlines: [
			"{player} is the Most Outstanding Player",
			"The Final Four belonged to {player}",
			"{player} takes the Most Outstanding Player award",
			"They will remember {player} in April",
		],
		bodies: [
			"{player} of {team} was named Most Outstanding Player of the Final Four, on {march}. {others} were named alongside him on the all-tournament team.",
			"The award goes to {player}, who was at {line} for the season and better than that when it mattered. {others} join him on the all-tournament five.",
			"Two games decided it and {player} was the best player in both. {team} has its Most Outstanding Player, and {others} have the other places on the team.",
		],
	});

	TPL({
		kind: "career milestone", group: "regular season", p: 0.6, when: 0.9,
		find: (ctx) => {
			const cand = [];
			for (const p of ctx.ncaa) {
				const prior = (p.priorSeasons || []).filter((r) => r.line && !r.redshirt);
				if (prior.length < 2 || !p.stats.gp) continue;
				let pts = p.stats.ppg * p.stats.gp;
				let gp = p.stats.gp;
				for (const r of prior) { pts += r.line.ppg * r.line.gp; gp += r.line.gp; }
				if (pts < 1200) continue;
				cand.push({ p, pts: Math.round(pts), gp, years: prior.length + 1 });
			}
			return cand.length ? bestBy(cand, (c) => c.pts) : null;
		},
		slots: (f) => ({
			player: PL(f.p.name, f.p.key), team: TM(f.p.newCollege),
			pts: T(String(f.pts)), gp: T(String(f.gp)),
			years: T(global.Text.plural(f.years, "season")),
			avg: T((f.pts / f.gp).toFixed(1)),
			now: T(f.p.stats.ppg.toFixed(1)),
		}),
		headlines: [
			"{player} passes {pts} career points",
			"{years} and {pts} points for {player}",
			"The long way: {player} reaches {pts}",
			"{player} has been doing this for {years}",
		],
		bodies: [
			"{player} has scored {pts} points in {gp} college games across {years}, at {avg} a night. He is at {now} a game this season, which is the best of them.",
			"{years} at {team}, {gp} games, {pts} points. The one-and-dones get the coverage; {player} has been the best player on his floor since he was a freshman.",
			"A number worth stopping on: {pts} career points for {player}, over {years} and {gp} games. Nobody gets there without staying.",
		],
	});

	TPL({
		kind: "player of the week", group: "regular season", p: 0.7,
		when: (f) => f.g.when,
		find: (ctx) => {
			const out = [];
			for (const p of ctx.ncaa) {
				for (const g of logGames(p)) {
					if (g.stage !== "reg" || !g.won || g.pts < 28) continue;
					out.push({ p, g });
				}
			}
			return out.length ? ctx.rng.pick(out) : null;
		},
		slots: (f) => ({
			player: PL(f.p.name, f.p.key), team: TM(f.p.newCollege),
			opp: TM(f.g.opp), conf: T(f.p.conf || "his conference"),
			pts: T(String(f.g.pts)),
			reb: T(global.Text.plural(f.g.reb, "rebound")),
			ast: T(global.Text.plural(f.g.ast, "assist")),
			score: T(f.g.pf + "-" + f.g.pa),
			month: T(dateline(f.g.when)),
		}),
		headlines: [
			"{conf} player of the week: {player}",
			"{player} takes the weekly award",
			"A {pts}-point week for {player}",
			"The league's best week belonged to {player}",
		],
		bodies: [
			"{player} was named {conf} player of the week after {pts} points, {reb} and {ast} in the win over {opp}, {score}.",
			"{pts} points, {reb} and {ast} against {opp} in {month}, and {team} won {score}. The {conf} gave {player} the weekly award for it.",
			"The weekly honor is a small thing that adds up. {player} has one for the {pts} he scored on {opp}.",
		],
	});

	TPL({
		kind: "coaching record", group: "regular season", p: 0.5, when: 0.97,
		find: (ctx) => {
			const cand = ctx.teamList.filter((t) => t.coach && t.coach.tenure >= 4 &&
				Number.isFinite(t.regW) && t.regW >= 20);
			return cand.length ? bestBy(cand, (t) => t.regW + (t.prestige || 0) * 0.05) : null;
		},
		slots: (t) => ({
			team: TM(t.name), coach: T(t.coach.name),
			w: T(String(t.regW)), l: T(String(t.regL)),
			years: T(global.Text.plural(t.coach.tenure, "season")),
			nth: T(global.Text.ordinal(t.coach.tenure)),
			conf: T(t.conf),
		}),
		headlines: [
			"{coach}'s best team at {team}",
			"{w} wins in {coach}'s {nth} season",
			"{years} in, and {coach} has {team} where he wants it",
			"{team} wins {w} under {coach}",
		],
		bodies: [
			"{coach} is {w}-{l} in his {nth} season at {team}. It is the kind of record that turns a hire into a tenure.",
			"{years} at {team} and {coach} has a {w}-{l} regular season out of it, in a {conf} that did not make it easy.",
			"The {conf} has spent {years} watching {coach} build this. {team} is {w}-{l}.",
		],
	});

	TPL({
		kind: "facing the old school", group: "regular season",
		p: 0.75, when: (f) => f.g.when,
		find: (ctx) => {
			const out = [];
			for (const p of ctx.ncaa) {
				const from = p.transfer && p.transfer.from;
				if (!from) continue;
				for (const g of logGames(p)) {
					if (g.opp === from) out.push({ p, g, from });
				}
			}
			return out.length ? ctx.rng.pick(out) : null;
		},
		slots: (f) => ({
			player: PL(f.p.name, f.p.key), team: TM(f.p.newCollege),
			old: TM(f.from), pts: T(String(f.g.pts)),
			score: T(f.g.pf + "-" + f.g.pa),
			result: T(f.g.won ? "won" : "lost"),
			month: T(dateline(f.g.when)),
		}),
		headlines: [
			"{player} faces {old}",
			"The game {player} had circled",
			"{player} against the school he left",
			"A return to {old} for {player}",
		],
		bodies: [
			"{player} left {old} for {team} in the offseason and played them in {month}. He scored {pts}, and {team} {result}, {score}.",
			"Every portal season writes one of these. {player} put up {pts} against {old}, the programme he transferred out of, and {team} {result} {score}.",
			"{pts} points against {old}. {player} did not say anything about it afterwards, which is its own kind of statement; {team} {result} the game {score}.",
		],
	});

	TPL({
		kind: "poy race lost", group: "awards", p: 0.7, when: 1.16,
		find: (ctx) => {
			const races = (ctx.res.fieldHonors || [])
				.filter((h) => / Player of the Year$/.test(h.award) &&
					!/Defensive/.test(h.award) && h.school);
			if (!races.length) return null;
			for (const h of ctx.rng.shuffle(races.slice())) {
				const t = ctx.teams[h.school];
				if (!t) continue;
				// The best prospect in that conference — the man who lost it.
				const lost = ctx.ncaa.filter((p) => p.conf === t.conf &&
					p.stats.mpg >= 20)
					.sort((a, b) => (b.scoreProd || 0) - (a.scoreProd || 0))[0];
				if (lost) return { h, lost, conf: t.conf };
			}
			return null;
		},
		slots: (f) => ({
			winner: T(f.h.name), school: TM(f.h.school),
			year: T(String(f.h.classYear || "returner").toLowerCase()),
			award: T(f.h.award), player: PL(f.lost.name, f.lost.key),
			team: TM(f.lost.newCollege), line: T(statBlurb(f.lost.stats)),
		}),
		headlines: [
			"The award the class didn't win: {award}",
			"{winner} beat the draft class to the {award}",
			"{player} finishes second in his own conference",
			"A {year} took the {award}",
		],
		bodies: [
			"The {award} went to {winner}, a {year} at {school} who is not in this draft class. {player} of {team} was at {line} and finished behind him.",
			"{player} had the best season of any prospect in the league and did not win it: the {award} belongs to {winner} of {school}.",
			"Not every honor goes to somebody with a draft grade. {winner}, a {year} at {school}, took the {award} ahead of {player}.",
		],
	});

	TPL({
		kind: "back from injury", group: "regular season",
		p: 0.75, when: (f) => f.g.when,
		find: (ctx) => {
			const out = [];
			for (const p of ctx.ncaa) {
				const inj = p.gameLog && p.gameLog.injury;
				if (!inj || !(inj.games >= 4)) continue;
				const after = logGames(p).filter((g) => g.i > inj.to);
				if (!after.length) continue;
				out.push({ p, inj, g: after[0], back: after.slice(0, 5) });
			}
			return out.length ? ctx.rng.pick(out) : null;
		},
		slots: (f) => ({
			player: PL(f.p.name, f.p.key), team: TM(f.p.newCollege),
			opp: TM(f.g.opp), missed: T(global.Text.plural(f.inj.games, "game")),
			why: T(f.inj.kind), pts: T(String(f.g.pts)), min: T(String(f.g.min)),
			since: T((f.back.reduce((a, g) => a + g.pts, 0) / f.back.length).toFixed(1)),
			n: T(global.Text.plural(f.back.length, "game")),
		}),
		headlines: [
			"{player} is back",
			"{missed} later, {player} returns",
			"The return of {player}",
			"{player} plays his first game since {why}",
		],
		bodies: [
			"{player} missed {missed} with {why} and came back against {opp}: {pts} points in {min} minutes. He has averaged {since} in the {n} since.",
			"{missed} out with {why}, and {player} walked back onto the floor at {team} and scored {pts}. The next {n} say the shot came back with him — {since} a game.",
			"There is a version of this season where {player} does not come back at all. He did, against {opp}, for {pts} in {min} minutes.",
		],
	});

	TPL({
		kind: "upset hero", group: "regular season", p: 0.7, when: (f) => f.g.when,
		find: (ctx) => {
			const out = [];
			for (const p of ctx.ncaa) {
				const t = ctx.teams[p.newCollege];
				if (!t || t.prestige >= 60) continue;
				for (const g of logGames(p)) {
					if (!g.won || g.stage !== "reg" || g.pts < 18) continue;
					const opp = ctx.teams[g.opp];
					if (!opp || !opp.apRank || opp.apRank > 25) continue;
					out.push({ p, g, opp });
				}
			}
			return out.length ? ctx.rng.pick(out) : null;
		},
		slots: (f) => ({
			player: PL(f.p.name, f.p.key), team: TM(f.p.newCollege),
			opp: TM(f.opp.name), rank: T("No. " + f.opp.apRank),
			pts: T(String(f.g.pts)),
			reb: T(global.Text.plural(f.g.reb, "rebound")),
			score: T(f.g.pf + "-" + f.g.pa), min: T(String(f.g.min)),
		}),
		headlines: [
			"{player} beats {rank} {opp} on his own",
			"{pts} from {player}, and {rank} {opp} is beaten",
			"The night {team} had a star",
			"{rank} {opp} had no answer for {player}",
		],
		bodies: [
			"{team} beat {rank} {opp} {score}, and {player} scored {pts} of it with {reb} in {min} minutes. A prospect at a programme like this gets four chances a season to be seen; he took one.",
			"{pts} points against {rank} {opp}. {team} won {score}, which nobody outside the building expected, and {player} is the reason it happened.",
			"There is a particular kind of night that makes a scout book a flight. {player} had one: {pts} points and {reb} in the {score} win over {rank} {opp}.",
		],
	});

	/* The context every row's `find` and `slots` read. Built once per class,
	   because forty-odd rows each recomputing "the NCAA prospects with a stat
	   line" is forty passes over the same array. */
	function templateContext(res, rng) {
		const teams = res.teams || {};
		const teamList = Object.values(teams).filter((t) => t && t.name && t.log);
		const ncaa = (res.players || []).filter((p) => !p.nonNcaa && p.stats);
		const byKey = {};
		for (const p of res.players || []) byKey[p.key] = p;
		return {
			res, teams, teamList, ncaa, byKey, rng,
			season: res.leagueFile && res.leagueFile.startingSeason,
			ranked: (res.poll || []).map((t) => t.name),
			confOf: (name) => {
				const t = teams[name];
				return t && global.Colleges.CONFERENCES[t.conf]
					? global.Colleges.CONFERENCES[t.conf] : null;
			},
		};
	}

	/* Run the table. One rng child per kind, so adding a row cannot change
	   which articles the rows before it produced — the same discipline the
	   phase rngs keep in the engine, and the reason a class stays stable while
	   this table grows. */
	function runTemplates(res, articles, rng) {
		const ctx = templateContext(res, rng);
		for (const tpl of TEMPLATES) {
			const r = rng.child("tpl:" + tpl.kind);
			ctx.rng = r;
			if (r.random() >= (tpl.p === undefined ? 0.6 : tpl.p)) continue;
			let found = null;
			try { found = tpl.find(ctx, r); } catch (e) { found = null; }
			if (!found) continue;
			const list = Array.isArray(found) ? found : [found];
			for (const one of list) {
				let slots;
				try { slots = tpl.slots(one, ctx); } catch (e) { continue; }
				if (!slots) continue;
				articles.push({
					when: typeof tpl.when === "function" ? tpl.when(one, ctx) : tpl.when,
					kind: tpl.kind,
					group: tpl.group,
					headline: fill(r.pick(tpl.headlines), slots),
					body: fill(r.pick(tpl.bodies), slots),
				});
			}
		}
	}

	function build(res) {
		if (!res || !res.players) return [];
		const rng = new Rng("news|" + ((res.cfg && res.cfg.seed) || ""));
		const teams = res.teams || {};
		const articles = [];
		/* Whether a notebook item runs this year. Of fifty-seven article
		   kinds, forty-two fired in every one of forty test classes: the
		   triple-double, the forty-point night, the overtime classic, the
		   scoring title, the poll riser, the stock riser and faller, the
		   conference race — so the table of contents of the paper was the
		   same every season and only the names changed. The material is
		   always there (every season has a longest overtime game); a real
		   desk does not run every one of them every year. The load-bearing
		   kinds — the poll, the bracket, the champion, the awards, the draft
		   — always run. The rest are drawn from the class's own seed. */
		const runs = (p) => rng.random() < p;
		const season = res.leagueFile && res.leagueFile.startingSeason;

		// --- preseason ---------------------------------------------------
		const pre = res.pollHistory && res.pollHistory[0];
		if (pre && pre.ranks.length) {
			articles.push({
				when: -0.2, kind: "preseason poll",
				headline: fill(rng.pick([
					"{one} opens the season at No. 1",
					"The preseason poll is out — {one} on top",
				]), { one: TM(pre.ranks[0].team) }),
				body: [T("The preseason AP poll: ")]
					.concat(pre.ranks.slice(0, 5).flatMap((r, i) => [
						T((i ? ", " : "") + "No. " + r.rank + " "), TM(r.team),
					]))
					.concat([T(". " + (pre.ranks[0].firstPlace || 0) +
						" of " + (global.Rankings ? global.Rankings.VOTERS : 60) +
						" first-place votes went to the top line.")]),
			});
		}

		// --- realignment (an offseason story) -----------------------------
		/* One move is a story; a raid of four is one story too. Six
		   near-identical "Realignment again" articles in a row read like a
		   bug even though each line was correct, so a raid runs as a
		   roundup, the way an offseason notebook writes it. */
		{
			const moves = res.realignment || [];
			if (moves.length === 1) {
				const m = moves[0];
				articles.push({
					when: -0.3, kind: "realignment",
					headline: fill(rng.pick([
						"{school} is leaving the {from}",
						"Realignment again: {school} to the {to}",
					]), { school: TM(m.school), from: T(m.from), to: T(m.to) }),
					body: [TM(m.school), T(" leaves the " + m.from + " for the " +
						m.to + ". The schedule, the conference tournament and the " +
						"all-conference teams follow it.")],
				});
			} else if (moves.length > 1) {
				const to = moves[0].to;
				const sameRaider = moves.every((m) => m.to === to);
				articles.push({
					when: -0.3, kind: "realignment",
					headline: fill(rng.pick(sameRaider ? [
						"The {to} raids {n} programs",
						"Realignment roundup: {n} schools on the move to the {to}",
					] : [
						"Realignment roundup: {n} programs change leagues",
						"The map moves again",
					]), { to: T(to), n: T(String(moves.length)) }),
					body: [T("The offseason's realignment, in one place: ")].concat(
						moves.flatMap((m, i) => [
							T(i ? "; " : ""), TM(m.school),
							T(" from the " + m.from + " to the " + m.to),
						])).concat([T(". The schedules, the conference tournaments " +
							"and the all-conference teams follow.")]),
				});
			}
		}

		// --- class anomalies, spread across the season --------------------
		/* The body used to be the label and nothing else ("a double-double
		   most nights"). The engine has his whole line, so the story carries
		   one concrete number the way the forty-point and title-hero
		   templates already do. */
		const byKey = {};
		for (const p of res.players || []) byKey[p.key] = p;
		(res.surprises || []).forEach((sp, i) => {
			const p = byKey[sp.key];
			const segs = [PL(sp.player, sp.key), T(" — " + global.Text.endSentence(sp.label))];
			if (p && p.stats && p.stats.gp > 0) {
				segs.push(T(" " + statBlurb(p.stats) + " for "));
				segs.push(teams[p.newCollege] ? TM(p.newCollege) : T(p.newCollege || "his club"));
				segs.push(T("."));
			}
			articles.push({
				when: 0.12 + (i * 0.61) % 0.75,
				kind: "prospect story",
				headline: fill(rng.pick(SURPRISE_HEADS),
					{ player: PL(sp.player, sp.key) }),
				body: segs,
			});
		});

		// --- the season's own events --------------------------------------
		for (const e of res.seasonEvents || []) pushEvent(articles, rng, e, teams);

		/* --- the table-driven kinds ----------------------------------
		   Forty-odd more of them, each one a row rather than a block of
		   plumbing. See TEMPLATES. */
		runTemplates(res, articles, rng.child("templates"));

		// --- an injury that actually moved a team --------------------------
		{
			const withKey = {};
			for (const p of res.players || []) withKey[p.key] = p;
			const candidates = [];
			for (const t of Object.values(teams)) {
				for (const o of t.outages || []) {
					const p = withKey[o.who];
					// The anomaly system already tells this story with more
					// color for a player who drew one of its injury kinds;
					// this section is for the ordinary draws it didn't touch.
					if (!p || p.surprise) continue;
					candidates.push({ p, t, o });
				}
			}
			candidates.sort((a, b) => b.o.drop - a.o.drop);
			const worst = candidates[0];
			if (worst && worst.o.drop >= 3 && runs(0.7)) {
				const games = (worst.t.log || []).filter(
					(g) => g.stage === "reg" && g.when >= worst.o.from && g.when <= worst.o.to);
				const w = games.filter((g) => g.won).length;
				const l = games.length - w;
				articles.push({
					when: (worst.o.from + worst.o.to) / 2, kind: "injury",
					headline: fill(rng.pick(INJURY_HEADS),
						{ player: PL(worst.p.name, worst.p.key), college: TM(worst.t.name) }),
					body: [PL(worst.p.name, worst.p.key), T(" goes down with " +
						(worst.o.kind || "an injury") + " for "), TM(worst.t.name),
						T(", who go " + w + "-" + l + " while he's out.")],
				});
				// The other half of the same story: the night he came back.
				// Only when the return happens with season still to play —
				// a return in the last week is not an article.
				if (worst.o.to < 0.92) {
					articles.push({
						when: worst.o.to + 0.04, kind: "injury return",
						headline: fill(rng.pick(INJURY_RETURN_HEADS),
							{ player: PL(worst.p.name, worst.p.key), college: TM(worst.t.name) }),
						body: [PL(worst.p.name, worst.p.key), T(" is back in the lineup for "),
							TM(worst.t.name), T(" after " +
								(worst.o.kind || "his injury") + " cost him a stretch of " +
								"the season" + (l > w ? " the team could not afford" : "") + ".")],
					});
				}
			}
		}

		// --- the metrics disagree -------------------------------------------
		{
			const ranked = (res.poll || []).filter((t) => Number.isFinite(t.netRank));
			let worst = null;
			ranked.forEach((t, i) => {
				const apRank = i + 1;
				const gap = t.netRank - apRank;
				if (!worst || Math.abs(gap) > Math.abs(worst.gap)) worst = { t, apRank, gap };
			});
			if (worst && Math.abs(worst.gap) >= 15 && runs(0.6)) {
				articles.push({
					when: 0.7, kind: "analytics",
					headline: fill(rng.pick(ANALYTICS_HEADS), { team: TM(worst.t.name) }),
					/* Three bodies rather than one. A kind with a single body
					   template reads identically every season however much its
					   numbers move, and this one fires most years. */
					body: [TM(worst.t.name), T(rng.pick(worst.gap > 0 ? [
						" sits No. " + worst.apRank + " in the AP poll but only No. " +
							worst.t.netRank + " in NET — the voters like the record more " +
							"than the computers like the games.",
						" is No. " + worst.apRank + " on the ballots and No. " +
							worst.t.netRank + " in the NET, which is the largest gap in " +
							"the country. One of them is measuring the schedule.",
						" carries a No. " + worst.apRank + " ranking and a NET of " +
							worst.t.netRank + ". Poll voters reward winning; the NET asks " +
							"who you beat and by how much, and it is not impressed.",
					] : [
						" is No. " + worst.t.netRank + " in NET while the AP poll has " +
							"it down at No. " + worst.apRank + " — the résumé is better " +
							"than the reputation.",
						" is No. " + worst.t.netRank + " by the numbers and No. " +
							worst.apRank + " by the ballot. Nobody is watching them on a " +
							"Wednesday night, which is the whole of the difference.",
						" has the efficiency margin of a No. " + worst.t.netRank +
							" team and the ranking of a No. " + worst.apRank + " one. " +
							"The committee will use the first number.",
					]))],
				});
			}
		}

		// --- poll movement -------------------------------------------------
		const hist = res.pollHistory || [];
		if (hist.length > 2) {
			// A change at No. 1 mid-season is always a story.
			let prevTop = hist[0].ranks[0] && hist[0].ranks[0].team;
			/* Two a season at most: the first change and the last. A 0.7
			   roll per change ran to seven articles in a year the top spot
			   kept moving, which is a story told once. */
			const changes = [];
			for (let w = 1; w < hist.length; w++) {
				const top = hist[w].ranks[0] && hist[w].ranks[0].team;
				if (top && prevTop && top !== prevTop) changes.push(w);
				prevTop = top || prevTop;
			}
			const tell = new Set(changes.length > 2 ? [changes[0], changes[changes.length - 1]] : changes);
			prevTop = hist[0].ranks[0] && hist[0].ranks[0].team;
			for (let w = 1; w < hist.length; w++) {
				const top = hist[w].ranks[0] && hist[w].ranks[0].team;
				if (top && prevTop && top !== prevTop && tell.has(w) && runs(0.85)) {
					/* The poll's own history, which the body had never read:
					   how long the man being replaced had held it, and where
					   the new No. 1 had been sitting. One template ran 26
					   times over fifteen classes. */
					let held = 0;
					for (let k = w - 1; k >= 0; k--) {
						const at = hist[k].ranks[0] && hist[k].ranks[0].team;
						if (at !== prevTop) break;
						held++;
					}
					const wasAt = (hist[w - 1].ranks || [])
						.filter((r) => r.team === top)[0];
					const month = hist[w].label.toLowerCase();
					const bodies = [
						[TM(top), T(" replaces "), TM(prevTop),
							T(" at the top of the AP poll in " + month + ".")],
						[TM(prevTop), T(" held the top spot for " +
							global.Text.plural(held, "week") + ". "), TM(top),
							T(" has it now.")],
						[TM(top), T(wasAt ? " had been No. " + wasAt.rank +
							" a week ago. The ballots moved him past " : " moves past "),
							TM(prevTop), T(" in " + month + ".")],
						[T("The voters blinked in " + month + ": "), TM(top),
							T(" is No. 1 and "), TM(prevTop), T(" is not.")],
						[TM(top), T(" is No. 1 for the first time this season, at the " +
							"expense of "), TM(prevTop), T(".")],
						[T("A new name at the top of the poll. "), TM(top),
							T(" over "), TM(prevTop),
							T(", after " + global.Text.plural(held, "week") +
								" of the other order.")],
					];
					articles.push({
						when: (w / (hist.length - 1)) * 0.98,
						kind: "new number one",
						headline: fill(rng.pick([
							"A new No. 1: {top}",
							"{top} takes over the top spot",
							"The poll turns over: {top}",
							"{top} climbs to the top of the ballot",
							"{prev} is no longer No. 1",
							"After " + global.Text.plural(held, "week") + ", a change at No. 1",
						]), { top: TM(top), prev: TM(prevTop) }),
						body: rng.pick(bodies),
					});
				}
				prevTop = top || prevTop;
			}
			// Biggest riser: final rank against preseason.
			const preRank = {};
			hist[0].ranks.forEach((r) => { preRank[r.team] = r.rank; });
			const final = hist[hist.length - 1];
			let riser = null;
			for (const r of final.ranks) {
				const delta = (preRank[r.team] || 30) - r.rank;
				if (!riser || delta > riser.delta) riser = { team: r.team, rank: r.rank, delta };
			}
			if (riser && riser.delta >= 8 && runs(0.6)) {
				articles.push({
					when: 0.99, kind: "poll riser",
					headline: fill(rng.pick([
						"Nobody saw {team} coming",
						"{team}, the season's biggest riser",
					]), { team: TM(riser.team) }),
					body: [TM(riser.team), T(
						(preRank[riser.team]
							? " opened the season ranked No. " + preRank[riser.team]
							: " opened the season unranked") +
						" and finished No. " + riser.rank + ".")],
				});
			}
		}

		/* The recruiting-cycle stories are about the men who signed THIS
		   cycle. A five-star who is a redshirt sophomore signed two years
		   ago, and his signing-day article ran dated to this offseason. */
		const recruit = (p) => !p.nonNcaa && p.recruiting &&
			p.classYear === "Freshman" && !(p.transfer && p.transfer.from);

		// --- signing day (preseason) ---------------------------------------
		{
			const fivestars = (res.players || []).filter((p) =>
				recruit(p) && p.recruiting.stars === 5)
				.sort((a, b) => a.recruiting.rank - b.recruiting.rank);
			for (const p of fivestars.slice(0, runs(0.6) ? 2 : 1)) {
				articles.push({
					when: -0.4, kind: "signing day",
					headline: fill(rng.pick(SIGNING_HEADS),
						{ player: PL(p.name, p.key), college: TM(p.newCollege) }),
					body: [PL(p.name, p.key), T(", the No. " + p.recruiting.rank +
						" recruit in the class, signs with "), TM(p.newCollege),
						T(p.recruiting.headliner
							? ". He arrives as the headline signing of the group."
							: ".")],
				});
			}
		}

		// --- transfer portal (preseason) ------------------------------------
		{
			const moves = (res.players || []).filter((p) =>
				!p.nonNcaa && p.transfer && p.transfer.from && p.transfer.story)
				.sort((a, b) =>
					(b.transfer.toPrestige - b.transfer.fromPrestige) -
					(a.transfer.toPrestige - a.transfer.fromPrestige));
			const bigMove = moves.filter((p) => p.transfer.direction === "up")[0];
			if (bigMove && runs(0.6)) {
				articles.push({
					when: -0.35, kind: "transfer",
					headline: fill(rng.pick(TRANSFER_HEADS),
						{ player: PL(bigMove.name, bigMove.key), college: TM(bigMove.newCollege) }),
					body: [PL(bigMove.name, bigMove.key), T(" arrives at "),
						TM(bigMove.newCollege), T(" — " + global.Text.endSentence(bigMove.transfer.story))],
				});
			}
		}

		// --- the class, in one line (preseason) -----------------------------
		if (res.flavor && res.flavor.name !== "balanced" && res.flavor.label) {
			articles.push({
				when: -0.15, kind: "class notebook",
				headline: fill(rng.pick(CLASS_FLAVOR_HEADS), { label: T(res.flavor.label) }),
				body: [T("Beat writers settling in for the season keep landing on " +
					"the same word for this class: " + global.Text.endSentence(res.flavor.label))],
			});
		}

		// --- conference tournaments ------------------------------------------
		{
			const CT = res.confTourneys || {};
			const TS = global.TeamsSim;
			const C = global.Colleges.CONFERENCES;
			const confs = Object.keys(CT).filter((c) => CT[c] && CT[c].champ);
			// The power conferences plus any where a genuine outsider won it —
			// covering all thirty-plus every class would bury the rest of the
			// paper, so this is capped at what a real notebook would run: the
			// upsets first (they are the story), then the strongest leagues.
			const rows = confs.map((conf) => {
				const ct = CT[conf];
				const champ = ct.champ;
				const isUpset = ct.regularChamp && ct.regularChamp !== champ &&
					(ct.regularChamp.cw - ct.regularChamp.cl) - (champ.cw - champ.cl) >= 4;
				return { conf, ct, champ, isUpset, strength: (C[conf] || {}).strength || 0 };
			}).sort((a, b) =>
				(b.isUpset ? 1 : 0) - (a.isUpset ? 1 : 0) || b.strength - a.strength);
			/* The upsets get their own articles; the rest of the week is a
			   roundup. Eight back-to-back "Nobody had X winning the Y"
			   blurbs was a wall of near-duplicate text. */
			const picked = rows.slice(0, runs(0.5) ? 8 : 4);
			const own = picked.filter((r) => r.isUpset).slice(0, 3);
			const rest = picked.filter((r) => own.indexOf(r) === -1);
			for (const row of own) {
				const { conf, ct, champ } = row;
				const label = TS ? TS.label(conf) : conf;
				const body = [TM(champ.name), T(" win the " + label + " tournament")];
				if (ct.regularChamp) {
					body.push(T(", denying "), TM(ct.regularChamp.name),
						T(" (the regular-season champion) the automatic bid"));
				}
				body.push(T("."));
				articles.push({
					when: 1.005, kind: "conf tourney",
					headline: fill(rng.pick(CONF_TOURNEY_UPSET_HEADS),
						{ champ: TM(champ.name), conf: T(label) }),
					body,
				});
			}
			if (rest.length === 1) {
				const { conf, champ } = rest[0];
				const label = TS ? TS.label(conf) : conf;
				articles.push({
					when: 1.005, kind: "conf tourney",
					headline: fill(rng.pick(CONF_TOURNEY_HEADS),
						{ champ: TM(champ.name), conf: T(label) }),
					body: [TM(champ.name), T(" win the " + label + " tournament.")],
				});
			} else if (rest.length > 1) {
				articles.push({
					when: 1.006, kind: "conf tourney",
					headline: [T(rng.pick([
						"Championship week: the automatic bids",
						"Conference tournament roundup",
						"The nets came down across the country",
					]))],
					body: [T("The week's champions: ")].concat(
						rest.flatMap((r, i) => [
							T(i ? "; " : ""), TM(r.champ.name),
							T(" (" + (TS ? TS.label(r.conf) : r.conf) + ")"),
						])).concat([T(".")]),
				});
			}
		}

		// --- Selection Sunday ---------------------------------------------
		const sel = res.tourney && res.tourney.selection;
		if (sel) {
			if (sel.bubble && sel.bubble.length) {
				articles.push({
					when: 1.02, kind: "selection",
					headline: [T(rng.pick([
						"Selection Sunday: the snubs",
						"The bubble bursts",
					]))],
					body: [T("First teams out: ")].concat(
						sel.bubble.slice(0, 4).flatMap((t, i) => [
							T(i ? ", " : ""), TM(t.name),
							T(t.quads ? " (Q1 " + t.quads.q1w + "-" + t.quads.q1l + ")" : ""),
						])).concat([T(".")]),
				});
			}
			for (const bc of sel.bidCheck || []) {
				articles.push({
					when: 1.03, kind: "selection",
					headline: [T(bc.got > bc.expected
						? "The " + bc.conf + " cashes in: " + bc.got + " bids"
						: "A lean year for the " + bc.conf)],
					body: [T("The " + bc.conf + " put " +
						global.Text.plural(bc.got, "team") +
						" in the field, against a typical " + bc.expected + ".")],
				});
			}
		}

		// --- March --------------------------------------------------------
		const t = res.tourney;
		if (t && t.regions) {
			const upsets = [];
			for (const r of Object.keys(t.regions)) {
				for (const round of t.regions[r].rounds) {
					for (const g of round) if (g.upset) upsets.push(g);
				}
			}
			upsets.sort((a, b) => (b.winner.seed - 0) - (a.winner.seed - 0));

			// The Cinderella of the field: the deepest-running double-digit
			// seed. One article, not one per round — that is the whole story.
			const cinderella = [];
			for (const r of Object.keys(t.regions)) {
				for (const x of t.regions[r].seeds) {
					if (x.seed >= 10 && (x.team.ncaaWins || 0) >= 2) cinderella.push(x);
				}
			}
			cinderella.sort((a, b) => (b.team.ncaaWins || 0) - (a.team.ncaaWins || 0));
			if (cinderella.length) {
				const c = cinderella[0];
				articles.push({
					when: 1.13, kind: "cinderella",
					headline: fill(rng.pick(CINDERELLA_HEADS), { team: TM(c.team.name) }),
					body: [T("No. " + c.seed + " "), TM(c.team.name),
						T(" has won " + c.team.ncaaWins + " games in this tournament" +
							(c.team.ncaaResult
								? ", and the run ended in the " +
									String(c.team.ncaaResult).replace(/^lost in the /i, "").replace(/^won the /i, "") + "."
								: "."))],
				});
			}

			// The Final Four, before the final decides it.
			if (t.finalFour && t.finalFour.length === 4) {
				articles.push({
					when: 1.15, kind: "final four",
					headline: [T(rng.pick(FINAL_FOUR_HEADS))],
					body: [T("Heading to the national semifinals: ")].concat(
						t.finalFour.flatMap((x, i) => [
							T(i ? ", " : ""), T("No. " + x.seed + " "), TM(x.team.name),
						])).concat([T(".")]),
				});
			}

			for (const g of upsets.slice(0, runs(0.5) ? 3 : 1)) {
				const loserSide = g.winner === g.a ? g.b : g.a;
				articles.push({
					when: 1.12, kind: "bracket upset",
					headline: fill(rng.pick([
						"No. {ws} {winner} shocks No. {ls} {loser}",
						"Madness: {winner} sends {loser} home",
					]), {
						winner: TM(g.winner.team.name), loser: TM(loserSide.team.name),
						ws: T(String(g.winner.seed)), ls: T(String(loserSide.seed)),
					}),
					body: [TM(g.winner.team.name),
						T(" won " + g.score + " in the " +
							(g.region ? g.region + " region" : "bracket") + ".")],
				});
			}
			if (t.champion) {
				const segs = [TM(t.champion.team.name),
					T(" (No. " + t.champion.seed + " seed) cut down the nets")];
				if (t.runnerUp) {
					segs.push(T(", beating "), TM(t.runnerUp.team.name),
						T(" " + (t.final && t.final.score ? t.final.score : "") + " in the final"));
				}
				segs.push(T("."));
				articles.push({
					when: 1.2, kind: "champion",
					headline: fill(rng.pick([
						"{champ} are national champions",
						"The nets come down for {champ}",
					]), { champ: TM(t.champion.team.name) }),
					body: segs,
				});
			}
			if (t.nit && t.nit.champion && runs(0.6)) {
				articles.push({
					when: 1.18, kind: "nit champion",
					headline: fill(rng.pick(NIT_HEADS), { champ: TM(t.nit.champion.name) }),
					body: [TM(t.nit.champion.name), T(" win the NIT — a real trophy " +
						"for a team that didn't make the 68.")],
				});
			}
		}

		// --- awards -------------------------------------------------------
		/* THE NATIONAL trophies, by name.

		   The filter used to be /Player of the Year|Naismith Trophy$|Wooden
		   Award$/, which is a rule about the WORDS and not about the trophies:
		   "WCC Player of the Year" matches it, and so does every one of the
		   thirty-two conferences'. Over fifteen classes this fired in all
		   fifteen and in nine of them the "winner" held no national trophy at
		   all — "sweeps the hardware || took 1 national honors", in a paper
		   that was simultaneously running the field-honors story naming the
		   man who actually won it. The names come from js/awards.js so a
		   trophy added there is picked up here rather than missed. */
		const NAT_POY = new Set((global.Awards.NATIONAL_POY || [])
			.map((a) => a.name).concat(["Consensus National Player of the Year"]));
		const natCount = (p) => (p.awards || []).filter((a) => NAT_POY.has(a)).length;
		// If a returning player took a national player-of-the-year trophy,
		// the class did not sweep anything and the field-honors story in the
		// same paper says so.
		const fieldTookPOY = (res.fieldHonors || []).some((h) => NAT_POY.has(h.award));
		const poy = (res.players || []).filter((p) => natCount(p) > 0)
			.sort((a, b) => natCount(b) - natCount(a));
		if (poy.length) {
			const p = poy[0];
			const n = natCount(p);
			// "Sweeps" is a claim about more than one trophy.
			const sweep = n >= 2 && !fieldTookPOY;
			articles.push({
				when: 1.15, kind: "awards",
				headline: fill(rng.pick(sweep ? [
					"{player} sweeps the hardware",
					"{player} takes them all",
					"Unanimous, near enough: {player}",
				] : [
					"{player}, player of the year",
					"The vote goes to {player}",
					"{player} takes the biggest one",
				]), { player: PL(p.name, p.key) }),
				body: [PL(p.name, p.key), T(" ("), TM(p.newCollege),
					T(") took " + global.Text.plural(n, "national player-of-the-year trophy",
						"national player-of-the-year trophies") +
						(p.stats ? " on " + p.stats.ppg.toFixed(1) + " points a game." : ".")),
				],
			});
		}

		// --- freshman of the year, defensive player of the year -------------
		{
			const fry = (res.players || []).filter((p) =>
				(p.awards || []).indexOf("Wayman Tisdale Award") !== -1)[0];
			if (fry && runs(0.7)) {
				articles.push({
					when: 1.16, kind: "awards",
					headline: fill(rng.pick(FRESHMAN_HEADS), { player: PL(fry.name, fry.key) }),
					body: [PL(fry.name, fry.key), T(" ("), TM(fry.newCollege),
						T(") takes the Wayman Tisdale Award" +
							(fry.stats ? " after averaging " + fry.stats.ppg.toFixed(1) +
								" points a game as a freshman." : "."))],
				});
			}
			const dpoy = (res.players || []).filter((p) =>
				(p.awards || []).indexOf("Naismith Defensive Player of the Year") !== -1)[0];
			if (dpoy && runs(0.7)) {
				articles.push({
					when: 1.17, kind: "awards",
					headline: fill(rng.pick(DPOY_HEADS), { player: PL(dpoy.name, dpoy.key) }),
					body: [PL(dpoy.name, dpoy.key), T(" ("), TM(dpoy.newCollege),
						T(") is the Naismith Defensive Player of the Year.")],
				});
			}
		}

		// --- the All-America team --------------------------------------------
		{
			const firstTeam = (res.players || []).filter((p) =>
				(p.awards || []).indexOf("Consensus First Team All-American") !== -1);
			if (firstTeam.length) {
				articles.push({
					when: 1.19, kind: "awards",
					headline: [T(rng.pick(ALL_AMERICA_HEADS))],
					body: [T("Consensus First Team: ")].concat(
						firstTeam.flatMap((p, i) => [
							T(i ? ", " : ""), PL(p.name, p.key), T(" ("), TM(p.newCollege), T(")"),
						])).concat([T(".")]),
				});
			}
		}

		// --- the trophy the class didn't win ---------------------------------
		for (const h of (res.fieldHonors || []).slice(0, runs(0.6) ? 3 : 1)) {
			const segs = [T(h.name)];
			if (h.school && teams[h.school]) segs.push(T(" ("), TM(h.school), T(")"));
			else if (h.school) segs.push(T(" (" + h.school + ")"));
			const heads = h.classYear ? FIELD_HONOR_HEADS
				: FIELD_HONOR_HEADS.filter((x) => x.indexOf("{year}") === -1);
			const who = h.key ? PL(h.name, h.key) : T(h.name);
			articles.push({
				when: 1.21, kind: "field honors",
				headline: fill(rng.pick(heads), {
					name: who,
					year: T(h.classYear
						? global.Text.withArticle(h.classYear.toLowerCase(), true) : ""),
				}),
				body: (h.key ? [who] : [T(h.name)]).concat(segs.slice(1)).concat([
					T(" " + honorPhrase(h.award) +
					(h.classYear ? " as " + global.Text.withArticle(h.classYear.toLowerCase()) : "") +
					" — this class had nothing for it.")]),
			});
		}

		// --- the best player nobody drafted -----------------------------------
		{
			const star = (res.fieldTop || [])[0];
			if (star && star.stats && runs(0.6)) {
				const who = star.key ? PL(star.name, star.key) : T(star.name);
				const nameSeg = star.school && teams[star.school]
					? [who, T(" (")].concat([TM(star.school)]).concat([T(")")])
					: [who, T(" (" + (star.school || "unattached") + ")")];
				articles.push({
					when: 1.22, kind: "returning star",
					headline: fill(rng.pick(RETURNING_STAR_HEADS), { name: who }),
					body: nameSeg.concat([T(", a " +
						(star.starReturner || "returning player") +
						(star.classYear ? " and " + star.classYear.toLowerCase() : "") +
						", averaged " + star.stats.ppg.toFixed(1) + " points and " +
						star.stats.rpg.toFixed(1) + " rebounds this season — none of " +
						"it draft eligible.")]),
				});
			}
		}

		// --- the recruiting cycle (before the season) -----------------------
		// The early signing period, in one roundup: where the top of the
		// class landed. One article, not one per signature — the two
		// biggest names already get their own signing-day stories.
		{
			const signed = (res.players || []).filter((p) =>
				recruit(p) && p.recruiting.stars >= 4)
				.sort((a, b) => a.recruiting.rank - b.recruiting.rank);
			if (signed.length >= 3 && runs(0.6)) {
				articles.push({
					when: -0.85, kind: "early signing period",
					headline: [T(rng.pick(EARLY_SIGNING_HEADS))],
					body: [T("The early signing period closes with the top of the " +
						"class settled: ")].concat(signed.slice(0, 3).flatMap((p, i) => [
							T(i ? ", " : ""), PL(p.name, p.key),
							T(" (No. " + p.recruiting.rank + ") to "), TM(p.newCollege),
						])).concat([T(".")]),
				});
			}
		}

		// --- a recruitment that would not stay decided ----------------------
		{
			const flip = (res.players || []).filter((p) =>
				recruit(p) && p.recruiting.decommits)
				.sort((a, b) => a.recruiting.rank - b.recruiting.rank)[0];
			if (flip) {
				articles.push({
					when: -0.55, kind: "decommitment",
					headline: fill(rng.pick(DECOMMIT_HEADS),
						{ player: PL(flip.name, flip.key), college: TM(flip.newCollege) }),
					body: rng.pick([
						[PL(flip.name, flip.key), T(" backed off " +
							flip.recruiting.decommits + " commitments before the letter " +
							"of intent finally landed at "), TM(flip.newCollege), T(".")],
						[T("Four coaching staffs thought they had him. "),
							PL(flip.name, flip.key), T(" decommitted " +
							flip.recruiting.decommits + " times and has signed with "),
							TM(flip.newCollege), T(".")],
						[PL(flip.name, flip.key), T(" is finally somebody's. After " +
							flip.recruiting.decommits + " changes of mind the fax came " +
							"from "), TM(flip.newCollege),
							T(", and the recruiting analysts can go back to sleep.")],
						[T("A recruitment that would not stay decided is decided: "),
							PL(flip.name, flip.key), T(" signs with "),
							TM(flip.newCollege), T(", his " +
							(flip.recruiting.decommits + 1) + "th commitment and the " +
							"only one with a signature under it.")],
					]),
				});
			}
		}

		// --- one more five-star commitment ----------------------------------
		// Signing day already covers the top two five-stars; the third one's
		// commitment is its own, earlier story.
		{
			const third = (res.players || []).filter((p) =>
				recruit(p) && p.recruiting.stars === 5)
				.sort((a, b) => a.recruiting.rank - b.recruiting.rank)[2];
			if (third && runs(0.6)) {
				articles.push({
					when: -0.65, kind: "five-star commit",
					headline: fill(rng.pick(FIVE_STAR_HEADS),
						{ player: PL(third.name, third.key), college: TM(third.newCollege) }),
					body: [PL(third.name, third.key), T(", the No. " +
						third.recruiting.rank + " player in the class, commits to "),
						TM(third.newCollege), T(".")],
				});
			}
		}

		// --- the class of the cycle -----------------------------------------
		// The school that assembled the best haul of prospects, judged by the
		// recruits it actually has in this class — at least two of them, at
		// least one blue-chipper, or there is no "class" to write about.
		{
			const bySchool = {};
			for (const p of res.players || []) {
				if (!recruit(p) || !p.newCollege) continue;
				(bySchool[p.newCollege] = bySchool[p.newCollege] || []).push(p);
			}
			let bestClass = null;
			for (const school of Object.keys(bySchool)) {
				const group = bySchool[school];
				if (group.length < 2 || !teams[school]) continue;
				if (!group.some((p) => p.recruiting.stars >= 4)) continue;
				const score = group.reduce((a, p) =>
					a + Math.max(0, 330 - p.recruiting.rank), 0);
				if (!bestClass || score > bestClass.score) bestClass = { school, group, score };
			}
			if (bestClass && runs(0.6)) {
				const names = bestClass.group.slice()
					.sort((a, b) => a.recruiting.rank - b.recruiting.rank);
				articles.push({
					when: -0.7, kind: "recruiting class",
					headline: fill(rng.pick(TOP_CLASS_HEADS), { college: TM(bestClass.school) }),
					body: [TM(bestClass.school), T(" put together the cycle's best " +
						"class: ")].concat(names.slice(0, 3).flatMap((p, i) => [
							T(i ? ", " : ""), PL(p.name, p.key),
							T(" (No. " + p.recruiting.rank + ")"),
						])).concat([T(".")]),
				});
			}
		}

		// --- the star who stayed (offseason) --------------------------------
		// fieldTop already yields the end-of-season "best player nobody
		// drafted" article; his DECISION to come back is the offseason story
		// that sets it up.
		{
			const stay = (res.fieldTop || [])[0];
			if (stay && stay.school && teams[stay.school] && runs(0.6)) {
				articles.push({
					when: -0.6, kind: "staying in school",
					headline: fill(rng.pick(STAY_HEADS),
						{ name: stay.key ? PL(stay.name, stay.key) : T(stay.name), college: TM(stay.school) }),
					body: [stay.key ? PL(stay.name, stay.key) : T(stay.name), T(" — a " +
						(stay.starReturner || "returning star") +
						(stay.classYear ? ", " + stay.classYear.toLowerCase() : "") +
						" — is coming back to "), TM(stay.school),
						T(" rather than chasing a professional contract.")],
				});
			}
		}

		// --- the graduate market (offseason) --------------------------------
		{
			const grad = (res.players || []).filter((p) =>
				!p.nonNcaa && p.transfer && p.transfer.from &&
				/grad/i.test(p.transfer.kind || ""))
				.sort((a, b) => b.newOvr - a.newOvr)[0];
			if (grad && runs(0.7)) {
				articles.push({
					when: -0.45, kind: "grad transfer",
					headline: fill(rng.pick(GRAD_TRANSFER_HEADS),
						{ player: PL(grad.name, grad.key), college: TM(grad.newCollege) }),
					body: [PL(grad.name, grad.key), T(" leaves " + grad.transfer.from +
						" with a degree and one season of eligibility, and spends it at "),
						TM(grad.newCollege), T(".")],
				});
			}
		}

		// --- the homecoming (offseason) -------------------------------------
		{
			const home = (res.players || []).filter((p) =>
				!p.nonNcaa && p.transfer &&
				p.transfer.kind === "returned to his original school")[0];
			if (home && runs(0.8)) {
				articles.push({
					when: -0.38, kind: "homecoming",
					headline: fill(rng.pick(HOMECOMING_HEADS),
						{ player: PL(home.name, home.key), college: TM(home.newCollege) }),
					body: rng.pick([
						[PL(home.name, home.key), T(" is back where he started: " +
							"the portal returns him to "), TM(home.newCollege), T(".")],
						[T("He left, and he is back. "), PL(home.name, home.key),
							T(" has re-signed with "), TM(home.newCollege),
							T(", the programme he committed to out of high school.")],
						[PL(home.name, home.key), T(" spent a year somewhere else and " +
							"has come home to "), TM(home.newCollege),
							T(". Nobody involved is describing it as a failure and " +
							"everybody involved is relieved.")],
					]),
				});
			}
		}

		// --- the offseason's biggest bench hire -----------------------------
		// A first-year coach at a big-name program is a hire worth a story
		// whoever he replaced. One article: the most prestigious bench that
		// changed hands.
		{
			const hire = Object.values(teams).filter((tm) =>
				tm.coach && tm.coach.situation === "first year" && tm.prestige >= 70)
				.sort((a, b) => b.prestige - a.prestige)[0];
			if (hire && runs(0.7)) {
				articles.push({
					when: -0.5, kind: "coaching hire",
					headline: fill(rng.pick(COACH_HIRE_HEADS),
						{ college: TM(hire.name), coach: T(hire.coach.name) }),
					body: [TM(hire.name), T(" hand the program to " +
						hire.coach.name +
						(hire.coach.replaced ? ", replacing " + hire.coach.replaced : "") +
						". A first-year staff at a name like this is the offseason's " +
						"biggest bet.")],
				});
			}
		}

		// --- the top-25 showdown (in-season) --------------------------------
		// The best game between two preseason top-25 teams: highest combined
		// billing, closest score. Read off the winner's log so each game is
		// seen once.
		if (pre && pre.ranks.length) {
			const preRankMap = {};
			for (const r of pre.ranks) preRankMap[r.team] = r.rank;
			let clash = null;
			for (const tm of Object.values(teams)) {
				const ra = preRankMap[tm.name];
				if (!ra || ra > 25) continue;
				for (const g of tm.log || []) {
					if (!g.won || g.stage !== "reg" || g.pf === null) continue;
					const rb = preRankMap[g.opp];
					if (!rb || rb > 25) continue;
					const score = 60 - ra - rb - Math.abs(g.pf - g.pa);
					if (!clash || score > clash.score) clash = { tm, g, ra, rb, score };
				}
			}
			if (clash && runs(0.6)) {
				articles.push({
					when: clash.g.when, kind: "ranked showdown",
					headline: fill(rng.pick(RANKED_CLASH_HEADS), {
						winner: TM(clash.tm.name), loser: TM(clash.g.opp),
						ws: T(String(clash.ra)), ls: T(String(clash.rb)),
					}),
					body: [T("No. " + clash.ra + " "), TM(clash.tm.name),
						T(" beat No. " + clash.rb + " "), TM(clash.g.opp),
						T(" " + clash.g.pf + "-" + clash.g.pa +
							(clash.g.ot ? " in overtime" : "") +
							" in the marquee matchup of the regular season.")],
				});
			}
		}

		// --- the multi-overtime classic (in-season) -------------------------
		{
			let epic = null;
			for (const tm of Object.values(teams)) {
				for (const g of tm.log || []) {
					if (!g.won || g.stage !== "reg" || !g.ot || g.ot < 2) continue;
					if (!epic || g.ot > epic.g.ot) epic = { tm, g };
				}
			}
			if (epic && runs(0.6)) {
				articles.push({
					when: epic.g.when, kind: "overtime classic",
					headline: fill(rng.pick(OT_CLASSIC_HEADS), {
						winner: TM(epic.tm.name), loser: TM(epic.g.opp),
						ot: T(String(epic.g.ot)),
					}),
					body: [TM(epic.tm.name), T(" finally put away "), TM(epic.g.opp),
						T(" " + epic.g.pf + "-" + epic.g.pa + " after " + epic.g.ot +
							" overtimes.")],
				});
			}
		}

		// --- a ranked team's skid (in-season) -------------------------------
		// A preseason top-25 team losing four straight is a story the polls
		// alone don't tell. The log has to be read in calendar order.
		if (pre && pre.ranks.length) {
			let skid = null;
			for (const r of pre.ranks.slice(0, 25)) {
				const tm = teams[r.team];
				if (!tm) continue;
				const log = (tm.log || []).filter((g) => g.stage === "reg")
					.slice().sort((a, b) => a.when - b.when);
				let cur = 0;
				let best = 0;
				let at = 0.5;
				for (const g of log) {
					if (!g.won) {
						cur++;
						if (cur > best) { best = cur; at = g.when; }
					} else cur = 0;
				}
				if (best >= 4 && (!skid || best > skid.n)) skid = { tm, n: best, rank: r.rank, at };
			}
			if (skid && runs(0.6)) {
				articles.push({
					when: skid.at, kind: "losing streak",
					headline: fill(rng.pick(LOSING_STREAK_HEADS), { team: TM(skid.tm.name) }),
					body: [TM(skid.tm.name), T(", ranked No. " + skid.rank +
						" in the preseason, have now lost " + skid.n + " in a row.")],
				});
			}
		}

		// --- the scoring title (in-season) ----------------------------------
		{
			const top = (res.players || []).filter((p) =>
				!p.nonNcaa && p.stats && p.stats.gp >= 15)
				.sort((a, b) => b.stats.ppg - a.stats.ppg)[0];
			if (top && top.stats.ppg >= 18 && runs(0.55)) {
				articles.push({
					when: 0.9, kind: "scoring title",
					headline: fill(rng.pick(SCORING_TITLE_HEADS),
						{ player: PL(top.name, top.key) }),
					body: [PL(top.name, top.key), T(" ("), TM(top.newCollege),
						T(") leads the class in scoring at " + top.stats.ppg.toFixed(1) +
							" points a game.")],
				});
			}
		}

		// --- the forty-point night (in-season) ------------------------------
		// The season's biggest individual scoring game, read straight off the
		// game logs — `best` is the highest-scoring game, so it IS the forty.
		{
			const big = (res.players || []).filter((p) =>
				!p.nonNcaa && p.gameLog && p.gameLog.highs && p.gameLog.highs.pts >= 40)
				.sort((a, b) => b.gameLog.highs.pts - a.gameLog.highs.pts)[0];
			if (big && big.gameLog.best && runs(0.6)) {
				const g = big.gameLog.best;
				articles.push({
					when: Math.min(0.98, g.when || 0.5), kind: "forty-point game",
					headline: fill(rng.pick(FORTY_HEADS), {
						player: PL(big.name, big.key), pts: T(String(g.pts)),
						opp: teams[g.opp] ? TM(g.opp) : T(g.opp || "his opponent"),
					}),
					body: [PL(big.name, big.key), T(" scored " + g.pts + " against ")]
						.concat([teams[g.opp] ? TM(g.opp) : T(g.opp || "his opponent")])
						.concat([T(g.reb >= 10 ? ", with " + g.reb + " rebounds beside it."
							: " — the scoring night of the season.")]),
				});
			}
		}

		// --- the triple-double machine (in-season) --------------------------
		{
			const td = (res.players || []).filter((p) =>
				!p.nonNcaa && p.gameLog && p.gameLog.tripleDoubles > 0)
				.sort((a, b) => b.gameLog.tripleDoubles - a.gameLog.tripleDoubles)[0];
			if (td && runs(0.6)) {
				articles.push({
					when: 0.62, kind: "triple-double",
					headline: fill(rng.pick(TRIPLE_DOUBLE_HEADS),
						{ player: PL(td.name, td.key) }),
					body: (function () {
						const n = td.gameLog.tripleDoubles;
						const word = global.Text.plural(n, "triple-double");
						const avg = td.stats ? td.stats.ppg.toFixed(1) + "/" +
							td.stats.rpg.toFixed(1) + "/" + td.stats.apg.toFixed(1) : null;
						return rng.pick([
							[PL(td.name, td.key), T(" ("), TM(td.newCollege),
								T(") has " + word + " this season" +
									(avg ? ", on " + avg + " averages." : "."))],
							[T("Nobody else in the country has more than one. "),
								PL(td.name, td.key), T(" of "), TM(td.newCollege),
								T(" has " + word + (avg ? " and averages " + avg + "." : "."))],
							[PL(td.name, td.key), T(" fills three columns most nights and " +
								"all of them on " + word.replace(/^\d+ /, n + " ") +
								" of them" + (avg ? ", at " + avg + " for " : " for ")),
								TM(td.newCollege), T(".")],
						]);
					}()),
				});
			}
		}

		// --- the conference race (late season) ------------------------------
		// One conference, one article: the tightest race among the strongest
		// leagues, or — failing a tight one anywhere — the most emphatic
		// runaway. Standings come from the conference tournament seeding,
		// which is the regular-season table.
		{
			const CT2 = res.confTourneys || {};
			const TS2 = global.TeamsSim;
			const CC = global.Colleges.CONFERENCES;
			const races = Object.keys(CT2).map((conf) => {
				const seeds = CT2[conf] && CT2[conf].seeds;
				if (!seeds || seeds.length < 2) return null;
				const gap = (seeds[0].cw - seeds[0].cl) - (seeds[1].cw - seeds[1].cl);
				return { conf, a: seeds[0], b: seeds[1], gap,
					strength: (CC[conf] || {}).strength || 0 };
			}).filter(Boolean);
			const tight = races.filter((r) => r.gap <= 1)
				.sort((a, b) => b.strength - a.strength)[0];
			const runaway = races.filter((r) => r.gap >= 6)
				.sort((a, b) => b.strength - a.strength)[0];
			const race = tight || runaway;
			if (race && runs(0.6)) {
				const label = TS2 ? TS2.label(race.conf) : race.conf;
				articles.push({
					when: 0.93, kind: "conference race",
					headline: fill(rng.pick(tight ? CONF_RACE_TIGHT_HEADS : CONF_RACE_CLINCH_HEADS),
						{ conf: T(label), a: TM(race.a.name), b: TM(race.b.name) }),
					body: tight
						? [TM(race.a.name), T(" (" + race.a.cw + "-" + race.a.cl + ") and "),
							TM(race.b.name), T(" (" + race.b.cw + "-" + race.b.cl +
								") go to the final week with the " + label +
								" title still on the table.")]
						: [TM(race.a.name), T(" clinched the " + label + " at " +
							race.a.cw + "-" + race.a.cl + ", " +
							"with the race decided long before the last weekend.")],
				});
			}
		}

		// --- the bid thief (championship week) ------------------------------
		// A team that could only get in with the automatic bid winning its
		// tournament takes an at-large spot from someone on the bubble.
		{
			const CT3 = res.confTourneys || {};
			const TS3 = global.TeamsSim;
			let thief = null;
			for (const conf of Object.keys(CT3)) {
				const ct = CT3[conf];
				if (!ct || !ct.champ || !ct.regularChamp || ct.champ === ct.regularChamp) continue;
				const margin = ct.champ.cw - ct.champ.cl;
				if (margin > 1) continue;
				if (!thief || margin < thief.margin) thief = { conf, ct, margin };
			}
			if (thief && runs(0.6)) {
				const label = TS3 ? TS3.label(thief.conf) : thief.conf;
				articles.push({
					when: 1.008, kind: "bid stealer",
					headline: fill(rng.pick(BID_STEALER_HEADS),
						{ champ: TM(thief.ct.champ.name), conf: T(label) }),
					body: [TM(thief.ct.champ.name), T(" went " + thief.ct.champ.cw +
						"-" + thief.ct.champ.cl + " in " + label +
						" play and won the tournament anyway — an automatic bid " +
						"nobody budgeted for, and one fewer at-large spot for the bubble.")],
				});
			}
		}

		// --- awards the voters missed ---------------------------------------
		// The best scorer who ended the season without a first-team spot or a
		// player-of-the-year trophy: every March has one.
		{
			const HONORED = /Consensus First Team All-American|Naismith Trophy|Wooden Award|Oscar Robertson Trophy|AP Player of the Year|NABC Player of the Year|Sporting News Player of the Year/;
			const snub = (res.players || []).filter((p) =>
				!p.nonNcaa && p.stats && p.stats.gp >= 15 &&
				!(p.awards || []).some((a) => HONORED.test(a)))
				.sort((a, b) => b.stats.ppg - a.stats.ppg)[0];
			if (snub && snub.stats.ppg >= 17 && runs(0.5)) {
				articles.push({
					when: 1.195, kind: "awards snub",
					headline: fill(rng.pick(SNUB_HEADS), { player: PL(snub.name, snub.key) }),
					body: [PL(snub.name, snub.key), T(" ("), TM(snub.newCollege),
						T(") averaged " + snub.stats.ppg.toFixed(1) + " points and " +
							snub.stats.rpg.toFixed(1) + " rebounds and did not make " +
							"the consensus first team.")],
				});
			}
		}

		// --- a conference player of the year --------------------------------
		{
			const NATIONAL = /Naismith|Wooden|Oscar Robertson|^AP |NABC|Sporting News|Consensus|Defensive/;
			let cpoy = null;
			for (const p of (res.players || []).filter((x) => !x.nonNcaa)
				.sort((a, b) => ((b.stats && b.stats.ppg) || 0) - ((a.stats && a.stats.ppg) || 0))) {
				/* NCAA only. A prospect abroad or in prep ball holds honors of
				   the same SHAPE — "National Prep Player of the Year", "NAIA
				   Player of the Year" — and this template renders his league
				   as a team link, so the story pointed at a team page called
				   "Prep / Postgrad" that does not exist. */
				const award = (p.awards || []).filter((a) =>
					/ Player of the Year$/.test(a) && !NATIONAL.test(a))[0];
				if (award) { cpoy = { p, award }; break; }
			}
			if (cpoy && runs(0.55)) {
				articles.push({
					when: 1.155, kind: "conference poy",
					headline: fill(rng.pick(CONF_POY_HEADS),
						{ player: PL(cpoy.p.name, cpoy.p.key), award: T(cpoy.award) }),
					body: [PL(cpoy.p.name, cpoy.p.key), T(" ("), TM(cpoy.p.newCollege),
						T(") takes the " + cpoy.award +
							(cpoy.p.stats ? " on " + cpoy.p.stats.ppg.toFixed(1) +
								" points a game." : "."))],
				});
			}
		}

		// --- more March: the games around the bracket ------------------------
		if (t && t.regions) {
			// A No. 1 seed's near-miss in the first round — the game the
			// bracket almost broke.
			let scare = null;
			for (const r of Object.keys(t.regions)) {
				for (const g of (t.regions[r].rounds[0] || [])) {
					if (!g.winner || g.winner.seed !== 1) continue;
					const m = /^(\d+)-(\d+)/.exec(g.score || "");
					const margin = m ? (+m[1]) - (+m[2]) : 99;
					const ot = /OT/.test(g.score || "");
					if (margin > 3 && !ot) continue;
					if (!scare || margin < scare.margin) scare = { g, margin };
				}
			}
			if (scare) {
				const loser = scare.g.winner === scare.g.a ? scare.g.b : scare.g.a;
				articles.push({
					when: 1.115, kind: "top seed scare",
					headline: fill(rng.pick(TOP_SEED_SCARE_HEADS), {
						winner: TM(scare.g.winner.team.name),
						loser: TM(loser.team.name),
					}),
					body: [T("No. 1 "), TM(scare.g.winner.team.name),
						T(" survived No. " + loser.seed + " "), TM(loser.team.name),
						T(" " + scare.g.score + " — the closest a top seed came to " +
							"going home in the first round.")],
				});
			}

			// Semifinal Saturday, as results rather than as a preview.
			if (t.semis && t.semis.length && runs(0.6)) {
				articles.push({
					when: 1.16, kind: "national semifinal",
					headline: [T(rng.pick(NATIONAL_SEMIS_HEADS))],
					body: t.semis.flatMap((s, i) => {
						const lost = s.winner === s.a ? s.b : s.a;
						return [T(i ? " " : ""), TM(s.winner.team.name),
							T(" beat "), TM(lost.team.name), T(" " + s.score + ".")];
					}),
				});
			}

			// The champion's best man in the tournament — but only if a
			// prospect from this class actually carried them.
			if (t.champion) {
				const hero = (res.players || []).filter((p) =>
					!p.nonNcaa && p.newCollege === t.champion.team.name &&
					p.gameLog && p.gameLog.postseason && p.gameLog.postseason.ncaa >= 3)
					.sort((a, b) => b.gameLog.postseason.ppg - a.gameLog.postseason.ppg)[0];
				if (hero) {
					articles.push({
						when: 1.205, kind: "title hero",
						headline: fill(rng.pick(TITLE_HERO_HEADS), {
							player: PL(hero.name, hero.key),
							college: TM(t.champion.team.name),
						}),
						body: [PL(hero.name, hero.key), T(" averaged " +
							hero.gameLog.postseason.ppg.toFixed(1) +
							" points across the postseason for national champion "),
							TM(t.champion.team.name), T(".")],
					});
				}
			}

			// The NIT semifinals, before its champion gets the trophy story.
			if (t.nit && t.nit.rounds) {
				const nitSemis = [];
				for (const round of t.nit.rounds) {
					for (const g of round) if (g.round === "NIT Semifinal") nitSemis.push(g);
				}
				if (nitSemis.length && runs(0.5)) {
					articles.push({
						when: 1.14, kind: "nit semifinal",
						headline: [T(rng.pick(NIT_SEMIS_HEADS))],
						body: nitSemis.flatMap((g, i) => {
							const lost = g.winner === g.a ? g.b : g.a;
							return [T(i ? " " : ""), TM(g.winner.name),
								T(" beat "), TM(lost.name), T(" " + g.score + ".")];
						}),
					});
				}
			}
		}

		// --- the draft cycle (after the nets come down) ---------------------
		// The consensus at the top of the mock drafts.
		{
			const bd = res.board || [];
			const one = bd[0];
			if (one) {
				articles.push({
					when: 1.3, kind: "mock draft",
					headline: fill(rng.pick(MOCK_DRAFT_HEADS),
						{ player: PL(one.name, one.key) }),
					body: [PL(one.name, one.key), T(
						one.preseasonRank && one.preseasonRank > 3
							? " has taken over the No. 1 spot in the mocks — he opened " +
								"the cycle ranked No. " + one.preseasonRank + "."
							: " sits at No. 1 in the consensus mock, where he has been " +
								"more or less wire to wire.")],
				});
			}
		}

		// --- the workout-circuit riser and the faller ------------------------
		{
			const up = (res.risers || [])[0];
			if (up && up.stockMove >= 5 && runs(0.6)) {
				articles.push({
					when: 1.33, kind: "stock riser",
					headline: fill(rng.pick(STOCK_RISER_HEADS),
						{ player: PL(up.name, up.key) }),
					body: [PL(up.name, up.key), T(" has climbed " + up.stockMove +
						" spots from his preseason ranking" +
						(up.boardRank ? " to No. " + up.boardRank + " on the board." : "."))],
				});
			}
			const down = (res.fallers || [])[0];
			if (down && down.stockMove <= -5 && runs(0.6)) {
				articles.push({
					when: 1.34, kind: "stock faller",
					headline: fill(rng.pick(STOCK_FALLER_HEADS),
						{ player: PL(down.name, down.key) }),
					body: [PL(down.name, down.key), T(" has slid " + (-down.stockMove) +
						" spots from where the preseason boards had him" +
						(down.boardRank ? ", down to No. " + down.boardRank + "." : "."))],
				});
			}
		}

		// --- the late riser hiding in round two ------------------------------
		{
			const sleeper = (res.board || []).filter((p) =>
				p.mockRound === 2 && p.stockMove >= 8)
				.sort((a, b) => b.stockMove - a.stockMove)[0];
			if (sleeper && runs(0.5)) {
				articles.push({
					when: 1.36, kind: "draft sleeper",
					headline: fill(rng.pick(SLEEPER_HEADS),
						{ player: PL(sleeper.name, sleeper.key) }),
					body: [PL(sleeper.name, sleeper.key), T(" is projected in the " +
						"second round after rising " + sleeper.stockMove +
						" spots across the season — the kind of climb that keeps " +
						"going right through the workouts.")],
				});
			}
		}

		// --- draft day ----------------------------------------------------
		{
			const slotOf = {};
			for (const p of res.board || []) if (p.draftSlot) slotOf[p.key] = p.draftSlot;
			for (const e of res.draftEvents || []) {
				const kind = (e.name || "").indexOf("slide") !== -1 ? "fall"
					: (e.name || "").indexOf("riser") !== -1 ? "rise"
					: (e.name || "").indexOf("trade") !== -1 ? "trade"
					: (e.name || "").indexOf("reach") !== -1 ? "reach" : null;
				const heads = (kind && DRAFT_HEADS_BY_KIND[kind]) || DRAFT_HEADS;
				const slot = slotOf[e.key];
				articles.push({
					when: 1.4, kind: "draft",
					headline: fill(rng.pick(heads), { player: PL(e.player, e.key) }),
					body: [PL(e.player, e.key),
						T((slot ? " went No. " + slot + " — " : " — ") +
							global.Text.endSentence(e.text +
								(e.detail ? " (" + e.detail + ")" : "")))],
				});
			}
		}

		articles.sort((a, b) => a.when - b.when);
		/* The paper's staff, and one pass over every article to give it a
		   voice and — where the facts support one — a second paragraph and a
		   quote. Done here rather than at the fifty-six push sites so that
		   every kind, including the ones added after this was written, is
		   covered by construction. The rng is a child so that adding a
		   paragraph pool cannot reshuffle which articles ran. */
		const staff = drawStaff(rng.child("staff"));
		const byKeyAll = {};
		for (const p of res.players || []) byKeyAll[p.key] = p;
		const decorCtx = { staff, teams, byKey: byKeyAll, res };
		const decorRng = rng.child("voice");
		for (const a of articles) decorate(a, decorCtx, decorRng);
		for (const a of articles) {
			const year = yearOf(a.when, season);
			a.year = year;
			a.dateline = dateline(a.when) + (year ? " " + year : "");
		}
		return articles;
	}

	global.News = {
		build, dateline, yearOf, statBlurb, honorPhrase,
		VOICES, QUOTES, PARAGRAPHS, drawStaff, quoteFor, factsOf,
		TEMPLATES, runTemplates, templateContext,
	};
})(typeof window !== "undefined" ? window : self);
