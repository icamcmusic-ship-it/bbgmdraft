/* THE TRAIT LAYER.

   An archetype is a SHAPE — what a player's rating vector looks like, and
   therefore what his box score looks like. A trait is everything a scout
   writes down that is not a shape: how long his arms are, whether he plays
   hard, whether he can finish with his left hand, whether the knee is a
   question. The tool had 121 builds, 29 flavors, 32 anomalies, 5 draft
   events, 20 coach styles and 6 star-returner kinds, and none of that
   vocabulary. A note could say a prospect was a Rim Protector at 6'11" and
   could not say he had a seven-foot-four wingspan, which is the first thing
   any human being would have written about him.

   Traits are ORTHOGONAL to builds, which is the whole argument for them: 131
   builds and a trait table multiply rather than add. A Rim Protector with a
   plus-seven wingspan and a Rim Protector with short arms and a great motor
   are two different prospects drawn from one row of the archetype table.

   What a trait can do, in order of how much of it there is:

     - a NOTE LINE. One clause in the scouting sentence, which is what a
       trait is mostly for.
     - an ADJECTIVE the news can use.
     - a BBGM `moodTraits` letter on export. BBGM's four are F (fame), L
       (loyalty), $ (money) and W (winning), and until now the tool wrote
       none of them, so an imported class arrived with whatever BBGM
       happened to roll. A leader gets L, a competitor gets W, a player
       who has been told he is a lottery pick since he was fifteen gets F.
     - a numeric EFFECT, for the handful that the simulation can actually
       express: volatility (night-to-night spread in the game log), the
       offensive/defensive rebound split, the injury roll.

   A trait that does none of those is not in the table. "A specialization you
   cannot see is a label" is the archetype table's standard and it applies
   here with more force, because a trait is cheaper to add and therefore
   easier to add carelessly.

   PREREQUISITES. Every trait states what has to be true of a player before it
   can be drawn: a height band, a class year, build tags he must or must not
   carry. A seven-footer is not "shifty"; a freshman is not "a fifth-year
   professional in a college gym"; a Sharpshooter is not "a non-shooter with
   a broken release". The gates are what make the draw read as a scouting
   report rather than as a shuffle. */
(function (global) {
	"use strict";

	const { clamp } = global.BBGMRng;

	/* Groups exist so the drawer can take at most one trait from each: a
	   player with three different opinions about his wingspan is not a
	   scouting report. */
	const GROUPS = [
		"frame", "athleticism", "motor", "character", "finishing", "shooting",
		"passing", "defense", "rebounding", "medical", "background", "role",
	];

	/* `needs` fields, all optional:
	     minHgt / maxHgt   the BBGM hgt rating band
	     tags              every one of these build tags is required
	     anyTag            at least one of these
	     notTag            none of these
	     years             the class years it can apply to
	     minOvr / maxOvr
	     transfer          true if the player must be a transfer
	   `eff` fields, all optional:
	     vol               multiplier on night-to-night spread (see gameLog)
	     orbBias           shifts the offensive/defensive rebound split
	     inj               multiplier on the injury roll
	   `mood` is a BBGM moodTraits letter. */
	const TRAITS = [
		// --------------------------------------------------------- frame
		{ name: "plus wingspan", group: "frame", w: 2.4,
			note: "a wingspan that measures several inches past his height",
			adj: "long-armed", eff: { orbBias: 0.04 } },
		{ name: "short arms", group: "frame", w: 1.0,
			note: "arms that measure short for his position, which shows at the rim",
			adj: "short-armed", eff: { orbBias: -0.03 } },
		{ name: "elite standing reach", group: "frame", w: 1.2, needs: { minHgt: 58 },
			note: "a standing reach that puts him at the rim without leaving the floor",
			adj: "high-shouldered" },
		{ name: "room to fill out", group: "frame", w: 2.6, needs: { years: ["Freshman", "Sophomore"] },
			note: "a frame that will carry another twenty pounds",
			adj: "wiry" },
		{ name: "maxed-out frame", group: "frame", w: 1.4, needs: { years: ["Senior", "Graduate"] },
			note: "a body that is not going to change much from here",
			adj: "physically finished" },
		{ name: "narrow-shouldered", group: "frame", w: 1.1,
			note: "narrow shoulders that make contact a problem he has to solve some other way",
			adj: "slight" },
		{ name: "genuinely strong", group: "frame", w: 1.6,
			note: "the kind of strength that decides where he gets to catch it",
			adj: "powerful" },

		// ---------------------------------------------------- athleticism
		{ name: "explosive first step", group: "athleticism", w: 2.0, needs: { maxHgt: 62 },
			note: "a first step that gets him past his man without a screen",
			adj: "explosive" },
		{ name: "two-foot leaper", group: "athleticism", w: 1.6,
			note: "a two-foot leaper who needs a gather but goes very high off it",
			adj: "bouncy" },
		{ name: "quick off one foot", group: "athleticism", w: 1.6,
			note: "a one-foot leaper in traffic, which is the useful kind",
			adj: "springy" },
		{ name: "lateral quickness", group: "athleticism", w: 1.8,
			note: "lateral quickness that is better than his straight-line speed",
			adj: "quick-footed" },
		{ name: "straight-line only", group: "athleticism", w: 1.3,
			note: "straight-line speed that does not survive a change of direction",
			adj: "north-south" },
		{ name: "heavy-footed", group: "athleticism", w: 1.2, needs: { minHgt: 55 },
			note: "feet that are a step slow on the perimeter and will be tested there",
			adj: "ground-bound" },
		{ name: "plays above the rim", group: "athleticism", w: 1.4, needs: { anyTag: ["athletic"] },
			note: "a vertical that makes the lob a real option rather than a highlight",
			adj: "vertical" },

		// ----------------------------------------------------------- motor
		{ name: "relentless motor", group: "motor", w: 2.2,
			note: "a motor that does not stop, which shows up in the possessions nobody counts",
			adj: "relentless", mood: "W" },
		{ name: "motor questions", group: "motor", w: 1.4,
			note: "stretches where the effort comes and goes",
			adj: "streaky-effort", eff: { vol: 1.12 } },
		{ name: "plays every possession", group: "motor", w: 1.5,
			note: "a habit of finishing every possession, on both ends",
			adj: "conscientious", mood: "W" },
		{ name: "conditioning questions", group: "motor", w: 1.0,
			note: "conditioning that becomes a factor in the second half",
			adj: "winded" },

		// ------------------------------------------------------- character
		{ name: "natural leader", group: "character", w: 1.5, needs: { years: ["Junior", "Senior", "Graduate"] },
			note: "the voice in the huddle, which the staff will tell you about first",
			adj: "vocal", mood: "L" },
		{ name: "fierce competitor", group: "character", w: 2.0,
			note: "a competitiveness that occasionally has to be managed",
			adj: "combative", mood: "W" },
		{ name: "supremely coachable", group: "character", w: 1.8,
			note: "a player who takes coaching and applies it inside a week",
			adj: "coachable", mood: "L" },
		{ name: "stubborn", group: "character", w: 1.0,
			note: "a stubborn streak about his own shot selection",
			adj: "headstrong" },
		{ name: "plays up to competition", group: "character", w: 1.4,
			note: "his best games against the best opponents, which is the split that matters",
			adj: "big-game", eff: { vol: 1.08 } },
		{ name: "shrinks in the big ones", group: "character", w: 0.9,
			note: "numbers that fall away against ranked opponents",
			adj: "inconsistent", eff: { vol: 1.10 } },
		{ name: "highly recruited since fifteen", group: "character", w: 1.2,
			note: "a player who has been told he was a professional since he was fifteen",
			adj: "hyped", mood: "F" },
		{ name: "chip on the shoulder", group: "character", w: 1.6,
			note: "a chip about being under-recruited that has not worn off",
			adj: "driven", mood: "W" },
		{ name: "quiet professional", group: "character", w: 1.4,
			note: "a professional temperament that never asks for anything",
			adj: "unflappable", mood: "L" },
		{ name: "focus lapses", group: "character", w: 1.0,
			note: "concentration that goes for four or five possessions at a time",
			adj: "distractible", eff: { vol: 1.10 } },

		// ------------------------------------------------------- finishing
		{ name: "off-hand finisher", group: "finishing", w: 1.6, needs: { maxHgt: 68 },
			note: "the ability to finish with his off hand, which almost nobody at this level has",
			adj: "ambidextrous" },
		{ name: "right hand only", group: "finishing", w: 1.5, needs: { maxHgt: 68 },
			note: "a right hand he goes to every single time, which better defenders will take away",
			adj: "one-handed" },
		{ name: "elite floater", group: "finishing", w: 1.4, needs: { maxHgt: 56 },
			note: "a floater he can get to over anybody",
			adj: "crafty" },
		{ name: "finishes through contact", group: "finishing", w: 1.7,
			note: "a willingness to go through the chest rather than around it",
			adj: "physical" },
		{ name: "avoids contact", group: "finishing", w: 1.1,
			note: "a tendency to fade away from contact at the rim",
			adj: "soft-finishing" },
		{ name: "no counter to the drive", group: "finishing", w: 1.2, needs: { maxHgt: 60 },
			note: "one move to the rim and nothing after it",
			adj: "one-dimensional" },

		// -------------------------------------------------------- shooting
		{ name: "quick release", group: "shooting", w: 1.8, needs: { anyTag: ["shooting", "scoring"] },
			note: "a release quick enough that a closeout does not reach it",
			adj: "quick-triggered" },
		{ name: "slow, high release", group: "shooting", w: 1.2,
			note: "a slow release he gets away because of his height and will not at the next level",
			adj: "deliberate" },
		{ name: "two-motion jumper", group: "shooting", w: 1.3,
			note: "a two-motion jumper that works standing still and not off the move",
			adj: "mechanical" },
		{ name: "step-back in his bag", group: "shooting", w: 1.2, needs: { maxHgt: 60, anyTag: ["scoring", "shooting"] },
			note: "a step-back he can get to whenever the possession stalls",
			adj: "shot-creating" },
		{ name: "catch-and-shoot only", group: "shooting", w: 1.5,
			note: "a jumper that lives entirely on the catch",
			adj: "spot-up" },
		{ name: "NBA range already", group: "shooting", w: 1.1, needs: { anyTag: ["shooting"] },
			note: "range that already extends well past the college line",
			adj: "deep-range" },
		{ name: "broken free-throw stroke", group: "shooting", w: 0.9, needs: { minHgt: 60 },
			note: "a free-throw stroke that has not been fixed in three years of trying",
			adj: "non-shooting" },

		// --------------------------------------------------------- passing
		{ name: "reads the second defender", group: "passing", w: 1.5, needs: { anyTag: ["playmaking"] },
			note: "the read most college guards do not make: the second defender, not the first",
			adj: "advanced" },
		{ name: "outlet passer", group: "passing", w: 1.1, needs: { minHgt: 55 },
			note: "an outlet pass that starts the break off his own defensive rebound",
			adj: "quick-outletting" },
		{ name: "post entry passer", group: "passing", w: 1.0, needs: { maxHgt: 60 },
			note: "the rare guard who can actually feed a post",
			adj: "unselfish" },
		{ name: "tunnel vision", group: "passing", w: 1.3, needs: { notTag: ["playmaking"] },
			note: "a habit of deciding what he is doing before he catches it",
			adj: "score-first" },
		{ name: "live-dribble turnovers", group: "passing", w: 1.2,
			note: "turnovers that come off the dribble rather than off the pass, which is the worse kind",
			adj: "loose" },

		// --------------------------------------------------------- defense
		{ name: "navigates screens", group: "defense", w: 1.5, needs: { maxHgt: 62 },
			note: "the ability to get over a screen rather than under it",
			adj: "connected" },
		{ name: "drop-coverage only", group: "defense", w: 1.4, needs: { minHgt: 58 },
			note: "a big who can play drop and cannot play anything else",
			adj: "conservative" },
		{ name: "switchable one through four", group: "defense", w: 1.2, needs: { minHgt: 40, maxHgt: 76 },
			note: "the size and feet to switch across four positions",
			adj: "switchable" },
		{ name: "closeout discipline", group: "defense", w: 1.3,
			note: "closeouts that arrive under control, which is a coached habit and a rare one",
			adj: "disciplined" },
		{ name: "gambles for steals", group: "defense", w: 1.4, needs: { anyTag: ["defense", "athletic"] },
			note: "a gambler in the passing lanes whose team pays for the misses",
			adj: "risk-taking" },
		{ name: "takes charges", group: "defense", w: 1.0,
			note: "a willingness to stand in front of somebody bigger and take the contact",
			adj: "sacrificing", mood: "W" },
		{ name: "loses his man off the ball", group: "defense", w: 1.3,
			note: "off-ball attention that comes and goes",
			adj: "ball-watching" },
		{ name: "transition defense questions", group: "defense", w: 1.1,
			note: "a habit of watching his own shot rather than getting back",
			adj: "slow-retreating" },

		// ------------------------------------------------------- rebounding
		{ name: "boxes out", group: "rebounding", w: 1.4, needs: { minHgt: 48 },
			note: "a genuine box-out habit, which is the least glamorous thing on this list",
			adj: "fundamental", eff: { orbBias: -0.05 } },
		{ name: "chases his own miss", group: "rebounding", w: 1.5,
			note: "an instinct for his own miss that produces second chances nobody schemed",
			adj: "opportunistic", eff: { orbBias: 0.08 } },
		{ name: "rebounds out of area", group: "rebounding", w: 1.2, needs: { minHgt: 52 },
			note: "the range to get to a rebound two men away from him",
			adj: "rangy", eff: { orbBias: 0.03 } },
		{ name: "gets moved under the rim", group: "rebounding", w: 1.1, needs: { minHgt: 55 },
			note: "a base that stronger fives move at will",
			adj: "movable", eff: { orbBias: -0.04 } },

		// --------------------------------------------------------- medical
		{ name: "clean medical", group: "medical", w: 2.6,
			note: "a clean file, which is worth saying out loud",
			adj: "durable", eff: { inj: 0.85 } },
		{ name: "prior surgery", group: "medical", w: 1.2,
			note: "a surgery in his file that teams will want their own doctors to read",
			adj: "reconstructed", eff: { inj: 1.25 } },
		{ name: "chronic knee", group: "medical", w: 0.8,
			note: "a knee that is managed rather than fixed",
			adj: "managed", eff: { inj: 1.5 } },
		{ name: "ankle history", group: "medical", w: 1.1,
			note: "ankles that have cost him games in each of the last two seasons",
			adj: "brittle", eff: { inj: 1.3 } },
		{ name: "has not missed a game", group: "medical", w: 1.6, needs: { years: ["Junior", "Senior", "Graduate"] },
			note: "a career without a missed game in it",
			adj: "available", eff: { inj: 0.7 } },

		// ------------------------------------------------------ background
		{ name: "young for his class", group: "background", w: 1.3, needs: { years: ["Freshman", "Sophomore"] },
			note: "a late birthday that makes him young for everything he has done",
			adj: "young", mood: "F" },
		{ name: "old for his class", group: "background", w: 1.1,
			note: "an age that flatters the production a little",
			adj: "experienced" },
		{ name: "family in the sport", group: "background", w: 1.0,
			note: "a family that has done this before, which shows in the parts nobody teaches",
			adj: "well-schooled" },
		{ name: "played four sports", group: "background", w: 0.9,
			note: "a multi-sport background and a body that reflects it",
			adj: "athletic" },
		{ name: "a long way from home", group: "background", w: 1.2,
			note: "a school two time zones from where he grew up",
			adj: "far-flung" },
		{ name: "stayed home", group: "background", w: 1.4,
			note: "a hometown school and a building full of people who have watched him since he was twelve",
			adj: "local", mood: "L" },
		{ name: "came up through the prep circuit", group: "background", w: 1.3,
			note: "a prep-school year that everybody involved describes as the making of him",
			adj: "prep-schooled" },
		{ name: "learned the game late", group: "background", w: 1.0, needs: { anyTag: ["raw", "athletic"] },
			note: "a player who picked up a basketball at fifteen and is still catching up",
			adj: "unpolished" },

		// ------------------------------------------------------------ role
		{ name: "sixth man", group: "role", w: 1.3,
			note: "a bench role he has taken to rather than argued with",
			adj: "instant-offence", mood: "L" },
		{ name: "wants it late", group: "role", w: 1.4, needs: { anyTag: ["scoring", "shooting"] },
			note: "the man his team goes to with the game on it",
			adj: "clutch", mood: "W", eff: { vol: 1.06 } },
		{ name: "positional versatility", group: "role", w: 1.4,
			note: "three positions he can play and none he is obviously best at",
			adj: "positionless" },
		{ name: "one position only", group: "role", w: 1.2,
			note: "one position, played well, with nothing behind it",
			adj: "specialised" },
		{ name: "system-dependent", group: "role", w: 1.2,
			note: "production that is hard to separate from the offence he plays in",
			adj: "system-reliant" },
		{ name: "would start anywhere", group: "role", w: 0.9, needs: { minOvr: 45 },
			note: "a player who would start for any programme in the country",
			adj: "high-floor" },
	];

	/* Volatility by build. The archetype table's `vol` field is authored on
	   the handful of builds that ARE a volatility statement; everything else
	   is drawn around 1 with a spread, so two players of the same build are
	   still not identical. Traits multiply on top. */
	const VOL_SPREAD = 0.10;

	function matches(t, p) {
		const n = t.needs;
		if (!n) return true;
		const hgt = p.newRatings ? p.newRatings.hgt : 45;
		if (Number.isFinite(n.minHgt) && hgt < n.minHgt) return false;
		if (Number.isFinite(n.maxHgt) && hgt > n.maxHgt) return false;
		if (Number.isFinite(n.minOvr) && (p.newOvr || 0) < n.minOvr) return false;
		if (Number.isFinite(n.maxOvr) && (p.newOvr || 0) > n.maxOvr) return false;
		if (n.years) {
			const cy = String(p.classYear || "").replace(/^Redshirt /, "");
			if (n.years.indexOf(cy) === -1) return false;
		}
		if (n.transfer && !p.transfer) return false;
		const tags = tagsOf(p);
		if (n.tags && !n.tags.every((x) => tags.indexOf(x) !== -1)) return false;
		if (n.anyTag && !n.anyTag.some((x) => tags.indexOf(x) !== -1)) return false;
		if (n.notTag && n.notTag.some((x) => tags.indexOf(x) !== -1)) return false;
		return true;
	}

	function tagsOf(p) {
		const RB = global.RatingsBuilder;
		if (!RB || !p.archetype) return [];
		const a = RB.ARCHETYPES.filter((x) => x.name === p.archetype)[0];
		return (a && a.t) || [];
	}

	function archOf(p) {
		const RB = global.RatingsBuilder;
		if (!RB || !p.archetype) return null;
		return RB.ARCHETYPES.filter((x) => x.name === p.archetype)[0] || null;
	}

	/* Draw a player's traits.

	   Two to four of them, one per group at most, weighted by rarity and
	   gated by the prerequisites. Drawn off the player's own key so a trait
	   survives a re-run, a slider move and a re-apply — the same contract
	   every other per-player fact keeps.

	   `cfg.traitCount` scales how many are drawn; 0 turns the layer off
	   entirely, which is what a user who wants a plain note wants. */
	function assign(p, rng, cfg) {
		const want = clamp(
			cfg && Number.isFinite(cfg.traitCount) ? cfg.traitCount : 3, 0, 6);
		const arch = archOf(p);
		/* Volatility first, because it is a property of the player whether or
		   not any trait touches it. The build's own `vol` is the anchor. */
		let vol = (arch && Number.isFinite(arch.vol) ? arch.vol : 1) *
			(1 + rng.normal(0, VOL_SPREAD));
		const out = [];
		if (want > 0) {
			const usedGroups = {};
			let pool = TRAITS.filter((t) => matches(t, p));
			const n = Math.max(1, Math.round(want + rng.uniform(-0.9, 0.9)));
			for (let i = 0; i < n && pool.length; i++) {
				const pick = rng.weighted(pool, (t) => t.w);
				out.push(pick);
				usedGroups[pick.group] = 1;
				pool = pool.filter((t) => !usedGroups[t.group]);
			}
		}
		const eff = { vol: 1, orbBias: 0, inj: 1 };
		for (const t of out) {
			if (!t.eff) continue;
			if (Number.isFinite(t.eff.vol)) eff.vol *= t.eff.vol;
			if (Number.isFinite(t.eff.orbBias)) eff.orbBias += t.eff.orbBias;
			if (Number.isFinite(t.eff.inj)) eff.inj *= t.eff.inj;
		}
		vol = clamp(vol * eff.vol, 0.7, 1.6);
		return {
			traits: out,
			names: out.map((t) => t.name),
			volatility: vol,
			orbBias: clamp(eff.orbBias, -0.12, 0.12),
			injuryMult: clamp(eff.inj, 0.5, 2.0),
			/* BBGM's four mood traits, deduplicated. An empty list is written
			   as no field at all rather than as an empty array, so a file that
			   never had moodTraits does not acquire one. */
			mood: [...new Set(out.map((t) => t.mood).filter(Boolean))],
		};
	}

	/* The note clause. Two traits at most in one sentence, because a scouting
	   note is a sentence and not a list. */
	function noteClause(traits) {
		const list = (traits || []).filter((t) => t.note).slice(0, 2);
		if (!list.length) return null;
		if (list.length === 1) return list[0].note;
		return list[0].note + ", and " + list[1].note;
	}

	/* One adjective the news layer can put in front of a name. */
	function adjective(traits) {
		const list = (traits || []).filter((t) => t.adj);
		return list.length ? list[0].adj : null;
	}

	global.Traits = {
		TRAITS, GROUPS, assign, matches, noteClause, adjective, tagsOf, VOL_SPREAD,
	};
})(typeof window !== "undefined" ? window : self);
