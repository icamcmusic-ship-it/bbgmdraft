/* Rebuilds player ratings into varied, specialized builds without inflating
   overall rating. Every build is re-solved so that BBGM's own ovr formula
   returns the target ovr exactly. */
(function (global) {
	"use strict";

	const { clamp } = global.BBGMRng;
	const BB = global.BBGM;
	const Cal = global.Calibration;

	/* Rating offsets that define a build. hgt is never touched here: it is tied
	   to the player's listed height, so archetypes are gated on size instead.
	   `w` is a rarity weight and `t` a list of tags the per-class flavor roll
	   reads (see CLASS_FLAVORS). The offset shapes are loosely patterned on the
	   drafted-player clusters in the 2009-21 college data (high-assist low-3PA
	   guards, 3&D wings, high-FTr low-FT% bigs, etc.).

	   The weights used to span [0.35, 1.0], with 47 of the 60 builds inside
	   [0.7, 1.0]. After the exposure normalization that produced a realized
	   frequency spread of about 5x across 59 specialist builds — one of
	   everything, every class, with no scarcity and no sense that a class was
	   guard-heavy or full of stretch bigs. They now span [0.34, 3.6]: a Combo
	   Guard is about ten times more likely than a Point Center, which is roughly
	   the real ratio.

	   The floor came up from 0.16. The six builds with no height gate at all
	   (min 0, max 100) carry an exposure of exactly 1.0 and so get no help from
	   the exposure divisor, which meant the two most interesting builds in a
	   draft class were also the two rarest: Raw Project appeared once in 840
	   players and Athletic Freak nine times. "A Raw Project every twelve
	   rerolls" is not rarity, it is absence, and a raw, toolsy, nobody-knows
	   project is the character a draft class is remembered for. */
	const ARCHETYPES = [
		// --- guards -------------------------------------------------------
		{ name: "Floor General", min: 0, max: 46, w: 2.6, pot: -3, t: ["guard", "playmaking"], o: { pss: 22, drb: 16, oiq: 14, ft: 6, spd: 6, ins: -14, dnk: -12, reb: -10, stre: -8 } },
		{ name: "Combo Guard", min: 0, max: 50, w: 3.6, t: ["guard", "scoring"], o: { fg: 14, tp: 12, drb: 12, spd: 8, pss: -4, diq: -8, reb: -10, ins: -10 } },
		{ name: "Sharpshooter", min: 0, max: 62, w: 2.6, t: ["guard", "shooting"], o: { tp: 24, ft: 18, fg: 10, oiq: 4, ins: -14, dnk: -12, diq: -10, stre: -8, reb: -8 } },
		{ name: "Slasher", min: 0, max: 64, w: 3.0, t: ["guard", "athletic", "scoring"], o: { dnk: 20, spd: 16, jmp: 14, drb: 10, tp: -16, ft: -8, fg: -4, reb: -6 } },
		{ name: "Defensive Pest", min: 0, max: 54, w: 1.9, t: ["guard", "defense"], o: { diq: 22, spd: 18, jmp: 8, endu: 8, ins: -14, dnk: -6, stre: -8, tp: -6, pss: -4 } },
		{ name: "Heliocentric Guard", min: 0, max: 44, w: 0.45, t: ["guard", "playmaking", "scoring"], o: { pss: 18, drb: 18, oiq: 16, fg: 10, endu: 8, diq: -16, reb: -12, ins: -10, stre: -6 } },
		{ name: "Pick-and-Roll Maestro", min: 0, max: 46, w: 1.0, t: ["guard", "playmaking"], o: { pss: 18, oiq: 16, drb: 12, fg: 8, tp: 4, dnk: -10, reb: -10, diq: -8, stre: -6 } },
		{ name: "Movement Shooter", min: 0, max: 56, w: 1.8, t: ["guard", "shooting"], o: { tp: 22, ft: 16, oiq: 6, endu: 8, drb: -12, pss: -8, ins: -12, diq: -8, stre: -6 } },
		{ name: "Pull-Up Artist", min: 0, max: 52, w: 1.1, t: ["guard", "scoring"], o: { fg: 22, tp: 14, drb: 10, ft: 6, diq: -12, reb: -10, ins: -10, dnk: -8, pss: -6 } },
		{ name: "Downhill Attacker", min: 0, max: 52, w: 2.0, t: ["guard", "athletic", "scoring"], o: { spd: 16, dnk: 14, drb: 12, ft: 8, stre: 6, tp: -14, fg: -8, diq: -6, reb: -6 } },
		{ name: "Crafty Finisher", min: 0, max: 48, w: 0.9, t: ["guard", "scoring"], o: { ins: 14, drb: 14, oiq: 10, ft: 8, fg: 6, tp: -10, jmp: -6, diq: -8, reb: -8 } },
		{ name: "Pass-First Sparkplug", min: 0, max: 42, w: 0.55, t: ["guard", "playmaking"], o: { pss: 24, spd: 14, endu: 10, drb: 6, oiq: 6, tp: -8, ins: -14, dnk: -10, reb: -10, fg: -6 } },
		{ name: "Ball Hawk", min: 0, max: 50, w: 1.5, t: ["guard", "defense"], o: { diq: 20, spd: 14, jmp: 8, oiq: -6, ins: -12, ft: -6, tp: -4, reb: -6 } },
		{ name: "Pesky On-Ball Stopper", min: 0, max: 48, w: 1.1, t: ["guard", "defense"], o: { diq: 18, stre: 14, endu: 12, oiq: 6, spd: -4, tp: -8, ins: -10, dnk: -10, jmp: -8, pss: -6 } },
		{ name: "Score-First Point", min: 0, max: 44, w: 1.0, t: ["guard", "scoring"], o: { fg: 14, ins: 10, tp: 10, drb: 10, spd: 6, pss: -10, diq: -10, reb: -8 } },
		{ name: "Sixth-Man Gunner", min: 0, max: 54, w: 0.8, t: ["guard", "shooting", "scoring"], o: { tp: 16, fg: 14, endu: 8, oiq: -6, pss: -8, diq: -10, reb: -8 } },
		{ name: "Streaky Volume Scorer", min: 0, max: 56, w: 0.75, t: ["guard", "scoring"], o: { fg: 18, tp: 14, dnk: 8, ft: 6, oiq: -10, diq: -12, pss: -8, reb: -6 } },
		{ name: "Change-of-Pace Guard", min: 0, max: 46, w: 0.7, t: ["guard", "athletic"], o: { spd: 18, drb: 14, pss: 10, endu: 8, tp: -8, ins: -10, reb: -10, stre: -8 } },
		{ name: "Post-Up Guard", min: 24, max: 46, w: 0.5, t: ["guard", "scoring"], o: { stre: 16, ins: 14, ft: 8, pss: 8, oiq: 6, spd: -12, tp: -10, drb: -6, jmp: -8, reb: -4 } },
		{ name: "Free-Throw Merchant", min: 0, max: 54, w: 0.6, t: ["guard", "scoring"], o: { ft: 18, drb: 12, oiq: 10, spd: 6, ins: 6, tp: -10, diq: -12, reb: -8 } },
		// --- wings --------------------------------------------------------
		{ name: "3&D Wing", min: 34, max: 64, w: 3.4, t: ["wing", "shooting", "defense"], o: { tp: 18, diq: 16, ft: 8, ins: -12, pss: -10, drb: -6, dnk: -4 } },
		{ name: "Two-Way Wing", min: 34, max: 66, w: 3.2, t: ["wing", "defense"], o: { diq: 12, oiq: 12, spd: 8, drb: 6, tp: 4, ins: -8, reb: -4 } },
		{ name: "Point Forward", min: 40, max: 70, w: 1.0, t: ["wing", "playmaking"], o: { pss: 20, oiq: 14, drb: 14, tp: -6, ins: -6, dnk: -4 } },
		{ name: "Wing Sniper", min: 36, max: 64, w: 2.0, t: ["wing", "shooting"], o: { tp: 22, ft: 14, fg: 6, jmp: 4, oiq: 4, drb: -8, ins: -12, dnk: -8, stre: -8, pss: -8, reb: -6 } },
		{ name: "Shot-Creating Wing", min: 36, max: 66, w: 1.9, pot: 2, t: ["wing", "scoring"], o: { fg: 14, drb: 14, ins: 8, dnk: 6, oiq: 6, diq: -10, reb: -8, tp: -4, pss: -4 } },
		{ name: "Transition Wing", min: 34, max: 64, w: 1.7, t: ["wing", "athletic"], o: { spd: 16, dnk: 14, endu: 10, jmp: 8, tp: -10, fg: -8, ft: -6, ins: -6 } },
		{ name: "Cutter / Finisher", min: 36, max: 66, w: 1.7, t: ["wing", "athletic"], o: { dnk: 18, jmp: 12, oiq: 10, endu: 6, tp: -12, drb: -10, pss: -8, fg: -4 } },
		{ name: "Wing Stopper", min: 36, max: 62, w: 1.2, t: ["wing", "defense"], o: { diq: 22, stre: 6, endu: 10, spd: 8, fg: -10, tp: -8, pss: -8, ins: -8 } },
		{ name: "Rebounding Wing", min: 40, max: 62, w: 0.9, t: ["wing", "rebounding"], o: { reb: 14, endu: 10, diq: 8, spd: 6, stre: 6, tp: -10, pss: -8, drb: -8, ft: -6 } },
		{ name: "Corner Specialist", min: 34, max: 62, w: 1.5, t: ["wing", "shooting"], o: { tp: 18, diq: 8, oiq: 8, drb: -12, pss: -10, ins: -10, fg: -4 } },
		{ name: "Midrange Operator", min: 36, max: 66, w: 0.8, t: ["wing", "scoring"], o: { fg: 22, ft: 10, oiq: 8, tp: -12, dnk: -8, reb: -6, pss: -6 } },
		{ name: "Jumbo Playmaker", min: 42, max: 68, w: 0.55, t: ["wing", "playmaking"], o: { pss: 18, drb: 14, oiq: 12, reb: 6, stre: 4, diq: -10, tp: -8, ins: -8, jmp: -8, spd: -6 } },
		{ name: "Energy Wing", min: 34, max: 64, w: 1.6, t: ["wing", "athletic", "defense"], o: { endu: 14, spd: 10, jmp: 10, reb: 8, diq: 6, tp: -10, fg: -10, pss: -8, ft: -6 } },
		{ name: "Do-It-All Forward", min: 40, max: 70, w: 1.1, t: ["wing"], o: { oiq: 10, pss: 8, reb: 8, diq: 8, fg: 4, tp: -6, dnk: -6, ins: -6 } },
		{ name: "Bully Slasher", min: 38, max: 66, w: 0.9, t: ["wing", "scoring"], o: { stre: 16, dnk: 14, ins: 10, ft: 6, tp: -14, fg: -8, pss: -8, drb: -4 } },
		{ name: "Glide Athlete", min: 36, max: 66, w: 1.0, inj: 1.15, t: ["wing", "athletic", "raw"], o: { jmp: 20, spd: 14, fg: 8, endu: 6, dnk: 6, tp: -10, ft: -10, oiq: -8, pss: -8, stre: -10 } },
		// --- everyone -----------------------------------------------------
		{ name: "Microwave Scorer", min: 0, max: 80, w: 0.9, pot: -3, t: ["scoring"], o: { fg: 16, tp: 12, ins: 10, dnk: 8, diq: -16, pss: -12, oiq: -4 } },
		{ name: "Athletic Freak", min: 0, max: 100, w: 1.8, inj: 1.25, t: ["athletic", "raw"], o: { spd: 18, jmp: 20, stre: 12, dnk: 14, oiq: -16, ft: -12, tp: -12, pss: -8 } },
		{ name: "Glue Guy", min: 0, max: 100, w: 1.6, pot: -3, inj: 0.8, t: ["defense", "durability"], o: { diq: 12, oiq: 10, pss: 8, endu: 12, ins: -8, dnk: -8, fg: -4, tp: -2 } },
		{ name: "High-IQ Connector", min: 0, max: 100, w: 1.0, t: ["playmaking"], o: { oiq: 16, pss: 12, diq: 8, tp: 4, dnk: -10, jmp: -8, ins: -8, fg: -4 } },
		{ name: "Raw Project", min: 0, max: 100, w: 1.7, pot: 9, t: ["raw", "athletic"], o: { jmp: 14, spd: 10, stre: 10, endu: 6, oiq: -14, diq: -10, ft: -10, tp: -8, fg: -6 } },
		/* Untagged meant no flavor could ever reach it — measured, Iron Man
		   appeared zero times in 30 consecutive classes. `durability` is the
		   shared availability axis with Injury-Prone Talent and Injury-Return
		   Unknown; `athletic` is what an every-game body is. */
		{ name: "Iron Man", min: 0, max: 100, w: 0.7, inj: 0.45, t: ["athletic", "durability"], o: { endu: 20, stre: 8, diq: 6, oiq: 6, dnk: -8, tp: -6, ins: -8, jmp: -6 } },
		// --- bigs ---------------------------------------------------------
		{ name: "Stretch Big", min: 54, max: 100, w: 2.4, t: ["big", "shooting"], o: { tp: 22, ft: 14, fg: 6, oiq: 4, reb: 4, spd: -8, drb: -10, dnk: -8, ins: -8, diq: -6 } },
		{ name: "Post Scorer", min: 56, max: 100, w: 1.8, t: ["big", "scoring"], o: { ins: 24, stre: 12, reb: 8, dnk: 8, oiq: 6, tp: -16, spd: -12, drb: -10, ft: -8, diq: -6 } },
		{ name: "Rim Protector", min: 58, max: 100, w: 2.4, t: ["big", "defense"], o: { diq: 22, jmp: 12, reb: 14, spd: 8, dnk: 6, oiq: -12, tp: -14, pss: -10, drb: -12 } },
		{ name: "Rim Runner", min: 52, max: 100, w: 3.0, t: ["big", "athletic"], o: { dnk: 22, spd: 14, endu: 10, jmp: 10, reb: 6, tp: -18, ft: -14, pss: -10, drb: -12, oiq: -6 } },
		{ name: "Motor Big", min: 50, max: 100, w: 2.8, pot: 1, t: ["big", "rebounding", "durability"], o: { reb: 20, stre: 14, endu: 14, diq: 10, ft: -12, tp: -14, pss: -6 } },
		{ name: "Skilled Big", min: 54, max: 100, w: 1.8, t: ["big", "playmaking"], o: { ins: 14, pss: 16, oiq: 12, ft: 10, reb: 8, spd: -8, jmp: -6 } },
		{ name: "Point Center", min: 60, max: 100, w: 0.62, pot: 3, t: ["big", "playmaking"], o: { pss: 22, oiq: 16, drb: 10, ft: 6, dnk: -10, jmp: -8, diq: -8, tp: -6 } },
		{ name: "Offensive Rebounding Menace", min: 54, max: 100, w: 1.0, t: ["big", "rebounding"], o: { reb: 20, jmp: 14, dnk: 10, endu: 8, ins: 4, ft: -14, tp: -14, pss: -10, drb: -10, oiq: -6 } },
		{ name: "Switchable Big", min: 54, max: 100, w: 1.2, t: ["big", "defense"], o: { spd: 14, diq: 14, endu: 8, jmp: 6, ins: -10, ft: -8, pss: -8, tp: -6 } },
		{ name: "Mobile Shot-Swatter", min: 56, max: 100, w: 1.1, t: ["big", "defense", "athletic"], o: { jmp: 18, diq: 16, spd: 8, reb: 6, oiq: -12, ins: -10, ft: -10, tp: -8 } },
		{ name: "Face-Up Four", min: 50, max: 78, w: 1.6, t: ["big", "scoring"], o: { fg: 16, tp: 10, drb: 8, oiq: 8, ins: -8, stre: -8, reb: -8, pss: -6 } },
		{ name: "Low-Post Bruiser", min: 56, max: 100, w: 0.9, t: ["big", "scoring", "rebounding"], o: { stre: 22, ins: 14, reb: 12, endu: 8, diq: 4, spd: -14, tp: -16, ft: -12, drb: -10, jmp: -6 } },
		{ name: "Pick-and-Pop Big", min: 52, max: 100, w: 1.7, t: ["big", "shooting"], o: { tp: 18, ft: 12, oiq: 8, fg: 8, drb: -10, spd: -8, reb: -8, ins: -6 } },
		{ name: "Lob Threat", min: 56, max: 100, w: 1.6, t: ["big", "athletic", "raw"], o: { dnk: 20, jmp: 18, stre: 6, ins: 4, oiq: -12, tp: -16, ft: -12, drb: -10, pss: -8, endu: -6 } },
		{ name: "Old-School Center", min: 60, max: 100, w: 0.95, inj: 1.15, t: ["big", "scoring", "rebounding"], o: { ins: 16, reb: 14, oiq: 10, pss: 8, diq: 6, spd: -16, tp: -16, drb: -10, jmp: -8, dnk: -4 } },
		{ name: "Undersized Rebounder", min: 46, max: 64, w: 0.75, pot: -4, t: ["big", "rebounding"], o: { reb: 20, jmp: 12, endu: 12, spd: 8, diq: 6, tp: -10, ins: -10, drb: -8, pss: -6, ft: -6 } },
		{ name: "Foul-Prone Enforcer", min: 54, max: 100, w: 0.6, t: ["big", "defense"], o: { stre: 18, diq: 10, ins: 8, reb: 8, oiq: -14, ft: -10, spd: -8, tp: -8 } },
		/* --- the gaps ------------------------------------------------------

		   Measured coverage of the 60 builds above: endurance was boosted by 19
		   of them and REDUCED BY NONE, so one whole rating was decorative — no
		   conditioning question mark, no foul-trouble-through-effort, no "great
		   in twenty-two minutes". There was no rebounding-tagged build under
		   hgt 46 at all, so a Westbrook or a Marcus Smart could not exist. And
		   the `raw` tag had exactly two members while one flavor multiplies it
		   by 2.2, which is a tilt applied to nothing.

		   These twelve fill those holes rather than adding more of what was
		   already well covered. */
		{ name: "Low-Motor Talent", min: 0, max: 100, w: 1.0, t: ["scoring", "raw", "durability"], o: { fg: 16, ins: 10, tp: 8, oiq: 6, endu: -20, diq: -14, reb: -8 } },
		{ name: "Injury-Prone Talent", min: 0, max: 100, w: 0.7, inj: 2.0, t: ["raw", "durability"], o: { fg: 12, drb: 10, pss: 8, oiq: 8, endu: -22, stre: -12, spd: -4 } },
		{ name: "Foul Magnet Guard", min: 0, max: 48, w: 0.8, t: ["guard", "scoring"], o: { ft: 16, drb: 12, spd: 10, ins: 6, diq: -14, endu: -10, tp: -8, reb: -6 } },
		{ name: "Non-Shooting Playmaker", min: 0, max: 52, w: 1.2, t: ["guard", "playmaking"], o: { pss: 22, drb: 16, oiq: 10, spd: 6, tp: -22, ft: -12, ins: -8 } },
		{ name: "Rebounding Guard", min: 20, max: 46, w: 0.9, t: ["guard", "rebounding", "athletic"], o: { reb: 20, jmp: 12, stre: 10, diq: 8, tp: -12, ins: -10, ft: -8 } },
		{ name: "Two-Way Point Guard", min: 0, max: 44, w: 1.3, t: ["guard", "playmaking", "defense"], o: { pss: 16, diq: 14, oiq: 10, drb: 8, ins: -12, reb: -10, dnk: -8 } },
		{ name: "Small-Ball Five", min: 46, max: 66, w: 1.0, t: ["big", "defense", "athletic"], o: { stre: 16, reb: 14, diq: 12, jmp: 8, tp: -12, drb: -10, pss: -8, ft: -6 } },
		{ name: "Stretch Four Stopper", min: 48, max: 74, w: 1.1, t: ["big", "shooting", "defense"], o: { tp: 14, diq: 14, stre: 10, reb: 8, oiq: 4, ins: -12, pss: -10, drb: -12, spd: -6 } },
		{ name: "Rim-Running Wing", min: 40, max: 68, w: 1.2, t: ["wing", "athletic"], o: { spd: 16, dnk: 14, endu: 12, reb: 6, oiq: -6, tp: -14, ft: -10, pss: -8, fg: -6 } },
		{ name: "Late Bloomer", min: 0, max: 100, w: 1.1, t: ["raw"], o: { endu: 10, oiq: 8, spd: 6, stre: 6, fg: -8, tp: -6, ins: -6, drb: -4 } },
		{ name: "Fifth-Year Senior", min: 0, max: 100, w: 1.2, pot: -6, inj: 1.1, t: ["defense", "playmaking", "durability"], o: { oiq: 14, diq: 10, ft: 8, fg: 6, jmp: -14, spd: -10, endu: -4, dnk: -8 } },
		{ name: "Positionless Forward", min: 38, max: 72, w: 1.4, t: ["wing", "playmaking", "defense"], o: { pss: 12, diq: 10, drb: 10, reb: 8, oiq: 6, ins: -10, dnk: -8, ft: -6 } },
		/* --- twenty-six more, and the shape of the table ---------------------

		   Two measured faults, fixed together rather than by adding more of
		   what was already well covered.

		   TAG COVERAGE was badly unbalanced: `guard` had 24 members and
		   `rebounding` and `raw` had five each, while CLASS_FLAVORS multiplies
		   those tags by up to 2.2. A 2.2x on a five-member pool is a much
		   blunter instrument than the same multiplier on a 24-member one, so a
		   rebounding-heavy or raw-heavy class could only ever be the same five
		   builds — which is the opposite of what a flavor is for. Fifteen of
		   the builds below carry `rebounding`, `raw`, `big` or `shooting`.

		   THE OFFSET TABLE WAS SYSTEMATICALLY SUBTRACTIVE. Every rating except
		   oiq and endurance was reduced by more builds than boosted it, most
		   severely tp (20 up / 43 down), ins (13/36), pss (16/31) and reb
		   (18/25). The ovr-neutralizing normalizer handles the LEVEL, so
		   nothing was broken — but the shape meant the average specialist was a
		   subtraction, which is why specialization read as "worse at things"
		   rather than "different". These builds lean the other way: most of
		   them boost one of the four ratings the table was starving, and the
		   measured ratio of boosts to cuts improved for every one of them
		   (ft 19/23 -> 30/32, reb 18/25 -> 24/30, tp 20/43 -> 25/48,
		   pss 16/31 -> 24/36). tp, ins, pss and reb are still net-negative and
		   will stay so: they are the ratings a specialist genuinely trades
		   away, and the normalizer handles the level regardless. The fault
		   worth fixing was the SHAPE being lopsided enough that the average
		   build read as a subtraction, and it no longer is.

		   `ins` remains the widest of them — 25 builds boost it against 51 that
		   cut it — and that is the right ratio rather than a residual fault.
		   Inside scoring is what a modern specialist actually trades away:
		   three quarters of the table is guards, wings and stretch bigs, and a
		   build that loads on ins is by construction a post player. What the
		   audit correctly identified as the CONSEQUENCE — that ins carries
		   weight 1.5 in BBGM's usage composite, the highest of any rating, so a
		   table that is net-negative on it systematically under-reads inside
		   scoring's claim on the offense — is real, and it is handled where it
		   arises rather than by adding post builds nobody asked for: see
		   USAGE_SELF_REF below, which is the fix for the protection mechanism
		   the audit named as compensating "imperfectly".

		   Role usage is derived now (see ROLE_USAGE below), so none of them
		   needs a hand-fitted constant, which is what made adding builds
		   expensive enough that there were 72 and not a hundred. */
		// --- guards -------------------------------------------------------
		{ name: "Off-Ball Mover", min: 0, max: 52, w: 1.5, t: ["guard", "shooting", "athletic"], o: { endu: 16, spd: 12, oiq: 10, tp: 10, dnk: 6, drb: -12, pss: -10, ins: -8, stre: -8 } },
		{ name: "Defensive Combo Guard", min: 0, max: 50, w: 1.6, t: ["guard", "defense", "playmaking"], o: { diq: 16, drb: 10, pss: 10, endu: 8, ins: -12, dnk: -10, reb: -8, tp: -4 } },
		{ name: "Turnover-Prone Creator", min: 0, max: 48, w: 1.0, t: ["guard", "playmaking", "raw"], o: { drb: 18, pss: 16, spd: 8, fg: 6, oiq: -18, diq: -10, reb: -8 } },
		{ name: "Spot-Up Only Guard", min: 0, max: 54, w: 1.3, t: ["guard", "shooting"], o: { tp: 20, ft: 14, fg: 6, oiq: 4, drb: -14, spd: -10, pss: -10, ins: -8, diq: -6 } },
		{ name: "Tough-Shot Maker", min: 0, max: 56, w: 1.1, t: ["guard", "scoring"], o: { fg: 20, tp: 10, jmp: 8, oiq: 6, diq: -12, pss: -10, reb: -8, endu: -6 } },
		{ name: "Full-Court Pusher", min: 0, max: 46, w: 1.2, t: ["guard", "athletic", "playmaking"], o: { spd: 18, endu: 14, pss: 12, drb: 8, fg: -12, ins: -10, stre: -10, reb: -6 } },
		{ name: "Steady Backup Point", min: 0, max: 44, w: 1.1, inj: 0.85, t: ["guard", "playmaking"], o: { oiq: 14, pss: 12, ft: 10, diq: 6, jmp: -12, dnk: -10, spd: -8, ins: -6 } },
		// --- wings --------------------------------------------------------
		{ name: "Weak-Side Rim Protector", min: 40, max: 70, w: 1.3, t: ["wing", "defense", "rebounding"], o: { diq: 16, jmp: 12, reb: 12, endu: 6, fg: -12, ft: -12, drb: -10, spd: -4 } },
		{ name: "Slashing Non-Shooter", min: 34, max: 66, w: 1.5, t: ["wing", "athletic", "scoring"], o: { dnk: 18, spd: 12, ins: 12, stre: 8, tp: -20, ft: -12, pss: -6 } },
		{ name: "Connective Passer Wing", min: 36, max: 68, w: 1.3, t: ["wing", "playmaking"], o: { pss: 16, oiq: 12, ft: 8, drb: 6, dnk: -12, jmp: -10, ins: -8, stre: -6 } },
		{ name: "Small-Ball Four", min: 44, max: 70, w: 1.4, t: ["wing", "big", "rebounding"], o: { reb: 16, stre: 14, ins: 10, diq: 8, ft: -10, drb: -10, spd: -8, dnk: -8 } },
		{ name: "Off-Ball Cutter Specialist", min: 36, max: 68, w: 1.1, t: ["wing", "athletic", "scoring"], o: { dnk: 16, oiq: 12, spd: 8, ins: 8, drb: -14, pss: -12, tp: -10, ft: -4 } },
		{ name: "High-Motor Rebounding Forward", min: 40, max: 70, w: 1.4, t: ["wing", "rebounding"], o: { reb: 18, endu: 12, stre: 12, diq: 8, ins: 4, fg: -12, oiq: -8, drb: -10, tp: -10 } },
		// --- bigs ---------------------------------------------------------
		{ name: "Passing Hub Five", min: 56, max: 100, w: 1.0, t: ["big", "playmaking"], o: { pss: 20, oiq: 14, ft: 8, ins: 8, reb: 6, spd: -12, jmp: -12, diq: -10, tp: -6, dnk: -6 } },
		{ name: "Drop-Coverage Anchor", min: 58, max: 100, w: 1.6, t: ["big", "defense", "rebounding"], o: { diq: 18, reb: 14, stre: 10, ins: 6, spd: -14, fg: -12, drb: -10, dnk: -6 } },
		{ name: "Perimeter-Switch Five", min: 54, max: 100, w: 1.3, t: ["big", "defense", "athletic"], o: { spd: 16, diq: 12, endu: 10, jmp: 8, ins: -12, ft: -8, fg: -8, dnk: -6 } },
		{ name: "Free-Throw-Line Extended Big", min: 50, max: 80, w: 1.2, t: ["big", "shooting", "scoring"], o: { ft: 18, fg: 14, oiq: 8, ins: 6, spd: -10, drb: -10, reb: -8, diq: -6 } },
		{ name: "Bruising Backup Center", min: 58, max: 100, w: 1.2, t: ["big", "scoring", "rebounding"], o: { stre: 18, ins: 14, reb: 12, dnk: 6, spd: -14, drb: -14, endu: -10, jmp: -8 } },
		{ name: "Third-Big Energy Guy", min: 52, max: 100, w: 1.5, pot: 2, t: ["big", "rebounding", "athletic"], o: { endu: 18, dnk: 12, reb: 10, spd: 8, diq: 6, drb: -12, ft: -12, oiq: -10, tp: -10 } },
		// --- everyone -----------------------------------------------------
		{ name: "Two-Sport Athlete", min: 0, max: 100, w: 1.1, inj: 1.2, t: ["athletic", "raw"], o: { spd: 16, stre: 16, endu: 12, jmp: 8, oiq: -14, fg: -12, tp: -10, drb: -8, pss: -6 } },
		{ name: "Late-Blooming Shooter", min: 0, max: 100, w: 1.3, t: ["shooting", "raw"], o: { tp: 18, ft: 12, endu: 8, drb: 6, oiq: -6, ins: -12, dnk: -10, diq: -8, stre: -8, pss: -6 } },
		{ name: "System Player", min: 0, max: 100, w: 1.2, t: ["playmaking", "defense"], o: { oiq: 14, diq: 10, tp: 8, endu: 8, pss: 4, dnk: -12, jmp: -10, drb: -8, ins: -6, stre: -4 } },
		{ name: "High-Floor Low-Ceiling", min: 0, max: 100, w: 1.2, inj: 0.85, t: ["defense"], o: { oiq: 12, ft: 12, fg: 8, endu: 8, diq: 4, jmp: -14, dnk: -12, spd: -8, reb: -6 } },
		{ name: "Boom-or-Bust Tools", min: 0, max: 100, w: 1.4, inj: 1.3, t: ["raw", "athletic"], o: { jmp: 18, dnk: 14, spd: 10, stre: 8, oiq: -16, diq: -12, ft: -10, drb: -8 } },
		{ name: "Overseas Pro Veteran", min: 0, max: 100, w: 1.0, pot: -6, t: ["shooting", "playmaking"], o: { oiq: 14, tp: 12, pss: 10, ft: 8, jmp: -14, spd: -10, dnk: -8, endu: -6 } },
		{ name: "Injury-Return Unknown", min: 0, max: 100, w: 0.9, pot: 5, inj: 1.7, t: ["raw", "scoring", "durability"], o: { fg: 12, ins: 10, oiq: 8, ft: 6, endu: -18, spd: -10, jmp: -8 } },

		/* --- shooting-tagged additions (task 4.1) ---
		   Measured: the `shooting` tag had 14 members against `guard`'s 30+, and
		   CLASS_FLAVORS multiplies shooting by 2.6 in the shooting-rich class.
		   Six more fills the tag to ~20 so the multiplier has real diversity to
		   work with. Each is a recognisable spot in the modern game: off-ball
		   catch-and-shoot, transition pull-up, a true center who shoots, a
		   relocation wing, a handoff-action guard, a floor-spacing four. */
		// --- guards (shooting) -----------------------------------------------
		{ name: "Transition Sniper", min: 0, max: 54, w: 1.2, t: ["guard", "shooting", "athletic"], o: { tp: 18, spd: 14, ft: 10, endu: 6, ins: -14, pss: -12, reb: -10, stre: -6 } },
		{ name: "DHO Specialist", min: 0, max: 52, w: 1.0, t: ["guard", "shooting", "playmaking"], o: { tp: 16, pss: 12, oiq: 10, ft: 8, ins: -14, dnk: -10, reb: -10, stre: -6 } },
		// --- wings (shooting) ------------------------------------------------
		{ name: "Catch-and-Shoot Wing", min: 34, max: 64, w: 1.6, t: ["wing", "shooting"], o: { tp: 20, ft: 10, diq: 8, endu: 6, spd: 4, drb: -14, pss: -10, ins: -10, dnk: -6, reb: -6 } },
		{ name: "Relocation Shooter", min: 34, max: 66, w: 1.3, t: ["wing", "shooting", "athletic"], o: { tp: 18, oiq: 12, spd: 8, fg: 8, diq: 4, drb: -14, pss: -12, ins: -10, stre: -8 } },
		// --- bigs (shooting) -------------------------------------------------
		{ name: "Stretch Five", min: 60, max: 100, w: 1.4, t: ["big", "shooting"], o: { tp: 20, ft: 12, diq: 10, reb: 8, stre: 4, spd: -14, drb: -14, dnk: -8, ins: -8 } },
		{ name: "Floor-Spacing Four", min: 48, max: 78, w: 1.5, t: ["big", "shooting"], o: { tp: 18, ft: 10, reb: 8, oiq: 8, ins: -10, dnk: -12, drb: -12, spd: -10, pss: -6, stre: 4 } },

		/* --- genuine-center builds (task 4.2) --------------------------------
		   No build in the table had min >= 72: every "big" was eligible for a
		   6'6" wing, so a 7'2" true center drew from the same pool as a 6'8"
		   power forward. Nine builds with min 72-78 give a seven-footer his own
		   identity space — post-up, rim-running, anchoring, paint-bully — without
		   overlapping the tweener fours. */
		{ name: "Back-to-Basket Center", min: 76, max: 100, w: 1.3, t: ["big", "scoring", "rebounding"], o: { ins: 22, stre: 12, ft: 10, oiq: 8, reb: 8, spd: -16, tp: -16, drb: -12, pss: -6, jmp: -8 } },
		{ name: "Shot-Blocking Anchor", min: 76, max: 100, w: 1.4, pot: 2, t: ["big", "defense"], o: { diq: 22, jmp: 10, ins: 10, stre: 8, endu: -10, reb: 2, spd: -10, tp: -16, pss: -10, drb: -12 } },
		{ name: "Glass-Eating Center", min: 76, max: 100, w: 1.3, t: ["big", "rebounding"], o: { reb: 24, stre: 14, ins: 10, oiq: 6, spd: -14, jmp: -8, tp: -16, drb: -12, pss: -8 } },
		{ name: "Paint Bully", min: 74, max: 100, w: 1.2, t: ["big", "scoring", "rebounding"], o: { stre: 20, dnk: 14, ins: 12, reb: 10, endu: 6, tp: -18, spd: -12, drb: -12, fg: -10, oiq: -6 } },
		{ name: "Vertical Spacer", min: 74, max: 100, w: 1.1, t: ["big", "athletic", "raw"], o: { jmp: 18, dnk: 14, diq: 8, spd: 4, stre: -6, tp: -18, ft: -12, drb: -12, pss: -8, oiq: -8, ins: -4 } },
		{ name: "Hook-Shot Specialist", min: 76, max: 100, w: 0.9, t: ["big", "scoring"], o: { ins: 20, fg: 16, endu: 8, oiq: 4, stre: 4, tp: -18, spd: -12, drb: -10, pss: -8, diq: -8, reb: -6 } },
		{ name: "Screen-and-Roll Center", min: 72, max: 100, w: 1.3, t: ["big", "athletic"], o: { dnk: 18, stre: 14, jmp: 10, endu: 8, tp: -16, ft: -12, drb: -10, pss: -8 } },
		{ name: "Defensive Pillar", min: 74, max: 100, w: 1.2, t: ["big", "defense", "rebounding"], o: { diq: 20, reb: 16, stre: 12, endu: 8, tp: -16, fg: -12, drb: -10, spd: -10 } },
		{ name: "Two-Way Center", min: 72, max: 100, w: 1.1, pot: 1, t: ["big", "defense", "scoring", "rebounding"], o: { diq: 16, ins: 14, reb: 10, stre: 8, tp: -14, drb: -12, spd: -10, pss: -8 } },

		/* --- four gaps in the coverage, measured rather than wished for -----

		   Each of these is a role a scout names out loud and the table could
		   not express, and each is distinguishable from the build it is
		   nearest to by more than a degree:

		   Screen Navigator is NOT a shooter. Movement Shooter loads tp 20 /
		   ft 14 and its identity is the shot at the end; this one's identity is
		   the two seconds before it — the conditioning and the feel to come off
		   three screens and be open, which is a separable skill and the reason
		   a 34% shooter can be a starter. It is the only build in the table
		   whose largest offset is endurance and whose shooting is untouched.

		   Secondary Creator sits between Shot-Creating Wing (fg 16, an iso
		   scorer) and Connective Passer Wing (pss 16, a swing-swing connector).
		   Both extremes existed and the two-to-four in the middle — the man who
		   runs the second side of the action, creates a shot when the first
		   option dies, and is the reason a good offense has two of them — did
		   not.

		   Zone Buster is an identity college has and the NBA does not, which is
		   exactly why a college draft tool should carry it: feel and range
		   against a set zone, with none of the strength or rebounding that a
		   man-to-man matchup asks for.

		   Matchup-Zone Defender is the 6'7"-6'9" band specifically (hgt 52-66
		   maps to about 78.5-81.8 inches). Switchable Big is a five who can
		   move his feet; Wing Stopper is a pure on-ball stopper who gives up
		   offense for it. This is the man who guards one through four in a
		   changing defense and is still on the floor for it. */
		{ name: "Screen Navigator", min: 0, max: 54, w: 1.3, t: ["guard", "athletic", "durability"], o: { endu: 20, spd: 12, oiq: 12, diq: 6, ins: -12, stre: -12, reb: -10, dnk: -8 } },
		{ name: "Secondary Creator", min: 36, max: 68, w: 1.6, pot: 2, t: ["wing", "playmaking", "scoring"], o: { drb: 14, pss: 12, fg: 10, ins: 8, oiq: 6, reb: -12, diq: -10, stre: -8, jmp: -6 } },
		{ name: "Zone Buster", min: 0, max: 66, w: 1.1, t: ["shooting", "scoring"], o: { oiq: 18, tp: 16, fg: 10, pss: 6, stre: -16, reb: -14, dnk: -10, diq: -8 } },
		{ name: "Matchup-Zone Defender", min: 52, max: 66, w: 1.3, t: ["wing", "defense", "athletic"], o: { diq: 18, spd: 10, endu: 10, reb: 8, oiq: 6, stre: 4, ins: -10, tp: -8, ft: -8, pss: -6, dnk: -6 } },

		/* --- four more gaps, each a role a scout names out loud ------------

		   Point-of-Attack Menace is the genuine non-shooter who is a great
		   defender at 6'3": Defensive Pest and Ball Hawk both cut tp by only
		   4-6, so the table had no guard whose jumper is truly broken and who
		   starts anyway because nobody gets the ball up the floor against him.

		   Rim-Pressure Bruiser is the foul-drawing rim finisher without a
		   jumper. Free-Throw Merchant is a guard build; this is the big whose
		   whole offense is a seal, a catch and two free throws.

		   Grab-and-Go Big is the high-turnover high-assist big. Passing Hub
		   Five and Point Center both carry positive oiq, so the table could not
		   say "he sees everything and throws a third of it away".

		   Tweener Forward is the 6'9"-6'10" band (hgt 58-74), which was the
		   thinnest pool in the table — most wing builds cap at 66-70 and the
		   center builds start at 72-76 — despite being the most common
		   bad-outcome profile in real drafts: not a wing, not a five, tools
		   without a role. */
		{ name: "Point-of-Attack Menace", min: 0, max: 50, w: 1.0, t: ["guard", "defense", "athletic"], o: { diq: 20, spd: 14, endu: 10, stre: 6, tp: -16, ft: -10, ins: -8, fg: -6 } },
		{ name: "Rim-Pressure Bruiser", min: 62, max: 88, w: 1.0, pot: -1, t: ["big", "scoring", "raw"], o: { ins: 16, dnk: 14, stre: 12, endu: 6, tp: -18, ft: -6, pss: -8, oiq: -6 } },
		{ name: "Grab-and-Go Big", min: 60, max: 80, w: 0.9, t: ["big", "playmaking", "raw"], o: { pss: 16, drb: 12, reb: 8, spd: 8, oiq: -14, tp: -10, ft: -8 } },
		{ name: "Tweener Forward", min: 58, max: 74, w: 1.3, t: ["wing", "big", "raw", "rebounding"], o: { jmp: 12, stre: 6, reb: 8, endu: 6, tp: -10, pss: -8, ins: -6, diq: -8 } },

		/* --- shapes the table did not have -------------------------------

		   Ten builds that exist in every real draft class and had no row. The
		   test is not "is this a player" but "is this a SHAPE the table
		   cannot already draw": each of these was checked against the
		   cosine-similarity sweep in tools/test.js, which is what stopped the
		   table growing to 121 names for 65 shapes.

		   Where a build is close to an existing one the difference is stated
		   in the comment, because a reader looking for redundancy will find
		   these first. */
		/* Offensive Rebounding Menace is all-glass (reb +20 with no split).
		   This one lives entirely on the offensive board and is a liability
		   on the defensive one, which is a real and distinct player: the
		   6'8" energy four who gets six second-chance points and lets his
		   man run past him to the other end. The stat model can express the
		   difference now that rebWeight splits the two. */
		{ name: "Putback Specialist", min: 50, max: 84, w: 1.0, t: ["big", "rebounding", "athletic"], o: { reb: 18, jmp: 16, dnk: 12, endu: 8, stre: 6, tp: -18, ft: -12, pss: -14, drb: -14, diq: -8, oiq: -6 } },
		/* Crafty Finisher is rim-only. This is the mid-range and floater
		   guard — the man who gets to eight feet and stops, which is a
		   different shot chart and a different set of tools. */
		{ name: "Floater Guard", min: 0, max: 46, w: 1.1, t: ["guard", "scoring"], o: { fg: 16, ins: 12, oiq: 10, drb: 8, ft: 6, tp: -14, dnk: -14, jmp: -10, stre: -8, reb: -8 } },
		/* Post-Up Guard stops at hgt 46. A post-up WING is the other end of
		   the same idea and had nowhere to live: too tall for that build and
		   too small for the big builds. */
		{ name: "Post-Up Wing", min: 40, max: 68, w: 0.9, t: ["wing", "scoring"], o: { ins: 18, stre: 14, ft: 8, oiq: 6, reb: 4, tp: -12, spd: -10, drb: -8, jmp: -6 } },
		/* Rim Runner and Lob Threat both carry +reb. A lob target who cannot
		   rebound is the most common version of this player in a real class
		   and the table could not draw him. */
		{ name: "Rolling Lob Target", min: 56, max: 92, w: 1.2, pot: 2, t: ["big", "athletic"], o: { dnk: 24, spd: 14, endu: 10, reb: -14, jmp: 6, tp: -14, ft: -10, pss: -12, drb: -10, diq: -8 } },
		/* Every defensive build produces EVENTS. This one is the 0.8 steals,
		   0.3 blocks, elite defensive rating player — position, hands, charges
		   — and had no way to exist: the identity multipliers added for the
		   defense tag would have made him a shot-blocker. Negative on stl and
		   blk sources, positive on diq and oiq. */
		{ name: "Help-Side Anchor", min: 44, max: 84, w: 1.0, t: ["defense"], o: { diq: 20, oiq: 12, stre: 10, endu: 8, jmp: -10, spd: -8, tp: -10, ins: -8, dnk: -10, pss: -6 } },
		/* Glue Guy is any-size and is a biography as much as a shape. This is
		   the specific one: a wing who guards and genuinely does not want the
		   ball, which the usage intent of the tags now says out loud. */
		{ name: "Two-Way Non-Scorer", min: 36, max: 70, w: 1.2, t: ["wing", "defense"], o: { diq: 18, endu: 12, oiq: 8, stre: 8, reb: 6, fg: -14, ins: -12, tp: -8, dnk: -8, pss: -4 } },
		/* Point Center handles; Grab-and-Go pushes. Neither SCREENS. The
		   inverted pick-and-roll big is the one who sets it and then handles
		   it out of the short roll, which is drb and pss on top of stre. */
		{ name: "Inverted Screener", min: 62, max: 92, w: 0.7, pot: 2, t: ["big", "playmaking", "scoring"], o: { pss: 16, drb: 14, stre: 12, oiq: 10, fg: 6, tp: -8, spd: -8, diq: -8, jmp: -6 } },
		/* Streaky Volume Scorer is a usage offset with the same night-to-night
		   spread as everybody else. This build carries `vol`, which the game
		   log reads (see gameLog): the same average, a much wider distribution
		   around it. */
		{ name: "Heat-Check Scorer", min: 0, max: 60, w: 0.85, vol: 1.35, t: ["guard", "scoring", "shooting"], o: { tp: 18, fg: 16, dnk: 6, oiq: -12, diq: -12, pss: -10, reb: -8, endu: -4 } },
		/* Nothing in the table loaded `ft` negatively enough to matter, so the
		   hack-a-candidate — a genuinely good big who cannot shoot a free
		   throw — did not exist. -26 is the point at which the FT term in the
		   stat model produces a sub-50% shooter. */
		{ name: "Hack-a-Candidate", min: 64, max: 100, w: 0.7, t: ["big", "rebounding"], o: { stre: 16, reb: 14, ins: 10, dnk: 8, ft: -26, tp: -18, pss: -10, drb: -12, spd: -8 } },
		/* The other half of the Vertical Spacer: a five who can shoot and
		   cannot do anything else. Stretch Five exists at the good end; this
		   is the specialist version with the defensive cost priced in. */
		{ name: "Standstill Stretch Five", min: 62, max: 100, w: 0.8, t: ["big", "shooting"], o: { tp: 22, ft: 14, oiq: 6, spd: -14, jmp: -12, diq: -12, reb: -8, drb: -8, dnk: -6 } },

		{ name: "Balanced", min: 0, max: 100, w: 1.0, t: [], o: {} },
	];

	/* Role usage: the share of a team's offense a build is given, over and
	   above what BBGM's usage composite says.

	   The composite is (1.5*ins + dnk + fg + tp + 0.5*(spd + hgt + drb + oiq)),
	   which is a description of a player's SHOT-MAKING, not of the role a
	   coach hands him. USAGE_PROTECT stops the ovr-neutralizing normalizer
	   gutting a defensive build's offense, and it works in its own terms — but
	   it can only protect what the composite reads, so a stopper still lost
	   volume, and the measured spread of scoring at equal overall rating ran
	   from -4.9 points (Defensive Pest) to +4.9 (Score-First Point). Nearly ten
	   points of scoring decided by build alone, at the same rating, is not a
	   specialization, it is a different player.

	   `u` says what the composite cannot: an on-ball creator is given the ball
	   whether or not his ins rating agrees, and a rim protector is not, and
	   both of those are role facts. Absent = 1.0. The table is fitted, not
	   guessed: each value is the multiplier that brings its build's mean
	   scoring residual against the class's own ovr fit inside +/-2 points, and
	   tools/validate.js bands the worst of them so it cannot drift back. */
	/* THE TABLE IS GONE. This is now DERIVED.

	   It used to be 72 hand-fitted constants, one per build, each of them the
	   multiplier that happened to bring its build's mean scoring residual
	   inside +/-2 points on the day it was measured. Three things were wrong
	   with that:

	     - Two builds had no entry at all (Injury-Prone Talent and Fifth-Year
	       Senior) and silently defaulted to 1.0, which made Injury-Prone Talent
	       the highest-scoring build in the class at 24.3 points a game. A
	       lookup that answers 1.0 for a name it has never seen cannot be
	       tested, because there is nothing to see.
	     - Twelve of the 72 sat on the fit boundary — seven pinned at exactly
	       2.30 and five at 0.32-0.34 — which means the fit failed for those
	       builds and was clipped. It worked, but only just, and only for the
	       exact model it was fitted against.
	     - Every new build needed a hand-fitted constant, which is the real
	       reason there were 72 builds and not 120.

	   What the table was actually compensating for is a known quantity. BBGM's
	   usage composite is 1.5*ins + dnk + fg + tp + 0.5*(spd + hgt + drb + oiq),
	   over 650 — a description of a player's SHOT-MAKING. An archetype that
	   loads on fg and tp raises that composite and takes volume it was never
	   given; one that loads on diq and reb lowers it and loses volume it never
	   should have lost. Both of those are computable straight off the build's
	   own (ovr-neutralized) offset vector.

	   So:

	     compensation = (U0 / (U0 + compositeDelta)) ^ ROLE_COMP_EXP

	   undoes what the composite over- or under-reads, and a small per-tag
	   INTENT term says what a coach does on purpose: a creator gets the ball
	   whether or not his ins rating agrees, and a rim protector does not.

	   Fitted, not guessed: tools/rolefit.js measures every build's mean scoring
	   residual against the class's own ovr fit and reports the constants that
	   minimize them, and tools/validate.js bands the worst residual so this
	   cannot drift. Adding a build no longer requires adding a constant. */
	const ROLE_USAGE_W = { ins: 1.5, dnk: 1, fg: 1, tp: 1, spd: 0.5, hgt: 0.5, drb: 0.5, oiq: 0.5 };
	const ROLE_USAGE_DENOM = 650;
	/* The usage composite a typical drafted prospect scores. Measured on a
	   draft-slot-shaped class, which is the population this has to be right
	   for; the old fixture's 0.45 is what made the filler baseline wrong too. */
	const ROLE_U0 = 0.394;
	/* Self-creation. The usage composite counts drb and oiq at 0.5 and pss not
	   at all, because it is measuring who can MAKE a shot, not who makes his
	   own. A build that loads on handle and vision is given the ball more than
	   its shot-making says: that is the difference between a Slasher and a
	   Cutter, who do the same damage but only one of whom creates it. Weighted
	   the way a creation role actually splits: handle first, then passing, then
	   feel.

	   The fit currently puts almost no weight on it (createW is near zero): the
	   playmaking and guard tags between them already absorb what it measures on
	   the present table. It is kept because it is a real and separable term —
	   the tags are a proxy for it and a new build can easily be a creator
	   without carrying either tag — and because a regressor the fit can decide
	   is worth nothing is exactly what a fitted model should contain. */
	const ROLE_CREATE_W = { drb: 0.6, pss: 1.0, oiq: 0.5 };
	function rawCreation(arch) {
		let d = 0;
		for (const k of Object.keys(ROLE_CREATE_W)) d += ROLE_CREATE_W[k] * (arch.o[k] || 0);
		// Scaled so the term has roughly unit spread across the table, which
		// is what keeps tools/rolefit.js's ridge from shrinking it to nothing
		// purely because its column was small.
		return d / 25;
	}

	/* What the TAGS predict about a build's creation, so the creation term can
	   be the part they do not.

	   The fit put createW at 0.02 — arithmetically present, practically zero —
	   and the honest reading of that was in the old comment: "the playmaking
	   and guard tags between them already absorb what it measures". That is a
	   collinearity, not a finding. Every heavy creator in the table carries the
	   playmaking or the guard tag, so the two columns of the design matrix
	   moved together, the ridge split the credit toward the one with more mass,
	   and the regressor that was supposed to separate a Heliocentric Guard from
	   a Sharpshooter was left with 2.5% of separation to do it with. The term
	   was not measured to be worthless; it was measured against a copy of
	   itself.

	   So creation is residualized against the tags before it is used. Each tag
	   carries the mean raw creation of the builds that hold it, a build's
	   predicted creation is the mean of its own tags' means, and
	   creationDelta() returns the difference. The term now answers a question
	   the tags cannot: is this build MORE of a creator than a build with its
	   labels usually is? A Heliocentric Guard (drb 18, pss 18, oiq 16) is; a
	   Sharpshooter is not; a Cutter / Finisher is markedly less of one than the
	   average wing. That is a separable fact, and it is one tools/rolefit.js
	   can now put real weight on because it no longer duplicates a column that
	   is already in the design.

	   Measured on the AUTHORED offsets, before normalization. That is a real
	   choice and not an oversight: the normalizer's job is to make a build
	   ovr-neutral, and the amount it has to move a build is a fact about the
	   ovr weights rather than about how much of a creator the build is — so
	   reading creation off the post-normalization vector would mix the author's
	   intent with the solver's arithmetic. tools/rolefit.js fits ROLE_FIT
	   against these same pre-normalization values, so the two agree by
	   construction; changing which side of normalization this is measured on
	   silently invalidates the fitted coefficients and needs a re-fit. */
	const CREATE_TAG_MEAN = {};
	let CREATE_GRAND_MEAN = 0;
	function recomputeCreationBaseline() {
		const sums = {};
		const counts = {};
		let total = 0;
		for (const a of ARCHETYPES) {
			const c = rawCreation(a);
			total += c;
			for (const t of a.t || []) {
				sums[t] = (sums[t] || 0) + c;
				counts[t] = (counts[t] || 0) + 1;
			}
		}
		CREATE_GRAND_MEAN = ARCHETYPES.length ? total / ARCHETYPES.length : 0;
		for (const k of Object.keys(CREATE_TAG_MEAN)) delete CREATE_TAG_MEAN[k];
		for (const t of Object.keys(sums)) CREATE_TAG_MEAN[t] = sums[t] / counts[t];
	}

	function creationDelta(arch) {
		const tags = (arch.t || []).filter((t) => Number.isFinite(CREATE_TAG_MEAN[t]));
		let predicted = CREATE_GRAND_MEAN;
		if (tags.length) {
			let acc = 0;
			for (const t of tags) acc += CREATE_TAG_MEAN[t];
			predicted = acc / tags.length;
		}
		return rawCreation(arch) - predicted;
	}

	const ROLE_FIT = {
		/* Re-fitted by tools/rolefit.js over 40 realistic classes against
		   the DECLARED intent (ROLE_INTENT above) rather than against zero.
		   The previous fit — asked to flatten every build's scoring to its
		   rating — had put scoring at 1.03 and defense at 0.99: the tags a
		   coach actually reads were doing nothing, because doing nothing was
		   what a zero target required. Fitted to the intent, scoring is 1.24
		   and defense and rebounding 0.86, which is the offensive ordering
		   the tags describe. compExp rises to 1.00: the composite
		   compensation now has to undo the whole of what the composite
		   over-reads, since the tags are no longer absorbing half of it. */
		createW: 0.08,
		compExp: 1.00,
		base: 0.93,
		/* What a coach hands each kind of player, over and above what his
		   shot-making says. Offensive roles (scoring) use more possessions;
		   defensive and rebounding roles defer on offense. */
		tags: {
			guard: 0.95, wing: 1.08, big: 1.18,
			scoring: 1.24, shooting: 0.97, playmaking: 0.94,
			defense: 0.86, athletic: 1.09, rebounding: 0.86, raw: 0.94,
		},
		/* Softly bounded rather than clamped, so a build can never land
		   exactly on a limit the way twelve of the old table's entries did.

		   Narrowed from 0.30-2.60: measured across all builds the realized
		   output spans about 0.79-1.16, because the ovr-normalizer and the
		   self-referential usage center already absorb most of the level and
		   this multiplier only carries what the composite cannot say. Bounds
		   twelve bands wide described a mechanism that was not operating, and
		   tools/rolefit.js --iterate (worst residual 1.29 points against a
		   2.00 band) confirms the near-unity output is the fit succeeding,
		   not failing. Not narrower than this: the order-independence and
		   monotonicity guarantees tested in tools/test.js scale like
		   band * exp(-(hi - lo) / band), and a still-tighter pair underflows
		   them at the extremes of the tested range. */
		lo: 0.45, hi: 2.00, band: 0.14,
	};

	/* DECLARED scoring intent, per tag, in points a game at equal overall.

	   The fit above used to be asked to bring EVERY build's mean scoring
	   residual against the class's own ovr fit to zero, and it did — worst
	   bias 0.00 against a 2.00 band — and the consequence, measured across
	   66 builds over 40 classes, was that a Score-First Point and a
	   Perimeter-Switch Five scored within a few points of each other at
	   equal rating, usage ran 22-28% across the whole table and minutes
	   28-33. The fit was inverting the offensive intent of the tags to hit a
	   flat target: a scorer's role multiplier came out at 0.83 and a
	   defensive big's at 1.15, because that is what zeroing the residual
	   required. Specialization that cannot be seen in the box score is a
	   label.

	   So the target is no longer zero. Each tag declares how many points a
	   build carrying it is MEANT to score above or below what its rating
	   alone would say — a scorer scores more at equal ovr, a stopper less —
	   and the fit (tools/rolefit.js) and the harness (tools/validate.js)
	   both measure the residual against that intent rather than against
	   nothing, so only the UNINTENDED part of a build's bias is fitted
	   away. The old "how much of a player's scoring is decided by his build"
	   check is still a check; it is now a check that the amount is the
	   amount declared here. Size tags carry no intent: a wing is not meant
	   to score more than a guard for being a wing. */
	const ROLE_INTENT = {
		scoring: 1.6, shooting: 0.4, playmaking: -0.2,
		defense: -1.2, rebounding: -0.9, athletic: 0.0, raw: -0.3, durability: 0.0,
		guard: 0.0, wing: 0.0, big: 0.0,
	};
	const ROLE_INTENT_CAP = 2.6;
	function roleIntent(arch) {
		let v = 0;
		for (const t of (arch && arch.t) || []) v += ROLE_INTENT[t] || 0;
		return clamp(v, -ROLE_INTENT_CAP, ROLE_INTENT_CAP);
	}
	/* The injury-history axis. `availability` already models who misses
	   games and when; nothing tied a build's RATING PROFILE to that draw,
	   so a brittle athletic freak and an iron man were hurt at the same
	   rate. A build may carry `inj`, a multiplier on the season's injury
	   roll, beside its offsets. */
	function injuryMultiplier(name) {
		const a = ARCHETYPES.filter((x) => x.name === name)[0];
		return a && Number.isFinite(a.inj) ? a.inj : 1;
	}
	function roleIntentOf(name) {
		const a = ARCHETYPES.filter((x) => x.name === name)[0];
		return a ? roleIntent(a) : 0;
	}

	/* The delta an archetype's offsets make to BBGM's usage composite. Read
	   off the NORMALIZED offsets, which is what actually reaches the ratings. */
	function usageCompositeDelta(arch) {
		let d = 0;
		for (const k of Object.keys(arch.o)) d += (ROLE_USAGE_W[k] || 0) * arch.o[k];
		return d / ROLE_USAGE_DENOM;
	}

	/* Softplus up from lo, mirrored down from hi. Monotone, and never exactly
	   equal to either bound.

	   The two halves are composed in one order, and softplus is not its own
	   inverse, so in principle `down(up(x))` and `up(down(x))` differ. In
	   practice they do not, and the size of "do not" is worth writing down
	   because the alternative is trusting it: over the whole of [lo - band,
	   hi + band] with this table's constants (lo 0.45, hi 2.00, band 0.14) the
	   two orders differ by at most a few 1e-6, still well below the smallest
	   gap between two builds' role usage. The reason is that the bounds are
	   ~11.1 bands apart: at x = lo the down-half contributes
	   band * log1p(exp(-11.1)) ≈ 2e-6, so there is no "double squeeze" of the
	   lower range — the lift the lower softplus applies at 0.45 survives the
	   upper half intact to within a few millionths. (The error scales like
	   band * exp(-(hi - lo) / band), which is why the bounds cannot be
	   narrowed much further — see the note on ROLE_FIT above.)

	   softBoundOrderError() below measures that gap and tools/test.js asserts
	   it stays under 1e-5, so this is a checked property rather than a
	   remembered one. The order is NOT changed to something symmetric: doing
	   so would move every build's role usage by ~1e-6, which is invisible in
	   the output and would still break the "same seed, same class" guarantee
	   for every shareable link already in the wild. */
	function softBound(x, lo, hi, band) {
		const up = (v, e) => {
			const z = (v - e) / band;
			return e + band * (z > 30 ? z : Math.log1p(Math.exp(z)));
		};
		const down = (v, e) => {
			const z = (e - v) / band;
			return e - band * (z > 30 ? z : Math.log1p(Math.exp(z)));
		};
		return down(up(x, lo), hi);
	}

	/* How far softBound's two composition orders disagree at x. Exported for
	   the regression test; nothing in the sim calls it. */
	function softBoundOrderError(x, lo, hi, band) {
		const up = (v, e) => {
			const z = (v - e) / band;
			return e + band * (z > 30 ? z : Math.log1p(Math.exp(z)));
		};
		const down = (v, e) => {
			const z = (e - v) / band;
			return e - band * (z > 30 ? z : Math.log1p(Math.exp(z)));
		};
		return Math.abs(down(up(x, lo), hi) - up(down(x, hi), lo));
	}

	function computeRoleUsage(arch) {
		const du = usageCompositeDelta(arch);
		let v = ROLE_FIT.base *
			Math.pow(ROLE_U0 / Math.max(0.05, ROLE_U0 + du), ROLE_FIT.compExp) *
			Math.exp(ROLE_FIT.createW * creationDelta(arch));
		for (const t of arch.t || []) {
			if (Number.isFinite(ROLE_FIT.tags[t])) v *= ROLE_FIT.tags[t];
		}
		return softBound(v, ROLE_FIT.lo, ROLE_FIT.hi, ROLE_FIT.band);
	}

	/* Computed once, exposed as an object so the editor and the tests can read
	   the whole table the way they always could. The creation baseline has to
	   be built first: creationDelta is measured against the table it is part
	   of. */
	const ROLE_USAGE = {};
	recomputeCreationBaseline();
	for (const a of ARCHETYPES) ROLE_USAGE[a.name] = computeRoleUsage(a);

	/* An unknown build is now an ERROR, not a silent 1.0.

	   Both builds that fell through the old table did so invisibly, and the
	   only reason anyone noticed is that one of them came out as the
	   highest-scoring archetype in the class. In a browser the sim must not
	   die on a name it does not recognize, so a fallback is still returned —
	   but under a test harness (BBGM_STRICT_ROLES, set by tools/test.js and
	   tools/validate.js) it throws, which is where a missing build should be
	   found. */
	const STRICT_ROLES = typeof process !== "undefined" && process.env &&
		process.env.BBGM_STRICT_ROLES === "1";
	function roleUsage(name) {
		const v = ROLE_USAGE[name];
		if (Number.isFinite(v)) return v;
		if (STRICT_ROLES) {
			throw new Error("roleUsage: unknown archetype " + JSON.stringify(name) +
				" — every build must be in ARCHETYPES");
		}
		return 1;
	}

	/* How much room to grow each build implies, in ovr→pot gap points. A Raw
	   Project should be a wider bet than a Floor General by construction; the
	   old model drew the gap from one distribution regardless of who the player
	   was, so potential said nothing about the build.

	   DERIVED, not tabulated. This used to be a second hand-authored table of
	   132 integers that had to be kept in sync with ARCHETYPES by a human
	   every time a build was added — the same maintenance burden ROLE_USAGE
	   carried before it became a formula. Fitted against that table, the gap
	   is legible: it is how much FINISHED SKILL the offset vector loads
	   (feel, conditioning, the jumper, the handle — a build that already has
	   them is already what he is going to be) plus a per-tag intent (a raw
	   build is a wide bet, a shooting build a narrow one). Athletic tools
	   (jmp, dnk, reb) turned out to carry no weight in the authored table at
	   all: upside was never "he can jump", it was "he cannot yet shoot". The
	   fit explains about two thirds of the table; where the rest was the
	   build's BIOGRAPHY rather than its vector (a fifth-year senior, a pro
	   veteran, a rehab case, a project) the build carries its own `pot` on
	   the ARCHETYPES entry, beside the offsets it belongs with, so a new
	   build gets a sane number without an entry anywhere else. */
	const POT_SKILL_W = {
		diq: -0.27, oiq: -0.17, endu: -0.15, spd: -0.12, stre: -0.10,
		fg: -0.10, ft: -0.07, pss: -0.07, tp: -0.06, drb: -0.05, ins: -0.04,
	};
	const POT_INTENT = {
		raw: 3, athletic: 0.6, defense: 0.8, shooting: -0.7, scoring: -0.5,
		rebounding: -0.5, playmaking: -0.2, durability: -0.2,
		guard: 0, wing: 0, big: 0,
	};
	const POT_BASE = 0.3;
	function computePotGap(arch) {
		if (!arch || arch.name === "Balanced") return 0;
		if (Number.isFinite(arch.pot)) return arch.pot;
		let v = POT_BASE;
		for (const k of Object.keys(POT_SKILL_W)) v += POT_SKILL_W[k] * ((arch.o && arch.o[k]) || 0);
		for (const t of arch.t || []) v += POT_INTENT[t] || 0;
		return Math.round(v);
	}
	const POT_BY_ARCHETYPE = {};
	for (const a of ARCHETYPES) POT_BY_ARCHETYPE[a.name] = computePotGap(a);

	/* What a basketball player of a given listed height typically weighs.

	   This was `5.05 * hgtInches - 178`, a straight line — and weight does not
	   scale linearly with height for the same reason nothing else does: a body
	   is three-dimensional and a height is one-dimensional. The line was fitted
	   through the middle of the distribution, so it was right in the middle and
	   wrong at both ends in the same direction. At 66 inches it predicted
	   155lb, about ten light; at 90 inches it predicted 276lb, when a 7'6"
	   player lists at 290-310. The frame term is clamped at ±4, which stopped
	   the error becoming absurd and did not stop it becoming systematic: every
	   very tall prospect read as heavy for his size and lost potential for it,
	   and every very short one read as light and gained.

	   A quadratic least-squared through listed heights and weights across the
	   range basketball actually occupies (5'6" to 7'6", nine anchors) fits every
	   one of them to within 1.1lb and stays sane a little outside it: 160lb at
	   5'4" and 311lb at 7'8". A power law fits about as well, and a quadratic
	   is two multiplies. */
	function typicalWeight(hgtInches) {
		const h = hgtInches;
		return 0.103535 * h * h - 10.779293 * h + 425.996970;
	}

	/* Potential gap for a finished build.

	   This used to be two terms — an archetype constant and an age slope — so
	   "potential" carried no information a scout would actually use. The four
	   added terms are the ones that do:

	     touch    Free-throw shooting is the classic leading indicator for
	              whether a young player's jumper arrives. A 58% free-throw
	              shooter who "just needs reps on his three" usually does not
	              get there; an 84% shooter with a broken three usually does.
	     frame    Room to add weight. A 6'10" 205lb teenager has years of
	              physical development in front of him; a 6'10" 265lb one is
	              already the player he is going to be.
	     ageClass Age relative to the class, not just absolute age. Being 18.4
	              in a class that averages 19.3 is a real edge and the flat
	              (19.5 - age) slope could not see it.
	     role     Applied later (see potFromRole): a productive low-usage
	              freshman on a stacked roster is the classic breakout, and a
	              22%-usage senior who needed every touch to get his numbers is
	              the classic non-breakout.

	   Returns a breakdown as well as a total so the editor can explain it. */
	function potFactors(archetypeName, age, ratings, physical, classAge) {
		/* Same contract as roleUsage: an unknown build is an ERROR under the
		   test harness and a quiet 0 in a browser. This was the half of the
		   "silent default for a name never seen" bug that stayed unfixed when
		   roleUsage got its strict check. */
		if (STRICT_ROLES && archetypeName !== undefined &&
			POT_BY_ARCHETYPE[archetypeName] === undefined) {
			throw new Error("potFactors: unknown archetype " +
				JSON.stringify(archetypeName) +
				" — every build must be in POT_BY_ARCHETYPE");
		}
		const arch = POT_BY_ARCHETYPE[archetypeName] || 0;
		// 19 is the modal draft age; every year younger is worth real upside.
		const ageAdj = Number.isFinite(age) ? clamp((19.0 - age) * 2.4, -7, 7) : 0;
		// Age relative to this class, which is what a draft board actually
		// compares. Only meaningful when the file varies age at all.
		const ageClass = Number.isFinite(age) && Number.isFinite(classAge)
			? clamp((classAge - age) * 1.6, -4, 4) : 0;
		// Touch: the ft rating against what a player of this size usually
		// carries. Worth more to a big (a stretch five is a different player).
		const bigness = ratings ? clamp((ratings.hgt - 30) / 55, 0, 1) : 0.45;
		const typicalFt = 55 - 10 * bigness;
		const touch = ratings && Number.isFinite(ratings.ft)
			? clamp((ratings.ft - typicalFt) * (0.055 + 0.045 * bigness), -4.5, 5.5) : 0;
		// Frame: listed weight against what this height usually carries. Light
		// for his size = room to fill out.
		let frame = 0;
		if (physical && Number.isFinite(physical.hgtInches) && Number.isFinite(physical.weight)) {
			frame = clamp((typicalWeight(physical.hgtInches) - physical.weight) * 0.075, -4, 4);
		}
		const total = arch + ageAdj + ageClass + touch + frame;
		return { arch, age: ageAdj, ageClass, touch, frame, role: 0, total };
	}

	/* Backwards-compatible total (kept because the tests and any external
	   caller use the two-argument form). */
	function potAdjust(archetypeName, age, ratings, physical, classAge) {
		return potFactors(archetypeName, age, ratings, physical, classAge).total;
	}

	/* The role term, which cannot be known until the season has been simulated:
	   production out of proportion to the touches he got is upside, and needing
	   a huge share of the offense to produce is not.

	   `usg` is his usage rate, `share` his share of team scoring, `year` his
	   class year. */
	/* `load` used to be measured against a single class-wide 0.245, which made
	   the term partly circular. A build's archetype decides how much of an
	   offense it is given, so a Rim Protector arrives at 18% usage BECAUSE HE
	   IS A RIM PROTECTOR — and was then paid a large positive `load` for it, on
	   the reasoning that efficient production on modest usage is a breakout
	   signal. It is, but only when the modest usage is a fact about his season
	   rather than a restatement of his build. The mechanism that deflated his
	   scoring was inflating his potential, out of the same number.

	   The reference is therefore passed in, and the engine measures it: the
	   mean usage of the players in THIS class who share his build (see
	   archetypeUsageReference in js/engine.js). "He used less than his build
	   usually does" is a fact about his season; "he used less than the class
	   average" was a fact about his build. A Rim Protector who used 18% is now
	   neutral; one who used 13% and produced anyway still gets the bonus.

	   Deriving the reference from ROLE_USAGE instead would not have worked and
	   is worth recording as a dead end: that table is a COMPENSATION applied on
	   top of BBGM's usage composite, not a statement of intent, so a Rim
	   Protector's entry is above 1 precisely because the composite reads him
	   too low. Reading it as "how much of the offense this build gets" inverts
	   half the table.

	   Falls back to the class-wide center when no reference is supplied, which
	   is the old behavior and what the two-argument callers still get. */
	const ROLE_USG_CENTER = 0.245;

	function potFromRole(stats, classYear, usageReference) {
		if (!stats) return 0;
		const usg = stats.usg;
		const perMinute = stats.mpg > 0 ? (stats.ppg + 1.2 * stats.rpg + 1.6 * stats.apg) / stats.mpg : 0;
		// Efficient production on modest usage, from a young player, is the
		// breakout signal. The same line from a senior is just a good senior.
		const youth = classYear === "Freshman" ? 1 : classYear === "Sophomore" ? 0.6
			: classYear === "Junior" ? 0.25 : 0;
		const efficiency = clamp((stats.ts - Cal.DRAFT_YEAR.ts.mean) * 26, -2.5, 3);
		const reference = Number.isFinite(usageReference)
			? clamp(usageReference, 0.16, 0.33) : ROLE_USG_CENTER;
		const load = clamp((reference - usg) * 26, -3, 3.5);
		const output = clamp((perMinute - 0.55) * 9, -2.5, 3);
		return clamp((load * 0.55 + output * 0.6 + efficiency * 0.5) * (0.45 + 0.75 * youth),
			-4.5, 6);
	}

	// How freely each rating may be shifted when solving for the target ovr.
	// Endurance is scarce for teenagers, so it moves less and never collapses.
	/* Endurance was scarce for teenagers and moved at 0.35, which combined with
	   nothing in the table ever reducing it to make the rating decorative:
	   nineteen builds boosted it, none cut it, and the solver barely moved it
	   either way. Builds that cut it exist now (Low-Motor Talent,
	   Injury-Prone Talent, Foul Magnet Guard), so the solver is allowed a
	   little more room — still the most constrained rating in the table,
	   because a teenager's conditioning genuinely does not span 0-100. */
	const SHIFT_SCALE = {
		hgt: 0, stre: 1, spd: 1, jmp: 1, endu: 0.5, ins: 1, dnk: 1, ft: 1,
		fg: 1, tp: 1, oiq: 1, diq: 1, drb: 1, pss: 1, reb: 1,
	};
	/* How far the solver's search runs, and therefore what `ovrRange` reports.

	   This was 90 — the width of the rating scale, which is the right number
	   only if every rating moves one-for-one with the shift. They do not.
	   Endurance moves at SHIFT_SCALE 0.5, and shiftScales() damps a build's
	   signature ratings by a further factor of 0.45 on the way down, so the
	   smallest effective scale in play is 0.225: at k = -90 such a rating has
	   moved 20 points and is nowhere near its floor.

	   So ovrRange.min was not a property of the PLAYER at all. It was the ovr
	   reached when the ratings that move fastest had bottomed out and the ones
	   that move slowest had barely started — a statement about where the search
	   stopped, wearing the name of a bound. Two builds differing only in
	   endurance reported the same floor because neither had reached one, and
	   the editor showed a limit that no amount of solving would actually have
	   been the limit.

	   Moving a rating from 99 to 0 at the slowest effective scale takes
	   99 / 0.225 = 440 of shift, so 500 saturates every rating at both ends
	   with headroom. What the range reports now is the genuine reach of the
	   shift model: for a mid-height base it is the whole scale, because every
	   target in it really is solvable, and where it is narrower — a 7-footer
	   cannot be solved below the ovr his fixed hgt rating already implies — the
	   narrowing is the player's, not the search's. That also removes a real
	   false negative: targets between the old bound and the true one were
	   reported unreachable and were not.

	   The bisection cost is unchanged. It is 52 halvings of whatever interval
	   it is given, and widening the interval by a factor of 5.6 costs under
	   three of them, so the solved shift is still exact to far below the
	   rounding threshold. */
	const SHIFT_RANGE = 500;

	/* BBGM's usage composite, which decides how much of an offense a player is
	   given: ins 1.5, dnk 1, fg 1, tp 1, spd 0.5, hgt 0.5, drb 0.5, oiq 0.5.
	   Normalized to a share so it can be used as a protection weight below. */
	const USAGE_W = (function () {
		const raw = { ins: 1.5, dnk: 1, fg: 1, tp: 1, spd: 0.5, hgt: 0.5, drb: 0.5, oiq: 0.5 };
		let total = 0;
		for (const k of Object.keys(raw)) total += raw[k];
		const out = {};
		for (const k of BB.RATING_KEYS) out[k] = (raw[k] || 0) / total;
		return out;
	})();

	// Linear ovr weight of each rating (from BBGM's ovr formula). Used to make
	// every archetype's offset vector ovr-neutral by construction: without
	// this, a build loading on diq (.159) forces the solver to gut everything
	// else, while one loading on ins (.0126) barely specializes at all — the
	// specialization slider would mean something different per archetype.
	const OVR_W = {
		hgt: 0.159, stre: 0.0777, spd: 0.123, jmp: 0.051, endu: 0.0632,
		ins: 0.0126, dnk: 0.0286, ft: 0.0202, fg: 0.01, tp: 0.0726,
		oiq: 0.133, diq: 0.159, drb: 0.059, pss: 0.062, reb: 0.01,
	};
	/* Make every archetype's offset vector ovr-neutral, WITHOUT quietly making
	   the defensive builds unplayable on offense.

	   The old normalizer subtracted a uniform u * SHIFT_SCALE from every
	   rating. A build loading on diq (ovr weight .159) and spd (.123) generates
	   a large positive ovr push, so u was large and negative for the defensive
	   archetypes — and the ratings that lost most were exactly the ones BBGM's
	   usage composite reads: ins (weight 1.5), dnk, fg, tp. The build came out
	   ovr-neutral by construction and offense-negative by side effect.
	   Measured: Switchable Big had the HIGHEST mean overall in the class (51.6)
	   and the 14th-highest scoring average (10.5 a game); Defensive Pest ran
	   9.4 points on 17.8% usage, which is not a rotation player. "The best
	   defensive big in the class" was a player nobody would draft.

	   So when the normalizer has to take ovr back OUT of a build, it protects
	   the usage inputs and takes the points out of everything else instead. A
	   build that has to be lifted is not losing its offense, so the other
	   direction is left alone. The
	   shift weights still have to reproduce the same total ovr push, so the
	   protection is renormalized rather than simply capped. */
	const USAGE_PROTECT = 0.75;
	const USAGE_PROTECT_MAX = Math.max(...Object.values(USAGE_W));
	/* How much of a build's own usage-composite loading cancels the
	   protection.

	   The protection above was written for one case and applied to two. It
	   fires whenever `push > 0` — whenever the normalizer has to take ovr back
	   OUT of a build — and it then spends that give-back away from the ratings
	   BBGM's usage composite reads. For a build that loaded on diq (ovr weight
	   .159) and spd (.123) that is exactly right: the ovr it has to hand back
	   would otherwise come out of its offense, and a stopper who cannot be
	   given the ball is not a stopper, he is unplayable.

	   But `push > 0` is not the same question as "is this a defensive build",
	   and 29 of the 85 builds it fires for are offensive ones. Combo Guard
	   (fg 14, tp 12, drb 12), Shot-Creating Wing (fg 16, drb 12, tp 8),
	   Score-First Point, Pull-Up Artist and Skilled Big all raise the usage
	   composite substantially with their own offsets, deliberately, and were
	   then handed a defensive build's compensation on top: the give-back was
	   steered away from the very ratings they had just spent their budget
	   raising, so they kept volume they had not paid for. Score-First Point
	   carries a composite delta of +0.072 — more than twice the reference below
	   — and was protected as hard as a Rim Protector.

	   (The audit that prompted this named Post Scorer, which turns out to be
	   the one case it is NOT: its raw ovr push is -1.62, so it takes the other
	   branch and has never been protected at all. The fault is real; it lives
	   one build over.)

	   So the protection is scaled by how much of the usage composite the build
	   loaded on itself. A build whose raw offsets push the composite up by
	   USAGE_SELF_REF or more gets none of it; one that pushes it down — a
	   stopper, a rim protector, a rebounder — gets all of it; in between it
	   tapers. USAGE_SELF_REF is the composite delta of a moderately
	   offense-loaded build, so "he paid for it himself" is measured on the same
	   scale as the compensation. */
	const USAGE_SELF_REF = 0.030;
	/* The offset vectors as authored, before normalization. Kept so the tests
	   can compare what the normalizer does now against what the old uniform
	   one did, and so the editor's tooltip can show a build's intent rather
	   than the solver's arithmetic. */
	const RAW_OFFSETS = {};
	for (const a of ARCHETYPES) RAW_OFFSETS[a.name] = Object.assign({}, a.o);
	(function normalizeArchetypes() {
		let shiftW = 0;
		for (const k of BB.RATING_KEYS) shiftW += OVR_W[k] * SHIFT_SCALE[k];
		for (const a of ARCHETYPES) {
			let push = 0;
			for (const k of Object.keys(a.o)) push += OVR_W[k] * a.o[k];
			if (Math.abs(push / shiftW) < 0.05) continue;
			/* A positive push means the normalizer has to take ovr back OUT of
			   the build, which is the case that guts the offense. Spend that
			   budget away from the usage composite — but only to the extent
			   the build did not load on the usage composite itself. See
			   USAGE_SELF_REF. */
			let du = 0;
			for (const k of Object.keys(a.o)) du += (ROLE_USAGE_W[k] || 0) * a.o[k];
			du /= ROLE_USAGE_DENOM;
			const strength = USAGE_PROTECT *
				clamp(1 - du / USAGE_SELF_REF, 0, 1);
			const scale = {};
			let w = 0;
			for (const k of BB.RATING_KEYS) {
				const protect = push > 0 ? 1 - strength * (USAGE_W[k] / USAGE_PROTECT_MAX) : 1;
				scale[k] = Math.max(0, SHIFT_SCALE[k] * clamp(protect, 0.1, 1));
				w += OVR_W[k] * scale[k];
			}
			const u = push / (w || shiftW);
			const o = {};
			for (const k of BB.RATING_KEYS) {
				if (k === "hgt") continue;
				const v = (a.o[k] || 0) - u * scale[k];
				if (Math.abs(v) >= 0.25) o[k] = Math.round(v * 4) / 4;
			}
			a.o = o;
		}
	})();

	/* How large a slice of the league each archetype is even eligible for.
	   Normalizing by the eligible set alone made an archetype's real frequency
	   rarity / (number of archetypes eligible at that height): guards see ~26
	   eligible builds and 7-footers ~14, so guard archetypes came out
	   systematically rarer at equal w, and a narrow band like Point Center
	   (hgt >= 60, w 0.35) appeared about once per thousand players — which is
	   not "occasional", it is never.

	   Dividing by each archetype's exposure makes w mean what it says: a target
	   share of the whole class, not a share of one height band. Computed once
	   from the height distribution BBGM actually generates. */
	const BALANCED = ARCHETYPES.filter((a) => a.name === "Balanced");

	const HGT_MEAN = 48;
	const HGT_SD = 17;
	(function computeExposure() {
		const grid = [];
		let total = 0;
		for (let h = 0; h <= 100; h++) {
			const z = (h - HGT_MEAN) / HGT_SD;
			const d = Math.exp(-0.5 * z * z);
			grid.push({ h, d });
			total += d;
		}
		for (const a of ARCHETYPES) {
			let e = 0;
			for (const g of grid) if (g.h >= a.min && g.h <= a.max) e += g.d;
			// Floor keeps a vanishing band from exploding into every class.
			a.exposure = Math.max(0.06, e / total);
		}
	})();

	/* Per-class flavor.

	   Every class used to come out with the same archetype mix, which is the
	   real reason rerolling did not feel like it produced a different draft:
	   34 distinct archetypes in a 70-man class is one of everything. A real
	   class is remembered as guard-heavy, or as the year the bigs were good.

	   A flavor is drawn once per run and multiplies the weight of every build
	   carrying the matching tags. cfg.classFlavor scales how far it bends. */
	const CLASS_FLAVORS = [
		{ name: "balanced", w: 1.4, label: "no strong flavor", m: {} },
		{ name: "guard-heavy", w: 1.3, label: "guard-heavy",
			m: { guard: 2.2, wing: 1.0, big: 0.45, playmaking: 1.4 } },
		{ name: "big-heavy", w: 1.0, label: "big-heavy",
			m: { big: 2.4, wing: 0.95, guard: 0.5, rebounding: 1.5 } },
		{ name: "wing-heavy", w: 1.1, label: "wing-heavy",
			m: { wing: 2.3, guard: 0.75, big: 0.7 } },
		{ name: "shooting-rich", w: 1.0, label: "full of shooters",
			m: { shooting: 2.6, scoring: 1.2, defense: 0.75, raw: 0.6 } },
		{ name: "defensive", w: 0.9, label: "defense-first",
			m: { defense: 2.6, shooting: 0.7, scoring: 0.65 } },
		{ name: "athletic", w: 0.9, label: "athletic and raw",
			m: { athletic: 2.5, raw: 2.2, shooting: 0.6, playmaking: 0.7 } },
		{ name: "skilled", w: 0.8, label: "skilled and cerebral",
			m: { playmaking: 2.5, shooting: 1.3, raw: 0.45, athletic: 0.7 } },
		{ name: "top-heavy scoring", w: 0.8, label: "score-first",
			m: { scoring: 2.4, defense: 0.7, playmaking: 0.85 } },
		/* Seven more, because nine flavors of which four barely differed is
		   not a reason to reroll. These carry `c` — a config bend applied to
		   the whole class, not only to its archetype mix — so a flavor can
		   move the things a class is actually remembered for: how old it is,
		   how many of it came through the portal, how good the top of it is.
		   The archetype tilt alone could never say "weak year". */
		{ name: "international", w: 0.7, label: "unusually international",
			m: { shooting: 1.5, playmaking: 1.4, athletic: 0.7, raw: 0.8 },
			c: { pDII: 0.02, wEuroLeague: 46, wNBL: 20 } },
		{ name: "one-and-done", w: 0.8, label: "one-and-done heavy",
			m: { athletic: 1.6, raw: 1.8, scoring: 1.2 },
			c: { freshmanShare: 68, transferShare: 18, potBias: 1.1 } },
		{ name: "portal", w: 0.8, label: "a transfer-portal year",
			m: { shooting: 1.3, scoring: 1.2, raw: 0.5 },
			c: { freshmanShare: 24, transferShare: 62, potBias: -0.8 } },
		{ name: "weak", w: 0.85, label: "a weak year",
			m: { raw: 1.3, athletic: 1.1, shooting: 0.9 },
			c: { classQuality: -1.4, eliteCount: 0, potSpread: 1.2 } },
		{ name: "top-heavy cliff", w: 0.7, label: "top-heavy, with a cliff",
			m: { scoring: 1.3, playmaking: 1.2 },
			c: { classDepth: -1.6, eliteCount: 5, classQuality: 0.6 } },
		{ name: "two-man", w: 0.8, label: "a two-man class",
			m: { scoring: 1.4, athletic: 1.2 },
			c: { classDepth: -2.2, eliteCount: 2, classQuality: 0.4 } },
		{ name: "veteran", w: 0.7, label: "old and finished",
			m: { shooting: 1.4, defense: 1.3, raw: 0.35, athletic: 0.7 },
			c: { freshmanShare: 18, potBias: -1.3, potSpread: 0.7 } },

		/* --- narrative flavors ----------------------------------------------

		   Every flavor above is compositional: it bends WHO IS IN the class.
		   None of them bends the SEASON, and a class is remembered for its
		   season at least as often as for its build mix — the year everyone got
		   hurt, the year three blue bloods went down, the year the mid-majors
		   won. Those are all things the engine already models (injuryRate,
		   program strength, upsetFactor); nothing could ask for them. */
		/* `durability` is the availability axis (Iron Man, Injury-Prone
		   Talent, Injury-Return Unknown). It was added to those builds so a
		   flavor could ask for them and then no flavor did — the tag had
		   three members and zero consumers, reproducing one level up the
		   exact fault it was created to fix. The year everybody got hurt is
		   the year those three stories get told. */
		{ name: "injury year", w: 0.9, label: "the year everybody got hurt",
			m: { raw: 1.2, athletic: 1.1, durability: 2.4 },
			c: { injuryRate: 2.0 } },
		{ name: "blue bloods down", w: 0.9, label: "the year the blue bloods fell over",
			m: {},
			c: { bluebloodDownYears: 3, upsetFactor: 1.35 } },
		{ name: "mid-major year", w: 0.9, label: "the year the mid-majors won",
			m: { shooting: 1.3, defense: 1.2, athletic: 0.85 },
			c: { midMajorLift: 7, upsetFactor: 1.55 } },
		{ name: "weak top deep middle", w: 0.9,
			label: "no top, but deep all the way down",
			m: { defense: 1.2, playmaking: 1.2, scoring: 0.85 },
			c: { classDepth: 2.2, eliteCount: 0, classQuality: -0.3, potSpread: 3 } },
		{ name: "realignment year", w: 0.85, label: "a realignment year",
			m: {},
			c: { realignmentRate: 1, transferShare: 52 } },

		/* --- spread / depth flavors -----------------------------------------
		   These bend potSpread and eliteCount directly, which shapes how the
		   talent is DISTRIBUTED rather than what kind it is.  A top-heavy class
		   concentrates ceiling in two or three names; a deep class spreads it
		   evenly; a volatile class widens the lottery on every prospect. */
		{ name: "top-heavy talent", w: 0.8,
			label: "top-heavy, loaded at the top",
			m: { scoring: 1.3, athletic: 1.2 },
			c: { eliteCount: 6, potSpread: 0.5, classDepth: -0.8 } },
		{ name: "deep talent", w: 0.8,
			label: "deep and even all the way through",
			m: { defense: 1.2, playmaking: 1.1 },
			c: { eliteCount: 0, potSpread: 2.5, classDepth: 1.8, classQuality: 0.2 } },
		{ name: "volatile", w: 0.7,
			label: "a volatile year — wide range of outcomes",
			m: { raw: 1.4, athletic: 1.2, shooting: 0.85 },
			c: { potSpread: 3.5 } },

		/* --- five that are not another shading of an existing one ------------

		   Twenty-four flavors sounds like variety and several of them were
		   each other with a different label. Measured on the tag multipliers
		   they apply: "guard-heavy" and "one-and-done" both lean athletic and
		   raw; "defensive" and "veteran" both lean defense and cut raw; "weak"
		   and "weak top deep middle" differ mainly in a depth constant. A
		   flavor whose archetype tilt is another flavor's is not a second
		   thing a class can be, it is the same class with two names, and it
		   makes the draw look richer than it is.

		   These five are chosen to be far from every existing entry in the tilt
		   they apply, and each carries a config bend that no other flavor
		   carries, so it changes something about the class that the archetype
		   mix alone could not say. */
		{ name: "euro-influenced", w: 0.75, label: "European in style",
			m: { shooting: 1.9, playmaking: 1.8, athletic: 0.5, raw: 0.5, defense: 1.1 },
			/* Not "international" with different numbers: that flavor changes
			   where the blank-college players END UP, which is a fact about the
			   roster. This one is about how the class PLAYS — feel, passing and
			   range over athleticism — and it lowers buildNoise, because the
			   thing that reads as a European development system is that the
			   players are less raw and more finished than their tools. */
			c: { buildNoise: 3, freshmanShare: 34, wEuroLeague: 34 } },
		{ name: "post-up renaissance", w: 0.7, label: "the year the bigs came back",
			/* The exact inverse of the small-ball class every other big-leaning
			   flavor is a version of: big-heavy raises `big` and `rebounding`
			   and leaves shooting alone, which in a table where most big builds
			   shoot is a class of stretch fives. This one cuts shooting hard,
			   which is what makes it a POST-UP year rather than a tall one. */
			m: { big: 2.2, scoring: 1.6, rebounding: 1.8, shooting: 0.35, guard: 0.6 },
			c: { pace: 63, efficiencyEnv: -0.5 } },
		{ name: "three-and-d only", w: 0.6, label: "3&D wings and rim protectors",
			/* Extreme specialization, which no existing flavor asks for: every
			   other one bends the mix and leaves the SHAPE of a build alone.
			   The archetype pool is cut to eight so the class really is made of
			   four or five things, and specialization is pushed up so each of
			   them is unmistakably itself. */
			m: { shooting: 2.2, defense: 2.2, playmaking: 0.4, scoring: 0.45, raw: 0.5 },
			c: { archetypePool: 8, specialization: 1.7, archetypeDiversity: 96 } },
		{ name: "feast or famine", w: 0.7, label: "brilliant or nothing",
			/* Bimodal: a class with no middle. classDepth -3 concentrates the
			   quality at the top and potSpread 8 widens every prospect's range,
			   so the board is a handful of names worth arguing about and a long
			   tail nobody can separate — which is a specific and recognisable
			   kind of bad year, and not the same thing as "a weak year". */
			m: { raw: 1.6, athletic: 1.4, scoring: 1.3, defense: 0.7 },
			c: { classDepth: -3, potSpread: 8, eliteCount: 3, buildNoise: 9 } },
		{ name: "coaching carousel", w: 0.75, label: "a coaching carousel year",
			/* The one thing that moves a college season that nothing else in
			   the table touches: who is coaching. Five blue bloods have a down
			   year and the portal is full, which is what a carousel year looks
			   like from the outside. */
			m: { raw: 1.2, defense: 0.85 },
			c: { bluebloodDownYears: 5, transferShare: 55, upsetFactor: 1.3 } },
	];

	/* The config bend a flavor applies to the whole class. Returned separately
	   from the archetype multipliers because the engine applies it once, before
	   anything is built, and because a user's own setting has to win: a flavor
	   nudges the DEFAULT, it does not overrule a slider the user moved. */
	function flavorConfig(flavor) {
		return (flavor && flavor.cfg) || null;
	}

	/* Draw one flavor for a class. Returns null when the flavor system is
	   turned off, which keeps the old behavior exactly. */
	/* The strength an explicitly named flavor is guaranteed. classFlavor: 0
	   used to disable the flavor system before the hint was even read, so a
	   user who NAMED a flavor in the dropdown got nothing, silently. Asking
	   for one implies wanting it to exist. */
	const ASKED_STRENGTH_FLOOR = 0.5;

	function pickFlavor(rng, cfg) {
		/* An asked-for flavor wins over the draw. A user who wants a
		   guard-heavy class could previously only set classFlavor to 2 and
		   reroll until one came up, which is a slot machine, not a setting —
		   and rerolling replaces the whole class, so the thing they were
		   keeping the seed for went with it. An unknown name falls through to
		   the draw rather than throwing: cfg comes from URLs and localStorage.
		   Checked BEFORE the strength gate: a named flavor at strength 0 is a
		   contradiction, resolved in favor of the thing the user named. */
		const hint = cfg && cfg.flavorHint ? String(cfg.flavorHint) : "";
		const asked = hint
			? CLASS_FLAVORS.filter((x) => x.name === hint)[0] : null;
		let strength = clamp(cfg && cfg.classFlavor !== undefined ? cfg.classFlavor : 1, 0, 3);
		if (asked && strength < ASKED_STRENGTH_FLOOR) strength = ASKED_STRENGTH_FLOOR;
		if (strength <= 0) return null;
		const f = asked || rng.weighted(CLASS_FLAVORS);
		if (f.name === "balanced") {
			return { name: f.name, label: f.label, mult: {}, cfg: null, strength,
				asked: !!asked };
		}
		const mult = {};
		for (const tag of Object.keys(f.m)) {
			// strength 1 = the table as written; 0 = no effect; 2 = doubled in
			// log space, so a 2.2x becomes ~4.8x.
			mult[tag] = Math.pow(f.m[tag], strength);
		}
		return { name: f.name, label: f.label, mult, cfg: f.c || null, strength,
			asked: !!asked };
	}

	function flavorMultiplier(arch, flavor) {
		if (!flavor || !flavor.mult) return 1;
		let m = 1;
		for (const tag of arch.t || []) {
			if (flavor.mult[tag] !== undefined) m *= flavor.mult[tag];
		}
		return m;
	}

	/* The builds THIS class is made of.

	   Measured over 24 rerolls of the same file, every class contained 34.6
	   distinct archetypes out of 60 (sd 2.66) — one of everything, every time,
	   which is the whole reason rerolling did not feel like it produced a
	   different draft. The class-flavor system was built to fix that and moved
	   the number by about three, because pickArchetype renormalizes the
	   specialist mass to sum to `diversity` within the eligible set: flavor
	   multiplies the weights and the normalization divides most of it straight
	   back out. Doubling every guard weight in a pool that is two-thirds guards
	   at that height changes almost nothing.

	   So the class draws a POOL of builds first and then draws its players from
	   the pool. Pool membership is discrete, so a flavor that favors guards
	   puts more guard builds in the pool and no renormalization can take that
	   back — and a 12-build class is "the year of the stretch bigs" rather than
	   one of everything.

	   Height coverage is not optional: a pool with no build a seven-footer is
	   eligible for would leave every big in the class Balanced. Each probe
	   height is topped up to MIN_PER_BAND options before the pool is returned,
	   which is also what stops the pool being all guards — guards are the
	   commonest builds and would otherwise crowd out the rest. */
	const POOL_PROBES = [8, 26, 40, 50, 58, 68, 82, 93];
	const MIN_PER_BAND = 2;
	/* The genuine-center builds (min >= CENTER_MIN) were added so a
	   seven-footer would have his own identity space, and measured over 40
	   classes they mostly did not reach it: Shot-Blocking Anchor and
	   Glass-Eating Center appeared once each in 2,800 players and Passing Hub
	   Five not at all. The coverage top-up above asked only that the 82 and
	   93 probes have SOME eligible build, and thirty bigs gated at 52-60
	   satisfy that — so a pool routinely carried no build a 7'2" center was
	   specifically for, and he drew from the same power-forward pool as a
	   6'8". A pool now has to carry at least CENTER_IN_POOL builds whose
	   floor is a center's height. */
	const CENTER_MIN = 72;
	const CENTER_IN_POOL = 3;

	function eligibleAt(list, hgt) {
		return list.filter((a) => hgt >= a.min && hgt <= a.max && a.name !== "Balanced");
	}

	/* Rarity compression.

	   The table's design target was a ~10x spread between the commonest build
	   and the rarest. Measured, the realized spread was far larger — the
	   rarest builds appeared roughly once every four or five classes, which is
	   not rarity but absence — because three multiplications compound: the
	   authored weight (0.45 to 3.6, an 8x range), the exposure divisor, and the
	   pool draw, which is sampling WITHOUT replacement and so amplifies any
	   weight difference into a much larger difference in how often a build
	   makes the pool at all.

	   Compressing the effective weight in log space is the one place that can
	   be corrected without flattening the authored intent: a Combo Guard stays
	   several times likelier than a Point Center, but "several" stops meaning
	   two hundred. The exponent is applied after the exposure divisor and after
	   the flavor, so a class flavor still bends the mix by as much as it ever
	   did — the flavor multiplier is the thing a user asked for, and it is
	   compressed by the same amount as everything else rather than singled
	   out. */
	const RARITY_COMPRESS = 0.42;
	function archetypeWeight(a, cfg, flavor) {
		const custom = (cfg && cfg.archetypeWeights) || null;
		const base = custom && Number.isFinite(custom[a.name])
			? custom[a.name]
			: (a.w === undefined ? 1 : a.w);
		const raw = (Math.max(0, base) * flavorMultiplier(a, flavor)) / a.exposure;
		return raw > 0 ? Math.pow(raw, RARITY_COMPRESS) : 0;
	}

	/* The same weight WITHOUT the exposure divisor, for pool membership.

	   Dividing by exposure is correct for per-player selection — it makes `w`
	   mean "target share of the whole class". It is wrong for pool membership,
	   because a pool slot is a fixed resource regardless of how many players
	   can use it. Measured over 4000 pool draws with the divisor applied to
	   both: the three center builds gated at hgt >= 76 each made ~25% of pools
	   (effective weight 3.75 against an authored 1.4) while Iron Man and
	   Injury-Prone Talent made ~6% (0.86 against 0.7) — a 4.4x inversion of
	   the authored ordering, spending 15% of the pool budget on builds two or
	   three prospects can use, taken from the builds the other 78% of the
	   class draws from. Height coverage is MIN_PER_BAND's job, and the probes
	   at 82 and 93 already guarantee it. */
	function poolWeight(a, cfg, flavor) {
		const custom = (cfg && cfg.archetypeWeights) || null;
		const base = custom && Number.isFinite(custom[a.name])
			? custom[a.name]
			: (a.w === undefined ? 1 : a.w);
		const raw = Math.max(0, base) * flavorMultiplier(a, flavor);
		return raw > 0 ? Math.pow(raw, RARITY_COMPRESS) : 0;
	}

	/* Draw the class's build pool. `size` is how many specialist builds the
	   class may contain before height coverage tops it up; 0 or a size at or
	   above the table turns the pool off entirely and restores the old
	   behavior exactly. */
	/* How much a build's weight is divided by for each of the last few pools
	   it appeared in, at cfg.poolMemory = 1. The most recent class counts
	   fullest and the memory fades over POOL_MEMORY_DEPTH classes, so a build
	   that has been absent for three is back to its authored weight.

	   Chosen against the measurement that prompted it: Combo Guard made the
	   pool in about 78% of classes. A build in the last pool has its weight cut
	   to a third at poolMemory 1, which drops that to roughly a coin flip and
	   still leaves it several times likelier than a Point Center. A HARD
	   exclusion was the obvious alternative and is worse: it inverts the
	   weights every second class, so the rarest builds would appear in fixed
	   alternation, which is a different kind of predictable. */
	const POOL_MEMORY_PENALTY = 3.0;
	const POOL_MEMORY_DEPTH = 3;

	function poolMemoryFactor(name, recent, strength) {
		if (!strength || !recent || !recent.length) return 1;
		const depth = Math.min(recent.length, POOL_MEMORY_DEPTH);
		let penalty = 0;
		let most = 0;
		for (let i = 0; i < depth; i++) {
			// Newest class first; each step back counts for less.
			const weight = (depth - i) / depth;
			most += weight;
			const names = recent[i];
			if (names && names.indexOf(name) !== -1) penalty += weight;
		}
		if (!penalty || most <= 0) return 1;
		/* Normalized by the largest penalty available at this depth, so the
		   exponent runs 0..1 and the intermediate cases stay distinguishable.
		   A `Math.min(1, penalty)` cap was the first version and flattened
		   exactly the distinction the memory is for: at depth 3 a build in all
		   three pools scores 2.0 and one in the newest alone scores 1.0, and
		   both were clipped to 1, so "in every class lately" and "in the last
		   one" were penalized identically. */
		return 1 / Math.pow(POOL_MEMORY_PENALTY, strength * (penalty / most));
	}

	function pickClassPool(rng, cfg, flavor) {
		const size = Math.round(clamp(
			cfg && cfg.archetypePool !== undefined ? cfg.archetypePool : 0, 0, 60));
		const specialists = ARCHETYPES.filter((a) => a.name !== "Balanced");
		if (!size || size >= specialists.length) return null;
		/* The exclusion memory. cfg.recentPools is [newestClassBuildNames, …],
		   supplied by the caller across rerolls; the engine never writes it. */
		const strength = clamp(
			cfg && cfg.poolMemory !== undefined ? cfg.poolMemory : 0, 0, 1);
		const recent = (cfg && Array.isArray(cfg.recentPools)) ? cfg.recentPools : null;
		// Raw authored weight for pool slots; the exposure-divided weight
		// stays where it belongs, in pickArchetype. See poolWeight.
		const wOf = (a) => poolWeight(a, cfg, flavor) *
			poolMemoryFactor(a.name, recent, strength);
		const remaining = specialists.slice();
		const pool = [];
		while (pool.length < size && remaining.length) {
			const pick = rng.weighted(remaining, wOf);
			pool.push(pick);
			remaining.splice(remaining.indexOf(pick), 1);
		}
		// The seven-footers' own builds. See CENTER_MIN.
		{
			const isCenter = (a) => a.min >= CENTER_MIN;
			let have = pool.filter(isCenter).length;
			while (have < CENTER_IN_POOL) {
				const options = remaining.filter(isCenter);
				if (!options.length) break;
				const pick = rng.weighted(options, wOf);
				pool.push(pick);
				remaining.splice(remaining.indexOf(pick), 1);
				have++;
			}
		}
		// Height coverage. A pool that leaves a band empty makes every player
		// in it Balanced, which is the opposite of the point.
		for (const h of POOL_PROBES) {
			let have = eligibleAt(pool, h).length;
			while (have < MIN_PER_BAND) {
				const options = eligibleAt(remaining, h);
				if (!options.length) break;
				const pick = rng.weighted(options, wOf);
				pool.push(pick);
				remaining.splice(remaining.indexOf(pick), 1);
				have++;
			}
		}
		return pool;
	}

	function pickArchetype(rng, hgtRating, cfg, flavor, pool, rank) {
		const source = pool && pool.length ? pool.concat(BALANCED) : ARCHETYPES;
		const eligible = source.filter(
			(a) => hgtRating >= a.min && hgtRating <= a.max,
		);
		if (!eligible.length) {
			return ARCHETYPES.filter((a) => a.name === "Balanced")[0];
		}
		let diversity = clamp(cfg.archetypeDiversity, 0, 100) / 100;
		/* The top of the board is the part of the class everyone looks at,
		   and the uniform Balanced share made the No. 1 pick the player MOST
		   likely to have no identity — measured, Balanced 20% of the time at
		   the top slot, twice any actual build. The Balanced mass shrinks for
		   the top ten (x0.25 at the very top, fading back to normal by pick
		   ~10); the slider's promise stays true for the class as a whole,
		   since ten players move at most about a point of the total share. */
		if (Number.isFinite(rank) && rank >= 0 && rank < 10) {
			diversity = 1 - (1 - diversity) * (0.25 + 0.075 * rank);
		}
		const wOf = (a) => archetypeWeight(a, cfg, flavor);
		/* Balanced keeps exactly (1 - diversity) of the probability mass however
		   many specialist builds are eligible; the rest is split by rarity
		   weight.

		   The +0.05 on Balanced and the +0.02 on the specialist mass did not
		   cancel: total weight came to 1.07, so at diversity 85 the label
		   promised 15% Balanced and the sim delivered 19.5-23%. Both fudge
		   terms are gone and the label is now true by construction. */
		const specialists = eligible.filter((a) => a.name !== "Balanced");
		const wSum = specialists.reduce((s, a) => s + wOf(a), 0) || 1;
		return rng.weighted(eligible, (a) =>
			a.name === "Balanced" ? 1 - diversity : (diversity * wOf(a)) / wSum,
		);
	}

	/* Per-rating shift scales for one build. A uniform shift preserves the gaps
	   between ratings but not the build's identity at the extremes: pushing a
	   low-ovr specialist down drives several ratings into the floor, after
	   which further shift moves only the others and quietly de-specializes him.
	   The same happens at the ceiling going up.

	   So the solver spends its budget where the archetype lives — raising the
	   signature ratings first when it must add, and cutting them last when it
	   must subtract. That also lets a genuine specialist clear BBGM's skill-
	   badge cutoffs: "V" (usage > .61), "A" (athleticism > .63) and "B"
	   (dribbling > .68) were previously unreachable for anything this tool
	   produced, so exported classes systematically lacked three of the nine
	   badges a native BBGM class has. */
	function shiftScales(arch, up, pinned) {
		const out = {};
		let maxOff = 0;
		for (const k of Object.keys(arch.o || {})) maxOff = Math.max(maxOff, Math.abs(arch.o[k]));
		for (const key of BB.RATING_KEYS) {
			// A rating the user has set by hand is exactly that: set. The
			// solver spends its budget on the others.
			if (pinned && Number.isFinite(pinned[key])) { out[key] = 0; continue; }
			const base = SHIFT_SCALE[key];
			const off = (arch.o && arch.o[key]) || 0;
			const sig = maxOff > 0 ? clamp(off / maxOff, -1, 1) : 0;
			// Going up: lean into the signature ratings. Going down: protect
			// them and take the points out of everything else.
			const f = up ? 1 + 0.75 * Math.max(0, sig) : 1 - 0.55 * Math.max(0, sig);
			out[key] = Math.max(0, base * f);
		}
		return out;
	}

	function applyShift(base, k, scales) {
		const sc = scales || SHIFT_SCALE;
		const out = {};
		for (const key of BB.RATING_KEYS) {
			out[key] = clamp(Math.round(base[key] + k * sc[key]), 0, 100);
		}
		return out;
	}

	// Solve for the uniform shift that makes BBGM's ovr equal targetOvr. The
	// shift preserves the gaps between ratings, so a specialist stays a
	// specialist; it just gets better or worse across the board.
	/* The ovr range a build can be solved to. hgt is never shifted (it is tied
	   to listed height), and every other rating clamps at 0/100, so a very tall
	   or very short base simply cannot reach every target. Callers — the lock
	   editor, the tests — need to know which asks are impossible rather than
	   silently getting the nearest thing.

	   IMPORTANT: pass the NOISE-FREE base. The range used to be computed on the
	   post-noise base, which made it a property of the roll rather than of the
	   player: the editor showed a solvable range that moved under the user on
	   every reroll while nothing about the prospect had changed, and a lock
	   that was reachable a moment ago stopped being so. It is a function of the
	   original ratings, the archetype, the specialization setting and the
	   pinned vector, all of which the user can see. */
	function ovrRange(base, arch, pinned) {
		const upScales = arch ? shiftScales(arch, true, pinned) : SHIFT_SCALE;
		const downScales = arch ? shiftScales(arch, false, pinned) : SHIFT_SCALE;
		return {
			min: BB.ovr(applyShift(base, -SHIFT_RANGE, downScales)),
			max: BB.ovr(applyShift(base, SHIFT_RANGE, upScales)),
		};
	}

	/* Re-solve a built player after one of his base ratings has been changed
	   outside the builder — a forced height, in practice. Returns the same
	   shape rebuild() does for the fields that move. */
	function resolveTo(base, targetOvr, archName, fuzz, pinned, cleanBase) {
		const arch = ARCHETYPES.filter((a) => a.name === archName)[0] ||
			ARCHETYPES[ARCHETYPES.length - 1];
		const solved = solveToOvr(base, targetOvr, arch, pinned);
		return {
			base,
			cleanBase: cleanBase || base,
			ratings: solved,
			ovr: BB.ovr(solved),
			pos: BB.pos(solved),
			skills: BB.skills(Object.assign({ fuzz }, solved)),
			ovrRange: ovrRange(cleanBase || base, arch, pinned),
		};
	}

	function solveToOvr(base, targetOvr, arch, pinned) {
		// Two scale vectors, one for each direction; both equal SHIFT_SCALE at
		// k = 0, so the shift stays continuous and monotone across the origin
		// and the bisection below is still valid.
		const upScales = arch ? shiftScales(arch, true, pinned) : SHIFT_SCALE;
		const downScales = arch ? shiftScales(arch, false, pinned) : SHIFT_SCALE;
		const shift = (k) => applyShift(base, k, k >= 0 ? upScales : downScales);
		let lo = -SHIFT_RANGE;
		let hi = SHIFT_RANGE;
		if (BB.ovr(shift(lo)) > targetOvr) return shift(lo);
		if (BB.ovr(shift(hi)) < targetOvr) return shift(hi);
		for (let i = 0; i < 52; i++) {
			const mid = (lo + hi) / 2;
			if (BB.ovr(shift(mid)) < targetOvr) lo = mid;
			else hi = mid;
		}
		const a = shift(lo);
		const b = shift(hi);
		return Math.abs(BB.ovr(a) - targetOvr) <= Math.abs(BB.ovr(b) - targetOvr) ? a : b;
	}

	// Target ovr/pot curve for the whole class ("curve" mode).
	function classCurve(rng, n, cfg) {
		const q = cfg.classQuality;
		const top = 43 + q * 2.6;
		const bottom = 18 + q * 2.0;
		const p = 1.55 * Math.exp(cfg.classDepth * 0.28); // >1 = deep, <1 = top heavy
		const out = [];
		for (let i = 0; i < n; i++) {
			const t = n === 1 ? 0 : i / (n - 1);
			let v = top - (top - bottom) * Math.pow(t, p);
			if (i < cfg.eliteCount) v += (cfg.eliteCount - i) * 2.2 + rng.uniform(0, 3);
			// Lottery cliff: steepen the drop across the top ~23% of the
			// class (14 picks of a 60-man class — the real lottery share).
			// A fixed `i <= 14` gave EVERY player in a 12-man class the
			// boost, which flattened exactly the cliff it exists to shape.
			const lotterySpan = Math.min(14, Math.max(3, Math.round(n * 0.23)));
			if (i < lotterySpan) {
				const lotteryBoost = ((lotterySpan - i) / lotterySpan) * 0.15;
				v *= (1 + lotteryBoost);
			}
			out.push(clamp(Math.round(v + rng.normal(0, 1.6)), 0, 100));
		}
		out.sort((a, b) => b - a);
		return out;
	}

	/* Rebuild one player's ratings.
	   orig: the ratings row from the league file
	   targetOvr / targetPot: what the rebuilt player must come out to */
	function rebuild(rng, orig, targetOvr, targetPot, cfg, forcedArchetype, flavor, pinned, pool, rank) {
		const forced = forcedArchetype
			? ARCHETYPES.filter((a) => a.name === forcedArchetype)[0]
			: null;
		const arch = forced || pickArchetype(rng, orig.hgt, cfg, flavor, pool, rank);
		const spec = clamp(cfg.specialization, 0, 3);
		const noise = Math.max(0, cfg.buildNoise);

		const base = {};
		/* The same vector without the per-rating jitter. Only `ovrRange` reads
		   it, and it reads it so that the range it reports is a fact about the
		   player rather than about this particular roll. */
		const cleanBase = {};
		for (const key of BB.RATING_KEYS) {
			// A hand-edited rating is taken literally and never shifted. There
			// was no way at all to say "leave everything else, just bump his tp
			// to 70"; the editor could only set ovr, pot, archetype and school.
			if (pinned && Number.isFinite(pinned[key])) {
				base[key] = clamp(Math.round(pinned[key]), 0, 100);
				cleanBase[key] = base[key];
				continue;
			}
			const lo = key === "hgt" ? orig[key] : 1;
			const hi = key === "hgt" ? orig[key] : 99;
			/* A negative offset is scaled by the room it has. Taking the
			   full offset off a rating that was already low and clamping
			   at 1 put about 1.5% of every class's ratings on the floor
			   exactly, concentrated in the ovr 20-39 band — a 25-overall
			   walk-on candidate with four 1s — and once a rating is on the
			   floor the solver can only de-specialize him. The cut still
			   points the same way; it just cannot go through the floor. */
			let off = arch.o[key] || 0;
			if (off < 0 && key !== "hgt") {
				const room = Math.max(0, orig[key] - lo);
				off *= room / (room + 0.5 * Math.abs(spec * off));
			}
			base[key] = clamp(orig[key] + spec * off + rng.normal(0, noise), lo, hi);
			cleanBase[key] = clamp(orig[key] + spec * off, lo, hi);
		}

		const range = ovrRange(cleanBase, arch, pinned);
		let solved = solveToOvr(base, targetOvr, arch, pinned);
		let finalOvr = BB.ovr(solved);
		/* The reported range describes the jitter-free build, so it has to be
		   a promise the solver keeps. Per-rating jitter can push a rating onto
		   its 1/99 clamp and cost the noisy vector a point of reach at the very
		   ends of the scale, which would leave the editor offering a lock it
		   then silently missed. In that rare case the jitter is dropped for
		   this player rather than the promise. */
		if (finalOvr !== targetOvr && targetOvr >= range.min && targetOvr <= range.max) {
			const retry = solveToOvr(cleanBase, targetOvr, arch, pinned);
			if (Math.abs(BB.ovr(retry) - targetOvr) < Math.abs(finalOvr - targetOvr)) {
				solved = retry;
				finalOvr = BB.ovr(retry);
			}
		}
		const pot = clamp(Math.max(targetPot, finalOvr + 1), finalOvr, 100);

		return {
			// The pre-solve base, so a later change to a rating (a size
			// surprise, say) can be re-solved to the same target rather than
			// leaving ovr disagreeing with the rating vector it came from.
			base,
			// The jitter-free vector, so a later re-solve (a forced height)
			// can report the same stable range this build did.
			cleanBase,
			archetype: arch.name,
			ratings: solved,
			ovr: finalOvr,
			pot: Math.round(pot),
			pos: BB.pos(solved),
			skills: BB.skills(Object.assign({ fuzz: orig.fuzz }, solved)),
			// What this player's height actually allows, so an impossible lock
			// can be reported instead of quietly ignored.
			ovrRange: range,
		};
	}

	global.RatingsBuilder = {
		ARCHETYPES, RAW_OFFSETS, OVR_W, SHIFT_SCALE, USAGE_W,
		rebuild, classCurve, pickArchetype, solveToOvr, shiftScales, ovrRange, resolveTo,
		potAdjust, potFactors, potFromRole, ROLE_USG_CENTER, POT_BY_ARCHETYPE, computePotGap,
		POT_SKILL_W, POT_INTENT, typicalWeight,
		ROLE_USAGE, roleUsage, computeRoleUsage, usageCompositeDelta, creationDelta,
		rawCreation, CREATE_TAG_MEAN,
		ROLE_FIT, softBound, softBoundOrderError,
		ROLE_INTENT, ROLE_INTENT_CAP, roleIntent, roleIntentOf, injuryMultiplier,
		CLASS_FLAVORS, pickFlavor, flavorMultiplier, flavorConfig, pickClassPool,
		poolMemoryFactor, POOL_MEMORY_DEPTH,
		archetypeWeight, poolWeight, RARITY_COMPRESS, CENTER_MIN, CENTER_IN_POOL,
	};
})(typeof window !== "undefined" ? window : self);
