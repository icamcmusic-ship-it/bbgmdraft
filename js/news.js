/* The season as news. The raw material has always existed — mid-season events
   read off simulated results, draft-day events, the class anomalies, the poll,
   the bracket, the awards — and it was rendered as four walls of centre-dots.
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
	function dateline(when) {
		if (when === undefined || when === null) return "Preseason";
		if (when < 0) return "Offseason";
		if (when > 1.1) return "March";
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
		],
	};

	const GENERIC_HEADS = [
		"Around the country",
		"Midweek notebook",
		"The week in college basketball",
	];

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
		const bodySegs = [];
		// The event text mentions its teams by name; link them in place.
		let rest = e.text;
		for (const nm of names) {
			const i = rest.indexOf(nm);
			if (i === -1) continue;
			if (i > 0) bodySegs.push(T(rest.slice(0, i)));
			bodySegs.push(TM(nm));
			rest = rest.slice(i + nm.length);
		}
		bodySegs.push(T(rest + "."));
		// A body that opens with generated text opens a sentence.
		if (bodySegs[0].t === "text") bodySegs[0].v = global.Text.capitalise(bodySegs[0].v);
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
	];

	const DRAFT_HEADS = [
		"Draft day: {player} moves the board",
		"War rooms react to {player}",
		"The pick that made the room gasp",
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

	const FIELD_HONOUR_HEADS = [
		"{name} beats the class to the trophy",
		"The award the class didn't win: {name}",
		// Filled from the class year the body asserts, so the headline
		// never calls a junior a senior.
		"{year} spoils the party: {name}",
	];
	/* A trophy is won; a team is named to. "wins the Consensus First Team
	   All-American" treated a selection like a cup. */
	function honourPhrase(award) {
		if (/All-American|All-America|Team\b|All-Defensive|All-Freshman|All-Newcomer/.test(award)) {
			return "is named " + global.Text.withArticle(award);
		}
		return "wins the " + award;
	}

	const RETURNING_STAR_HEADS = [
		"The best player in the country isn't in this class",
		"{name} doesn't need the draft to matter",
		"Scouting report on a player nobody can draft: {name}",
	];

	const FRESHMAN_HEADS = [
		"{player} named the country's top freshman",
		"{player} sweeps freshman honours",
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

	const CLASS_FLAVOUR_HEADS = [
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

	/* One line of numbers a story can carry: the scoring average and the
	   one other thing his line is about. */
	function statBlurb(s) {
		const n1 = (x) => x.toFixed(1);
		const bits = [n1(s.ppg) + " points"];
		if (s.rpg >= 7) bits.push(n1(s.rpg) + " rebounds");
		else if (s.apg >= 4.5) bits.push(n1(s.apg) + " assists");
		else if (s.bpg >= 1.8) bits.push(n1(s.bpg) + " blocks");
		else if (s.spg >= 1.8) bits.push(n1(s.spg) + " steals");
		else if (Number.isFinite(s.ts)) return n1(s.ppg) + " points a game on " +
			(s.ts * 100).toFixed(1) + "% true shooting";
		return bits.join(" and ") + " a game";
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
						"The {to} raids {n} programmes",
						"Realignment roundup: {n} schools on the move to the {to}",
					] : [
						"Realignment roundup: {n} programmes change leagues",
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

		// --- an injury that actually moved a team --------------------------
		{
			const withKey = {};
			for (const p of res.players || []) withKey[p.key] = p;
			const candidates = [];
			for (const t of Object.values(teams)) {
				for (const o of t.outages || []) {
					const p = withKey[o.who];
					// The anomaly system already tells this story with more
					// colour for a player who drew one of its injury kinds;
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
					body: [TM(worst.t.name), T(worst.gap > 0
						? " sits No. " + worst.apRank + " in the AP poll but only No. " +
							worst.t.netRank + " in NET — the voters like the record more " +
							"than the computers like the games."
						: " is No. " + worst.t.netRank + " in NET while the AP poll has " +
							"it down at No. " + worst.apRank + " — the résumé is better " +
							"than the reputation.")],
				});
			}
		}

		// --- poll movement -------------------------------------------------
		const hist = res.pollHistory || [];
		if (hist.length > 2) {
			// A change at No. 1 mid-season is always a story.
			let prevTop = hist[0].ranks[0] && hist[0].ranks[0].team;
			for (let w = 1; w < hist.length; w++) {
				const top = hist[w].ranks[0] && hist[w].ranks[0].team;
				if (top && prevTop && top !== prevTop && runs(0.7)) {
					articles.push({
						when: (w / (hist.length - 1)) * 0.98,
						kind: "new number one",
						headline: fill(rng.pick([
							"A new No. 1: {top}",
							"{top} takes over the top spot",
						]), { top: TM(top) }),
						body: [TM(top), T(" replaces "), TM(prevTop),
							T(" at the top of the AP poll in " +
								hist[w].label.toLowerCase() + ".")],
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
				headline: fill(rng.pick(CLASS_FLAVOUR_HEADS), { label: T(res.flavor.label) }),
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
						T(" has won " + c.team.ncaaWins + " games in this tournament — " +
							c.team.ncaaResult + ".")],
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
		const poy = (res.players || []).filter((p) => (p.awards || []).some(
			(a) => /Player of the Year|Naismith Trophy$|Wooden Award$/.test(a) &&
				!/finalist|Top 20|Defensive/.test(a)));
		if (poy.length) {
			const p = poy[0];
			articles.push({
				when: 1.15, kind: "awards",
				headline: fill(rng.pick([
					"{player} sweeps the hardware",
					"{player}, player of the year",
				]), { player: PL(p.name, p.key) }),
				body: [PL(p.name, p.key), T(" (" ), TM(p.newCollege),
					T(") took " + (p.awards || []).filter((a) =>
						/Player of the Year|Trophy|Award/.test(a) &&
						!/finalist|Top 20|watch/.test(a)).length +
						" national honours" +
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
		for (const h of (res.fieldHonours || []).slice(0, runs(0.6) ? 3 : 1)) {
			const segs = [T(h.name)];
			if (h.school && teams[h.school]) segs.push(T(" ("), TM(h.school), T(")"));
			else if (h.school) segs.push(T(" (" + h.school + ")"));
			const heads = h.classYear ? FIELD_HONOUR_HEADS
				: FIELD_HONOUR_HEADS.filter((x) => x.indexOf("{year}") === -1);
			const who = h.key ? PL(h.name, h.key) : T(h.name);
			articles.push({
				when: 1.21, kind: "field honours",
				headline: fill(rng.pick(heads), {
					name: who,
					year: T(h.classYear
						? global.Text.withArticle(h.classYear.toLowerCase(), true) : ""),
				}),
				body: (h.key ? [who] : [T(h.name)]).concat(segs.slice(1)).concat([
					T(" " + honourPhrase(h.award) +
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
					body: [PL(flip.name, flip.key), T(" backed off " +
						flip.recruiting.decommits + " commitments before the letter " +
						"of intent finally landed at "), TM(flip.newCollege), T(".")],
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
					body: [PL(home.name, home.key), T(" is back where he started: " +
						"the portal returns him to "), TM(home.newCollege), T(".")],
				});
			}
		}

		// --- the offseason's biggest bench hire -----------------------------
		// A first-year coach at a big-name programme is a hire worth a story
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
					body: [TM(hire.name), T(" hand the programme to " +
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
					body: [PL(td.name, td.key), T(" ("), TM(td.newCollege),
						T(") has " + td.gameLog.tripleDoubles + " triple-double" +
							(td.gameLog.tripleDoubles > 1 ? "s" : "") + " this season" +
							(td.stats ? ", on " + td.stats.ppg.toFixed(1) + "/" +
								td.stats.rpg.toFixed(1) + "/" + td.stats.apg.toFixed(1) +
								" averages." : "."))],
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
			const HONOURED = /Consensus First Team All-American|Naismith Trophy|Wooden Award|Oscar Robertson Trophy|AP Player of the Year|NABC Player of the Year|Sporting News Player of the Year/;
			const snub = (res.players || []).filter((p) =>
				!p.nonNcaa && p.stats && p.stats.gp >= 15 &&
				!(p.awards || []).some((a) => HONOURED.test(a)))
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
			for (const p of (res.players || []).slice()
				.sort((a, b) => ((b.stats && b.stats.ppg) || 0) - ((a.stats && a.stats.ppg) || 0))) {
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
		for (const e of res.draftEvents || []) {
			articles.push({
				when: 1.4, kind: "draft",
				headline: fill(rng.pick(DRAFT_HEADS), { player: PL(e.player, e.key) }),
				body: [PL(e.player, e.key), T(" — " + global.Text.endSentence(e.text +
					(e.detail ? " (" + e.detail + ")" : "")))],
			});
		}

		articles.sort((a, b) => a.when - b.when);
		for (const a of articles) {
			const year = yearOf(a.when, season);
			a.year = year;
			a.dateline = dateline(a.when) + (year ? " " + year : "");
		}
		return articles;
	}

	global.News = { build, dateline, yearOf, statBlurb, honourPhrase };
})(typeof window !== "undefined" ? window : self);
