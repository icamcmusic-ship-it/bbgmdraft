/* Season stat lines for every prospect, derived from BBGM composite ratings,
   the strength and *defensive shape* of the teams they face, and the teammates
   they share possessions with (better teammates => fewer shots, better
   efficiency, more assists).

   Rate targets (turnovers, free-throw rate, shot mix, shooting percentages)
   are calibrated against the 2009-2021 college dataset via js/calibration.js —
   specifically against the DRAFT_YEAR anchor there (a prospect's final,
   highest-usage college season), not the pooled all-seasons anchor. See the
   header of that file for why the pooled figure deflated every volume stat by
   roughly 9%.

   Possession accounting follows the standard identity

       Possessions = FGA - ORB + TOV + 0.44*FTA
   =>  FGA + 0.44*FTA + TOV = Possessions + ORB

   so the scoring *chances* a team gets exceed its possession count by its
   offensive rebounds. D-I ORB% runs ~29%, which puts the ratio near 1.15.
   Conflating the two (the pre-2026 model did) deflated every counting stat by
   about 14%. */
(function (global) {
	"use strict";

	const { clamp } = global.BBGMRng;

	/* The free-throw-trip coefficient of the possession identity above.

	   It was a bare 0.44 at five sites across three files. The offensive
	   rebound chain was de-literalized for exactly this reason — a constant
	   written twice is a constant that can drift — and the possession
	   coefficient was left behind, which is the same fault at a second site.
	   Unlike the rebound share this one is NOT read off the model: 0.44 is
	   part of the definition of a possession, not a measurement of one, so
	   every place that computes possessions or true shooting has to use the
	   same number or the two stop reconciling. Naming it is what makes that
	   checkable.

	   And naming it ONCE is what makes it true. This file named it and then
	   js/bbgmstats.js went on carrying seven bare 0.44s — the possession
	   denominator of vop, two PER terms, both halves of USG% and both
	   true-shooting denominators — which is the same fault at a second site
	   again. The single declaration now lives there, next to the stats row
	   those formulas fill in, and this is a reference to it. */
	/* Read from js/bbgmstats.js rather than declared here: that file is where
	   the stats row and every advanced statistic derived from it live, it uses
	   the coefficient at six sites of its own, and two declarations of one
	   definitional constant is the exact fault this naming exists to prevent.
	   It loads before this file in index.html and in the harness shim. */
	const FT_TRIP = global.BBGMStats.FT_TRIP;
	const BB = global.BBGM;
	const CAL = global.Calibration;

	/* A CEILING THAT BENDS.

	   A hard ceiling does not remove the players who would have gone past it,
	   it stacks them ON it: measured over 33,617 stat lines, 245 finished with
	   exactly 3.90 personal fouls, 639 sat to the decimal on the per-40
	   rebounding cap and 118 on the assist one — a wall being reported as a
	   distribution, which is the same failure the three-point ceiling was
	   softened for years ago (see tpLim below). Above the knee the curve bends
	   asymptotically toward the limit instead of arriving at it, so the top of
	   the sample is spread over the last few percent rather than pinned to one
	   number, and below the knee nothing moves at all. */
	function softCeil(x, lim, knee) {
		const t = lim * (knee === undefined ? 0.88 : knee);
		if (!(x > t) || !(lim > t)) return x;
		return t + (lim - t) * (1 - Math.exp(-(x - t) / (lim - t)));
	}

	/* SHOOTING VARIANCE IS A FUNCTION OF ATTEMPTS.

	   Every percentage in statLine used to be `deterministic mean +
	   rng.normal(0, k * noise)` with a CONSTANT k — 0.030 on three-point
	   percentage, 0.026 on twos, 0.035 at the line — and there was no binomial
	   resampling anywhere in the file. Measured over 25 seeds and 1,444
	   prospects, the observed spread of 3P% was flat at .050-.056 across the
	   whole volume range while the binomial expectation falls from .114 at
	   half an attempt a game to .030 at eight. Three separate failures come
	   out of that one constant:

	     - A player attempting 25 threes all season could only land in
	       [15%, 42%] (measured min/max over 196 such seasons, sd .052 against
	       a realistic ~.095). "41% from three on 1.2 attempts a game" — the
	       classic scouting trap, and the whole reason a scout is told to check
	       the attempt column — was not a line this model could generate.
	     - High-volume shooters were roughly 1.7x too noisy.
	     - At tp 70-95 the measured spread COLLAPSED to .016-.021, below
	       binomial, because tpLim/softCeil squeezed the mean. An elite shooter
	       could not have a cold year.

	   So the deterministic expression becomes the player's TRUE TALENT p — the
	   ceilings and clamps apply to p, where they belong, and never to the
	   realized percentage — and the makes are resampled as Binomial(N, p) over
	   the attempts he actually took. That is a beta-binomial rather than a
	   binomial, because true talent is not perfectly known either: a small
	   Gaussian on p carries shot quality and the season-to-season drift a
	   percentage has beyond counting noise, and it is what keeps a 300-attempt
	   shooter from being pinned to +/- 3 points of his rating.

	   Exact Bernoulli summation below the normal-approximation threshold
	   (n*p*q >= 9 is the standard rule) because that is exactly the regime
	   this fix exists for, and it is the regime where the normal is worst. */
	function rbinom(rng, n, p) {
		const N = Math.max(0, Math.round(n));
		if (N <= 0) return 0;
		const q = clamp(p, 0, 1);
		if (q <= 0) return 0;
		if (q >= 1) return N;
		const v = N * q * (1 - q);
		if (v >= 9) {
			// Continuity-corrected normal; the rounding IS the correction.
			return clamp(Math.round(rng.normal(N * q, Math.sqrt(v))), 0, N);
		}
		let k = 0;
		for (let i = 0; i < N; i++) if (rng.random() < q) k++;
		return k;
	}

	/* Tuning constants for the volume model. Exported so tools/validate.js and
	   any future calibration sweep can read the same numbers the sim uses. */
	const TUNING = {
		MPG_CAP: 37.5,      // D-I minutes leaders run 36-38, not a flat 35.5
		USG_CAP: 0.365,     // share of team possessions while on the floor
		/* A drafted player never vanishes from the offense. The draft-year 5th
		   percentile is USG 17.8, so this is where a prospect's usage settles,
		   not where it stops: `softUsg` approaches it from below rather than
		   clamping onto it. The hard clamp piled 3.7% of the whole class on
		   exactly 15.5% usage — a wall, which is the artifact the soft CEILING
		   was introduced to remove, left in place at the other end. */
		/* The floor is the PLAYER's, not the class's. A single shared constant
		   is a wall wherever it binds however softly it is approached: the
		   asymptote at USG_FLOOR * (1 - USG_FLOOR_BAND) = 13.65% collected
		   11.5% of a realistic class into one percentage point of usage, which
		   is the "everyone's stats feel the same" artifact seen from the
		   inside. A bound cannot be un-piled by moving it — raising the floor
		   to 0.190 pinned a quarter of the class on 17.1% instead — so the
		   floor is now a function of how good the player is, which spreads the
		   binding population across a range rather than onto a point, and the
		   raw distribution above it is widened (see ROLE_DRAW_SD) so that far
		   fewer players reach it at all. */
		USG_FLOOR: 0.178,
		/* Span of the floor across the talent range. Down from 0.075, and the
		   ceiling's talent term with it (CEIL_TALENT, 0.030 -> 0.018): these
		   two and USG_FLOOR_COMP are the same dial read off two different
		   inputs, and the talent half is the ovr ramp the whole usage model
		   has been trying not to be. What they were for — spreading the floor
		   so it is not a wall — the composite term now does, off a rating
		   rather than off a draft slot. */
		/* 0.050 -> 0.030 and CEIL_TALENT 0.018 -> 0.010, both for the reason
		   MINUTES_TILT_ABS came down: they are overall-rating channels into
		   college volume, and after the ceilings became operative (see
		   FILLER_CEIL_REF) the envelope is what actually decides realized
		   usage, so its talent slope now reaches the box score where before
		   the renormalize washed it out. The spread these two exist to create
		   is carried by USG_FLOOR_ROLE and CEIL_ROLE, which are independent of
		   overall rating by construction and are the reason the floor is not
		   one number to within a rounding error. */
		USG_FLOOR_TALENT: 0.030,
		USG_FLOOR_ROLE: 0.050,     // and across the college-role latent
		/* And across BBGM's OWN usage composite, which reached the envelope
		   almost not at all: the floor did not read it and the ceiling read it
		   at 0.20 against a composite whose class spread is 0.082, so a
		   standard deviation of shot-making moved a prospect's usage ceiling by
		   1.6 tenths of a point. Since the envelope is what realized usage
		   actually is — the raw share is squeezed into it and USG_EXP was
		   measured to be worth 0.002 of correlation between 1.85 and 2.60 —
		   that is the whole reason the composite BBGM's game sim picks its
		   shooters by barely showed up in a box score. */
		USG_FLOOR_COMP: 0.26,
		/* How far BELOW the reference that term may reach, against 0.16 above.
		   The floor is a floor: its job is to spread the bottom of a class,
		   not to build a second wall underneath it, and the players who reach
		   the bottom of this term are the ones already sitting on the other
		   two. Symmetric, it widened the class's realized usage spread to 0.056
		   against an empirical 0.046; clipped, the spread is back on the
		   0.053 it was before any of this and the correlation it was bought
		   for is unchanged. */
		USG_FLOOR_COMP_DOWN: 0.09,
		/* Both envelope terms are read against this, the usage composite a
		   realistically shaped class actually averages, rather than against
		   two different numbers. Being the class's own mean is what makes both
		   terms mean-zero, so their strengths can be tuned without moving the
		   class's usage LEVEL off the empirical anchor. */
		USG_COMP_REF: 0.384,
		USG_FLOOR_FILLER: 0.10,
		// How far below the floor the softened curve may reach, as a fraction
		// of it. The floor becomes an asymptote instead of a clamp.
		USG_FLOOR_BAND: 0.35,
		/* The lower bound on a player's PERSONAL ceiling was a hard
		   clamp(..., 0.195, USG_CAP), and a hard bound at the bottom of a
		   saturating curve is a wall: everyone whose computed ceiling fell
		   below it got exactly 0.195 and then saturated towards it, piling
		   12.5% of a class into [18.5, 20.0]. It is a softplus now, so the
		   ceiling approaches USG_CEIL_MIN asymptotically and no two players
		   share it. */
		USG_CEIL_MIN: 0.150,
		/* The intercept of the personal ceiling. 0.253 when the composite term
		   was centred on 0.42; re-centring it on USG_COMP_REF moved the term's
		   mean by 0.20 * (0.384 - 0.42), so the intercept absorbs that and the
		   mean ceiling is exactly where it was. */
		USG_CEIL_BASE: 0.2458,
		USG_CAP_BAND: 0.022,
		USG_CEIL_BAND: 0.038,
		/* Steepness of the usage composite -> volume curve. Came down from
		   2.35. Three multiplicative terms all scaled with overall rating —
		   this one, the talent term below, and prospectTalent's own slope —
		   which stacked into corr(ovr, PPG) = 0.72 on a realistically shaped
		   class. Real draft classes run 0.25-0.35: Zach Edey outscored every
		   lottery pick in his class and Bronny James averaged 4.8. College
		   production is not a ramp on NBA overall. */
		USG_EXP: 1.85,
		/* The talent half of the same stack, previously the inline exponent
		   1.6 on (0.35 + 1.3 * talent/100). */
		USG_TALENT_EXP: 1.20,
		/* Size tilt on raw usage: a draft class's guards carry more of the
		   offense than its centers, which BBGM's usage composite (ins 1.5,
		   hgt 0.5) gets backwards. Was an inline 1.05. */
		USG_SIZE_TILT: 1.30,
		/* COLLEGE ROLE, the variable that did not exist.

		   `classYear` appeared exactly once in this file, to set a reserve-year
		   probability, so experience had no effect on usage, minutes,
		   efficiency or turnovers — and the single most common profile of a
		   draft class's leading scorer, a 22-year-old senior at a mid-major
		   taking 30% of his team's shots, was a player the model could not
		   construct. A college role is not an NBA overall rating: it is what a
		   coach hands a player, and it depends on how long he has been in the
		   program, what kind of player he is (ROLE_USAGE), and a genuine
		   independent draw that no rating predicts. */
		EXP_USG: {
			Freshman: 0.90, Sophomore: 1.04, Junior: 1.12,
			Senior: 1.20, Graduate: 1.24,
		},
		/* The unpredictable half of the role. Log-normal, so the multiplier is
		   centered on 1 and right-skewed the way "how big a role did he get"
		   actually is. Together with ROLE_SKILL below it widens the raw usage
		   distribution enough that the bounds above stop binding for most of
		   the class, and it is what keeps college production from being a
		   function of NBA overall. */
		/* Down from 0.44, and the spread it gave up is handed to ROLE_SKILL
		   below rather than dropped. At 0.44 the pure draw was 35% of the
		   variance of raw usage on its own and the whole role latent was 55%
		   of it, against 31% for BBGM's usage composite and 1.8% for talent —
		   so realized usage correlated 0.90 with a number no rating predicts
		   and 0.25 with the composite BBGM's own game sim picks shooters by.
		   That is the "stat lines don't follow the ratings" complaint measured:
		   the single largest term in a stat line was a coin flip. */
		ROLE_DRAW_SD: 0.26,
		/* The half of the role a scout CAN see, and the reason cutting the
		   draw does not just flatten the class.

		   A coach's role decision is not a dice roll and it is not an NBA
		   overall rating either — it is who can handle and deliver the ball.
		   BBGM has two composites for exactly that (`dribbling` = drb + spd,
		   `passing` = 0.4*drb + pss + 0.5*oiq) and neither reached usage at
		   all. Both are read against what a player of his size, shot-making
		   and overall rating typically scores on them (ROLE_ONBALL below), so
		   this says "a ball-handler for what he is" — a point guard against a
		   shooting guard, a point forward against a rim runner — and not "a
		   guard", which USG_SIZE_TILT already says, nor "a good player", which
		   is the ramp this file exists to avoid.

		   The exponent is on a term whose spread is 0.119, so a standard
		   deviation of on-ball skill is worth about a 35% role. */
		ROLE_SKILL: 2.5,
		/* The reference the two composites are read against: what a player of
		   this SIZE, this SHOT-MAKING level and this OVERALL typically scores
		   on `dribbling + passW * passing`. It is a least-squares fit on a
		   realistically shaped class SUBJECT TO ONE CONSTRAINT, and the
		   constraint is the interesting part.

		   Take a player and add four points to every rating but height — which
		   is exactly the transformation the prior-season model applies in
		   reverse (resolveTo shifts a build to a lower target overall). The
		   left-hand side moves by 0.0160 a point, size by 0.0080, the usage
		   composite by 0.0092 and overall rating by 1.410. An unconstrained
		   fit does not reproduce that ratio, so the residual is not invariant
		   shift: a talent-referenced fit made every prior season come out
		   systematically LESS on-ball than the same build's draft year, and
		   its lowest-rated seasons scored half a point further below their
		   draft year than the harness allows. A freshman is not playing out of
		   position; he is just worse. So the coefficients are constrained to
		   satisfy that identity exactly and fitted for the best cross-sectional
		   de-trending among the references that do.

		   What the three terms buy, beyond the constraint:

		   Size, because USG_SIZE_TILT already says "a guard gets the ball" and
		   saying it twice would move the class's guard/big scoring balance as
		   a side effect of a role fix.

		   Shot-making (BBGM's `usage` composite), because that is what the
		   envelope above now reads — USG_FLOOR_COMP and CEIL_COMP — and a role
		   that tracked it too would be one rating counted twice.

		   Overall rating, because a term that still tracked it would put the
		   ovr ramp back: with a size-only reference the measured
		   corr(ovr, PPG) went from 0.36 to 0.63, against a real draft class's
		   0.25-0.35 and this repository's own band. It is `ovr` and not the
		   college-talent scalar for the same reason the constraint exists:
		   prospectTalent folds in POTENTIAL, and an earlier season of the same
		   player carries the same potential against a lower overall, so a
		   talent-referenced term reads a freshman as less on-ball than the
		   senior he becomes purely because the gap to his ceiling was wider.

		   What is left correlates -0.07 with overall rating: it is entirely
		   "what kind of player is he" and not at all "how good is he", which is
		   what a coach's role decision actually is. It makes a Floor General's
		   line read like a Floor General's without making the draft board
		   readable off the scoring column. */
		ROLE_ONBALL: {
			passW: 0.60,
			base: 0.29295, size: -0.43499, usage: 0.23307, ovr: 0.01229,
			/* The spread of the residual, used to keep this MEDIAN-1 term from
			   also moving the class's usage LEVEL: exp() of a mean-zero draw
			   has mean exp(k^2 s^2 / 2), and the level of a class is
			   FILLER_USAGE's job alone. */
			sd: 0.119,
			/* A cap, in units of that spread. A pathological build three
			   standard deviations out gets a large role, not an unbounded
			   one. */
			z: 3.0,
		},
		CEIL_COMP: 0.55,
		CEIL_TALENT: 0.010,
		CEIL_ROLE: 0.110,
		/* How much of the role latent reaches MINUTES. Minutes are far flatter
		   than usage — the gap between a 20-minute man and a 33-minute one is
		   not the gap between a 14% and a 30% usage — so the same latent is
		   damped hard on its way in. */
		MIN_ROLE_EXP: 0.45,
		/* Upperclassmen finish better and turn it over less: an extra year in
		   a college program is worth real efficiency, which is most of why
		   the senior-mid-major-scorer archetype exists at all. Per class-year
		   step, centered on a sophomore. */
		/* Class year -> efficiency. 0.0045 a year made the gradient invisible:
		   within ovr 15-30 measured TS% ran .550/.542/.545/.546 across years
		   0-3 and partial(year, TS% | ovr) came out -0.01, against
		   partial(year, USG | ovr) of +0.17. The "22-year-old senior mid-major
		   volume scorer" existed on volume and not at all on efficiency, which
		   is half of what that player IS. The real freshman-to-senior gap at
		   equal talent is 2-3 points of true shooting; 0.0045 over the
		   4.4-year span the clamp allows is 2.0 points BEFORE the usage
		   gradient (which runs the other way, seniors carrying more load)
		   eats it. 0.008 clears it. Centered on a sophomore, so the class mean
		   does not move off the empirical anchor. */
		EXP_EFF: 0.013,
		EXP_TOV: 0.030,
		/* Assists. At 4.1 the exponent produced a physically impossible floor:
		   a center's 10th-percentile line was 0.15 assists per game and the Rim
		   Protector archetype averaged 0.42, which is not what a man playing 25
		   minutes a night finishes a season with (the real floor for a
		   non-passing D-I big is 0.6-0.8). It also made the distribution
		   bimodal rather than smoothly right-skewed, and pushed the class's
		   best passer to 8.6 a game when a draft class's best passer is usually
		   6.5-7.5. AST_FLOOR is a floor on the passing composite used only for
		   sharing out the pool: everybody on a basketball court makes the
		   occasional dump-off, and a weight of zero is what produces impossible
		   lines. AST_PSS is how much of the share is read off the raw passing
		   rating rather than the composite, which is 0.4*drb + 1.0*pss +
		   0.5*oiq and therefore rewards every guard build for handling the
		   ball — which is why a Sharpshooter finished within 1.7 assists of a
		   dedicated Floor General. */
		/* Down from 3.0/0.30: the cubic starved every non-creator — 24% of
		   28+ MPG players finished under 1.5 APG, and a wing playing 31
		   minutes of D-I basketball does not finish with 0.8 assists. The
		   softer exponent plus a higher floor lifts the bottom without
		   moving the ceiling (the pool is fixed, so the best passer barely
		   notices). */
		AST_EXP: 2.4,
		/* 0.42 was raised to stop bigs finishing under half an assist a game,
		   and it worked by making every big identical: a college centre's
		   passing composite runs around 0.30, so the floor bound for the whole
		   of that end of the roster — prospect and returning player alike — and
		   a passing big and a non-passing big took the same share of the pool.
		   0.42^2.4 is 12.5% of a point guard's 0.65^2.4, so a seven-footer was
		   handed an eighth of a point guard's weight when the real figure for a
		   non-passer is nearer a twentieth.

		   With assignFillerSlots giving every rotation a real point guard to
		   lose assists to, the floor is no longer what stops a big printing
		   0.4 a game — the gradient is — so it comes down to where it is a
		   guard against absurdity rather than a shaper of the distribution. */
		AST_FLOOR: 0.30,
		/* Rebounds. At 1.25 a center out-rebounded a guard by 2.4x; the real
		   defensive-rebound-rate ratio between those two is 4-5x. 1.55 got
		   the big:guard RPG ratio to 1.9x against a real ~2.4x, so another
		   step to 1.9, offset by a softer REB_CAP below so the ceiling stops
		   binding exactly at the measured maximum. */
		REB_EXP: 1.9,
		REB_FLOOR: 0.33,
		/* Explicit height terms on the rebound share, on top of the composite.
		   See rebWeight: the composite treats one inch of height and one point
		   of the reb rating as the same thing, and they are not. Steeper on
		   the defensive glass, where reach decides, than on the offensive
		   glass, where effort does. */
		REB_HGT_ORB: 0.03,
		REB_HGT_DRB: 0.06,
		/* STRENGTH, WHICH REACHED NOTHING.

		   Partial correlations against 15 ratings x 14 stats controlling for
		   overall, 12 seeds: `stre` measured -0.03 on rebounds, -0.03 on
		   points, -0.15 on steals — it touched nothing a scout reads. BBGM
		   weights it 0.1 out of 5.2 in the `rebounding` composite and 0.3 out
		   of 2.8 at the rim, so a strong 6'9" bruiser rebounded and fouled
		   exactly like a weak one of the same height. The only explicit
		   strength in this file was IDENTITY_REB / IDENTITY_PF, which are
		   ARCHETYPE-level offsets — a fact about the build a player was given,
		   not about the rating he carries.

		   So it enters the rebound weight the way height already does (see
		   REB_HGT_DRB): a multiplicative factor centered so that the class's
		   own mean strength gives exactly 1 and only the deviation moves
		   anything, which keeps the team pool and every calibration anchor
		   where they were — rebounding is zero-sum inside a roster. Steeper on
		   the OFFENSIVE glass than the defensive one, which is the mirror of
		   the height exponents and for the same reason: reach wins a defensive
		   board, a body wins an offensive one. Centered at 0.45 because that
		   is the strength rating a draft class averages. */
		REB_STRE_ORB: 1.05,
		REB_STRE_DRB: 0.55,
		/* And the whistle. A physical player fouls more: the contact that
		   wins him the offensive board is the contact a referee calls when he
		   loses it. Same centering, so the team foul pool does not move. */
		PF_STRE: 0.40,
		/* DUNKING, WHICH DID NOT AFFECT FIELD-GOAL PERCENTAGE.

		   partial(dnk, fgp | ovr) measured -0.02 — zero, on the rating named
		   after the highest-percentage shot in basketball. BBGM weights `dnk`
		   0.3 out of 2.8 in shootingAtRim, so the composite carries a trace of
		   it and the 0.26 slope on that composite in insideEff turns the trace
		   into nothing. It gets its own term at the rim, alongside
		   shootingAtRim rather than instead of it: 0.10 over the rating's
		   range is five points of rim field-goal percentage between a 25-dunk
		   big and a 75-dunk one, which is about what the tracking data shows
		   and small enough not to disturb the height table it sits on. */
		DNK_RIM: 0.18,
		/* ENDURANCE, ON THE CEILING RATHER THAN ON THE SHARE.

		   allocateMinutes multiplied every player's minute WEIGHT by
		   (0.80 + 0.40 * endurance) under a comment reading "Endurance finally
		   does something". It did not: weights are renormalized to the team's
		   200 minutes and then flattened again by MINUTES_UNIFORM, so a term
		   applied to everyone's share largely cancels — measured effect on
		   MPG, +0.02.

		   A conditioning rating is not a claim about what share of the
		   rotation a coach gives a man. It is a claim about how long he can
		   stay on the floor, which is a CEILING, and a ceiling does not
		   renormalize away: the soft cap in allocateMinutes is solved for one
		   scale factor and a player whose personal cap is lower simply
		   saturates sooner and hands his minutes to somebody else. At 0.30 an
		   iron man's cap sits ~13% above a 20-endurance big's, which at a
		   35.5-minute team cap is about four and a half minutes a night. */
		MIN_ENDU_CAP: 0.42,
		AST_PSS: 0.45,
		STL_EXP: 2.1,
		/* 2.6 gave a big:guard BPG ratio of 4.1x against a real 8-10x, with
		   seven-footers medianing 1.1 a game. Team blocks were on target, so
		   the pool is fine and the share was too flat — steepen it.

		   3.5 steepened it too far in the other direction: the national leader
		   averaged 5.6 blocks a game against a real D-I leader's 3.6, 110
		   lines of 33,617 cleared 4.5, and 301 of them sat on the share cap
		   exactly. A power of 2.5 keeps the big:guard separation the comment
		   above exists for and stops one shot-blocker taking most of a team's
		   blocks on his own. But flattening the exponent flattens the
		   big:guard ratio with it — 2.5 measured 3.7 against a band floor of
		   4.5 — so the exponent stays where it was and the two CEILINGS do the
		   work instead: a soft share cap and an absolute per-40 one. The
		   leader now averages 4.1 against 5.6, nothing clears 4.5, and no line
		   sits on the cap. */
		BLK_EXP: 3.5,
		/* 1.2 handed fouls out almost proportionally to minutes: a quarter
		   of every class averaged over 4.0 PF/g and the max was 5.28, which
		   is not a high number but an impossible one (five is a foul-out).
		   At 2.0 the fouling composite actually separates the foul-prone
		   from the disciplined. */
		PF_EXP: 2.0,
		ORB_RATE: 0.29,     // D-I offensive rebound rate
		/* Missed free throws come off the rim too, so the rebounds available on
		   a possession exceed the missed field goals by a few percent. */
		ORB_FT: 1.07,
		/* Team personal fouls. The model computed this, and reconcileTeamTotals
		   then fitted assists, steals, blocks and rebounds to their pools and
		   left fouls alone — so team fouls were unconstrained and drifted to
		   15.2 against this very target, with no validate.js band to catch it.
		   Fouls are now fitted like everything else. */
		TEAM_PF: 16.6,
		/* Share of MADE field goals that are assisted, measured straight off the
		   league totals (13.5 assists on 25.9 made field goals in the modern
		   game, 12.6 on 24.1 in 2009-2021 — the same 0.52 in both eras). The
		   old 0.53 sat on top of a stale 0.465 field-goal percentage that no
		   longer matched what the sim shot, so the two errors part-canceled
		   and team assists came out 7% light anyway. Everything else the pool
		   needs — how much of a chance is a shot, how often it misses — now
		   comes from the era's own team averages via CAL.chanceShape(). */
		ASSISTED_SHARE: 0.52,
		// Documented per-player ceilings, now actually enforced (see capNoisy).
		AST_CAP: 0.62,
		/* Absolute per-40-minute ceilings, applied after the share caps. See
		   clipPer40: a share of a team pool cannot say "no college player
		   rebounds at this rate". 14.5 and 10.0 sit just above the real
		   draft-class maxima of 12-13 and 8-9 a game at 32-34 minutes. */
		REB_PER40_CAP: 14.5,
		AST_PER40_CAP: 10.0,
		/* And the same statement about blocks, which had only a share cap and
		   so could say "no college player blocks shots at this rate" only by
		   accident of how few his team blocked. 5.5 per 40 is just above the
		   real record season. */
		BLK_PER40_CAP: 5.5,
		/* Measured max share was 0.40 against a cap of 0.40 — binding
		   exactly. Softened so the steeper REB_EXP has headroom. */
		REB_CAP: 0.46,
		/* Walker Kessler took 4.6 of Auburn's 6.6 blocks — 70%. The old 0.50
		   cap forbade by construction the exact season the comment cited; 0.60
		   then became a wall 301 lines sat on. It is a SOFT ceiling now (see
		   softCeil), so a Kessler season can still bend past it while the
		   ordinary shot-blocker is nowhere near, and the absolute per-40
		   ceiling above is what actually forbids the impossible. 0.52 is as
		   low as it goes without flattening the big:guard ratio the exponent
		   exists to produce. */
		BLK_CAP: 0.52,
		STL_CAP: 0.42,
		/* 0.28 let one player take 28% of a team's 16.6 fouls — 4.65 a
		   game, past the number that ends a night. The real D-I leader in
		   fouls per game sits around 3.6-3.8. */
		PF_CAP: 0.20,
		/* Minutes are flatter than talent, but not as flat as they were: 32% of
		   minutes handed out uniformly made an NBA prospect the fourth option
		   on his own blue-blood roster, and 22% still had him fourth. At 22%,
		   high-major prospects averaged 29.2 MPG against the 30-33 a drafted
		   player actually plays, and the measured correlation between where a
		   prospect played and how much he scored (-0.50) was stronger than the
		   correlation between how good he was and how much he scored (+0.42).
		   Where you play should not predict your scoring better than how good
		   you are. */
		MINUTES_UNIFORM: 0.08,
		/* Rotation priority for a drafted player, as a slot floor that depends
		   on how good he is: a lottery talent starts anywhere, a late
		   second-rounder is at worst his team's fifth man. `SLOT_ANCHOR` is the
		   college-talent level that always starts and `SLOT_STEP` how much
		   talent one rotation slot is worth. */
		PROSPECT_SLOT_ANCHOR: 76,
		PROSPECT_SLOT_STEP: 7,
		PROSPECT_SLOT_MAX: 2,
		/* THE PROMOTION IS NOT UNCONDITIONAL.

		   PROSPECT_SLOT_MAX alone promoted every prospect to at worst slot
		   r + 2, so every drafted player was top-three in his own rotation
		   regardless of who was ahead of him — and with the old near-flat
		   ROTATION_SHAPE that made where he played worth 2.3 minutes and
		   nothing else. A coach plays the future pro over an ordinary
		   returning starter; he does not play him over a senior who is
		   genuinely better than he is right now. So the floor is capped by the
		   number of teammates who clear him by PROSPECT_SLOT_GAP points of
		   college talent: at a weak program that count is zero and the
		   promotion is exactly what it was, and at a blue blood with three
		   older, better players it puts the freshman behind them.

		   The gap is 3 rather than the 8 first tried, and the reason is worth
		   recording because it bounds what this mechanism can ever do: a
		   drafted prospect almost always out-talents his own teammates by
		   construction. Measured over one class, prospect college talent
		   averages 66.1 against a best returning teammate of 53.5 and a
		   rotation mean of 34.2, so at a gap of 8 only 10.3% of prospects had
		   ANYONE clearly ahead of them and the term did essentially nothing.
		   At 3 it bites on the freshmen at the bottom of a class playing for
		   the top of the country, which is exactly the population the missing
		   low-minutes tail is made of, and still never binds at a weak
		   program. A tie goes to the prospect, which is the premium
		   PROSPECT_PREMIUM already says he gets. */
		PROSPECT_SLOT_GAP: 3,
		/* How much the reserve-year probability responds to the depth a player
		   is buried under. The draw exists because "some of a class is
		   freshmen who came off the bench behind a senior" — which is a fact
		   about the bench he is behind, and RESERVE_RATE was flat across every
		   program in the country. Scaled by the mean talent of the teammates
		   AHEAD of him rather than by the program's level, so it responds to
		   depth and not to prestige: the location bias the minutes rework
		   exists to remove comes from program level, and this deliberately
		   does not read it. */
		RESERVE_DEPTH: 0.90,
		/* How far talent tilts a player off the canonical rotation shape.
		   Two terms, because they answer two different questions. The ABS term
		   is how good he is on the college-talent scale, which is what makes a
		   lottery pick out-minute a late second-rounder wherever either of them
		   plays. The REL term is how much better he is than his own teammates,
		   which is real (a coach rides the one man who can play) but is also
		   the entire channel by which a program's strength used to decide a
		   prospect's minutes, so it carries much the smaller weight. */
		/* A drafted player's rotation priority over a returning player in the
		   same slot. Coaches play the future pro. */
		PROSPECT_PREMIUM: 1.12,
		/* How often a drafted player spends his draft year as a reserve. */
		RESERVE_RATE: 0.17,
		/* 0.55 -> 0.34. This is the largest of the three multiplicative
		   channels through which overall rating reaches college scoring, and
		   together they had put corr(ovr, PPG) at 0.50 against this file's own
		   stated target of 0.25-0.35 (a real draft class runs 0.25-0.35
		   because a draft board ranks NBA projection and a box score measures
		   a college role, and the two agree only loosely). It is the honest
		   lever of the three: the other two (USG_EXP, USG_TALENT_EXP) are
		   inside the usage solve, where changing them moves the class's whole
		   volume level as a side effect, and talentEffAdj is a documented
		   empirical gradient rather than a tuning dial. Minutes are where a
		   ramp on overall rating is least defensible anyway — a coach's
		   rotation answers to what a player does in November, not to what an
		   NBA team will think of him in June. */
		MINUTES_TILT_ABS: 0.22,
		MINUTES_TILT_REL: 0.22,
		MINUTES_TILT_ANCHOR: 62,
		MINUTES_TILT_REF: 14,
		/* How much of the class's scoring gradient is allowed to come from
		   playing at a weak program rather than from being good. */
		STL_ATH: 0.60,
		/* The usage composite a synthesized returning teammate scores. See
		   simulateTeamStats for why this number decides the whole class's
		   scoring level. */
		FILLER_USAGE: 0.280,
		/* The usage composite a synthesized returning teammate actually
		   SCORES, which is not FILLER_USAGE: the filler synthesis draws
		   `f(FILLER_USAGE, 0.07)` and f() scales its base by
		   (0.55 + 0.9 * talent/100), so a returning player at talent ~45 lands
		   near 0.227 rather than 0.280. Measured at 0.2264 over 3,676
		   simulated rotations.

		   It exists because the PERSONAL USAGE CEILING read every player's
		   composite against USG_COMP_REF (0.384), the reference for a class of
		   DRAFT PROSPECTS. A returning player is 0.16 of composite below that
		   — the full width of the ceiling's own clamp — so every filler in the
		   country got the minimum ceiling the formula can produce, about 0.19,
		   and 7-9 of a 9.27-man rotation then made it arithmetically
		   impossible to allocate 100% of a team's chances inside the ceilings.
		   Measured before this: sum(ceiling * minute share) averaged 0.9845 and
		   sat below 1.0 on 67.5% of rosters, the post-solve renormalize fired
		   on 65.4% of team-seasons, and that blanket rescale then pushed two
		   thirds of all players past their own personal ceiling — which made
		   USG_CEIL_BASE, CEIL_COMP, CEIL_TALENT, CEIL_ROLE, USG_CAP and
		   USG_CAP_BAND inoperative on most rosters. A reference is a statement
		   about the population it is applied to; two populations, two
		   references, exactly as the turnover term already does with
		   TOV_COMP_FIELD. Change FILLER_USAGE and this moves with it. */
		FILLER_CEIL_REF: 0.2264,
		/* How much ceiling headroom a rotation must have beyond 100% of its
		   own chances before the bisection is asked to solve. The ceilings are
		   bounds on individuals and their sum is not a quantity anyone tuned,
		   so on a roster where it lands short the honest repair is to relax
		   the BOUNDS before solving rather than to solve wrongly and rescale
		   the answer afterwards. 2% of headroom is enough for the softened
		   curve — which approaches each ceiling asymptotically and never
		   reaches it — to still find an interior solution. */
		USG_CEIL_BUDGET: 1.02,
		/* How far this draft class's composites sit below the reference points
		   the efficiency and pool models were written against.

		   It USED TO be one fixed scalar (0.048), measured once as the average
		   composite gap between a synthetic N(45,13) fixture and a realistic
		   draft-slot-curve fixture. That broke in both directions: on a
		   synthetic class the correction inflated TS% three points above the
		   anchor because the gap was zero and the correction was not, and on a
		   realistic class it under-corrected the volume channels (usage,
		   passing, rebounding) where the gap is 0.06, not 0.05.

		   Now computed per-class in simulateTeamStats from the actual mean
		   usage composite of the prospects, scaled so that a class whose
		   composites already sit at the calibration reference gets ref = 0.

		   PROSPECT_COMP_BASE: the usage composite of the calibration reference
		   class (synthetic N(45,13), mean usage composite ~0.45).
		   PROSPECT_COMP_SCALE: amplification, because the ref feeds into
		   channels whose sensitivity differs from the raw composite gap.

		   WHERE THE TWO SCALARS COME FROM, since neither had a provenance and
		   no tool re-fits them. Both are RATIOS OF SENSITIVITIES, not measured
		   quantities, and that is what makes them derivable by hand rather
		   than by sweep:

		     PROSPECT_COMP_SCALE (1.32) is the volume side. classRefVolume is
		     added to the usage composite before USG_EXP (1.85) is applied, so
		     a composite gap g does not move usage by g — it moves it by
		     roughly USG_EXP * g / usage, and at the class mean usage composite
		     of ~0.39 that derivative is about 1.3x the raw gap. 1.32 is that
		     factor. Change USG_EXP or the class's mean usage composite and
		     this moves with them.

		     PROSPECT_COMP_SCALE_EFF (0.82) is the efficiency side, and it is
		     BELOW one for the mirror-image reason. classRefEfficiency is added
		     inside the shooting terms, whose slopes on a composite are 0.40
		     (three-point) and 0.26 (rim, mid, post) — so a composite gap
		     reaches true shooting at well under its own size, and the
		     correction has to be damped rather than amplified to land on the
		     same anchor. 0.82 is the minutes-weighted mean of those slopes
		     against the 0.40 the intercepts were fitted at.

		   Neither is fitted, so neither can drift out of agreement with a
		   measurement — but both are downstream of constants that do change,
		   which is why the derivation is written down here rather than the
		   two numbers alone. */
		PROSPECT_COMP_BASE: 0.428,
		/* Per-composite reference levels: the mean each composite scores on
		   the N(45, 13) calibration fixture the stat model's intercepts were
		   fitted against, measured rather than assumed. Used as a ratio
		   against the class's own mean to build classRefMult — see the long
		   comment in js/engine.js for why a share weight takes a multiplier
		   and a rate term takes an addition. */
		PROSPECT_COMP_BASES: {
			usage: 0.4395, rebounding: 0.4700, passing: 0.4535,
			stealing: 0.4613, drawingFouls: 0.4544, turnovers: 0.4393,
			shootingThreePointer: 0.4387,
		},
		PROSPECT_COMP_SCALE: 1.32,
		PROSPECT_COMP_SCALE_EFF: 0.82,
		/* Turnovers. Positive because BBGM's `turnovers` composite is a
		   PROPENSITY, not a skill — see tovRate in statLine. At a composite
		   spread of 0.167 for a class of prospects this is worth about 1.9
		   points of turnover rate per standard deviation, against an empirical
		   draft-year spread of 4.1. */
		/* 0.115 -> 0.20. "About 1.9 points of turnover rate per standard
		   deviation, against an empirical draft-year spread of 4.1" is the
		   comment above conceding that the term is swamped, and the measured
		   consequence was on the single most-cited rating in a scouting
		   report: partial(oiq, TOPG | ovr) came out -0.09, so a great feel for
		   the game bought essentially no ball security. BBGM's turnover
		   composite is the only channel oiq has into the turnover column, and
		   at 0.115 that channel carried less than half of the empirical
		   spread. 0.20 puts it at ~3.3 points per sd against the 4.1 — the
		   rest is genuinely unexplained by ratings, which is the right place
		   for it to be. The term is mean-zero over both populations it is
		   applied to (see the two references below), so the class's turnover
		   LEVEL does not move with it. */
		TOV_COMP: 0.20,
		/* The reference for the synthesized field, which sits well below the
		   class's own (PROSPECT_COMP_BASES.turnovers). Measured off the filler
		   composites in simulateTeamStats; change a filler base and this moves
		   with it. */
		TOV_COMP_FIELD: 0.380,
	};

	/* The shape of a college rotation's minutes, by slot. Measured off D-I
	   box scores: a starter plays 30-34, the sixth man low twenties, and the
	   ninth man single figures — and that shape barely moves between a blue
	   blood and a low major. It is renormalized to the team total below, so
	   only the ratios here matter. */
	/* The canonical rotation shape, declared once in js/teams.js (which loads
	   first) and read here. STEEPENED ACROSS THE TOP FOUR SLOTS when it moved
	   there — it was 1.00/0.95/0.89/0.83, four percent between a team's first
	   and second option, which combined with PROSPECT_SLOT_MAX to make the
	   rotation model unable to say "he came off the bench behind a senior".
	   Measured, a freshman at ovr 30-42 played 31.2 MPG on the worst quarter
	   of rosters and 28.9 on the best: a 2.3-minute effect, against a
	   draft-year 5th percentile of 19.5 that the sim reached only at 22.4. The
	   real gradient between a first and a fourth option is nearer fifteen
	   percent, and the tail below it is the point — "18 minutes, terrific
	   per-minute numbers" is a line a scout reads constantly and this model
	   could not print. Slots 4 and beyond barely moved; they were never the
	   problem. */
	const ROTATION_SHAPE = global.TeamsSim.ROTATION_SHAPE;

	/* The composite an average D-I rotation actually scores on each pool key,
	   blended the same way teamPools blends it (same key, same top-player
	   weight), so an average roster gets a scale() factor of exactly 1 and the
	   pool constant beside it means what it says.

	   RE-DERIVED, and not as an arithmetic mean. scale() raises the ratio to a
	   power and then clamps it, and for every exponent except stealing's 1.00
	   that map is not linear — so the composite that gives a factor of 1 ON
	   AVERAGE is the POWER mean at that exponent, not the average composite.
	   The gap is small where the exponent is near 1 and large where it is not:
	   at blocking's 2.30 the arithmetic mean is 0.497 and the power mean is
	   0.509, a 4% error in the block pool of every team in the country, all of
	   it in the same direction because the map is convex.

	   Measured over 5,446 simulated rotations (8 realistic classes, the
	   fixture tools/validate.js defaults to), by bisecting each base until the
	   mean of clamp((agg/base)^exp, lo, hi) came out to 1.000 under that
	   pool's own exponent and clamps:

	     rebounding  0.443 -> 0.429   (0.4291 at exp 0.55, 0.4280 at 0.35)
	     passing     0.435 -> 0.435   (0.4348 — the one that had not drifted)
	     stealing    0.462 -> 0.442
	     blocking    0.500 -> 0.509
	     fouling     0.412 -> 0.433

	   The audit that prompted this expected `blocking` to be stale LOW, on the
	   grounds that the filler synthesis bases blocking at 0.45 + slot offsets
	   of +/-0.18. It is not: teamPools reads blocking with a 0.70 top-player
	   weight, which by construction reads the biggest man in the rotation
	   rather than the rotation, and that is what puts the aggregate half a
	   composite point above the filler base. 0.500 was very nearly right for
	   the arithmetic mean; what was wrong was using an arithmetic mean at all.

	   Change a filler base, a slot shape or a top-player weight and every one
	   of these moves with it. */
	const POOL_BASE = {
		rebounding: 0.429, passing: 0.435, stealing: 0.442,
		blocking: 0.509, fouling: 0.433,
	};

	/* Per-league environment. Everything outside D-I used to run on cfg.pace —
	   the slider labeled "College season -> Pace" — so dragging it rewrote
	   EuroLeague box scores, and every league was scored over a 40-minute game
	   even though the G League plays 48, which made G League per-game numbers
	   ~17% low by construction.

	   pace is possessions per *game*, gameMinutes is the length of that game,
	   and youthCap is the minutes ceiling a 19-year-old actually gets: the
	   single most characteristic fact about a teenager at Real Madrid is that
	   he does not play 30 minutes. */
	const LEAGUE_ENV = {
		"EuroLeague":            { pace: 70, gameMinutes: 40, youthCap: 22, mpgCap: 32 },
		"NBA G League":          { pace: 103, gameMinutes: 48, youthCap: 30, mpgCap: 38 },
		"Liga ACB":              { pace: 72, gameMinutes: 40, youthCap: 20, mpgCap: 32 },
		"NBL":                   { pace: 76, gameMinutes: 40, youthCap: 24, mpgCap: 34 },
		"Chinese CBA":           { pace: 82, gameMinutes: 48, youthCap: 26, mpgCap: 38 },
		"LNB Pro A":             { pace: 74, gameMinutes: 40, youthCap: 24, mpgCap: 33 },
		"EuroCup":               { pace: 72, gameMinutes: 40, youthCap: 24, mpgCap: 33 },
		"Basketball Bundesliga": { pace: 76, gameMinutes: 40, youthCap: 24, mpgCap: 33 },
		"Adriatic League":       { pace: 74, gameMinutes: 40, youthCap: 26, mpgCap: 34 },
		"NBL1":                  { pace: 82, gameMinutes: 40, youthCap: 30, mpgCap: 36 },
		// Youth leagues: everybody is a teenager, so there is nothing to cap.
		"Overtime Elite":        { pace: 84, gameMinutes: 40, youthCap: null, mpgCap: 34 },
		"NBA Academy":           { pace: 76, gameMinutes: 40, youthCap: null, mpgCap: 34 },
		"DII NCAA":              { pace: null, gameMinutes: 40, youthCap: null, mpgCap: 37.5 },
		"Basketball Champions League": { pace: 73, gameMinutes: 40, youthCap: 24, mpgCap: 33 },
		"Turkish BSL":           { pace: 74, gameMinutes: 40, youthCap: 22, mpgCap: 32 },
		"Greek Basket League":   { pace: 71, gameMinutes: 40, youthCap: 22, mpgCap: 32 },
		"Israeli Premier League": { pace: 78, gameMinutes: 40, youthCap: 24, mpgCap: 33 },
		"Japan B.League":        { pace: 76, gameMinutes: 40, youthCap: 26, mpgCap: 34 },
		"Brazil NBB":            { pace: 78, gameMinutes: 40, youthCap: 26, mpgCap: 34 },
		"Basketball Africa League": { pace: 76, gameMinutes: 40, youthCap: 28, mpgCap: 34 },
		"CEBL":                  { pace: 84, gameMinutes: 40, youthCap: 30, mpgCap: 35 },
		// Youth and amateur levels: everybody is a teenager or an amateur, so
		// there is nothing to cap.
		"Prep / Postgrad":       { pace: 80, gameMinutes: 32, youthCap: null, mpgCap: 29 },
		"NAIA":                  { pace: 74, gameMinutes: 40, youthCap: null, mpgCap: 36 },
		"Italian LBA":           { pace: 72, gameMinutes: 40, youthCap: 22, mpgCap: 32 },
		"Lithuanian LKL":        { pace: 74, gameMinutes: 40, youthCap: 24, mpgCap: 33 },
		"VTB United League":     { pace: 72, gameMinutes: 40, youthCap: 22, mpgCap: 32 },
		"Polish PLK":            { pace: 76, gameMinutes: 40, youthCap: 26, mpgCap: 34 },
		"BNXT League":           { pace: 76, gameMinutes: 40, youthCap: 26, mpgCap: 34 },
		"Korean KBL":            { pace: 80, gameMinutes: 40, youthCap: 26, mpgCap: 34 },
		"Philippine PBA":        { pace: 88, gameMinutes: 48, youthCap: 28, mpgCap: 38 },
		"Argentine Liga Nacional": { pace: 78, gameMinutes: 40, youthCap: 26, mpgCap: 34 },
		"Mexican LNBP":          { pace: 80, gameMinutes: 40, youthCap: 28, mpgCap: 35 },
		"Puerto Rico BSN":       { pace: 82, gameMinutes: 40, youthCap: 28, mpgCap: 35 },
		"New Zealand NBL":       { pace: 84, gameMinutes: 40, youthCap: 30, mpgCap: 36 },
		"JUCO":                  { pace: 80, gameMinutes: 40, youthCap: null, mpgCap: 36 },
		"DIII NCAA":             { pace: 74, gameMinutes: 40, youthCap: null, mpgCap: 36 },
	};
	// Everything else (D-I, and any league without an entry) takes cfg.pace and
	// a 40-minute game.
	const NCAA_ENV = { pace: null, gameMinutes: 40, youthCap: null, mpgCap: TUNING.MPG_CAP };

	function leagueEnv(name) {
		return LEAGUE_ENV[name] || NCAA_ENV;
	}

	/* Class year as a number, 0 = freshman. The string carries decorations —
	   "Redshirt Junior", "Graduate" — so it cannot be looked up directly, and
	   a redshirt year IS an extra year in the program even though it is not
	   an extra year of eligibility used. */
	const CLASS_YEAR_INDEX = {
		Freshman: 0, Sophomore: 1, Junior: 2, Senior: 3, Graduate: 4,
	};
	function classYearIndex(classYear) {
		const s = String(classYear || "Sophomore");
		for (const k of Object.keys(CLASS_YEAR_INDEX)) {
			if (s.indexOf(k) !== -1) {
				// A redshirt has been in the building a year longer than his
				// eligibility says.
				return CLASS_YEAR_INDEX[k] + (s.indexOf("Redshirt") === 0 ? 0.6 : 0);
			}
		}
		return 1;
	}
	function experienceUsage(classYear) {
		const s = String(classYear || "Sophomore");
		for (const k of Object.keys(TUNING.EXP_USG)) {
			if (s.indexOf(k) !== -1) return TUNING.EXP_USG[k];
		}
		return 1;
	}

	/* The college role a coach hands a player, as a multiplier on raw usage.

	   Deliberately NOT a function of overall rating: ovr already enters raw
	   usage twice (through the composite and through the talent term) and
	   through prospectTalent a third time, and that triple count is what made
	   college scoring a near-deterministic ramp on NBA overall. What decides a
	   college role instead is how long he has been here, what kind of player
	   he is, and a large amount of nothing anyone can predict. */
	function collegeRole(m, comps, cfg, rng) {
		if (m.filler) return 1;
		const p = m.player;
		const RB = global.RatingsBuilder;
		const arch = RB && p ? RB.roleUsage(p.archetype) : 1;
		/* The half of the role that IS a rating. See ROLE_SKILL: BBGM's own
		   ball-handling and passing composites, read against what a player of
		   this size, this shot-making level and this overall rating scores on
		   them — so the term carries no size tilt and no ovr ramp of its
		   own. */
		const R = TUNING.ROLE_ONBALL;
		let skill = 1;
		if (comps) {
			const big = clamp((comps.blocking - 0.18) / 0.55, 0, 1);
			const onBall = clamp(
				comps.dribbling + R.passW * comps.passing -
					(R.base + R.size * big + R.usage * comps.usage +
						R.ovr * (p && Number.isFinite(p.newOvr) ? p.newOvr : 35)),
				-R.z * R.sd, R.z * R.sd,
			);
			/* Median 1 AND mean 1: the lognormal correction keeps a term that
			   is mean-zero in the exponent from raising the class's usage
			   level as a side effect of widening it. */
			skill = Math.exp(TUNING.ROLE_SKILL * onBall -
				0.5 * TUNING.ROLE_SKILL * TUNING.ROLE_SKILL * R.sd * R.sd);
		}
		/* The independent draw. Scaled by the stat-noise slider, but floored:
		   a college role is a latent fact about a player and his program,
		   not a rounding error, so "deterministic from ratings" still leaves
		   room for two identical prospects to be used differently. */
		const noise = clamp(Number.isFinite(cfg.statNoise) ? cfg.statNoise : 1, 0, 3);
		const sd = TUNING.ROLE_DRAW_SD * Math.max(noise > 0 ? 0.4 : 0, noise);
		/* Median 1, not mean 1: the draw is a role, and roles are
		   right-skewed. The level it implies for the class as a whole is set
		   by FILLER_USAGE, which is the only place a class's scoring level can
		   come from at all (usage renormalizes to 1 inside a roster). */
		return experienceUsage(p && p.classYear) * arch * skill *
			Math.exp(rng.normal(0, sd));
	}

	function shareFromWeights(vals, exp) {
		const p = vals.map((v) => Math.pow(Math.max(0.001, v), exp));
		const s = p.reduce((a, b) => a + b, 0);
		return p.map((v) => v / s);
	}

	/* Allocate minutes across a rotation by talent, then clamp to something a
	   real rotation looks like and renormalize back to the team's minutes. */
	function allocateMinutes(members, rng, comps, env, roleMult) {
		const e = env || NCAA_ENV;
		const gameMinutes = e.gameMinutes || 40;
		const teamMinutes = 5 * gameMinutes;
		const capTeam = Math.min(e.mpgCap || TUNING.MPG_CAP, gameMinutes - 2);
		// Endurance finally does something. A 90-endurance iron man and a
		// 30-endurance big used to draw identical minutes; the rating moved ovr
		// and nothing else. Ball-handling size gets a small nudge too: guards
		// are harder to sub than bigs, which is why college guards out-minute
		// college bigs at equal quality.
		const stamina = members.map((m, i) => {
			const c = comps && comps[i];
			const endu = c ? c.endurance : (m.endurance === undefined ? 0.5 : m.endurance);
			const bigness = c ? clamp((c.blocking - 0.18) / 0.55, 0, 1) : 0.45;
			return (0.80 + 0.40 * clamp(endu, 0, 1)) * (1 + 0.10 * (0.45 - bigness));
		});
		/* Minutes come off a canonical rotation SHAPE, not off raw talent ratios.

		   The old model shared minutes out as `talent^1.6 / sum`, which makes a
		   rotation's minute spread a function of its talent DISPERSION rather
		   than of anybody's quality. At a level-23 program the best player was
		   talent 76 against teammates at 19 and 17 — a 4x ratio, so 9x the
		   weight, so 37.5 minutes on the cap. At a level-89 program the same
		   rotation ran 82/79/69, a 1.2x ratio, so its best player drew 27.5.
		   Measured, that made where a prospect played predict his minutes
		   (-0.78) two and a half times better than how good he was (+0.29), and
		   28% of late second-rounders finished under 10 points a game.

		   A coach does not do that. He plays his best man about 33 minutes
		   whether the rest of the roster is good or bad; the SHAPE of a rotation
		   is close to fixed and talent decides who occupies which slot. So the
		   weight is the canonical shape at a player's slot, tilted by how far
		   his talent sits from his own rotation's mean — a bounded tilt, so a
		   flat roster and a top-heavy one still differ, but not by 10 minutes. */
		const val = members.map((m, i) => m.talent * stamina[i] * (1 + rng.normal(0, 0.05)));
		const order = members.map((m, i) => i).sort((a, b) => val[b] - val[a]);
		/* Rotation priority, which is not a talent bonus.

		   A coach's rotation is not a pure talent ranking: a future NBA player
		   plays, because he is the reason the season is interesting and because
		   he is leaving in April. A program that landed a draft pick did not
		   already have three better players. So the r-th best prospect on a
		   roster is promoted to no worse than slot r + PROSPECT_SLOT, which at a
		   weak program is never binding (he already leads the team) and at a
		   blue blood stops him being the fifth option on his own team. His
		   talent is untouched: usage, team rating and the ovr solver see exactly
		   what they saw before. */
		/* ...but only past the teammates he is not clearly behind. See
		   PROSPECT_SLOT_GAP: the floor may not lift him above the men who beat
		   him by a clear margin of college talent, which is zero people at a
		   weak program (nothing changes) and two or three at a loaded one. */
		let seen = 0;
		for (let r = 0; r < order.length; r++) {
			if (members[order[r]].filler) continue;
			const me = members[order[r]];
			let clearlyBetter = 0;
			for (const o of members) {
				if (o !== me && o.talent > me.talent + TUNING.PROSPECT_SLOT_GAP) clearlyBetter++;
			}
			const target = Math.max(
				seen + clamp(Math.round(
					(TUNING.PROSPECT_SLOT_ANCHOR - me.talent) /
						TUNING.PROSPECT_SLOT_STEP), 0, TUNING.PROSPECT_SLOT_MAX),
				Math.min(clearlyBetter, r));
			seen++;
			if (r <= target) continue;
			const idx = order.splice(r, 1)[0];
			order.splice(Math.min(target, order.length), 0, idx);
		}
		const slotOf = new Array(members.length);
		order.forEach((idx, slot) => { slotOf[idx] = slot; });
		let meanTalent = 0;
		for (const m of members) meanTalent += m.talent;
		meanTalent /= members.length || 1;
		const shapeAt = global.TeamsSim.rotationWeightAt;
		/* The tilt is applied to the DRAFT PROSPECTS only; a returning player
		   sits on the shape his slot gives him.

		   This is the difference between a minutes model and a talent-ratio
		   model. If the tilt were applied to everybody, a filler's weight would
		   track his program's level (his talent is drawn from it), so a
		   prospect's share — his weight over the roster's total — would fall as
		   his program got stronger, for no reason but arithmetic. That is the
		   whole of the residual -0.52 correlation between where a man played
		   and how long he played. There is also nothing to say with a
		   synthetic teammate: the roster shape already carries everything the
		   model knows about him. */
		/* The RELATIVE tilt applies to everybody: a coach rides the one man on
		   his roster who can play, and that is as true of a low major's senior
		   as of a lottery pick. Without it every team's best player drew the
		   same 32 minutes, which flattened the field a draft class is judged
		   against and handed the prospects a third more national awards than
		   they should win.

		   The ABSOLUTE tilt and the prospect premium apply only to the draft
		   prospects. A returning player's talent is drawn FROM his program's
		   level, so tilting him on it would make every rotation at a strong
		   program flatter than every rotation at a weak one for no reason but
		   arithmetic — which is the whole of the location bias this rework
		   exists to remove. */
		const relTilt = (talent) => 1 +
			TUNING.MINUTES_TILT_REL * clamp((talent - meanTalent) / 12, -1.5, 1.5);
		const absTilt = (m) => (m.filler ? 0 : TUNING.PROSPECT_PREMIUM - 1 +
			TUNING.MINUTES_TILT_ABS *
				clamp((m.talent - TUNING.MINUTES_TILT_ANCHOR) / TUNING.MINUTES_TILT_REF, -1.5, 1.5));
		/* The reserve year. Talent and slot alone give every drafted player a
		   starter's minutes, and real draft classes do not look like that: the
		   draft-year 5th percentile is about 19 minutes a game, because some of
		   a class is freshmen who came off the bench behind a senior, players
		   who lost half a season to a knee, and eighteen-year-olds a coach
		   brought along slowly. None of that is predictable from a rating, so
		   it is drawn — independently of where he plays, so it widens the
		   distribution without putting the location bias back. Freshmen draw it
		   most often; a senior who is still a reserve has usually transferred. */
		/* Fit, which the biography generated and then did nothing with.

		   A transfer, a redshirt and a reclassification moved the note text and
		   the award eligibility and nothing else — `transferShare: 34` changed
		   a sentence. But arriving somewhere new in June is a real fact about a
		   season: a transfer who fits gets the ball immediately and one who does
		   not spends November working it out. A returning player has no such
		   question, which is the whole difference between the two. */
		const fitOf = (m) => {
			const p = m.player;
			if (!p) return 1;
			let f = 1;
			if (p.transfer) {
				// Two-sided and wide: the point of a transfer is that it can go
				// either way, and a mid-major jump is a bigger bet than a
				// lateral move.
				const bet = p.transfer.kind === "mid-major jump" ||
					p.transfer.kind === "low-major jump" ||
					p.transfer.kind === "JUCO transfer" ? 0.16 : 0.10;
				f *= Math.exp(rng.normal(0, bet));
			}
			// A year of practice and no games: he knows the system, and he has
			// not played in one.
			if (p.redshirt) f *= 1 + rng.normal(0.03, 0.06);
			// Playing a year young against older players is hard.
			if (p.reclassified && p.reclassified.indexOf("up") !== -1) f *= 0.94;
			return clamp(f, 0.5, 1.6);
		};
		const roleOf = (m) => {
			if (m.filler) return 1;
			const year = m.player && m.player.classYear;
			/* How deep the bench in front of him is. Counted as the talent
			   surplus of the teammates who clear him, normalized so an
			   ordinary roster (nobody clearly ahead) gives exactly 1 and a
			   loaded one raises the reserve-year probability by about half
			   again. Deliberately a function of the teammates AHEAD of him
			   rather than of the program's level — see RESERVE_DEPTH. */
			let ahead = 0;
			for (const o of members) {
				if (o !== m) ahead += Math.max(0, o.talent - m.talent - TUNING.PROSPECT_SLOT_GAP);
			}
			const depth = 1 + TUNING.RESERVE_DEPTH * clamp(ahead / 25, 0, 1.4);
			const rate = TUNING.RESERVE_RATE * depth *
				(year === "Freshman" ? 1.6 : year === "Sophomore" ? 1.0
					: year === "Junior" ? 0.6 : 0.45);
			const fit = fitOf(m);
			if (rng.random() < rate) return rng.uniform(0.34, 0.68) * fit;
			return Math.exp(rng.normal(0, 0.11)) * fit;
		};
		/* The college-role latent reaches minutes too, flattened by
		   MIN_ROLE_EXP. A coach who hands a player the ball also plays him, and
		   the man who came back for a fifth year to be the guy is on the floor
		   for it — but minutes are a much flatter quantity than usage, so the
		   same latent enters at well under its full strength. Without this the
		   role variable moved usage only, and usage alone could not break
		   college scoring loose from NBA overall. */
		const roleMin = (i) => (roleMult && Number.isFinite(roleMult[i])
			? Math.pow(Math.max(0.05, roleMult[i]), TUNING.MIN_ROLE_EXP) : 1);
		const talentShares = shareFromWeights(members.map((m, i) => shapeAt(slotOf[i]) *
			stamina[i] * roleOf(m) * roleMin(i) *
			Math.max(0.05, relTilt(m.talent) + absTilt(m))), 1);
		// Real rotations are flatter than raw talent: fouls, matchups, blowouts
		// and coaching spread minutes around. But not as flat as they were.
		const uniform = 1 / members.length;
		const u = TUNING.MINUTES_UNIFORM;
		const shares = talentShares.map((s) => (1 - u) * s + u * uniform);
		let mins = shares.map((s) => teamMinutes * s);
		// Clamp-and-renormalize, ending on a renormalize so team minutes always
		// sum to the team total.
		// Adaptive floor: a normal 9-10 man rotation bottoms out at 6 MPG, but
		// an oversized group (many prospects on one school) must still fit.
		const lo = Math.min(6, (teamMinutes / members.length) * 0.6);
		/* THE CAP IS THE PLAYER'S, NOT THE LEAGUE'S. See MIN_ENDU_CAP: the
		   stamina term above multiplies a SHARE, and a share is renormalized
		   twice below (once by MINUTES_UNIFORM, once by the scale factor the
		   bisection solves for), so it measured +0.02 on MPG. A conditioning
		   rating belongs on the ceiling, where nothing renormalizes it away.
		   Centered at endurance 0.5 so the team's mean cap is unchanged and
		   only the spread is new. */
		const capOf = members.map((m, i) => {
			const c = comps && comps[i];
			const endu = c ? c.endurance : (m.endurance === undefined ? 0.5 : m.endurance);
			return Math.max(lo + 2,
				Math.min(gameMinutes - 2,
					capTeam * (1 + TUNING.MIN_ENDU_CAP * (clamp(endu, 0, 1) - 0.5))));
		});
		// Soft ceiling. A hard clamp piled a third of all prospects on exactly
		// the cap — eight straight rows of "35.5 MPG" is a wall, not a
		// distribution. Saturate smoothly instead, and find the one scale
		// factor that makes the softened minutes sum to exactly the team total.
		const soft = (m, i) => {
			const room = capOf[i] - lo;
			return m <= lo ? lo : lo + room * (1 - Math.exp(-(m - lo) / room));
		};
		const totalAt = (k) => mins.reduce((a, m, i) => a + soft(m * k, i), 0);
		let klo = 0.05;
		let khi = 40;
		for (let i = 0; i < 60; i++) {
			const mid = (klo + khi) / 2;
			if (totalAt(mid) < teamMinutes) klo = mid;
			else khi = mid;
		}
		return mins.map((m, i) => soft(m * ((klo + khi) / 2), i));
	}

	/* A team's defensive shape, from the rotation that actually plays it.

	   BBGM gives defenseInterior and defensePerimeter composites and the stat
	   model used neither: team defensive quality had exactly one channel into
	   an opponent's box score, a flat efficiency shave off oppStrength, so a
	   front line of rim protectors did not actually reduce anyone's rim FG%.
	   This is the profile that does it. Values are centered at ~0 for an average
	   D-I rotation and read in points of percentage. */
	/* Each weight is mins[i] / teamMinutes, so the weights sum to 1 and every
	   value below is the minutes-weighted average of the rotation. An earlier
	   version multiplied every weight by an on-floor count and divided every
	   sum by the same count — arithmetic that canceled exactly, with a
	   comment claiming it "derived the divisor". It derived nothing, and the
	   next person to edit one half without the other would have introduced a
	   real error. */
	function defenseProfile(comps, mins, teamMinutes, gameMinutes) {
		const gm = gameMinutes || 40;
		const tm = teamMinutes || 5 * gm;
		let rim = 0;
		let per = 0;
		let ovr = 0;
		let force = 0;
		for (let i = 0; i < comps.length; i++) {
			const w = mins[i] / tm;
			rim += comps[i].defenseInterior * w;
			per += comps[i].defensePerimeter * w;
			ovr += comps[i].defense * w;
			force += comps[i].stealing * w;
		}
		return {
			rim: rim - 0.46,
			perimeter: per - 0.46,
			overall: ovr - 0.47,
			force: force - 0.49,
		};
	}

	/* The same profile, computed cheaply from a roster before any stat line
	   exists, so the engine can work out what each team's OPPONENTS looked like
	   defensively and feed that back in. Fillers are approximated from talent
	   the same way simulateTeamStats does. */
	/* The top-eight weighted walk both roster previews do.

	   rosterDefenseProfile and rosterShooting were the same loop twice — same
	   sort, same slice, same `[1, 0.96, 0.9, ...] || 0.2` literal (a THIRD
	   copy of the canonical rotation shape, and one that never moved when the
	   shape did), same filler-versus-prospect branch — differing only in what
	   they accumulated. `visit` is called once per man with his minute weight
	   and either his real composites or the talent-scaled stand-in a returning
	   player gets, and returns the summed weight so the caller can normalize.
	   One place to change the shape, one place to change how a filler is
	   approximated, one place for the two to disagree instead of four. */
	function walkRotation(team, visit) {
		const sorted = team.members.slice().sort((a, b) => b.talent - a.talent).slice(0, 8);
		let w = 0;
		for (let i = 0; i < sorted.length; i++) {
			const m = sorted[i];
			const weight = global.TeamsSim.rotationWeightAt(i);
			// A returning player has no rating vector; his composites are the
			// same talent-scaled approximation simulateTeamStats synthesizes.
			const r = m.filler ? m.talent / 100 : 0;
			const flat = (base) => clamp(base * (0.55 + 0.9 * r), 0.05, 0.95);
			visit(m, weight, m.filler ? null : BB.composites(m.player.newRatings), flat);
			w += weight;
		}
		return w;
	}

	function rosterDefenseProfile(team) {
		let rim = 0;
		let per = 0;
		let ovr = 0;
		let force = 0;
		const w = walkRotation(team, (m, weight, c, flat) => {
			rim += (c ? c.defenseInterior : flat(0.46)) * weight;
			per += (c ? c.defensePerimeter : flat(0.46)) * weight;
			ovr += (c ? c.defense : flat(0.48)) * weight;
			force += (c ? c.stealing : flat(0.48)) * weight;
		});
		if (!w) return { rim: 0, perimeter: 0, overall: 0, force: 0 };
		/* `force` was hardcoded to 0 here while defenseProfile computed a real
		   value, so opponent ball-pressure reached the model only through the
		   style constant (ctx.oppPress) and never through the rosters actually
		   faced. Same 0.49 centering as defenseProfile. */
		return {
			rim: rim / w - 0.46,
			perimeter: per / w - 0.46,
			overall: ovr / w - 0.47,
			force: force / w - 0.49,
		};
	}

	/* How a returning player's composites differ by roster slot.

	   One row per composite the size of a player actually decides. Every row
	   sums to zero over the three slots — see the comment at the call site for
	   why that is not a nicety — and the magnitudes are the gaps a real
	   rotation shows: a college point guard's passing composite runs around
	   0.60 against a centre's 0.30, and the rebounding gap is the mirror of
	   it. Wings carry the small residual that makes the three sum to zero
	   rather than sitting exactly at the old flat value, because a wing is not
	   the average of a guard and a centre on every axis. */
	const SLOT_SHAPE = {
		guard: {
			passing: +0.15, rebounding: -0.10, blocking: -0.17, stealing: +0.07,
			three: +0.06, rim: -0.05, post: -0.09, mid: +0.03,
			drawingFouls: -0.03, defInt: -0.10, defPer: +0.08,
			athleticism: +0.05, fouling: +0.04, turnovers: -0.02,
		},
		wing: {
			passing: 0.00, rebounding: 0.00, blocking: -0.01, stealing: +0.01,
			three: +0.03, rim: 0.00, post: 0.00, mid: +0.02,
			drawingFouls: 0.00, defInt: 0.00, defPer: +0.02,
			athleticism: +0.02, fouling: +0.01, turnovers: +0.01,
		},
		big: {
			passing: -0.15, rebounding: +0.10, blocking: +0.18, stealing: -0.08,
			three: -0.09, rim: +0.05, post: +0.09, mid: -0.05,
			drawingFouls: +0.03, defInt: +0.10, defPer: -0.10,
			athleticism: -0.07, fouling: -0.05, turnovers: +0.01,
		},
	};

	/* The weights that share out a team's assist and steal pools. They live
	   here rather than inline because statLine and the denominator loop in
	   simulateTeamStats have to agree on them exactly, and did not have to
	   before: every extra factor added to one had to be remembered in the
	   other. */
	function passSkill(comps, ratings) {
		// The prospect reference shift is applied by astWeight, which knows
		// whether this is a prospect or a synthesized teammate; this returns
		// the raw skill.
		const raw = ratings && Number.isFinite(ratings.pss) ? ratings.pss / 100 : comps.passing;
		return clamp((1 - TUNING.AST_PSS) * comps.passing + TUNING.AST_PSS * raw, 0.02, 1);
	}
	/* `ref` is the composite reference shift (see statLine): the assist and
	   rebound POOLS are team-level and correctly calibrated, so what a prospect
	   gets out of them is decided entirely by his weight against his
	   teammates'. Those weights are raw composites, and a realistically shaped
	   draft class scores about 0.05 below the level these exponents were fitted
	   at — so a future NBA guard took a SMALLER share of his team's assists
	   than the returning walk-on beside him, purely because the reference never
	   moved with the fixture. Median assists came out 1.6 a game against a real
	   2.5-3.0 and rebounds 4.7 against 5.5. Same correction, same reason. */
	/* `mult` is the per-composite reference MULTIPLIER (see the long comment
	   at classRefMult in js/engine.js). 1 for a returning player, who already
	   sits on the reference; a number a little above 1 for a prospect, whose
	   class sits below it. A multiplier rather than the old addition because
	   these are share weights and an addition compresses them — which is what
	   flattened the position gradient. */
	function refOf(mult, k) {
		return mult && Number.isFinite(mult[k]) ? mult[k] : 1;
	}
	function astWeight(comps, ratings, minShare, mult) {
		return Math.pow(
			Math.max(TUNING.AST_FLOOR, passSkill(comps, ratings) * refOf(mult, "passing")),
			TUNING.AST_EXP) * minShare;
	}
	function stlWeight(comps, minShare, mult, refVol) {
		return Math.pow(Math.max(0.02, comps.stealing * refOf(mult, "stealing")),
			TUNING.STL_EXP) *
			/* Athleticism enters as a CENTERED term, not as a share, so the
			   additive reference is the right one here and stays. */
			(1 + TUNING.STL_ATH * (comps.athleticism + (refVol || 0) - 0.50)) * minShare;
	}
	/* Rebounding, with height in it.

	   BBGM's rebounding composite is hgt*2 + reb*2 + oiq*0.5 + diq*0.5, so a
	   Glass-Eating Center's +reb offset buys exactly as many boards as one
	   inch of height does, and reading only that composite made the
	   `rebounding` archetype tag invisible in the box score — measured, bigs
	   carrying the tag averaged 8.46 rebounds against 8.65 for bigs without
	   it. Size is not a linear input to rebounding: a seven-footer standing
	   next to the rim gets to a defensive board a 6'2" guard cannot reach at
	   all, whatever either of them wants.

	   So the weight carries an explicit height term on top of the composite.
	   It is deliberately mild on the offensive glass (where effort and
	   positioning matter more relative to reach) and steeper on the defensive
	   glass, which is where the real height gradient lives. */
	/* `strength` is the player's own `stre` rating on 0-1. See REB_STRE_DRB:
	   BBGM's rebounding composite gives it a weight of 0.1 out of 5.2, so it
	   has to be read explicitly or a bruiser and a reed rebound identically.
	   Centered on 0.45, the class mean, so the factor is 1 for an average
	   player and the team pool does not move. */
	function rebWeight(comps, minShare, offensive, mult, bigness, strength) {
		const bg = Number.isFinite(bigness) ? clamp(bigness, 0, 1) : 0.5;
		const size = Math.pow(0.62 + 0.76 * bg, offensive ? TUNING.REB_HGT_ORB : TUNING.REB_HGT_DRB);
		const st = Number.isFinite(strength) ? clamp(strength, 0, 1) : 0.45;
		const box = 1 + (offensive ? TUNING.REB_STRE_ORB : TUNING.REB_STRE_DRB) * (st - 0.45);
		return Math.pow(
			Math.max(TUNING.REB_FLOOR, comps.rebounding * refOf(mult, "rebounding")),
			TUNING.REB_EXP + (offensive ? 0.35 : 0)) * size * Math.max(0.25, box) * minShare;
	}

	/* How well a roster shoots, before a single stat line exists, so the engine
	   can work out how often each team's OPPONENTS missed — which is what a
	   defensive rebound total should respond to and previously could not: the
	   pool was the literal constant 25.2 regardless of who the team played.
	   Returns an expected field-goal percentage on the era's own anchors. */
	/* `cal` is an optional era-bound calibration view (CAL.forEra("modern")).
	   Without it this reads the module-global era, which is whatever the last
	   run left behind — fine inside a run, a hazard for a view-layer caller
	   with two files loaded at different eras. */
	function rosterShooting(team, cal) {
		const CAL = cal || global.Calibration;
		let two = 0;
		let three = 0;
		let share3 = 0;
		const w = walkRotation(team, (m, weight, c, flat) => {
			const inside = c ? (c.shootingAtRim + c.shootingMidRange) / 2
				: flat(0.50) + CAL.effShift("fieldEff");
			const outside = c ? c.shootingThreePointer
				: flat(0.505) + CAL.effShift("fieldEff");
			const b = c ? clamp((m.player.newRatings.hgt - 30) / 55, 0, 1) : 0.45;
			const tp = c ? m.player.newRatings.tp : 45;
			two += weight * (0.5 * CAL.byHeight("rimPct", b) + 0.5 * CAL.byHeight("midPct", b) +
				0.5 * CAL.effShift("inside") + 0.5 * CAL.effShift("mid") +
				0.26 * (inside - (0.40 + 0.22 * b)));
			three += weight * (0.339 + CAL.effShift("three") + 0.40 * (outside - (0.50 - 0.20 * b)));
			share3 += weight * CAL.threeShare(b, tp);
		});
		if (!w) return CAL.ROTATION.twoPct;
		const s3 = share3 / w;
		return clamp((1 - s3) * (two / w) + s3 * (three / w), 0.34, 0.60);
	}

	/* ctx:  { oppStrength, oppDefense, games, league, pro }
	   who:  { talent, filler } — the player himself. Needed because two rate
	         anchors differ between a drafted prospect and the returning
	         rotation player beside him, and the model used the DRAFTED anchor
	         for everybody: the drafted-player free-throw-rate table (.367 for
	         guards up to .511 for seven-footers) was applied to all of Division
	         I, when the whole-field rotation baseline is .366 flat. That alone
	         put team free-throw attempts 12% high. */
	/* A per-player bend on the stat line.

	   The anomaly system (SURPRISES in js/engine.js) could change a prospect's
	   biography, his height, his recruiting rank and whether he played — and
	   nothing else. "He shot the ball eight points worse than his jumper says",
	   "he was the best defender in the league out of nowhere", "he had fifteen
	   double-doubles" are the anomalies a scout actually has to evaluate
	   through, and none of them was expressible: every one of them is a fact
	   about the season and not about the player, which is exactly what a stat
	   bend is.

	   Every field is optional and additive, and the bend is applied INSIDE the
	   stat line rather than to it afterwards, so the team reconciliation still
	   runs over the bent numbers — a player who rebounds more takes the boards
	   off his own teammates rather than conjuring them, which is what makes the
	   bend a season and not a cheat. */
	function bendOf(me) {
		return (me && me.statBend) || null;
	}

	/* What a build says about a stat line that BBGM's composites cannot.

	   BBGM's `drawingFouls` composite is {hgt, spd, drb, dnk, oiq} and its
	   `fouling` composite is {hgt, diq, spd}: neither reads ins, stre or ft,
	   so a Free-Throw Merchant (ft 18, ins 6) and a Foul Magnet Guard drew
	   fouls at exactly the class rate — measured, FTr 0.30 against a class
	   mean of 0.33 — and a Foul-Prone Enforcer (stre 18, oiq -14) fouled like
	   everybody else. Any build whose identity rests on those three ratings
	   was structurally invisible to the model that should express it.

	   Derived from the build's own (normalized) offset vector rather than
	   tabulated per build, on the same reasoning as ROLE_USAGE: the
	   ratings a specialist trades toward are the fact; a hand-fitted
	   constant per name is a second table to keep in sync. Inside scoring
	   and strength are rim pressure, which is what draws a whistle; a
	   free-throw shooter gets sent there on purpose late in games, which is
	   why ft carries a smaller, real weight. Fouls given away come from
	   strength used without feel. Balanced is the origin of both. */
	const IDENTITY_FTR = { ins: 0.0024, stre: 0.0016, ft: 0.0018, dnk: 0.0006 };
	const IDENTITY_PF = { stre: 0.010, oiq: -0.008, ins: 0.003 };
	/* REBOUNDING INTENT.

	   The `rebounding` archetype tag did nothing in the box score. Measured
	   over ten classes before this: builds carrying the tag averaged 8.46
	   rebounds a game and bigs WITHOUT it averaged 8.65 — the tag was a label,
	   which is exactly what the archetype table's own README forbids.

	   The cause is that BBGM's rebounding composite is hgt*2 + reb*2 +
	   oiq*0.5 + diq*0.5, so a Glass-Eating Center's +26 on `reb` is worth
	   thirteen inches of height and nothing else; a build could be drawn as a
	   rebounding specialist and share the glass with everybody. The composite
	   is also the only thing rebWeight could read, and ROLE_INTENT declares a
	   rebounder's SCORING intent (-0.9 points) with no rebounds term beside it.

	   So intent gets its own multiplier on the share weight, read off the same
	   authored offsets: `reb` mostly, with strength (boxing out) and jumping
	   (going and getting one) behind it. Rebounding builds average +14.3 on
	   reb against -3.3 for everything else, so the gap this opens is real
	   without being a second height gradient. */
	const IDENTITY_REB = { reb: 0.0090, stre: 0.0020, jmp: 0.0016, oiq: 0.0005 };
	/* DEFENSIVE-EVENT INTENT.

	   Same failure one tag over: builds tagged `defense` produced 2.13 steals
	   plus blocks against 1.76 for everything else, a 1.21x separation where
	   the real gap between a defensive specialist and a rotation player is
	   nearer 1.6x. The steal share reads (50 + spd + 2*diq) / 400, whose
	   constant 50 halves the range of everything that follows it, and blocks
	   read only the composite.

	   Split in two because they are two different players: a Ball Hawk is
	   quick hands and anticipation, a Rim Protector is length and timing, and
	   a build that is one is usually not the other. */
	/* PLAYMAKING INTENT.

	   The third of the same family. Builds tagged `playmaking` produced 4.21
	   assists against 3.20 for other guards, a 1.32x separation where the real
	   gap between a lead guard and a scoring guard is nearer 2.5x. BBGM's
	   passing composite is 0.4*drb + 1.0*pss + 0.5*oiq, so it rewards every
	   guard who can dribble — which is why a Sharpshooter finished within 1.7
	   assists of a Floor General — and AST_PSS already reads some raw pss back
	   to correct that. This is the rest of it: what the build is FOR, as
	   against what its ratings incidentally add up to. */
	const IDENTITY_AST = { pss: 0.0100, oiq: 0.0022, drb: 0.0012, ins: -0.0008 };
	const IDENTITY_STL = { diq: 0.0145, spd: 0.0058, oiq: 0.0018, jmp: 0.0010 };
	const IDENTITY_BLK = { diq: 0.0105, jmp: 0.0098, hgt: 0.0030, stre: 0.0020 };
	/* Centered on the table, weighted by rarity: the offset table is
	   net-negative on ins (a specialist genuinely trades inside scoring
	   away), so an uncentered term would move the CLASS free-throw rate off
	   its anchor by a few percent rather than only moving builds around it.
	   The anchor is the calibration table's job. */
	/* One table per axis, so adding an axis is a row rather than five edits. */
	const IDENTITY_AXES = {
		ftr: IDENTITY_FTR, pf: IDENTITY_PF,
		reb: IDENTITY_REB, ast: IDENTITY_AST, stl: IDENTITY_STL, blk: IDENTITY_BLK,
	};
	const IDENTITY_KEYS = Object.keys(IDENTITY_AXES);
	const IDENTITY_CENTER = {};
	const IDENTITY_CACHE = {};
	function identityRaw(arch) {
		const out = {};
		for (const axis of IDENTITY_KEYS) {
			const tbl = IDENTITY_AXES[axis];
			let v = 0;
			for (const k of Object.keys(tbl)) v += tbl[k] * (arch.o[k] || 0);
			out[axis] = v;
		}
		return out;
	}
	function identityOf(name) {
		const RB = global.RatingsBuilder;
		if (!RB || !name) return null;
		if (IDENTITY_CACHE[name]) return IDENTITY_CACHE[name];
		if (!IDENTITY_CACHE.__centered) {
			let wsum = 0;
			const acc = {};
			for (const a of RB.ARCHETYPES) {
				const w = a.w === undefined ? 1 : a.w;
				const r = identityRaw(a);
				wsum += w;
				for (const axis of IDENTITY_KEYS) acc[axis] = (acc[axis] || 0) + w * r[axis];
			}
			for (const axis of IDENTITY_KEYS) {
				IDENTITY_CENTER[axis] = wsum ? acc[axis] / wsum : 0;
			}
			IDENTITY_CACHE.__centered = true;
		}
		const arch = RB.ARCHETYPES.filter((a) => a.name === name)[0];
		if (!arch || !arch.o) return null;
		const r = identityRaw(arch);
		const out = {};
		for (const axis of IDENTITY_KEYS) out[axis] = r[axis] - IDENTITY_CENTER[axis];
		IDENTITY_CACHE[name] = out;
		return out;
	}
	const IDENTITY_NONE = { ftr: 0, pf: 1, reb: 1, ast: 1, stl: 1, blk: 1 };
	function archetypeIdentity(name, cfg) {
		const id = identityOf(name);
		if (!id) return IDENTITY_NONE;
		/* Scaled by specialization, the same way the offsets reach the
		   ratings: at 0 every build is BBGM's own and there is no identity to
		   read. */
		const spec = clamp(cfg && Number.isFinite(cfg.specialization) ? cfg.specialization : 1, 0, 3);
		/* ftr is a rate and adds; the rest are share multipliers and multiply,
		   so they go through exp() and land on 1 for a build with no intent.
		   The clamps stop a specialization of 3 on the most extreme build in
		   the table turning into a different sport. */
		return {
			ftr: clamp(id.ftr * spec, -0.09, 0.12),
			pf: Math.exp(clamp(id.pf * spec, -0.45, 0.55)),
			reb: Math.exp(clamp(id.reb * spec, -0.42, 0.45)),
			ast: Math.exp(clamp(id.ast * spec, -0.40, 0.45)),
			stl: Math.exp(clamp(id.stl * spec, -0.45, 0.60)),
			blk: Math.exp(clamp(id.blk * spec, -0.45, 0.55)),
		};
	}

	function statLine(rng, ratings, comps, minutes, usgShare, ctx, cfg, teamCtx, who) {
		const me = who || { talent: 55, filler: false };
		const bend = bendOf(me);
		const identity = archetypeIdentity(me.archetype, cfg);
		const noise = clamp(cfg.statNoise, 0, 3);
		const env = teamCtx.env || NCAA_ENV;
		const gameMinutes = env.gameMinutes || 40;
		// Nobody plays every game. Tweaks, illness, a suspension, a coach's
		// doghouse: the draft-year GP mean is 33.5 against a ~35-game team
		// schedule, and a sim where everyone is available all year runs high.
		/* The absence is drawn before a game is played (see assignAvailability
		   in js/engine.js) so the team's record can respond to it. This used to
		   invent one here and gameLog invented a second, unrelated one further
		   downstream, so a note could say a man missed eleven games while his
		   game log blanked out four different ones. A filler has no availability
		   of his own, so he keeps the old draw. */
		const missed = me.availability
			? me.availability.games
			: (me.filler && rng.random() >= 0.46
				? Math.min(14, Math.round(Math.abs(rng.normal(0, 3.1)) + 1))
				: 0);
		const games = Math.max(5, teamCtx.games - missed);
		const minShare = minutes / gameMinutes;

		// Team possessions per game.
		const pace = teamCtx.pace;

		// Scoring chances this player finishes, per game. usgShare already folds
		// in playing time and sums to 1 across the rotation; chanceMult converts
		// possessions into chances (see the header identity).
		const poss = pace * teamCtx.chanceMult * usgShare;
		/* Turnovers are denominated in POSSESSIONS, not chances. TO% in the
		   source data (and in every public college box-score derivation) is
		   turnovers over possessions, and the model was applying it to chances
		   — which exceed possessions by the team's offensive rebounds, a factor
		   of about 1.147. That is the whole of the 15% turnover excess: the
		   measured team rate was 19.6% of possessions against a real 17.2%, and
		   19.6 / 1.147 = 17.1. An offensive rebound restarts a chance inside a
		   possession that has already survived its turnover risk. */
		const tovPoss = poss / teamCtx.chanceMult;
		// USG% proper: share of team chances used while actually on the floor.
		const usgRate = minutes > 0 ? (usgShare * gameMinutes) / minutes : 0;

		/* Competition: harder leagues shave efficiency, and a little volume.

		   -0.0022 was directionally right and numerically nothing: measured
		   corr(conference strength, PPG) = -0.12 and corr(confStr, TS%) =
		   -0.12, which puts a 20-point scorer in the SWAC and one in the Big
		   12 well under a point apart. A 20-point SWAC season and a 20-point
		   Big 12 season are not the same season and a draft board that cannot
		   say so is missing the single most-used adjustment in scouting.
		   -0.0040 over the ~30 points of conference strength that separate the
		   two ends of Division I is 12 points of efficiency spread across the
		   whole range, or about 2.5 between a typical high-major and a typical
		   low-major schedule — which is the size of the gap the
		   strength-of-schedule adjusted ratings actually show. */
		const compAdj = -0.0032 * (ctx.oppStrength - 52);
		/* THERE IS DELIBERATELY NO USAGE PENALTY HERE, and it is worth saying
		   why rather than leaving the absence to look like an oversight.

		   `ctx.oppStrength` is a property of the SCHEDULE, so it is identical
		   for all ten men in a rotation. usgShare is a share that sums to 1
		   across that rotation, so any factor applied uniformly to it cancels
		   exactly — it cannot move one player against his teammates, which is
		   the only thing a usage term can do. What it would move is the team's
		   volume LEVEL, and that is already decided twice downstream: by the
		   efficiency terms above, and then by anchorPointsToScoreboard, which
		   ties the rotation's points to the games js/teams.js actually played
		   against that schedule. A usage penalty here would be arithmetic that
		   looks like a model. The competition effect belongs on efficiency,
		   where it is, and the volume half arrives through the scoreboard. */
		/* Talent -> efficiency. js/calibration.js has always documented and
		   exported this gradient ("better prospects carry a little more volume
		   at slightly better efficiency") and nothing ever called it, so the
		   volume half was in the model and the efficiency half was not. The
		   measured correlation between overall rating and true shooting was
		   0.20 — almost all of it arriving through usage. */
		const talentAdj = me.filler ? 0 : CAL.talentEffAdj(me.talent);
		/* Experience -> efficiency. A fourth-year player in a college
		   program finishes better than a freshman with the same NBA rating,
		   and until now class year touched nothing but a reserve-year
		   probability. Centered on a sophomore so the class mean does not move
		   off the empirical anchor. */
		const expAdj = me.filler || !Number.isFinite(me.year)
			? 0 : TUNING.EXP_EFF * clamp(me.year - 1, -1.2, 3.2);
		/* The efficiency dial, which did not exist: pace and scoringEnv are
		   both possession dials, and moving either left true shooting at 0.572
		   in every configuration. */
		const envEff = 0.010 * clamp(cfg.efficiencyEnv || 0, -3, 3) +
			(me.filler ? CAL.effShift("fieldEff") : 0);
		// The defenses actually faced. `oppDefense` is the minute-weighted
		// average defensive profile of this team's schedule, so a prospect in a
		// conference full of shot-blockers finishes worse at the rim than the
		// same player in a conference of guards.
		const od = ctx.oppDefense || { rim: 0, perimeter: 0, overall: 0 };
		// Teammate spacing/passing helps everyone score more efficiently.
		const synergy = 0.0015 * (teamCtx.support - 50);
		// Volume tax: a low-usage role player picks his shots, a 33%-usage hub
		// takes what the defense gives him. Keeps pass-first guards from being
		// the least efficient scorers on the floor.
		/* Steeper above thirty percent. The linear tax let a 36%-usage man
		   on a fast team shoot 65% true shooting on twenty-three attempts and
		   print 36 a game — a line Division I has not produced this century.
		   The extra term only reaches the top tenth of a class: at 30% usage
		   it is zero, at 36% it costs about five points of true shooting. */
		const loadAdj = -0.30 * (usgRate - 0.245) -
			0.85 * Math.max(0, usgRate - 0.30);

		const bigness = clamp((ratings.hgt - 30) / 55, 0, 1);
		/* THE COMPOSITE REFERENCE.

		   Every skill term below is written as "how far this composite sits
		   from what a typical player of this size scores on it", and every one
		   of those reference points was read off a class whose ratings averaged
		   45 — the shape of the old calibration fixture, not the shape of a
		   BBGM draft class. A real export averages nearer 38, which puts every
		   prospect composite about 0.05 low against a reference that never
		   moved, and a class that is by assumption made of NBA draft picks then
		   shot 55.4% true against an anchor of 58.5 and 31.8% from three
		   against 35.2 — a three-point-per-attempt error caused entirely by
		   measuring the class against the wrong reference player.

		   Returning rotation players are synthesized from talent and already
		   sit on the reference, so the shift is the prospect's alone. */
		const refVol = me.filler ? 0 : (ctx.classRefVolume || 0);
		const refEff = me.filler ? 0 : (ctx.classRefEfficiency || 0);
		/* The share-weight half of the same correction. Null for a filler, who
		   is synthesized on the reference already. */
		const refMult = me.filler ? null : (ctx.classRefMult || null);

		// Turnovers: draft-year mean 17.2% of possessions (p5 10.7, p95 24.5),
		// essentially flat across sizes. A ball-pressure defense forces more.
		// Skill composites are centered at what a typical prospect of this size
		// actually scores on them (~45 base ratings, hgt = 30+55*bigness), so
		// only above/below-typical skill moves the rate off its empirical anchor.
		/* Returning rotation players give the ball away a little more often than
		   future draft picks do; the drafted table is the prospect's anchor. */
		/* And experience -> ball security, the other half of the same fact.
		   A fourth-year guard gives it away less than a freshman does. */
		const tovAnchor = CAL.byHeight("tov", bigness) * (me.filler ? 1.06 : 1) *
			(me.filler || !Number.isFinite(me.year)
				? 1 : 1 - TUNING.EXP_TOV * clamp(me.year - 1, -1.2, 3.2));
		/* WHICH WAY BBGM'S TURNOVER COMPOSITE POINTS.

		   `turnovers` is (50*0.5 + ins + pss - oiq) normalized — it RISES with
		   the ratings that put the ball in a player's hands and FALLS with
		   offensive IQ, and BBGM's own game sim reads it as a propensity: the
		   higher it is, the more often that player coughs the ball up. This
		   file read it as a skill and subtracted it, so the model paid a
		   high-IQ, low-usage big the turnover discount and charged the smart
		   playmaker for it. Measured on a realistic class, offensive IQ
		   correlated +0.23 with turnovers per game — the sign of the single
		   most-cited "he doesn't turn it over" rating was backwards.

		   Two references, not one, and neither is 0.467. The term has to be
		   MEAN-ZERO over the population it is applied to or it moves that
		   population's turnover level off the empirical anchor rather than
		   redistributing it: a class of prospects averages 0.4393 on this
		   composite (PROSPECT_COMP_BASES) and the synthesized field averages
		   0.380, so one shared reference of 0.467 was quietly handing the
		   whole of Division I nearly a point of extra turnover rate. And the
		   class-level correction is the composite's OWN multiplier
		   (classRefMult), not classRefVolume — that number is the gap on the
		   USAGE composite, which is the fault the multiplier table was
		   introduced to fix, still in place at this one site. */
		const tovComp = me.filler
			? comps.turnovers - TUNING.TOV_COMP_FIELD
			: comps.turnovers * ((refMult && refMult.turnovers) || 1) -
				TUNING.PROSPECT_COMP_BASES.turnovers;
		const tovRate = clamp(
			tovAnchor + TUNING.TOV_COMP * tovComp +
				/* Opponent ball pressure. PROGRAM_STYLES gives a full-court
				   press team press: 0.06, and it was added straight onto a rate
				   — so a conference stacked with pressing teams could add six
				   percentage points of turnover rate, larger than the entire
				   height gradient in the calibration table (17.2% to 17.8%).
				   Half of a press's effect shows up as a live-ball turnover;
				   the rest is a rushed shot, which the efficiency terms already
				   carry. */
				0.13 * od.perimeter + 0.5 * (ctx.oppPress || 0) +
				rng.normal(0, 0.014 * noise),
			0.08, 0.27,
		);
		// Free-throw rate climbs steeply with size (FTr .37 guards -> .51
		// seven-footers); foul-drawing skill moves it around that anchor.
		/* Fillers are the whole of Division I outside this class, so they take
		   the flat whole-field rotation baseline rather than the drafted-player
		   height table, which runs 9% richer and slopes hard with size. */
		const ftrAnchor = me.filler
			? CAL.ROTATION.ftr * (0.90 + 0.24 * bigness)
			: CAL.byHeight("ftr", bigness);
		const ftRate = clamp(
			ftrAnchor + 0.32 * (comps.drawingFouls - (0.42 + 0.11 * bigness) + refVol) +
				// The rim pressure the composite cannot see: see archetypeIdentity.
				identity.ftr +
				rng.normal(0, 0.045 * noise),
			0.10, 0.75,
		);

		// Volume jitter is applied to the *inputs*, so that points, FG% and TS%
		// stay reconcilable with the attempts printed beside them.
		const jv = (x, sd) => Math.max(0, x * (1 + rng.normal(0, sd * noise)));
		const tov = jv(tovPoss * tovRate, 0.10);
		const fga = jv((poss - tov) / (1 + FT_TRIP * ftRate), 0.045);
		const fta = jv(fga * ftRate, 0.06);

		// Shot mix: 3PA share anchored to the height buckets (.39 for guards
		// down to .085 for 6'11"+), stretched by shooting talent.
		// The system he plays in. A shooter at a four-out program and the same
		// shooter in a pack-line offense do not take the same shots.
		const style = teamCtx.style || { three: 0, rim: 0, press: 0 };
		/* A system does not make a non-shooter shoot.

		   The height-and-talent term below is damped for a player who cannot
		   shoot (see threeShare in js/calibration.js) and the two terms added
		   to it were not, so a four-out program's +share and the shot-mix
		   noise landed in full on a seven-footer with a tp of 25 — measured at
		   a sixth of his attempts from three, which is about 1.3 a game
		   against the 0.2 a real post-only big takes. What a four-out offense
		   actually does with a big who cannot shoot is give the shots to
		   somebody else, so both terms are scaled by the same willingness
		   factor the base term uses. */
		const willing = ratings.tp >= 30 ? 1 : Math.max(0, ratings.tp) / 30;
		const base3 = CAL.threeShare(bigness, ratings.tp + refVol * 100, ratings.tp) +
			willing * style.three;
		/* The shot-mix noise is RELATIVE. A flat sd of 0.045 is a tenth of a
		   guard's 0.39 share and half of a seven-footer's 0.085, so the same
		   draw that moved a guard from 12 threes a hundred shots to 16 moved a
		   post player from two to seven — and the tail of that distribution is
		   how a big who cannot shoot ended up taking a sixth of his shots from
		   range. The floor keeps a genuinely small share from being noiseless,
		   which would be its own artifact. */
		let share3 = base3 + rng.normal(0,
			0.045 * noise * clamp(base3 / 0.30, 0.3, 1));
		share3 = clamp(share3, 0.0, 0.75);

		const tpa = fga * share3;
		const twoA = fga - tpa;

		/* Attempts -> season percentage. `a` is attempts per game and `games`
		   is the season he actually played, so N is the season's attempt count
		   — which is the number the binomial is defined on and the number a
		   scout is supposed to check. The noise slider scales the DEVIATION
		   from true talent rather than gating the resample, so statNoise 0 is
		   still exactly deterministic (which several callers rely on) and
		   statNoise 2 is twice as wild, the same contract every other term in
		   this function honors. */
		const shoot = (r, a, p, nz) => {
			const N = Math.round(Math.max(0, a) * games);
			if (N <= 0 || !(nz > 0)) return p;
			const k = rbinom(r, N, p);
			return clamp(p + nz * (k / N - p), 0, 1);
		};

		// A shared "touch" term so a player's 3P% and FT% move together — the
		// old model drew them independently and produced 46%/58% shooters.
		const touch = rng.normal(0, 1);
		const mix = (t, e) => 0.707 * t + 0.707 * e;

		// Percentages. 3P% centers near the draft-year median of .348 for a
		// real shooter; the floor lets non-shooters brick their token attempts.
		// The slope on the shooting composite is steep on purpose: the measured
		// spread used to run 34.8% for guards to 31.1% for centers with almost
		// nothing between an elite shooting big and a non-shooting guard, when
		// the real range is 27% to 40% *within* every size band.
		/* THE THREE-POINT CEILING, AND WHY IT IS NOT A CLAMP.

		   The ceiling used to allow 56% from three on token volume, which is
		   not a number, it is a joke line, and the correction over-shot the
		   other way: `clamp(0.435 + 0.08 * max(0, 1 - tpa/3.5), 0.435, 0.50)`
		   is a HARD WALL at exactly .435 for anybody taking three and a half
		   attempts a game. Measured over ten classes, the p90 of every shooter
		   at two or more attempts was 43.5% to the decimal and the maximum was
		   44.3 — a tenth of the shooters in the country pinned onto one value,
		   which is precisely the failure the usage-distribution band in
		   tools/validate.js exists to catch and was never asked to catch here.
		   Real draft classes produce a 45-48% shooter on six attempts most
		   years, and that man is the entire point of the Sharpshooter build.

		   So the wall becomes a soft saturation. Below the knee nothing moves —
		   which protects the finding the old comment records, that a COHORT of
		   shooting specialists should average 38-40% and not 43.7% — and above
		   it the curve bends asymptotically toward a limit instead of stacking
		   everyone on the limit. A volume shooter can now reach the high
		   forties and essentially nobody reaches 50. */
		/* THE LIMIT CAME DOWN (0.470 + 0.055 -> 0.432 + 0.058) BECAUSE IT
		   CHANGED MEANING. It used to bound the percentage a player PRINTED,
		   so the ceiling and the season maximum were nearly the same number
		   and 0.470 was read straight off "essentially nobody reaches 50".
		   Now it bounds true talent and the season is resampled around it, so
		   the printed maximum is the ceiling plus the binomial tail — measured,
		   the old number put the best high-volume shooter in a class at 56.1%,
		   which is not a season. A true-talent ceiling near .432 at volume puts
		   the realized maximum back in the high forties, where it was, and
		   leaves the LOW-volume asymptote generous (a token-attempt shooter can
		   still be genuinely elite) because that is where the binomial itself
		   supplies the spread. */
		const tpLim = 0.432 + 0.058 * Math.max(0, 1 - tpa / 3.5);
		/* The ceiling is on TRUE TALENT, not on the season he shot.

		   tpLim used to sit on the realized percentage, which is what
		   compressed the elite tail below binomial: a 90-tp shooter's mean was
		   squeezed to .47 AND his season was drawn with the same flat sd as
		   everybody else's, so he could not have a cold year. It is a claim
		   about how well a man can shoot, so it belongs on p; the season then
		   varies around it by the binomial. The volume term stays because a
		   low-volume shooter's talent really is less constrained — those are
		   his open catch-and-shoot looks, not his shot diet. */
		const tpTrue = clamp(softCeil(
			(bend && bend.tpp ? bend.tpp : 0) +
			0.339 + CAL.effShift("three") + envEff +
				0.40 * (comps.shootingThreePointer - (0.50 - 0.20 * bigness) + refEff) +
				compAdj + synergy + talentAdj + expAdj + loadAdj * 0.6 - 0.055 * od.perimeter +
				/* The shot-quality half of the beta-binomial: how open his
				   looks were this year, which the counting noise below cannot
				   express. Down from 0.030 (which was carrying the WHOLE of the
				   spread) to roughly the residual a real high-volume shooter
				   shows once counting noise is removed. Still shares `touch`
				   with the free-throw line: 3P% and FT% move together. */
				mix(touch, rng.normal(0, 1)) * 0.013 * noise,
			tpLim, 0.86),
			0.16, 0.52,
		);
		const tpp = shoot(rng, tpa, tpTrue, noise);
		// Rim/mid split and finishing: rim FG% runs .59 (guards) to .72 (bigs).
		// The calibration table already carries the height effect, so the skill
		// composites (which lean heavily on hgt) are centered at what a player of
		// this size typically scores on them, to avoid double-counting height.
		// Rim attempts are ~50% of 2PA for guards and ~55% for centers in the
		// data — nearly flat; the size effect lives in rim FG%, not shot mix.
		const rimMix = clamp(0.49 + 0.06 * bigness + style.rim +
			0.10 * (comps.shootingAtRim - comps.shootingMidRange), 0.30, 0.75);
		// Interior defense bites hardest exactly where it should: at the rim.
		const insideEff = CAL.byHeight("rimPct", bigness) + CAL.effShift("inside") + envEff +
			0.26 * (comps.shootingAtRim - (0.32 + 0.44 * bigness) + refEff) +
			0.16 * (comps.shootingLowPost - (0.40 + 0.17 * bigness) + refEff) +
			// The dunking rating, which had no effect on field-goal percentage
			// at all. See DNK_RIM.
			TUNING.DNK_RIM *
				(clamp((Number.isFinite(ratings.dnk) ? ratings.dnk : 45) / 100, 0, 1) - 0.45) -
			0.16 * od.rim;
		/* OFFENSIVE IQ, WHICH MADE A PLAYER A WORSE FINISHER.

		   BBGM's shootingMidRange composite is (oiq * -0.5 + fg * 1 +
		   stre * 0.2) normalized — `oiq` enters it NEGATIVELY, at half the
		   weight of the shooting rating itself. That is an upstream modeling
		   choice about shot SELECTION (a smart player takes fewer long twos),
		   and nothing in this file offset it, so it arrived here as a claim
		   about accuracy: measured partial(oiq, TS% | ovr) = -0.15. Offensive
		   intelligence made you shoot worse, which is not a sentence about
		   basketball.

		   The composite is left alone — the shot-mix model and BBGM's own
		   exports read it — and the accuracy half is put back here, at the
		   0.26 slope's own scale times the 0.5 weight the composite subtracts,
		   so the two cancel to first order and what remains is the genuine
		   shot-selection story the composite is for. */
		const midEff = CAL.byHeight("midPct", bigness) + CAL.effShift("mid") + envEff +
			0.26 * (comps.shootingMidRange - 0.45 + refEff) +
			0.22 * (clamp((Number.isFinite(ratings.oiq) ? ratings.oiq : 45) / 100, 0, 1) - 0.45) -
			0.05 * od.perimeter;
		const twoTrue = clamp(
			rimMix * insideEff + (1 - rimMix) * midEff + compAdj + synergy + talentAdj +
				expAdj + loadAdj +
				// Shot quality, not counting noise — see rbinom. 0.026 -> 0.013.
				rng.normal(0, 0.013 * noise),
			0.34, 0.68,
		);
		const twoP = shoot(rng, twoA, twoTrue, noise);
		// FT%: draft-year mean .726 with a real size gradient (.78 guards, .67
		// centers) beyond what the ft rating alone carries.
		/* Free-throw shooting reads the raw `ft` rating rather than a composite,
		   so it needs the same reference correction in rating points that the
		   composite terms get in composite points — otherwise a realistically
		   shaped class shoots 69.3% from the line against an anchor of 73.0 for
		   no reason but the level of the fixture the intercept was fitted on. */
		const ftTrue = clamp(
			0.548 + 0.40 * ((ratings.ft + refEff * 100) / 100) - 0.035 * bigness +
				// 0.035 -> 0.018, same split as the field-goal terms.
				mix(touch, rng.normal(0, 1)) * 0.018 * noise,
			0.35, 0.94,
		);
		const ftp = shoot(rng, fta, ftTrue, noise);

		const fgm = twoA * twoP + tpa * tpp;
		const fgp = fga > 0 ? fgm / fga : 0;
		const pts = twoA * twoP * 2 + tpa * tpp * 3 + fta * ftp;

		// Counting stats scale off team totals and the player's share. The team
		// totals themselves respond to the roster (see teamPools), so a real
		// shot-blocker raises his team's block count instead of only taking
		// share from his teammates.
		const sh = (comp, exp) => Math.pow(comp, exp) * minShare;
		// Offensive rebounds lean a little more on size and effort than the
		// defensive glass, where everyone boxes out.
		/* identity.reb is the build's rebounding INTENT — what the offset
		   table says this man goes and gets that his composite cannot see.
		   See IDENTITY_REB. Like the fouling identity below, it redistributes
		   inside a roster and reconcileTeamTotals refits the team to its pool
		   afterwards, so a Glass-Eating Center's extra boards come off his
		   teammates' rather than out of thin air. */
		/* The offensive/defensive split. `orbBias` moves the two halves in
		   opposite directions and by construction leaves their sum alone, so
		   a putback specialist takes his extra offensive boards out of his own
		   defensive ones rather than out of the team's pool. */
		const ob = clamp(me.orbBias || 0, -0.12, 0.12);
		const strength = clamp((Number.isFinite(ratings.stre) ? ratings.stre : 45) / 100, 0, 1);
		const orbW = rebWeight(comps, minShare, true, refMult, bigness, strength) *
			identity.reb * (1 + 2.4 * ob);
		const drbW = rebWeight(comps, minShare, false, refMult, bigness, strength) *
			identity.reb * (1 - 0.9 * ob);
		// No single player takes an unbounded share of a team total: the record
		// books top out near 60-70% of team assists and blocks, so saturate the
		// share smoothly rather than letting one dominant composite run away
		// with the whole pool.
		// Linear until the knee, then asymptotic to `lim` — so ordinary lines
		// are untouched and only the runaway tail is bent back.
		const saturate = (x, lim, knee) => {
			const t = lim * knee;
			if (x <= t || lim <= 0) return x;
			return t + (lim - t) * (1 - Math.exp(-(x - t) / (lim - t)));
		};
		/* The documented cap has to survive the noise. Applying jv() AFTER the
		   saturation let ±10-16% multiplicative jitter push a capped share back
		   over the ceiling — measured maxima were 0.672 of team assists against
		   a documented 0.62, and 0.429 of team rebounds against 0.40. Noise
		   first, cap second, and the ceiling means what the comment says. */
		const capNoisy = (raw, sd, pool, cap) =>
			saturate(jv(raw, sd), pool * cap, 0.62);

		const rebLim = (teamCtx.orbPool + teamCtx.drbPool) * TUNING.REB_CAP;
		/* The double-double anomaly. It lifts the rebound share (and, below,
		   the assist share for a guard) rather than writing double-doubles into
		   the game log directly: the log is drawn from the season average, so
		   raising the average is what actually produces the fifteen nights, and
		   it keeps the line and the log in agreement — which everything else in
		   this model does and this had no reason not to. Still capped, so a
		   double-double machine cannot take 60% of his team's boards. */
		const rebB = 1 + (bend && bend.reb ? bend.reb : 0);
		const orbRaw = jv((teamCtx.orbPool * orbW) / teamCtx.orbDen, 0.14) * rebB;
		const drbRaw = jv((teamCtx.drbPool * drbW) / teamCtx.rebDen, 0.09) * rebB;
		const rebRaw = orbRaw + drbRaw;
		const rebScale = rebRaw > 0 ? saturate(rebRaw, rebLim, 0.62) / rebRaw : 1;
		const orb = orbRaw * rebScale;
		const drb = drbRaw * rebScale;
		const ast = capNoisy(
			((teamCtx.astPool * astWeight(comps, ratings, minShare, refMult) * identity.ast) /
				teamCtx.astDen) *
				(1 + (bend && bend.ast ? bend.ast : 0)),
			0.10, teamCtx.astPool, TUNING.AST_CAP);
		/* Athleticism finally reaches the steal column. BBGM's stealing
		   composite is (50 + spd + 2*diq) / 400: defensive IQ outweighs speed
		   two to one and strength and leaping do not appear at all, so the
		   athletic freaks swatted shots (athleticism vs blocks correlated 0.54)
		   and never got into a passing lane (athleticism vs steals, 0.16).
		   The composite is left alone — half the model reads it — and the share
		   is tilted here instead. */
		const stl = capNoisy(
			(teamCtx.stlPool * stlWeight(comps, minShare, refMult, refVol) * identity.stl) /
				teamCtx.stlDen,
			0.13, teamCtx.stlPool, TUNING.STL_CAP);
		const blk = capNoisy(
			(teamCtx.blkPool * sh(comps.blocking, TUNING.BLK_EXP) * identity.blk) /
				teamCtx.blkDen,
			0.16, teamCtx.blkPool, TUNING.BLK_CAP);
		// Personal fouls: BBGM's fouling composite finally does something, so
		// the Foul-Prone Enforcer archetype has an on-court identity.
		// Starters foul less per minute than the bench does (they are better,
		// and they are the ones a coach protects), so fouls scale with minutes
		// sub-linearly rather than one-for-one.
		// The build's own fouling identity multiplies the composite's share;
		// reconcileTeamTotals refits the team to its pool afterwards, so an
		// Enforcer's extra fouls come out of his teammates' rather than
		// inflating the team.
		/* BBGM's fouling composite is (50 + hgt - diq - spd) / 400: it RISES
		   as a player gets worse, so a class's prospects sat at 0.61 against
		   the 0.47 the field is synthesized at and fouled thirty percent
		   more per minute, with an eighth of every class pinned on the
		   ceiling. Centered on the field's own reference, like every other
		   rate in here: the field is synthesized around 0.38 on it, a class of
		   prospects sits near 0.60, and a starter fouls a little less per
		   minute than the bench he is protected from. */
		const foulComp = me.filler
			? comps.fouling
			: clamp(0.40 + 0.5 * (comps.fouling - 0.60), 0.15, 1);
		/* And the whistle a physical player draws. Same centering as the
		   rebound box-out term, so the team's foul pool is unmoved and this
		   only redistributes inside the roster. */
		const pfW = Math.pow(foulComp, TUNING.PF_EXP) *
			Math.pow(minShare, 0.82) * identity.pf *
			Math.max(0.4, 1 + TUNING.PF_STRE * (strength - 0.45));
		// Five fouls ends a night, so a season average saturates well below
		// it. The hard ceiling is derived from minutes: a player at 5 PF/40
		// is fouling out of most of his games, which caps what any season
		// average can physically reach — and the national leader in fouls
		// per game sits around 3.6-3.8, not five.
		const pfRaw = (teamCtx.pfPool * pfW) / teamCtx.pfDen;
		const pfLim = Math.min(4.2, 5.0 * (minutes / 40) * 0.95 + 0.6);
		const pf = clamp(jv(saturate(pfRaw, 3.3, 0.60), 0.12), 0, pfLim);

		/* --- the defensive box score --------------------------------------
		   Steals and blocks were the whole of a player's defensive record,
		   which is why defensive honors had almost nothing to rank on. These
		   are the plays that decide the other two-thirds of it. All three are
		   real, tracked college statistics. */
		/* A defensive breakout multiplies the plays a defensive record is made
		   of, and improves the rating those plays imply. It does NOT touch the
		   composites: the point of the anomaly is a player whose season was
		   better than his tools, which a scout then has to decide whether to
		   believe. */
		const defB = 1 + (bend && bend.defense ? bend.defense : 0);
		const contested = jv(
			(4.2 + 7.6 * comps.defenseInterior + 3.4 * comps.defensePerimeter) * minShare, 0.13) * defB;
		const deflections = jv(
			(0.5 + 4.6 * comps.defensePerimeter + 1.4 * comps.stealing) * minShare, 0.16) * defB;
		const charges = jv((0.9 * comps.defense + 0.5 * comps.defenseInterior) * minShare, 0.30) * defB;
		// Defensive rating: points allowed per 100 possessions with him on the
		// floor. Anchored at the league average and moved by what he actually
		// does — events, the composites, and the fouls he gives away.
		const drtg = clamp(
			104 - 22 * (comps.defense - 0.47) - 9 * (comps.defenseInterior - 0.46) -
				7 * (comps.defensePerimeter - 0.46) - 1.9 * blk - 2.4 * stl -
				0.35 * drb + 0.9 * pf + rng.normal(0, 1.6 * noise) -
				(bend && bend.defense ? 7 * bend.defense : 0),
			84, 122,
		);

		/* --- the playmaking side of the box score ------------------------
		   Assisted rate (how much of his scoring came off a teammate's pass
		   rather than his own creation) and the share of his points that
		   came in transition. The engine already computed a creation term
		   for role-usage purposes and never surfaced it; a scout reads
		   "assisted on 78% of his makes" as a different player from one
		   assisted on 35%, and a stat line could not say which he was. Both
		   are rates, drawn around what the composites and the system imply. */
		const creation = 0.5 * (comps.dribbling - 0.50) + 0.5 * (comps.passing - 0.45);
		const astdRate = clamp(
			0.56 + 0.20 * bigness - 0.9 * creation - 0.35 * (usgRate - 0.245) +
				rng.normal(0, 0.05 * noise),
			0.12, 0.96);
		const transShare = clamp(
			0.14 + 0.45 * (comps.athleticism - 0.50) - 0.06 * bigness +
				0.006 * (style.pace || 0) + 0.15 * (ctx.oppPress || 0) +
				rng.normal(0, 0.03 * noise),
			0.03, 0.45);

		return {
			gp: games,
			mpg: minutes,
			ppg: pts,
			astdRate,
			transShare,
			rpg: orb + drb,
			orpg: orb,
			drpg: drb,
			apg: ast,
			spg: stl,
			bpg: blk,
			topg: tov,
			pfpg: pf,
			cspg: contested,     // contested shots per game
			deflpg: deflections,
			chgpg: charges,
			drtg,
			fgp, tpp, ftp,
			fga, tpa, fta,
			/* The shot mix behind fgp, which the line used to average away.
			   A BBGM stats row splits two-pointers into three zones (at the
			   rim, the low post, the mid-range) and the model already decides
			   the split — it just threw it away after folding it into one
			   two-point percentage. See collegeStatsRow in js/engine.js. */
			bigness,
			rimMix,
			rimPct: insideEff,
			midPct: midEff,
			twoPct: twoP,
			usg: usgRate,        // USG%: share of chances used while on the floor
			usgShare,            // share of all team chances (sums to 1)
			ts: fga + FT_TRIP * fta > 0 ? pts / (2 * (fga + FT_TRIP * fta)) : 0,
		};
	}

	/* Team stat pools. Each responds to the rotation that actually plays: a
	   front line of shot-blockers blocks more shots than a team of guards,
	   rather than the same fixed 4.8 redistributed. `agg` is the
	   minute-weighted mean composite of the five men on the floor. */
	function teamPools(comps, mins, pace, chanceMult, gameMinutes, env, cal) {
		const CAL = cal || global.Calibration;
		const gm = gameMinutes || 40;
		const e = env || {};
		/* The share of a team's own shots that come back as rebounds. This was
		   the literal constant 0.44, written twice in two files, while the
		   sim's own team field-goal percentage was .472 — a true miss share of
		   .528, a 20% internal inconsistency in the middle of the offensive
		   rebound chain. It is read off the model's own shooting now.

		   `oppMissShare` is the same number for the schedule this team faced,
		   which is what its DEFENSIVE rebound total should respond to: a team
		   that plays a diet of bad shooters gets more defensive rebounds than
		   one that plays great shooters, and the old hardcoded 25.2 could not
		   express that at all. */
		const missShare = clamp(
			e.missShare === undefined ? CAL.chanceShape().missShare : e.missShare, 0.42, 0.64);
		const oppMissShare = clamp(
			e.oppMissShare === undefined ? missShare : e.oppMissShare, 0.42, 0.64);
		// Two views of the roster: the minute-weighted average of the five men
		// on the floor, and the best specialist on it. Team block totals track
		// the shot-blocker far more than the average (Walker Kessler took 4.6
		// of Auburn's 6.6), so pools blend the two rather than using the mean,
		// which one player can barely move.
		const agg = (key, topWeight) => {
			let a = 0;
			let top = 0;
			for (let i = 0; i < comps.length; i++) {
				a += comps[i][key] * (mins[i] / gm);
				top = Math.max(top, comps[i][key] * clamp(mins[i] / (gm * 0.75), 0, 1));
			}
			const meanOnFloor = a / 5;
			const w = topWeight === undefined ? 0 : topWeight;
			return meanOnFloor * (1 - w) + top * w;
		};
		const scale = (a, base, exp, lo, hi) =>
			clamp(Math.pow(Math.max(0.05, a) / base, exp), lo, hi);
		/* The `base` in each scale() below is meant to be the composite an
		   AVERAGE D-I rotation scores, so an average roster gets a factor of
		   exactly 1 and the pool constant beside it means what it says. They
		   were hand-set and drifted away from the filler bases they mirror: a
		   returning player's passing composite synthesizes to about 0.43 while
		   the scale was centered on 0.47, so every team in the country was
		   multiplied by 0.95 and team assists came out 5% light while the pool
		   constant itself looked correct. See POOL_BASE. */

		// Offensive rebound rate moves with the roster's glass work, which in
		// turn sets how many extra scoring chances the team creates.
		const orbRate = clamp(
			TUNING.ORB_RATE * scale(agg("rebounding", 0.25), POOL_BASE.rebounding, 0.55, 0.7, 1.35), 0.18, 0.42,
		);
		const chances = pace * chanceMult;
		const shape = CAL.chanceShape();
		/* Rebounds come off MISSED SHOTS, not off scoring chances. The pool was
		   `chances * missShare * orbRate`, and chances exceed field-goal
		   attempts by the turnovers and the free-throw split — about 34% — so
		   every offensive rebound total in the sim was a third too big, which
		   in turn inflated the chance multiplier that produced them. Team
		   rebounds measured 36.0 a game against a real 33.3 and the whole
		   possession chain was carrying the error. */
		const teamFga = chances * shape.fgaShare;
		const orbPool = teamFga * missShare * TUNING.ORB_FT * orbRate;
		/* The defensive glass is the mirror image: the opponent's missed shots,
		   minus the ones he rebounds himself. It was the constant 25.2, so a
		   team that played a schedule of bad shooters rebounded exactly as much
		   as one that played a schedule of great shooters. */
		const drbPool = teamFga * oppMissShare * TUNING.ORB_FT * (1 - TUNING.ORB_RATE) *
			scale(agg("rebounding", 0.25), POOL_BASE.rebounding, 0.35, 0.8, 1.25);

		/* Assists track MADE FIELD GOALS, and the old pool did not: it took
		   `pace * chanceMult` — the team's scoring *chances*, ~78 — and
		   multiplied by 0.46 * 0.48, implying ~36 made field goals on a team
		   that makes about 26. Chances are already net of the chance
		   multiplier, of turnovers and of the free-throw split, so applying
		   them again double-counted and put team assists 24% high (16.8 against
		   a real 13.5, AST/FGM 0.66 against a real 0.53).

		   The correct base is team FGA x FG% x assisted share. The passing
		   term leans on the best passer on the floor (topWeight 0.35), so a
		   roster with a true point guard assists more of its own baskets than
		   a team of wings does. */
		/* Sensitivity 0.55 → 0.80 for the same reason as blocks below: a
		   roster with a true Floor General should assist visibly more of
		   its own baskets than a team of wings, not 6% more. */
		/* The upper clamp came down 1.30 -> 1.22. It is the only thing that
		   bounds team AST/FGM, and it was not bounding it where the record
		   book does: measured over 948 simulated NCAA seasons the maximum was
		   0.812 (0.796 after the pool bases were re-derived) against a real
		   D-I ceiling near 0.68. 0.52 * 1.22 = 0.634 is the pool's own
		   ceiling; the realized ratio runs a little above it because the pool
		   is sized on the model's expected field goals and the box score
		   counts the ones actually made. */
		const assistedShare = TUNING.ASSISTED_SHARE *
			scale(agg("passing", 0.35), POOL_BASE.passing, 0.80, 0.72, 1.22);

		return {
			orbRate,
			orbPool,
			drbPool,
			/* Team turnovers answer to the era's chance shape the same way
			   fouls answer to TEAM_PF: the rate model was fixed at the player
			   level and the team total was still unconstrained. */
			toPool: chances * shape.tovShare,
			astPool: teamFga * (1 - missShare) * assistedShare,
			stlPool: 6.8 * scale(agg("stealing", 0.30), POOL_BASE.stealing, 1.00, 0.70, 1.45),
			/* Team blocks measured 4.57 a game against a real D-I 3.5, 31%
			   high: a 5.3 base and a 2.80x ceiling on top of a 1.70 exponent
			   compounded into a shot-blocking league. The shape is right (the
			   best rim protector on the floor should move his team's total,
			   which is what the 0.70 top-player weight buys); the level and the
			   ceiling were not. */
			/* The covariance term is the piece that makes the extremes
			   reachable without moving the mean: a roster anchored by a
			   genuine 7'2" rim protector should block 6-7 a game and a team
			   of guards should block 2, rather than everybody clustering at
			   3.5. Sensitivity up (1.70 → 2.30) and the floor down, mean
			   unchanged because scale() is centered on POOL_BASE. */
			/* Upper clamp 2.20 -> 1.75. The comment above says what the
			   covariance term is for — "a roster anchored by a genuine 7'2"
			   rim protector should block 6-7 a game" — and 4.0 * 2.20 is 8.8,
			   which is not that number. Measured team maxima ran to 10.4
			   before the pool bases were re-derived and 9.63 after, against a
			   real D-I maximum near 7. 4.0 * 1.75 = 7.0 is the sentence the
			   comment already wrote. The floor is left alone: a team of guards
			   blocking 1.8 a game is a real team. */
			blkPool: 4.0 * scale(agg("blocking", 0.70), POOL_BASE.blocking, 2.30, 0.45, 1.75),
			pfPool: TUNING.TEAM_PF * scale(agg("fouling", 0.20), POOL_BASE.fouling, 0.60, 0.80, 1.25),
		};
	}

	/* Compute the stat lines for one team's whole rotation. Returns entries for
	   the prospects only, but the maths uses everybody. */
	function simulateTeamStats(team, ctx, cfg, rng) {
		const env = ctx.league || (ctx.pro ? leagueEnv(team.conf) : NCAA_ENV);
		const gameMinutes = env.gameMinutes || 40;
		// Rotation: draft prospects always crack it (they got drafted — even
		// the draft-year p5 played ~19 MPG, not DNPs), plus the best fillers.
		const sorted = team.members.slice().sort((a, b) => b.talent - a.talent);
		const prospects = sorted.filter((m) => !m.filler);
		const fillers = sorted.filter((m) => m.filler);
		/* At least two returning players even on a prospect-stacked roster: a
		   school with 12+ prospects used to get a rotation of nothing but
		   draft picks, which no real program has ever iced. */
		/* Eight to eleven men, not nine everywhere in the country: the
		   rotation's size was the one number every program shared. */
		const drawn = 8 + Math.min(3, Math.floor(rng.child("rotsize").random() * 4));
		const size = Math.max(drawn, prospects.length + (fillers.length ? 2 : 0));
		const members = prospects
			.concat(fillers.slice(0, Math.max(0, size - prospects.length)))
			.sort((a, b) => b.talent - a.talent);

		// Composites: real ones for prospects, synthesized for filler teammates.
		// Filler bases sit ~12% above the old values so returning players score
		// composites on the same scale real BBGM rating vectors produce —
		// otherwise prospects out-composite everyone on top of out-talenting them.
		const comps = members.map((m, i) => {
			if (!m.filler) return BB.composites(m.player.newRatings);
			const r = m.talent / 100;
			// The separator keeps "X1"+i=1 from colliding with "X"+i=11.
			const cr = rng.child("f|" + team.name + "|" + i);
			const f = (base, spread) => clamp(base * (0.55 + 0.9 * r) + cr.normal(0, spread), 0.05, 0.95);
			/* Bases are set so that the WHOLE simulated field lands on the
			   D-I rotation-player anchor in js/calibration.js (USG 20.2,
			   TS 53.4, 3P 33.8, FT 70.6, ORtg 102.6) rather than only the
			   prospects landing on the drafted anchor. Now that every program
			   is simulated, that whole-field figure is measurable, and it was
			   off: 3P 30.3 against 33.8 and FT 73.7 against 70.6, which by
			   itself put the average program 2.3 points of offensive
			   efficiency light. */
			/* THE SLOT. See assignFillerSlots in js/teams.js: every returning
			   player now has a size, and a size is what a composite vector is
			   mostly about. `d` reads the per-slot offset off SLOT_SHAPE.

			   Every row of SLOT_SHAPE sums to zero across the three slots, so
			   a nine-man rotation of three guards, three wings and three bigs
			   averages exactly what the flat bases averaged before. That is
			   load-bearing: the whole-field anchors in js/calibration.js (USG
			   20.2, TS 53.4, 3P 33.8, FT 70.6, ORtg 102.6) were fitted on the
			   flat bases, and shaping the rotation must redistribute those
			   numbers without moving them. */
			const d = SLOT_SHAPE[m.slotType || "wing"];
			return {
				/* 0.485 was fitted so the whole simulated field landed on the
				   D-I rotation anchor — but it was fitted while the prospects
				   being tested were drawn from a class averaging 0.450 on the
				   same composite. A realistically shaped draft class averages
				   0.394, and the 23% gap in the filler's favor is amplified by
				   USG_EXP into a large weight gap: real prospects were losing
				   possessions to invented teammates, which is the whole of the
				   class-level scoring shortfall. Usage is zero-sum inside a
				   roster, so the level of a class can only be raised here.

				   Usage carries NO slot offset on purpose: it is the one dial
				   the class's scoring level is set by, and tilting it by size
				   would move that level as a side effect of a positional fix. */
				usage: f(TUNING.FILLER_USAGE, 0.07),
				passing: f(0.45 + d.passing, 0.09), turnovers: f(0.47 + d.turnovers, 0.07),
				shootingAtRim: f(0.515 + d.rim, 0.09),
				shootingLowPost: f(0.45 + d.post, 0.09),
				shootingMidRange: f(0.455 + d.mid, 0.08),
				shootingThreePointer: f(0.505 + d.three, 0.10),
				rebounding: f(0.47 + d.rebounding, 0.10),
				stealing: f(0.48 + d.stealing, 0.07),
				blocking: f(0.45 + d.blocking, 0.10),
				drawingFouls: f(0.47 + d.drawingFouls, 0.08),
				defense: f(0.48, 0.08), fouling: f(0.47 + d.fouling, 0.08),
				defenseInterior: f(0.46 + d.defInt, 0.09),
				defensePerimeter: f(0.46 + d.defPer, 0.09),
				endurance: f(0.50, 0.09),
				// Athleticism reaches the steal share now, so a filler needs it
				// too — without it every returning player's steal weight came
				// out NaN and took the whole team steal pool with it.
				athleticism: f(0.48 + d.athleticism, 0.09),
				/* And ball-handling, for the same reason and with the same
				   symptom one field over: astdRate reads it, a filler did not
				   have it, and every filler line therefore carried
				   astdRate: NaN — 66,243 of them over twenty classes, exported
				   to the league file as null. Guards handle the ball; the slot
				   shape's passing offset is the only read the composite table
				   has on that. */
				dribbling: f(0.47 + d.passing, 0.09),
			};
		});

		/* One role draw per player, on its own rng stream so that changing
		   anything else about the run does not reshuffle who got the ball. The
		   same latent decides minutes and usage, because it is one fact about
		   the player and not two. */
		const roleMult = members.map((m, i) =>
			collegeRole(m, comps[i], cfg, rng.child("role|" + team.name + "|" + i)));
		const mins = allocateMinutes(members, rng, comps, env, roleMult);
		/* A 19-year-old at Real Madrid does not play 30 minutes, whatever his
		   talent says. Cap the prospects, hand the freed minutes back to the
		   senior professionals around them. */
		if (env.youthCap) {
			let freed = 0;
			for (let i = 0; i < members.length; i++) {
				if (members[i].filler) continue;
				/* The cap is the club's, not the league's: a per-player draw
				   around it, so the EuroLeague's nineteen-year-olds are not
				   all printed at 22.0 minutes to the decimal (61% of capped
				   prospects used to sit on the number exactly). */
				const cap = Math.max(8, env.youthCap +
					rng.child("ycap:" + (members[i].player ? members[i].player.key : i)).uniform(-3, 3));
				if (mins[i] > cap) { freed += mins[i] - cap; mins[i] = cap; }
			}
			if (freed > 0) {
				const takers = [];
				for (let i = 0; i < members.length; i++) if (members[i].filler) takers.push(i);
				const room = takers.reduce(
					(a, i) => a + Math.max(0, (env.mpgCap || 36) - mins[i]), 0);
				if (room > 0) {
					for (const i of takers) {
						mins[i] += freed * (Math.max(0, (env.mpgCap || 36) - mins[i]) / room);
					}
				}
			}
		}

		// Usage: high-usage players on weak teams shoot a lot more. Better
		// prospects also carry a bit more volume (lottery picks averaged
		// USG 24.3 vs 22.4 for picks 41+ in the 2009-21 data). The exponent is
		// steep because BBGM's usage composite only spans ~0.22-0.52 in a real
		// class — a shallow curve leaves the clamp doing all the separating.
		/* The size tilt is explicit and deliberate. BBGM's usage composite
		   weights `ins` at 1.5 and `hgt` at 0.5, so in a specialized class the
		   bigs win it outright and the sim produced centers scoring 13.6 a game
		   against guards' 10.9 — backwards for a draft class, where guards are
		   the volume scorers. This puts the ordering back without touching the
		   composite the rest of the model depends on. */
		const bignessOf = (i) => clamp((comps[i].blocking - 0.18) / 0.55, 0, 1);
		/* The tilt was strengthened (0.50 -> 0.85). It corrected the ORDERING of
		   raw usage and then the soft ceiling and the renormalization absorbed
		   most of it back: at equal overall rating a seven-footer and a guard
		   finished on the same 26% usage, so the big won the scoring title on
		   efficiency alone (58.7% from the floor against 45.2%) and outscored
		   the guard by 1.7 a game. Efficiency by size is right — real D-I
		   centers do shoot in the high fifties — so the fix is on the volume
		   side, where a draft class's guards really do carry more of the
		   offense than its centers. At 1.05 an overall-matched guard, wing and
		   center score within half a point of one another, with the guard
		   ahead — which is the ordering a draft board shows. */
		/* Role usage. BBGM's usage composite reads shot-making, not the role a
		   coach hands a player, so the archetype says what the composite
		   cannot — see ROLE_USAGE in js/ratings.js. Fillers have no archetype
		   and take 1. */
		/* The coach's philosophy, which was computed for every program and
		   read by nothing here: a stars-and-scrubs staff concentrates the
		   offense in its best players and an egalitarian one spreads it. It
		   moves the talent exponent, so the label is a fact about the box
		   score and not only about the coach's page. */
		const usageBias = team.coach && Number.isFinite(team.coach.usageBias)
			? clamp(team.coach.usageBias, -1.5, 1.5) : 0;
		const talentExp = TUNING.USG_TALENT_EXP * (1 + 0.22 * usageBias);
		const rawUsg = members.map((m, i) =>
			Math.pow(comps[i].usage + (m.filler ? 0 : (ctx.classRefVolume || 0)), TUNING.USG_EXP) *
				Math.pow(0.35 + 1.3 * (m.talent / 100), talentExp) *
				(1 + TUNING.USG_SIZE_TILT * (0.42 - bignessOf(i))) *
				CAL.talentUsageMult(m.talent) *
				roleMult[i],
		);
		let denom = 0;
		for (let i = 0; i < members.length; i++) denom += rawUsg[i] * mins[i];
		let usgShare = members.map((m, i) => (rawUsg[i] * mins[i]) / denom);

		// Physical envelope: while on the floor nobody uses more than USG_CAP of
		// team chances (Trae Young ran ~34%, Cam Thomas ~34%), and no DRAFTED
		// player disappears from the offense — the draft-year p5 is USG 17.8,
		// so prospects floor near 15.5% where fillers may fade to 10%. usgShare
		// is a share of *all* team chances, so the bounds scale with minutes.
		// Same soft saturation as minutes: 15% of prospects used to sit on
		// exactly USG 33.0, which erases the difference between a primary
		// option and a genuine offensive fulcrum. Again solved for the single
		// scale factor that makes the shares sum back to 1.
		// The ceiling is the player's, not the league's. A universal cap made
		// every good prospect converge on the same number.
		const bounds = members.map((m, i) => {
			const ms = mins[i] / gameMinutes;
			/* A personal floor. A class's 65th-best prospect really does floor
			   lower than its best, and giving every prospect the same one made
			   the asymptote a wall that 11.5% of a realistic class sat on. */
			/* The floor moves with the ROLE as well as with talent. Talent
			   alone spans barely three points of usage across a draft class,
			   so a talent-only floor is still one number to within a rounding
			   error and still piles a tenth of the class onto it — and making
			   it steeper in talent would buy the spread back by re-adding the
			   ovr ramp this whole change exists to remove. The role latent is
			   independent of overall rating by construction, so it widens the
			   floor without steepening anything. */
			const floorRate = m.filler
				? TUNING.USG_FLOOR_FILLER
				: TUNING.USG_FLOOR +
					TUNING.USG_FLOOR_TALENT * clamp((m.talent - 55) / 40, -0.5, 0.9) +
					TUNING.USG_FLOOR_ROLE * clamp(Math.log(Math.max(0.15, roleMult[i])), -1, 1) +
					TUNING.USG_FLOOR_COMP *
						clamp(comps[i].usage - TUNING.USG_COMP_REF,
							-TUNING.USG_FLOOR_COMP_DOWN, 0.16);
			const floor = floorRate * ms;
			/* The ceiling is the player's, not the league's. A universal cap made
			   every good prospect converge on the same number.

			   The intercept came down (0.268 -> 0.253) because the cap was only
			   ever binding for one population: a prospect at a weak program,
			   where nobody else can take a shot. High-major prospects average
			   25% usage and never reach it; mid-major ones sat on it, which is
			   most of why the same overall rating produced 16.7 points a game
			   in one conference and 21.2 in another. */
			/* Softplus at the bottom rather than a clamp. The old
			   clamp(..., 0.195, USG_CAP) gave every player whose computed
			   ceiling fell below 0.195 exactly 0.195, and the saturating curve
			   then pushed them all towards it: 12.5% of a class landed in
			   [18.5, 20.0] on that one bound. Softplus has the same asymptote
			   and no two players on it. */
			/* Each population against its own reference. See FILLER_CEIL_REF
			   for what reading a returning player against the prospects'
			   0.384 did to the whole envelope. */
			const ceilRef = m.filler ? TUNING.FILLER_CEIL_REF : TUNING.USG_COMP_REF;
			const raw = TUNING.USG_CEIL_BASE +
				TUNING.CEIL_COMP * clamp(comps[i].usage - ceilRef, -0.16, 0.16) +
				TUNING.CEIL_TALENT * ((m.talent - 55) / 45) + 0.105 * (0.42 - bignessOf(i)) +
				TUNING.CEIL_ROLE * Math.log(Math.max(0.15, roleMult[i]));
			const band = TUNING.USG_CEIL_BAND;
			const soft = (x, edge, w, up) => {
				// Smooth one-sided bound: softplus above `edge` when up, its
				// mirror below when not. Approaches the bound asymptotically,
				// so nobody ever lands exactly on it.
				const z = (up ? x - edge : edge - x) / w;
				const v = w * (z > 30 ? z : Math.log1p(Math.exp(z)));
				return up ? edge + v : edge - v;
			};
			/* Both bounds are soft. USG_CAP was still a hard clamp, and a hard
			   clamp is a wall wherever it binds: once the personal ceiling
			   picked up enough spread to be worth having, 5.2% of the class
			   landed on exactly 36.5% usage. */
			const personal = soft(
				soft(raw, TUNING.USG_CEIL_MIN, band, true),
				TUNING.USG_CAP, TUNING.USG_CAP_BAND, false,
			);
			return {
				floor,
				band: Math.max(1e-9, floor * TUNING.USG_FLOOR_BAND),
				ms,
				personal,
				room: Math.max(1e-6, personal * ms - floor),
			};
		});
		/* RELAX THE CEILINGS, DO NOT RESCALE THE ANSWER.

		   sum(personal ceiling * minute share) is the most usage this rotation
		   can account for, and nothing in the model constrains it to reach 1 —
		   the ceilings are per-player bounds fitted one player at a time. When
		   it lands short the bisection below has no interior solution: the
		   bracket fails high, the softened shares sum to less than 1, and the
		   renormalize at the bottom of this block divides everyone up past
		   their own ceiling. That is the wrong repair in two ways. It is
		   applied AFTER the soft saturation, so it lands hardest on exactly
		   the players the saturation had bent back; and it is a statement
		   about a team applied to individuals, which is what made the personal
		   ceiling inoperative on two thirds of all rosters.

		   Scaling the ceilings up first is the same arithmetic run in the
		   right order: every bound moves by one factor, their ORDERING and
		   their SPREAD are preserved (the factor is common), and the solve
		   that follows is a genuine interior one, so USG_CAP and the rest mean
		   what they say for everybody. The factor is measured and counted, so
		   how often a rotation cannot afford its own ceilings is a visible
		   fact rather than something inferred from a renormalize firing. */
		{
			let ceilTotal = 0;
			for (const b of bounds) ceilTotal += b.personal * b.ms;
			if (ceilTotal < TUNING.USG_CEIL_BUDGET) {
				CONVERGENCE.usageCeilingShort++;
				const g = ceilTotal > 1e-9 ? TUNING.USG_CEIL_BUDGET / ceilTotal : 1;
				for (const b of bounds) {
					b.personal *= g;
					b.room = Math.max(1e-6, b.personal * b.ms - b.floor);
				}
			}
		}
		/* Saturating at BOTH ends. Above the floor the curve bends towards the
		   player's personal ceiling; below it, it bends towards floor - band
		   instead of clamping flat onto the floor. Both branches have slope 1
		   at the floor, so the map stays continuous, monotone and smooth and
		   the bisection below is still valid — and a genuine 12%-usage role
		   player is still ordered below a 15% one instead of both printing the
		   same number. */
		const softUsg = (v, i) => {
			const b = bounds[i];
			if (v <= b.floor) return b.floor - b.band * (1 - Math.exp(-(b.floor - v) / b.band));
			return b.floor + b.room * (1 - Math.exp(-(v - b.floor) / b.room));
		};
		const usgTotalAt = (k) => usgShare.reduce((a, s, i) => a + softUsg(s * k, i), 0);
		let ulo = 0.05;
		let uhi = 60;
		/* The bracket has to actually bracket. On a pathological roster the
		   solution can sit outside [0.05, 60] and the bisection would silently
		   return the bound; count it (see CONVERGENCE) so it is a visible
		   fact rather than a quiet wrong answer. */
		if (usgTotalAt(uhi) < 1 || usgTotalAt(ulo) > 1) CONVERGENCE.usageBisectionAtBound++;
		for (let i = 0; i < 60; i++) {
			const mid = (ulo + uhi) / 2;
			if (usgTotalAt(mid) < 1) ulo = mid;
			else uhi = mid;
		}
		const uk = (ulo + uhi) / 2;
		usgShare = usgShare.map((s, i) => softUsg(s * uk, i));
		/* When the bracket did not bracket, the soft bounds have left the
		   team's shares summing short (a 0.976 team boxed 2.4% light);
		   renormalize proportionally rather than shipping the shortfall. */
		{
			const tot = usgShare.reduce((a, b) => a + b, 0);
			CONVERGENCE.teamSeasons++;
			if (tot > 0 && Math.abs(tot - 1) > 0.004) {
				CONVERGENCE.usageRenormalized++;
				usgShare = usgShare.map((s) => s / tot);
			}
		}

		// Team support = quality of the other four guys on the floor.
		const teamMinutes = 5 * gameMinutes;
		const teamTalent = members.reduce((a, m, i) => a + m.talent * mins[i], 0) / teamMinutes;

		// Pace: D-I takes the slider, every other league takes its own. The
		// slider is labeled "College season", and it used to silently rewrite
		// EuroLeague and G League box scores.
		const stylePace = (team.style && team.style.pace) || 0;
		const pace = env.pace !== null && env.pace !== undefined
			? clamp(env.pace + (cfg.scoringEnv || 0) * 1.2 + stylePace, 50, 115)
			: clamp(cfg.pace + cfg.scoringEnv * 1.6 + stylePace, 58, 78);
		// Chances exceed possessions by the team's offensive rebounds; solve
		// chances = poss + orbRate * missShare * chances for the multiplier.
		// One pass on a nominal ORB rate, then refine with the roster's own.
		/* The share of shots that miss, for this team and for the schedule it
		   faced. Both were the hardcoded 0.44 while the sim shot .472 from the
		   floor. `oppFg` is the field-goal percentage of the opponents this
		   team actually played, which the engine works out from their rosters. */
		const missShare = clamp(1 - (ctx.teamFg || CAL.chanceShape().fgp), 0.42, 0.64);
		const oppMissShare = clamp(1 - (ctx.oppFg || (1 - missShare)), 0.42, 0.64);
		const poolEnv = { missShare, oppMissShare };
		/* chances = poss + ORB, and an offensive rebound comes off a MISSED FIELD
		   GOAL, so ORB = orbRate * ORB_FT * missShare * FGA and FGA is the
		   era's field-goal share of a chance:

		       chanceMult = 1 / (1 - orbRate * fgaShare * missShare * ORB_FT)

		   The old form took offensive rebounds off every chance rather than off
		   missed shots — turnovers and free-throw trips included — which put
		   the multiplier at 1.18 where the real ratio is 1.14, and inflated
		   every rebound total in the sim by a third. */
		const shape = CAL.chanceShape();
		const mult = (orbRate) =>
			clamp(1 / (1 - orbRate * shape.fgaShare * missShare * TUNING.ORB_FT), 1.05, 1.24);
		/* The team's pace jitter, drawn BEFORE the pools are sized. The pools
		   used to be computed at the nominal pace while statLine read the
		   jittered one, so a team that drew fast (±~3% of possessions) took
		   more shots against assist, rebound and block pools sized for the
		   slow pace — a drift in implied team ORB% and AST/FGM that no band
		   caught, because individual lines are recomputed from attempts. */
		const paceAdj = rng.normal(0, 2.0);
		const jitteredPace = env.pace !== null && env.pace !== undefined
			? clamp(pace + paceAdj, 50, 118)
			: clamp(pace + paceAdj, 58, 78);
		let chanceMult = mult(TUNING.ORB_RATE);
		let pools = teamPools(comps, mins, jitteredPace, chanceMult, gameMinutes, poolEnv);
		chanceMult = mult(pools.orbRate);
		pools = teamPools(comps, mins, jitteredPace, chanceMult, gameMinutes, poolEnv);
		/* Defensive emphasis: a defensive-minded staff forces a few more
		   turnovers and contests a few more shots; an uptempo one gives some
		   of that back. A few percent, which is what a scheme is worth. */
		if (team.coach && Number.isFinite(team.coach.defEmphasis) && team.coach.defEmphasis) {
			const d = clamp(team.coach.defEmphasis, -1, 1.5);
			pools.stlPool *= 1 + 0.05 * d;
			pools.blkPool *= 1 + 0.04 * d;
		}

		/* Team-level variance lives on the pool, not on the individual draws.
		   The per-player jitter used to be the only source of it, which meant
		   the reconciliation below would have flattened it away. */
		const teamNoise = clamp(cfg.statNoise, 0, 3);
		for (const key of ["astPool", "stlPool", "blkPool", "orbPool", "drbPool", "pfPool"]) {
			pools[key] = Math.max(0, pools[key] * (1 + rng.normal(0, 0.05 * teamNoise)));
		}

		const teamCtx = Object.assign({
			games: ctx.games,
			paceAdj,
			support: teamTalent,
			chanceMult,
			env,
			style: team.style || { three: 0, rim: 0, press: 0, pace: 0 },
			rebDen: 0, orbDen: 0, astDen: 0, stlDen: 0, blkDen: 0, pfDen: 0,
		}, pools);
		// The pace this team actually plays at, jitter included — the SAME
		// number the pools above were sized with, so statLine and teamPools
		// agree by construction.
		teamCtx.pace = jitteredPace;
		/* Published, so the award model can normalize a counting-stat resume
		   for tempo. PROGRAM_STYLES moves possessions by +/-5.5 a game and
		   productionScore was raw per-game volume, which tilted the entire
		   honors list towards run-and-gun schools. */
		team.pace = teamCtx.pace;
		/* The rating rows the stat model reads, built once. statLine only needs
		   hgt, ft, tp and pss off a ratings row (everything else comes from the
		   composites), so a filler needs just those four — but they have to
		   exist BEFORE the denominator loop, because the assist share is read
		   partly off the raw passing rating and the numerator and denominator
		   have to agree. Height is backed out of the blocking composite, which
		   is mostly height by construction. */
		/* Filler ft and tp were the flat constants 43 and 45, so all ~3,300
		   returning players in the country shot from the identical raw ratings
		   — no 90% free-throw shooter, no 48% big — while their composites
		   varied. Backed out of the shooting composites the filler already
		   drew (deterministic, no extra rng draws), centered on each filler's
		   own talent-scaled expectation so the FIELD mean stays exactly on
		   the calibration anchors (43 and 45) while individual fillers spread
		   ±6-8 rating points around them. */
		const ratingRows = members.map((m, i) => {
			if (!m.filler) return m.player.newRatings;
			const tscale = 0.55 + 0.9 * (m.talent / 100);
			const dMid = comps[i].shootingMidRange - 0.455 * tscale;
			const dTp = comps[i].shootingThreePointer - 0.505 * tscale;
			return {
				/* The slot's own height, now that a filler has one. It used to
				   be inferred from the blocking composite, which made every
				   good shot-blocker tall and every tall man a shot-blocker —
				   and, with the composite flat across the roster, made every
				   returning player the same 6'6". */
				hgt: Number.isFinite(m.hgt)
					? m.hgt : clamp(30 + 55 * comps[i].blocking * 0.8, 5, 95),
				ft: clamp(43 + 40 * dMid + 35 * dTp, 5, 95),
				tp: clamp(45 + 80 * dTp, 5, 95),
				pss: clamp(comps[i].passing * 100, 5, 95),
				/* A filler needs `stre` and `dnk` for the same reason it
				   needed `ft` and `tp`: the rebound box-out weight, the foul
				   weight and the rim term all read them now, and a returning
				   player without them would take the neutral default while
				   every prospect took a real rating — which is a systematic
				   tilt, not a missing field. Backed out of the composites the
				   filler already drew (deterministic, no extra rng draws) and
				   centered on each filler's own talent-scaled expectation, so
				   the FIELD mean stays at 45 while individuals spread around
				   it. `athleticism` is the composite that carries strength at
				   the highest weight (1 of 3.75); `shootingAtRim` is the one
				   that carries dunking (0.3 of 2.8), which is why the
				   back-out slope on dnk is the steeper of the two. */
				stre: clamp(45 + 110 * (comps[i].athleticism - 0.48 * tscale), 5, 95),
				dnk: clamp(45 + 160 * (comps[i].shootingAtRim - 0.515 * tscale), 5, 95),
			};
		});

		for (let i = 0; i < members.length; i++) {
			const ms = mins[i] / gameMinutes;
			// Same reference the line itself will use, or the shares would not
			// sum to the pool.
			const cr = members[i].filler ? 0 : (ctx.classRefVolume || 0);
			const cm = members[i].filler ? null : (ctx.classRefMult || null);
			// bigness exactly as statLine computes it, or the shares would not
			// sum to the pool the denominator was built from.
			const bg = clamp((ratingRows[i].hgt - 30) / 55, 0, 1);
			/* The same identity and orbBias multipliers the line will use, or
			   the shares would not sum to the pool the denominator was built
			   from — the one invariant every stat in this file depends on. */
			const id = members[i].filler
				? { reb: 1 }
				: archetypeIdentity(members[i].player.archetype, cfg);
			const ob = members[i].filler
				? 0 : clamp(members[i].player.orbBias || 0, -0.12, 0.12);
			/* The same strength the line will read, or the shares would not
			   sum to the pool the denominator was built from. */
			const st = clamp((Number.isFinite(ratingRows[i].stre)
				? ratingRows[i].stre : 45) / 100, 0, 1);
			teamCtx.rebDen += rebWeight(comps[i], ms, false, cm, bg, st) *
				id.reb * (1 - 0.9 * ob);
			teamCtx.orbDen += rebWeight(comps[i], ms, true, cm, bg, st) *
				id.reb * (1 + 2.4 * ob);
			teamCtx.astDen += astWeight(comps[i], ratingRows[i], ms, cm);
			teamCtx.stlDen += stlWeight(comps[i], ms, cm, cr);
			teamCtx.blkDen += Math.pow(comps[i].blocking, TUNING.BLK_EXP) * ms;
			teamCtx.pfDen += Math.pow(comps[i].fouling, TUNING.PF_EXP) * Math.pow(ms, 0.82) *
				Math.max(0.4, 1 + TUNING.PF_STRE * (st - 0.45));
		}

		const out = [];
		const field = [];
		const lines = [];
		const totals = {
			pts: 0, fga: 0, fta: 0, tov: 0, orb: 0, trb: 0, ast: 0, poss: 0,
			stl: 0, blk: 0, pf: 0, cs: 0, defl: 0,
		};
		for (let i = 0; i < members.length; i++) {
			const m = members[i];
			// Fillers get a line too — not to show anyone, but so the team
			// totals (points, FGA, possessions) are real numbers the calibration
			// harness can check. Per-player rate bands cannot catch a broken
			// possession model; team points per game can.
			const seed = m.filler
				? "fillerstat|" + team.name + "|" + i
				// The stat-noise axis of a per-player reroll: same build, same
				// school, a different set of nights.
				: "stat:" + m.player.key + (m.player.statSalt || "");
			const line = statLine(
				rng.child(seed), ratingRows[i], comps[i], mins[i], usgShare[i], ctx, cfg,
				teamCtx, {
					talent: m.talent,
					filler: !!m.filler,
					year: m.filler ? null : classYearIndex(m.player.classYear),
					availability: m.filler ? null : m.player.availability,
					// See bendOf / SURPRISES: a per-player bend on the season,
					// as distinct from a change to the player.
					statBend: m.filler ? null : m.player.statBend,
					// The build, so the parts of a stat line BBGM's composites
					// cannot see (see archetypeIdentity) can read it.
					archetype: m.filler ? null : m.player.archetype,
					/* The trait layer's one stat-model effect: which half of
					   the glass this man lives on. See js/traits.js — "chases
					   his own miss" against "boxes out" is a real and visible
					   difference between two players with the same rebounding
					   composite, and the model could not express it. */
					orbBias: m.filler ? 0 : (m.player.orbBias || 0),
				},
			);
			lines.push(line);
			totals.pts += line.ppg;
			totals.fga += line.fga;
			totals.fta += line.fta;
			totals.tov += line.topg;
			totals.orb += line.orpg;
			totals.trb += line.rpg;
			totals.ast += line.apg;
			totals.stl += line.spg;
			totals.blk += line.bpg;
			totals.pf += line.pfpg;
			totals.cs += line.cspg;
			totals.defl += line.deflpg;
			if (m.filler) {
				/* Filler lines were computed and discarded. They are the whole
				   of Division I outside this draft class, and keeping them
				   means the award model can rank prospects against real
				   simulated seasons instead of against a linear regression on
				   talent — which is what it used to do, and which badly
				   understated a weak team's best player (extrapolating the
				   prospects-only fit down to talent 30 predicted a scoring
				   line of roughly zero for a low-major's leading scorer). */
				field.push({ talent: m.talent, rotationIndex: i, mpg: mins[i], line,
					// Identity, so an award a returner wins can name him —
					// and a key, so a link can reach him. Star returners
					// took trophies under a name that nothing could click.
					key: "field:" + team.name + ":" + i,
					name: m.name, classYear: m.classYear || null,
					starReturner: m.starReturner || null });
				continue;
			}
			m.player.stats = line;
			m.player.teamPace = teamCtx.pace;
			// Where he sits in his own rotation, which is what makes a Sixth
			// Man of the Year candidate a reserve rather than a starter.
			m.player.minutesRank = mins
				.filter((v, j) => v > mins[i] || (v === mins[i] && j < i)).length;
			m.player.teamShare = {
				ast: line.apg, reb: line.rpg, blk: line.bpg, stl: line.spg,
			};
			out.push({ player: m.player, line });
		}
		/* Enforce the documented caps against the TEAM TOTAL, which is what the
		   comment has always claimed and what anybody reading the output would
		   check.

		   Saturating each player's raw share against the pool was not enough:
		   the per-player noise means the realized team total is not the pool,
		   so a player capped at 62% of the pool could still finish with 67% of
		   what his team actually recorded — measured 0.672 of team assists
		   against a documented 0.62, and 0.429 of team rebounds against 0.40.

		   One pass here renormalizes each category to its pool (so the team
		   total IS the pool) and then clips the tail at the cap, handing the
		   clipped surplus to the players with room. Below the cap nothing
		   moves, so the distribution keeps the shape statLine gave it. */
		reconcileTeamTotals(lines, pools, gameMinutes);
		/* And then answer to the SCOREBOARD.

		   A team's points existed three times over and no two of them agreed:
		   the stat pool summed its rotation to one number, teamBox summed the
		   same lines to a second, and js/teams.js had already played thirty-one
		   games whose final scores said a third. Measured over 3,640
		   team-seasons the box said 73.4 and the season the team actually
		   played said 70.6, 1,231 of them differed by more than five points,
		   and the worst was off by twenty-one — a program whose box score and
		   whose results page described different teams. Everything that is a
		   DIFFERENCE between the two (net rating, plus/minus, on/off, both team
		   ratings) inherited the gap: the country netted +3.6 a hundred
		   possessions on a true margin of -0.19.

		   The scoreboard is the one of the three with a season behind it, so
		   it wins: one factor over the whole rotation puts the pool's points on
		   the points the team actually scored. One factor and not a per-player
		   fit because the SHARES are the stat model's answer and are not in
		   question — only the total is. Percentages are untouched (attempts and
		   makes move together), and the bound keeps a freak schedule from
		   rewriting a rotation rather than correcting it. */
		anchorPointsToScoreboard(lines, team);
		totals.ast = 0; totals.stl = 0; totals.blk = 0; totals.pf = 0;
		totals.orb = 0; totals.trb = 0; totals.tov = 0;
		// Points and the attempts behind them are re-summed too: the anchor
		// above moved them, and they were accumulated as the lines were built.
		totals.pts = 0; totals.fga = 0; totals.fta = 0;
		for (const line of lines) {
			totals.pts += line.ppg;
			totals.fga += line.fga;
			totals.fta += line.fta;
			totals.ast += line.apg;
			totals.stl += line.spg;
			totals.blk += line.bpg;
			totals.pf += line.pfpg;
			totals.orb += line.orpg;
			totals.trb += line.rpg;
			totals.tov += line.topg;
		}
		totals.poss = totals.fga - totals.orb + totals.tov + FT_TRIP * totals.fta;
		team.teamTotals = totals;
		/* The same totals as a full box score — makes as well as attempts, and
		   the defensive glass. `teamTotals` is what the calibration harness
		   and the award model read and it carries only what they needed;
		   BBGM's advanced statistics are all ratios against a complete team
		   line, so the export needs one (see js/bbgmstats.js). Per game, like
		   teamTotals, and built from the same reconciled lines. */
		team.box = teamBox(lines, ctx.games, gameMinutes);
		/* Every line the box was summed from, prospects and returning players
		   alike, in rotation order. BBGM's advanced statistics are defined on a
		   whole roster (PER is normalized against the field, BPM adjusts to the
		   team's own rating), so an export that writes them needs the rotation
		   and not only its total. */
		team.lines = lines;
		team.fieldPlayers = field;
		team.defense = defenseProfile(comps, mins, teamMinutes, gameMinutes);
		// Team defensive efficiency: points allowed per 100 possessions, read
		// off the scores the team actually gave up.
		const paAvg = team.log && team.log.length
			? team.log.reduce((a, g) => a + (g.oppPts || 0), 0) / team.log.length
			: null;
		team.oppPpg = paAvg;
		team.defRtg = paAvg !== null && totals.poss > 0
			? (100 * paAvg) / totals.poss
			: null;
		team.offRtg = totals.poss > 0 ? (100 * totals.pts) / totals.poss : null;
		// Each prospect's share of the team totals, for the award model and the
		// share-cap regression checks.
		for (const o of out) {
			o.player.shareOf = {
				ast: totals.ast > 0 ? o.line.apg / totals.ast : 0,
				reb: totals.trb > 0 ? o.line.rpg / totals.trb : 0,
				blk: totals.blk > 0 ? o.line.bpg / totals.blk : 0,
				stl: totals.stl > 0 ? o.line.spg / totals.stl : 0,
				pts: totals.pts > 0 ? o.line.ppg / totals.pts : 0,
			};
		}
		return out;
	}

	/* A team's complete per-game box score, summed off the rotation's own stat
	   lines. Everything here is per game and rounds to nothing: the export
	   multiplies by the games played to get the season totals BBGM's advanced
	   statistics are defined on. `min` comes out at 5 * gameMinutes by
	   construction, because that is how the minutes were allocated. */
	function teamBox(lines, games, gameMinutes) {
		const box = {
			gp: Math.max(1, Math.round(games || 0)),
			// The night's length, so the advanced statistics can normalize a
			// forty-eight-minute club and a thirty-two-minute prep team each
			// on its own clock.
			gameMinutes: gameMinutes || 40,
			min: 0, fg: 0, fga: 0, tp: 0, tpa: 0, ft: 0, fta: 0,
			orb: 0, drb: 0, trb: 0, ast: 0, tov: 0, stl: 0, blk: 0, pf: 0, pts: 0,
		};
		for (const L of lines) {
			box.min += L.mpg;
			box.fga += L.fga;
			box.fg += L.fga * L.fgp;
			box.tpa += L.tpa;
			box.tp += L.tpa * L.tpp;
			box.fta += L.fta;
			box.ft += L.fta * L.ftp;
			box.orb += L.orpg;
			box.drb += L.drpg;
			box.trb += L.rpg;
			box.ast += L.apg;
			box.tov += L.topg;
			box.stl += L.spg;
			box.blk += L.bpg;
			box.pf += L.pfpg;
			box.pts += L.ppg;
		}
		box.poss = box.fga - box.orb + box.tov + FT_TRIP * box.fta;
		// Possessions per game IS the pace when a game is one game long; the
		// distinction matters only for overtime, which the log carries and
		// these season averages do not.
		box.pace = box.poss;
		box.gameMinutes = gameMinutes;
		return box;
	}

	/* Renormalize one category to its pool, then clip the tail at `cap` of the
	   team total and redistribute the surplus to everyone with room. */
	function fitToPool(values, pool, cap) {
		/* Clipped first, and the sum taken from the clipped values.

		   A negative input would make its own renormalized share negative and
		   would also shrink the denominator, inflating everyone else — and a
		   set that summed to zero because its negatives canceled its
		   positives took the early return and came back unchanged, negatives
		   included. Nothing upstream produces a negative; clipping here means
		   nothing downstream has to assume that. */
		const clipped = values.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
		let sum = 0;
		for (const v of clipped) sum += v;
		if (sum <= 1e-9 || pool <= 0) return clipped;
		const out = clipped.map((v) => (v * pool) / sum);
		const lim = pool * cap;
		/* ITERATE TO A RESIDUAL, NOT TO A PASS COUNT.

		   The loop was `for (iter < 6)` with the comment "six passes has
		   always been enough in practice". It was not: instrumented over
		   4,368 team-seasons the counter below fired 6,780 times, about 1.5
		   non-convergences per team-season. Every one of them is a silently
		   violated share cap — AST_CAP, REB_CAP and BLK_CAP are documented
		   ceilings, and the redistribution step hands the clipped surplus to
		   players who may themselves then breach the cap, so a single pass
		   trades one violation for several smaller ones. Measured
		   consequences: team AST/FGM reached 0.812 against a real D-I ceiling
		   of ~0.68, and team blocks reached 10.4 a game against a real
		   maximum near 7.

		   And the test itself was wrong, which is the deeper half of it.
		   `excess < 1e-9` is UNREACHABLE by construction: softCeil is
		   asymptotic, so it shaves something off every value above its knee
		   (lim * 0.88) forever, and the redistribution step then pushes the
		   receivers back above that knee. The excess therefore settles at a
		   small positive constant and the old test could not be satisfied on
		   any roster carrying a player near the cap, however many passes it
		   was given — the loop was not failing to converge, it was being asked
		   a question with no answer. Measured: raising the pass count alone
		   moved the count 6,780 -> 6,760.

		   What DOES converge is the vector. Each pass is a contraction (it
		   moves at most the previous excess, spread over strictly positive
		   headroom), so the per-player movement over a whole pass falls
		   geometrically to zero and the iteration settles on a fixed point at
		   which the shave and the redistribution exactly cancel. That is the
		   residual to test. TOL is a millionth of a per-game unit, far below
		   anything the export prints; 25 is the safety stop, not the expected
		   cost — ordinary rosters settle in 3-8 passes. */
		/* And the residual is the FIXED POINT, not the excess.

		   `excess < 1e-9` was unreachable by construction, which is the real
		   reason the counter fired 1.5 times per team-season: softCeil is
		   asymptotic, so it shaves something off every value above its knee
		   (lim * 0.88) forever, and the redistribution step then pushes the
		   receivers back above the knee. The excess therefore settles at a
		   small POSITIVE constant and the old test could never be satisfied on
		   any roster with a player near the cap — the loop was not failing to
		   converge, it was being asked the wrong question.

		   What converges is the vector: each pass is a contraction, so the
		   per-player movement falls geometrically to zero. Terminate on that.
		   TOL is a millionth of a per-game unit — far below anything the
		   export prints. 25 is the safety stop, not the expected cost
		   (ordinary rosters finish in 4-8). */
		/* The tolerance is RELATIVE to the pool, because the residual is in
		   the pool's own units, and it is 2e-4 rather than something
		   arbitrarily small because that is where the residual stops meaning
		   anything: 2e-4 of a team's assist pool is a thousandth of an assist
		   a game, three orders of magnitude below the per-player jitter that
		   produced the values and two below the last digit any export prints.

		   It is not set tighter because the approach to the fixed point is
		   asymptotic and slow — measured, the per-pass movement decays like
		   1/iter, not geometrically, because softCeil's shave near its knee is
		   very nearly linear in the excess. Chasing 1e-6 would cost hundreds
		   of passes to move a hundredth of a rebound. What the loop is
		   actually for does hold at this tolerance and was checked directly:
		   over 554 previously-"unconverged" fits, ZERO values exceeded their
		   cap at exit and the fitted total matched the pool to 1e-6. An
		   absolute floor keeps a near-empty pool (a team that blocks nothing)
		   from spending the pass budget on numbers that round to zero. */
		const TOL = Math.max(1e-7, 2e-4 * pool);
		let converged = false;
		let prev = out.slice();
		for (let iter = 0; iter < 25; iter++) {
			let excess = 0;
			for (let i = 0; i < out.length; i++) {
				// Soft, so the men at the top of a category are spread over
				// the last few percent of the cap instead of stacked on it.
				const v = softCeil(out[i], lim);
				if (v < out[i]) { excess += out[i] - v; out[i] = v; }
			}
			if (excess < TOL) { converged = true; break; }
			let room = 0;
			for (const v of out) room += Math.max(0, lim - v);
			if (room < 1e-9) { converged = true; break; } // everyone at cap: done
			for (let i = 0; i < out.length; i++) {
				out[i] += (excess * Math.max(0, lim - out[i])) / room;
			}
			// The residual is the movement of the VECTOR over a whole pass.
			let moved = 0;
			for (let i = 0; i < out.length; i++) {
				const d = Math.abs(out[i] - prev[i]);
				if (d > moved) moved = d;
				prev[i] = out[i];
			}
			if (moved < TOL) { converged = true; break; }
		}
		// A non-convergence at 25 passes is a real pathology, not a tuning
		// artifact; the counter makes it countable instead of silent.
		if (!converged) CONVERGENCE.fitToPoolUnconverged++;
		return out;
	}

	/* Solver health, aggregated per page load. tools/validate.js and the
	   batch harness can read (and reset) these; a non-zero count is a fact
	   about the run that used to be invisible. */
	/* `usageCeilingShort` counts the rotations whose personal usage ceilings
	   could not between them account for USG_CEIL_BUDGET of the team's own
	   chances, and were therefore scaled up before the bisection — see the
	   block above it in simulateTeamStats. It replaces inferring the same fact
	   from how often the post-solve renormalize fired, which was 65.4% of
	   team-seasons and was reported nowhere. */
	const CONVERGENCE = {
		usageBisectionAtBound: 0, fitToPoolUnconverged: 0, usageCeilingShort: 0,
		teamSeasons: 0, usageRenormalized: 0,
		/* Must stay 0. See the re-floor in reconcileTeamTotals: it is an
		   assertion about five functions agreeing, not a repair. */
		negativeRebounds: 0,
	};

	/* An ABSOLUTE per-40-minute ceiling, on top of the share cap.

	   REB_CAP and AST_CAP are shares of a team pool, so on a low-pool team the
	   share cap binds late and the multiplicative jitter on top of it (0.14 on
	   offensive rebounds) widens the tail further. Measured over ten classes:
	   a maximum of 17.1 rebounds and 10.9 assists a game, and a Pick-and-Roll
	   Maestro at 45 overall printing 8.8 assists and 6.8 rebounds in 29
	   minutes. Real draft-class maxima run 12-13 rebounds and 8-9 assists.

	   A share cap cannot express "no college player rebounds at this rate",
	   because that is a statement about a player and not about his team. This
	   is that statement. The surplus is handed to teammates with room, exactly
	   as fitToPool does, so the team total is unchanged and the pool identity
	   the calibration harness checks still holds. */
	function clipPer40(lines, key, per40Cap, gameMinutes) {
		const gm = gameMinutes || 40;
		const limit = lines.map((l) => Math.max(0, per40Cap * ((l.mpg || 0) / gm)));
		let surplus = 0;
		for (let i = 0; i < lines.length; i++) {
			const v = lines[i][key] || 0;
			const s = softCeil(v, limit[i]);
			if (s < v) { surplus += v - s; lines[i][key] = s; }
		}
		if (surplus <= 1e-9) return;
		let room = 0;
		for (let i = 0; i < lines.length; i++) {
			room += Math.max(0, limit[i] - (lines[i][key] || 0));
		}
		if (room <= 1e-9) return;
		const share = Math.min(1, surplus / room);
		for (let i = 0; i < lines.length; i++) {
			lines[i][key] += Math.max(0, limit[i] - (lines[i][key] || 0)) * share;
		}
	}

	/* Put the rotation's points on the points the team's own results say it
	   scored. `team.log` is the season js/teams.js played; a team with no
	   season behind it (a prior year that was never scheduled) keeps the
	   pool's own answer, which is all there is.

	   Only the scoring volume moves — attempts and makes by the same factor,
	   so every shooting percentage, every share and every non-scoring stat is
	   exactly what the stat model said. Bounded at ±15%: past that the
	   disagreement is not a reconciliation, and a rotation should not be
	   rewritten to chase one. */
	function anchorPointsToScoreboard(lines, team) {
		const log = team && team.log;
		if (!log || !log.length || !lines.length) return;
		let pf = 0;
		let n = 0;
		for (const g of log) {
			if (Number.isFinite(g.teamPts)) { pf += g.teamPts; n++; }
		}
		if (!n) return;
		let pts = 0;
		for (const l of lines) pts += l.ppg || 0;
		if (pts <= 1e-9) return;
		const k = clamp((pf / n) / pts, 0.85, 1.15);
		if (Math.abs(k - 1) < 1e-6) return;
		for (const l of lines) {
			l.ppg *= k; l.fga *= k; l.tpa *= k; l.fta *= k;
		}
	}

	function reconcileTeamTotals(lines, pools, gameMinutes) {
		const set = (key, pool, cap) => {
			const fitted = fitToPool(lines.map((l) => l[key]), pool, cap);
			lines.forEach((l, i) => { l[key] = fitted[i]; });
		};
		set("apg", pools.astPool, TUNING.AST_CAP);
		set("spg", pools.stlPool, TUNING.STL_CAP);
		set("bpg", pools.blkPool, TUNING.BLK_CAP);
		// Rebounds are capped on the total, so the two halves are fitted to
		// their own pools first and then the combined line is clipped.
		/* Personal fouls. statLine computed them, totals summed them and this
		   function fitted everything except them, so team fouls answered to
		   nothing: measured 15.2 against the model's own 16.6 target. */
		/* Fouls carry a second, ABSOLUTE ceiling on top of the share cap: the
		   team-noise pass above can inflate pfPool ~10%, and PF_CAP of an
		   inflated pool walked one player back over 4.5 a game — past the
		   number that ends a night. 3.9 is just above the real D-I
		   leader's 3.6-3.8. */
		set("pfpg", pools.pfPool,
			Math.min(TUNING.PF_CAP, 4.1 / Math.max(1e-9, pools.pfPool)));
		/* Turnovers: fixed at the rate level long ago, but the team total was
		   still unconstrained the same way fouls were before pfpg was added
		   here. A generous cap — one player CAN commit a third of a team's
		   turnovers. */
		if (Number.isFinite(pools.toPool)) set("topg", pools.toPool, 0.34);
		set("orpg", pools.orbPool, 0.75);
		set("drpg", pools.drbPool, 0.60);
		const rebPool = pools.orbPool + pools.drbPool;
		const totalReb = lines.map((l) => l.orpg + l.drpg);
		const fitted = fitToPool(totalReb, rebPool, TUNING.REB_CAP);
		lines.forEach((l, i) => {
			const before = totalReb[i];
			const k = before > 1e-9 ? fitted[i] / before : 1;
			l.orpg *= k;
			l.drpg *= k;
			/* Re-floor after the rescale — as a COUNTED assertion, not a
			   silent clamp. statLine floors every stat at zero and every step
			   between here and there preserves it (fitToPool only ever scales
			   by a positive factor and redistributes into headroom), so this
			   cannot currently fire. But "cannot currently" is a property of
			   five functions agreeing, and the argument this file makes
			   everywhere else about walls and clamps applies here too: a clamp
			   that silently repairs an impossible value is a clamp that hides
			   the day the five functions stop agreeing. Counting it costs one
			   branch on top of the two comparisons and makes the failure a
			   fact a harness can read, exactly like the two solver counters. */
			if (l.orpg < 0 || l.drpg < 0) CONVERGENCE.negativeRebounds++;
			l.orpg = Math.max(0, l.orpg);
			l.drpg = Math.max(0, l.drpg);
			l.rpg = l.orpg + l.drpg;
		});
		/* The absolute ceilings, last, so nothing downstream can walk a line
		   back over them. Rebounds are clipped on the total and the two halves
		   are rescaled to match, the same way the share cap above works. */
		clipPer40(lines, "apg", TUNING.AST_PER40_CAP, gameMinutes);
		clipPer40(lines, "bpg", TUNING.BLK_PER40_CAP, gameMinutes);
		const before = lines.map((l) => l.rpg);
		clipPer40(lines, "rpg", TUNING.REB_PER40_CAP, gameMinutes);
		lines.forEach((l, i) => {
			const k = before[i] > 1e-9 ? l.rpg / before[i] : 1;
			l.orpg = Math.max(0, l.orpg * k);
			l.drpg = Math.max(0, l.drpg * k);
			l.rpg = l.orpg + l.drpg;
		});
	}

	/* -------------------------------------------------------------- game log */

	/* ---------------------------------------------------- plus/minus impact */

	/* How much better his team was with him on the floor, in points per 100
	   possessions — the number on/off is, and the number the export's
	   `onOff100` has to come out at.

	   The old impact term was `share * (prod - 11 * share) * 0.22`, a per-GAME
	   number added to every player's plus/minus. Two things were wrong with
	   it, and both of them showed up in the export rather than here.

	   It was not ZERO-SUM. Five men are on the floor for every point of a
	   team's margin, so the rotation's plus/minus has to sum to five times it;
	   an impact term that is positive for good players and negative for
	   nobody hands the team more margin than it won. BBGM's on/off then reads
	   the surplus off the OFF-court minutes, of which a starter has about nine
	   a night, and divides by them.

	   And it was not on a per-possession scale. On/off is amplified by
	   1 / (share * (1 - share)) — about 6x for a 30-minute starter and 17x for
	   a 37-minute one — so a five-point-a-game impact term is a fifty-point
	   on/off. Measured over eight classes: on/off ran to +295 and -217 per 100
	   with a p99 of +117, against a real college range of +10 to +20 and an
	   extreme near +25.

	   So the impact is DEFINED per 100 possessions, bounded there, and then
	   converted into the per-game plus/minus that produces it. It is measured
	   against his own rotation's production rather than a constant 11, which
	   is what makes the sum zero: subtract the minutes-weighted mean and the
	   team's margin is exactly the margin it won. */
	const PM_IMPACT = new WeakMap();
	const IMPACT_K = 0.8;
	const IMPACT_CAP = 20;

	function productionOf(l) {
		return (l.ppg || 0) + 1.2 * (l.rpg || 0) + 1.5 * (l.apg || 0) +
			2 * (l.spg || 0) + 2 * (l.bpg || 0) - 1.3 * (l.topg || 0);
	}

	/* Every rotation player's impact, per 100 and as a per-game plus/minus,
	   cached on the team: it is a property of the whole rotation and the game
	   log is built one player at a time. */
	function impactTerms(team, gameMinutes) {
		const cached = PM_IMPACT.get(team);
		if (cached) return cached;
		const gm = gameMinutes || team.gameMinutes || 40;
		const lines = (team && team.lines) || [];
		const pace = (team && team.box && team.box.pace) || 68;
		const out = new Map();
		let prodSum = 0;
		let shareSum = 0;
		for (const l of lines) {
			prodSum += productionOf(l);
			shareSum += Math.min(1, (l.mpg || 0) / gm);
		}
		// Production per full game on the floor, against the rotation's own.
		const base = shareSum > 1e-9 ? prodSum / shareSum : 0;
		const raw = [];
		let rawSum = 0;
		for (const l of lines) {
			const s = clamp((l.mpg || 0) / gm, 0, 0.98);
			const per40 = s > 1e-6 ? productionOf(l) / s : 0;
			const imp100 = clamp(IMPACT_K * (per40 - base), -IMPACT_CAP, IMPACT_CAP);
			const pg = s * (1 - s) * (pace / 100) * imp100;
			raw.push({ l, s, pg });
			rawSum += pg;
		}
		/* Centered so the five men on the floor account for the team's
		   margin and no more — the rotation's impacts have to sum to zero,
		   because `margin * share` already spends the whole margin.

		   The correction is spread on the SAME weight the impact itself
		   carries, s * (1 - s), and not on the minutes. That is not a
		   cosmetic choice: on/off divides an impact by s * (1 - s) (see
		   gameLog — the amplifier is exact, which is why the impact is
		   built with the factor in it), so a correction proportional to s
		   instead came back out of the division as a term in 1 / (1 - s).
		   For a 37-minute starter that is a fourteen-fold amplification of
		   a number that is the same for everybody on his team, which put
		   on/off swings near +30 per forty on the column and made the
		   statistic a function of minutes played rather than of the player.
		   With the weights matched, the correction is a per-team constant
		   in on/off, where it belongs, and the sum is still exactly zero. */
		let weightSum = 0;
		for (const r of raw) weightSum += r.s * (1 - r.s);
		for (const r of raw) {
			const pg = r.pg - (weightSum > 1e-9
				? (r.s * (1 - r.s) * rawSum) / weightSum : 0);
			out.set(r.l, pg);
		}
		PM_IMPACT.set(team, out);
		return out;
	}

	/* One line per game, for a player who already has a season average.

	   signatureGame already fabricated a game log — it drew rng.normal(ppg, sd)
	   once per game and threw the array away, keeping only the maximum. Keeping
	   it costs nothing and buys real season highs in every category, a "20-point
	   games: 14" line, genuine hot and cold streaks, and a game log tab.

	   The draws are rescaled so their mean is exactly the season average, so
	   the log and the stat line can never disagree — everything else in the
	   model reconciles and this has to as well. */
	function gameLog(p, team, rng) {
		const s = p.stats;
		if (!s || !team || !team.log || !team.log.length) return null;
		const schedule = team.log;
		const gp = Math.max(1, Math.min(schedule.length, Math.round(s.gp)));
		const missedCount = schedule.length - gp;

		/* Which games he missed. The old code took the FIRST gp entries of a
		   conference-first log, so a player who missed games always missed the
		   last N — which were always non-conference. Missed games are drawn as
		   an injury (one contiguous block) or as scattered absences. */
		/* Which games he missed. The absence itself was decided before the
		   season was played, so this places the games it names rather than
		   inventing a second, unrelated one: the block of an injury lands on
		   the dates the team was actually weaker for, and everything else is
		   scattered. */
		const missed = new Set();
		let injury = null;
		const av = p.availability;
		if (missedCount > 0) {
			/* The log is in the order the scheduler PAIRED the games, not the
			   order they were played (see longestRun in js/teams.js), so a run
			   of consecutive indices is a run of nothing. Both branches below
			   work on the calendar. */
			const byDate = schedule.map((g, i) => i)
				.sort((a, b) => (schedule[a].when || 0) - (schedule[b].when || 0));
			if (av && av.injury && av.from !== null) {
				// Place the block on the same stretch of the calendar the
				// season simulation took him out of.
				let start = 0;
				for (let k = 0; k < byDate.length; k++) {
					if ((schedule[byDate[k]].when || 0) >= av.from) { start = k; break; }
					start = k;
				}
				start = Math.max(0, Math.min(start, byDate.length - missedCount));
				for (let k = 0; k < missedCount; k++) missed.add(byDate[start + k]);
				injury = {
					from: start, to: start + missedCount - 1, games: missedCount,
					kind: av.kind,
				};
			} else {
				/* Scattered nights, and only out of the REGULAR SEASON: an
				   ordinary absence drawn over the whole log took a man out of
				   an NCAA tournament game his team played at full strength —
				   33 prospects over ten classes — because a coach's decision
				   or a one-game suspension in December has nothing to say
				   about March. */
				const reg = byDate.filter((i) => (schedule[i].stage || "reg") === "reg");
				const pool = reg.length >= missedCount ? reg : byDate;
				let guard = 0;
				while (missed.size < missedCount && guard++ < 500) {
					missed.add(pool[rng.int(0, pool.length - 1)]);
				}
				injury = {
					from: null, to: null, games: missedCount,
					kind: av ? av.kind : "a minor knock",
				};
			}
		}

		// A slow-moving form term gives real hot and cold stretches instead of
		// independent coin flips around the mean.
		let form = rng.normal(0, 1);
		const games = [];
		/* Night-to-night spread. It used to be sd = rel * avg + floor, with
		   rel 0.34 for points — which put a 27-point scorer at a per-game SD
		   of 13 against the 7-8 a real high-major volume scorer carries, and
		   over 47,000 sampled games produced 43 nights of 50, eight of 60 and
		   an 81. A counting stat is Poisson-like: its spread grows with the
		   SQUARE ROOT of its average, not with the average, so the SD is
		   a * sqrt(avg) + b, fitted to real box-score spreads (a 27-point
		   scorer about 7.7, a 15-point scorer 5.8, a 5-point reserve 3.6).
		   Fouls are tighter still because a coach manages them — a man on
		   four sits — and the old 0.42 relative SD against a mean near 3 with
		   a hard ceiling at 5 fouled a starter out of 20-30% of his games
		   against a real 3-6%. The third number is how much of the night's
		   form reaches the stat: scoring rides it, fouls barely do. */
		const SPREAD = {
			pts: [1.35, 0.6, 1.0], reb: [1.0, 0.4, 0.8], ast: [0.95, 0.3, 0.8],
			stl: [0.85, 0.2, 0.4], blk: [0.85, 0.2, 0.4], tov: [0.85, 0.2, 0.5],
			fouls: [0.45, 0.12, 0.25],
		};
		/* A night's ceiling is his minutes, not a flat multiple of his
		   average: a 12-minute reserve does not score 30, and a 35-minute
		   scorer's 55 is a once-a-decade line, not a once-a-season one.
		   Anything drawn above the ceiling is compressed toward it rather
		   than clipped, so the tail still exists. */
		/* VOLATILITY.

		   Every player's night-to-night spread used to be a function of his
		   average and nothing else, so two eighteen-point scorers produced
		   identical-looking game logs — and "Streaky Volume Scorer" was a
		   usage offset with exactly the same distribution around it as an Iron
		   Man. Streakiness is a fact about a player, not about his average.

		   `p.volatility` is drawn per player from his build (the `vol` field
		   on the archetype table, see js/traits.js) and runs about 0.8 to
		   1.4. It scales the shooting-driven categories only: a streaky
		   scorer's rebounds are not streaky, and his fouls certainly are not.
		   The rescale below still forces the log to sum to the season total,
		   so a wider spread costs nothing in accuracy — it moves nights
		   around, which is the whole idea. */
		const vol = Number.isFinite(p.volatility) ? clamp(p.volatility, 0.6, 1.6) : 1;
		const VOL_APPLIES = { pts: 1, ast: 0.5, tov: 0.5, reb: 0.25, stl: 0.25, blk: 0.25 };
		const mpg = Number.isFinite(s.mpg) ? s.mpg : 30;
		/* How long a game is where he plays. A college game is forty
		   minutes and a G League game forty-eight; the minutes cap and the
		   night's ceilings used to assume forty for everybody, so a G League
		   prospect at 36 minutes a night was cut to 40 in overtime and his
		   ceilings sat where a college player's do. A club carries its
		   league's game length (see simulateProLeagues). */
		const gameMinutes = team.gameMinutes || 40;
		const scale = gameMinutes / 40;
		const CEIL = {
			pts: 4 + 1.55 * mpg / scale, reb: 3 + 0.6 * mpg / scale, ast: 2 + 0.42 * mpg / scale,
			stl: 2 + 0.2 * mpg / scale, blk: 2 + 0.2 * mpg / scale, tov: 2 + 0.25 * mpg / scale,
			// Below five: a man on four sits, so the draw bends before the cap.
			fouls: 4.5,
		};
		for (let i = 0; i < schedule.length; i++) {
			if (missed.has(i)) continue;
			form = 0.62 * form + 0.78 * rng.normal(0, 1);
			const g = schedule[i];
			// A little more upside against a good opponent playing at home.
			const lift = (g.home > 0 ? 0.055 : 0) + (g.quality > 55 ? 0.04 : 0);
			const draw = (key, avg) => {
				const [a, b, fw] = SPREAD[key];
				const k = VOL_APPLIES[key] || 0;
				const sdev = (a * Math.sqrt(Math.max(0, avg)) + b) * (1 + k * (vol - 1));
				let v = avg * (1 + lift) + sdev * (0.55 * fw * form + 0.83 * rng.normal(0, 1));
				const ceil = CEIL[key];
				if (v > ceil) v = ceil + (v - ceil) * (key === "fouls" ? 0.2 : 0.3);
				return Math.max(0, v);
			};
			games.push({
				i,
				opp: g.opp, won: g.won, teamPts: g.teamPts, oppPts: g.oppPts, ot: g.ot, home: g.home,
				stage: g.stage, round: g.round, quality: g.quality, when: g.when,
				conference: !!g.conference,
				pts: draw("pts", s.ppg),
				reb: draw("reb", s.rpg),
				ast: draw("ast", s.apg),
				stl: draw("stl", s.spg),
				blk: draw("blk", s.bpg),
				tov: draw("tov", s.topg),
				fouls: draw("fouls", s.pfpg || 0),
			});
		}
		if (!games.length) return null;

		/* Rescale so the log SUMS to the season total exactly, then hand out
		   integers by largest remainder. Rounding each game independently
		   after scaling meant the log's mean no longer equalled the season
		   average — for a low-rate stat (0.3 blocks over 31 games) the
		   rounding error was a large fraction of the total. Fouls are the
		   one stat with a per-game physical ceiling: five ends a night, so
		   the allocation respects it and the games that hit it are counted
		   as foul-outs below. */
		const targets = {
			pts: s.ppg, reb: s.rpg, ast: s.apg,
			stl: s.spg, blk: s.bpg, tov: s.topg, fouls: s.pfpg || 0,
		};
		for (const key of Object.keys(targets)) {
			allocate(games, key, games.map((g) => g[key]),
				Math.round(targets[key] * games.length),
				key === "fouls" ? () => 5 : null);
		}

		/* Minutes and the shooting line behind the points. The log carried
		   counting stats only, so "best game" could say he scored 30 and
		   not whether it was 11-of-15 or a 28-shot night. */
		attachMinutesAndShooting(games, s, rng, gameMinutes);
		// The minutes the game had, so an export can count them.
		for (const g of games) g.avail = gameMinutes + 5 * (g.ot || 0);

		/* Plus/minus, which a modern box score carries and this one did
		   not. His team's margin that night, scaled by how much of it he
		   was on the floor for, plus the real night-to-night variance of a
		   lineup number. On/off is the difference between his per-40
		   plus/minus and the team's margin — an estimate, and labeled as
		   one in the view. */
		const share = Math.min(1, s.mpg / (gameMinutes || 40));
		/* An impact term, so on/off is not the noise term alone: the margin
		   scaled by his floor time cancels exactly against the team's
		   margin in the on/off formula below, which left on/off correlated
		   with nothing (-0.02 against overall). See impactTerms: it is
		   defined per 100 possessions, bounded there, and zero-sum over the
		   rotation. */
		const impact = impactTerms(team, gameMinutes).get(s) || 0;
		for (const g of games) {
			const margin = Number.isFinite(g.teamPts) && Number.isFinite(g.oppPts) ? g.teamPts - g.oppPts : 0;
			g.pm = margin * share + impact + rng.normal(0, 5.0);
		}
		/* The nights vary; the SEASON does not. The per-night noise is
		   recentred to sum to zero, so his season plus/minus is exactly the
		   margin he was on the floor for plus his impact — which is what the
		   number means, and the only way on/off can be bounded at all. Left
		   uncentred, a season's worth of lineup noise reached on/off through
		   the same 1 / (share * (1 - share)) amplifier as everything else and
		   carried a standard deviation near eight points per 100 on its own. */
		{
			let have = 0;
			let want = 0;
			for (const g of games) {
				const margin = Number.isFinite(g.teamPts) && Number.isFinite(g.oppPts) ? g.teamPts - g.oppPts : 0;
				want += margin * share + impact;
				have += g.pm;
			}
			const off = (have - want) / games.length;
			for (const g of games) g.pm = Math.round(g.pm - off);
			// Rounding leaves a residue; hand it out a point at a time so the
			// season total still lands where the model put it.
			let residue = Math.round(want) - games.reduce((a, g) => a + g.pm, 0);
			for (let i = 0; residue !== 0 && i < games.length; i++) {
				const step = residue > 0 ? 1 : -1;
				games[i].pm += step;
				residue -= step;
			}
		}
		const teamMargin = meanOf(games.map((g) =>
			({ m: Number.isFinite(g.teamPts) && Number.isFinite(g.oppPts) ? g.teamPts - g.oppPts : 0 })), "m");
		const plusMinus = meanOf(games, "pm");
		/* On/off is his per-40 plus/minus less the team's margin per 40
		   WITHOUT him, which is what the column has always said it was and
		   not what it computed: subtracting the team's overall margin left
		   his own minutes in the comparison and understated the difference by
		   a factor of (1 - share). */
		const without = share < 0.95 ? (teamMargin - plusMinus) / (1 - share) : null;
		const onOff = share > 0.05 && without !== null
			? plusMinus / share - without : 0;
		// Close games: decided by five or fewer, or in overtime.
		const closeGames = games.filter((g) =>
			Number.isFinite(g.teamPts) && Number.isFinite(g.oppPts) && (Math.abs(g.teamPts - g.oppPts) <= 5 || g.ot));
		const clutch = closeGames.length ? {
			gp: closeGames.length,
			ppg: meanOf(closeGames, "pts"),
			delta: meanOf(closeGames, "pts") - s.ppg,
			w: closeGames.filter((g) => g.won).length,
			l: closeGames.filter((g) => !g.won).length,
		} : null;

		const best = games.slice().sort((a, b) =>
			b.pts - a.pts || (b.reb + b.ast) - (a.reb + a.ast))[0];
		const highs = {};
		for (const key of ["pts", "reb", "ast", "stl", "blk"]) {
			highs[key] = Math.max.apply(null, games.map((g) => g[key]));
		}
		// Longest run of games at or above the season scoring average + 20%.
		let streak = 0;
		let bestStreak = 0;
		let bestStreakPts = 0;
		let runPts = 0;
		const bar = s.ppg * 1.2;
		for (const g of games) {
			if (g.pts >= bar) {
				streak++;
				runPts += g.pts;
				if (streak > bestStreak) { bestStreak = streak; bestStreakPts = runPts; }
			} else { streak = 0; runPts = 0; }
		}
		return {
			games,
			best,
			highs,
			injury,
			/* Fouling out is one of the most legible things in a box score,
			   and the number a physically plausible foul rate is actually
			   constrained by. */
			foulOuts: games.filter((g) => g.fouls >= 5).length,
			plusMinus,
			onOff,
			clutch,
			doubleDoubles: games.filter((g) =>
				[g.pts, g.reb, g.ast, g.stl, g.blk].filter((v) => v >= 10).length >= 2).length,
			tripleDoubles: games.filter((g) =>
				[g.pts, g.reb, g.ast, g.stl, g.blk].filter((v) => v >= 10).length >= 3).length,
			twentyPointGames: games.filter((g) => g.pts >= 20).length,
			hotStreak: bestStreak >= 3
				? { games: bestStreak, ppg: bestStreakPts / bestStreak }
				: null,
			// Split by phase, so "he was a different player after Christmas" is
			// something the note can actually say.
			splits: phaseSplits(games),
			postseason: postseasonSplit(games),
		};
	}

	/* Hand out an integer total across games by largest remainder, scaling
	   the raw draws so they sum to the target first. `capOf(g)` is a per-game
	   ceiling (five fouls, the minutes a game had); the cap wins over the
	   total, by construction. */
	function allocate(games, key, raw, total, capOf) {
		const got = raw.reduce((a, v) => a + v, 0);
		const k = got > 1e-9 ? total / got : 0;
		const cap = (i) => (capOf ? capOf(games[i]) : Infinity);
		const scaled = raw.map((v, i) => Math.min(cap(i), Math.max(0, v * k)));
		const base = scaled.map((v) => Math.floor(v));
		let sum = 0;
		for (const v of base) sum += v;
		let need = total - sum;
		const order = scaled
			.map((v, i) => ({ i, r: v - base[i] }))
			.sort((a, b) => b.r - a.r);
		for (let j = 0; need > 0 && j < order.length; j++) {
			if (base[order[j].i] < cap(order[j].i)) { base[order[j].i]++; need--; }
		}
		// A capped stat can leave the total short. Fill any room left, then
		// stop.
		let guard = 0;
		while (need > 0 && guard++ < 8) {
			for (let i = 0; i < base.length && need > 0; i++) {
				if (base[i] < cap(i)) { base[i]++; need--; }
			}
		}
		games.forEach((g, i) => { g[key] = base[i]; });
	}

	/* Per-game minutes and shooting, reconciled to the season line.

	   Minutes sit around his average, run longer in overtime, and are cut on
	   the nights he fouled out. Attempts follow the scoring night — a
	   30-point game is a 20-shot game — and sum to the season's attempts
	   exactly. Makes are then solved per game so that
	   2 * (FGM - 3PM) + 3 * 3PM + FTM equals the points already in the log,
	   and a final exchange pass (a three for a two-and-a-free-throw, a two
	   for two free throws — both points-neutral) moves the season's FGM
	   and 3PM totals onto the line's own, so the percentages a reader
	   recomputes off the log are the percentages beside it. */
	function attachMinutesAndShooting(games, s, rng, gameMinutes) {
		const n = games.length;
		const mpg = Number.isFinite(s.mpg) ? s.mpg : 0;
		const gm = gameMinutes || 40;
		const gameMin = (g) => gm + 5 * (g.ot || 0);
		const rawMin = games.map((g) => {
			let m = mpg + rng.normal(0, 0.11 * mpg + 1.4);
			if (g.ot) m += 2.5 * g.ot * Math.min(1, mpg / 30);
			if (g.fouls >= 5) m = Math.min(m, Math.max(4, mpg * 0.8));
			return Math.max(0, Math.min(gameMin(g), m));
		});
		allocate(games, "min", rawMin, Math.round(mpg * n), gameMin);

		if (!Number.isFinite(s.fga) || !Number.isFinite(s.fgp) ||
			!Number.isFinite(s.tpa) || !Number.isFinite(s.fta)) return;
		const ppg = s.ppg || 0;
		// Usage moves with the scoring night, less than one-for-one.
		const shape = (g) => (ppg > 0.5 ? 0.5 + 0.5 * (g.pts / ppg) : 1);
		allocate(games, "fga",
			games.map((g) => Math.max(0, s.fga * shape(g) * (1 + rng.normal(0, 0.14)))),
			Math.round(s.fga * n), null);
		const tpShare = s.fga > 0 ? s.tpa / s.fga : 0;
		allocate(games, "tpa",
			games.map((g) => Math.max(0, g.fga * tpShare * (1 + rng.normal(0, 0.28)))),
			Math.round(s.tpa * n), (g) => g.fga);
		allocate(games, "fta",
			games.map((g) => Math.max(0, s.fta * shape(g) * (1 + rng.normal(0, 0.32)))),
			Math.round(s.fta * n), null);

		/* Every game has to be scorable from its own attempts: the most a
		   line can produce is 2 * FGA + 3PA + FTA. Where a big night drew too
		   few shots, take attempts from the game with the most slack. */
		const capacity = (g) => 2 * g.fga + g.tpa + g.fta;
		for (let guard = 0; guard < 200; guard++) {
			const short = games.filter((g) => capacity(g) < g.pts)
				.sort((a, b) => (b.pts - capacity(b)) - (a.pts - capacity(a)))[0];
			if (!short) break;
			const donor = games.filter((g) => g !== short && g.fga - g.tpa > 0 &&
				capacity(g) - g.pts >= 2)
				.sort((a, b) => (capacity(b) - b.pts) - (capacity(a) - a.pts))[0];
			if (!donor) { short.fga++; continue; }
			donor.fga--;
			short.fga++;
		}

		/* Move one MISSED attempt from another game into `g`. A miss is
		   points-neutral wherever it sits, so this changes nothing a reader
		   can recompute; it only gives a game the room it needs. Makes are
		   solved after the moves, so a "miss" here is an attempt above the
		   makes the game will end up with. */
		const spareTwo = (d) => (d.fga - d.tpa) - Math.max(0, (d.fgm || 0) - (d.tpm || 0));
		const spareThree = (d) => d.tpa - (d.tpm || 0);
		const spareFt = (d) => d.fta - (d.ftm || 0);
		const borrow = (g, kind) => {
			const spare = kind === "2a" ? spareTwo : kind === "3a" ? spareThree : spareFt;
			const d = games.filter((x) => x !== g && spare(x) >= 1)
				.sort((a, b) => spare(b) - spare(a))[0];
			if (!d) return false;
			if (kind === "2a") { d.fga--; g.fga++; }
			else if (kind === "3a") { d.fga--; d.tpa--; g.fga++; g.tpa++; }
			else { d.fta--; g.fta++; }
			return true;
		};

		// Season make totals, forced onto the points already in the log.
		const ptsT = games.reduce((a, g) => a + g.pts, 0);
		const fgaT = games.reduce((a, g) => a + g.fga, 0);
		const tpaT = games.reduce((a, g) => a + g.tpa, 0);
		const ftaT = games.reduce((a, g) => a + g.fta, 0);
		/* THE FEASIBLE TARGETS.

		   The log's points are already forced to the season total, so the
		   three make-totals are constrained: fgmT must lie in [tpmT, fgaT],
		   and ftmT = ptsT - 2*fgmT - tpmT must lie in [0, ftaT]. Those two
		   intervals intersect for almost every line and the code used to give
		   up whenever they did not — "fall back to the identity per game and
		   let the totals land where they land" — which left a 64% free-throw
		   shooter printing 20 of 22 across his season log. Rare (about one
		   player in 800 before per-player volatility widened the points
		   distribution, and one in 400 after), and visibly wrong when it fired.

		   Searching the interval instead is four lines and always finds an
		   answer when one exists: take the fgmT closest to the ideal that
		   satisfies both constraints, and only give up when the intersection
		   is genuinely empty — which can only happen if the attempts cannot
		   carry the points at all, and the per-game solver borrows attempts
		   precisely so that they can. */
		let tpmT = Math.min(tpaT, Math.round(s.tpa * s.tpp * n));
		const idealFgm = Math.round(s.fga * s.fgp * n);
		const feasible = (tp) => {
			// fgm bounds from the free-throw constraint, then from its own.
			const lo = Math.max(tp, Math.ceil((ptsT - tp - ftaT) / 2));
			const hi = Math.min(fgaT, Math.floor((ptsT - tp) / 2));
			if (hi < lo) return null;
			return clamp(idealFgm, lo, hi);
		};
		let fgmT = feasible(tpmT);
		/* If this three-point total cannot be carried, walk it toward zero:
		   threes are the scarcest of the three and the easiest to give up. */
		for (let d = 1; fgmT === null && d <= tpaT; d++) {
			if (tpmT - d >= 0 && feasible(tpmT - d) !== null) {
				tpmT -= d; fgmT = feasible(tpmT); break;
			}
			if (tpmT + d <= tpaT && feasible(tpmT + d) !== null) {
				tpmT += d; fgmT = feasible(tpmT); break;
			}
		}
		/* The free-throw total needs no search of its own: points are already
		   fixed and pts = 2*fgm + tpm + ftm, so driving the two make totals
		   below to fgmT and tpmT lands ftm on ptsT - 2*fgmT - tpmT by
		   arithmetic. */

		/* Per-game makes: the fewest moves from the expected makes that
		   satisfy the points identity within the game's attempts. A game
		   with no way to make its total (one point and no free throw, two
		   points from nothing but threes) borrows the attempt it lacks. */
		/* `carry` is the running shortfall between what the games solved so
		   far SHOULD have made and what they did, per category.

		   Without it each game minimises its own error independently and the
		   season sum comes out biased, because the per-game choice is an
		   integer under a parity constraint: a 64% free-throw shooter taking
		   one attempt a night has an ideal of 0.64 makes, and in any game
		   whose points are odd with no three made the parity forces the make.
		   Twenty-eight of those in a row and the log says he shot 20 of 22
		   from the line. The exchange passes below cannot repair it — the
		   only move that lowers free-throw makes needs a game with two of
		   them, and he never had two in a game.

		   Feeding the shortfall forward is the standard fix for exactly this
		   (it is the same idea as error diffusion, or largest-remainder
		   apportionment done online) and costs two numbers. */
		const carry = { ft: 0, tp: 0 };
		const solveGame = (g) => {
			const twoA = g.fga - g.tpa;
			const tpm0 = g.tpa * (s.tpp || 0) + carry.tp;
			const ftm0 = g.fta * (s.ftp || 0) + carry.ft;
			let best = null;
			for (let tpm = 0; tpm <= g.tpa; tpm++) {
				for (let ftm = 0; ftm <= g.fta; ftm++) {
					const rest = g.pts - 3 * tpm - ftm;
					if (rest < 0 || rest % 2 !== 0) continue;
					const two = rest / 2;
					if (two > twoA) continue;
					const cost = Math.abs(tpm - tpm0) + Math.abs(ftm - ftm0) +
						0.5 * Math.abs(two - twoA * (s.fgp || 0.45));
					if (!best || cost < best.cost) best = { tpm, ftm, two, cost };
				}
			}
			return best;
		};
		for (const g of games) {
			let best = solveGame(g);
			for (let tries = 0; !best && tries < 4; tries++) {
				if (!borrow(g, "fta")) g.fta++;
				best = solveGame(g);
			}
			if (!best) best = { tpm: 0, ftm: Math.min(g.fta, g.pts), two: 0 };
			g.tpm = best.tpm;
			g.ftm = best.ftm;
			g.fgm = best.two + best.tpm;
			/* What this game owes, or is owed, forward. Bounded so one
			   impossible game cannot drag every game after it. */
			carry.ft = clamp(carry.ft + g.fta * (s.ftp || 0) - g.ftm, -2.5, 2.5);
			carry.tp = clamp(carry.tp + g.tpa * (s.tpp || 0) - g.tpm, -2.5, 2.5);
		}
		if (fgmT === null) return;

		/* The exchange pass. Each move is points-neutral inside one game:
		   a three becomes a two and a free throw (or back), and a two
		   becomes two free throws (or back). The MAKES a move needs have to
		   be in the game already; the attempts it needs can be borrowed. */
		const tot = (k) => games.reduce((a, g) => a + g[k], 0);
		const madeTwo = (g) => g.fgm - g.tpm;
		const attempt = (g, kinds) => {
			for (const k of kinds) {
				const spare = k === "2a" ? spareTwo : k === "3a" ? spareThree : spareFt;
				const want = k === "fta" && kinds.filter((x) => x === "fta").length;
				while (spare(g) < (want || 1)) if (!borrow(g, k)) return false;
			}
			return true;
		};
		/* Try every candidate game, not only the best one.

		   This took `games.filter(pred).sort(...)[0]` and gave up if that one
		   game could not borrow the attempt the move needed — so a single
		   uncooperative game aborted the whole pass and left the season's make
		   totals wherever the per-game solver had put them. Measured: one
		   player in a few hundred finished the season shooting 20 of 22 from
		   the line on a 64% free-throw stroke, and the game log and the stat
		   line beside it disagreed in a way a reader can add up.

		   Walking the candidates in order costs a handful of comparisons on
		   the one pass in a thousand that needs it. */
		const exchange = (pred, kinds, apply) => {
			const cands = games.filter(pred).sort((a, b) => b.pts - a.pts);
			for (const g of cands) {
				if (!attempt(g, kinds)) continue;
				apply(g);
				return true;
			}
			return false;
		};
		for (let guard = 0; guard < 400 && tot("tpm") !== tpmT; guard++) {
			const moved = tot("tpm") < tpmT
				? exchange((g) => madeTwo(g) >= 1 && g.ftm >= 1, ["3a"],
					(g) => { g.tpm++; g.ftm--; })
				: exchange((g) => g.tpm >= 1, ["2a", "fta"],
					(g) => { g.tpm--; g.ftm++; });
			if (!moved) break;
		}
		/* The compound move, for the season the single move cannot reach.

		   Raising field-goal makes by one costs two free-throw makes in the
		   SAME game, and a man who shoots 0.7 free throws a night rarely has
		   two in one. Measured: a 66% free-throw shooter on 23 attempts
		   finished his log 19-of-23 because no game held two made free
		   throws to trade. Two games can do it between them, each move
		   points-neutral inside its own game: in X a made three becomes two
		   twos less a free throw (3 = 2 + 2 - 1), in Y a two and a free
		   throw become a three. Net: one more field goal, two fewer free
		   throws, the three-point total unchanged. Mirror for the other
		   direction. */
		const compound = (up) => {
			if (up) {
				const xs = games.filter((g) => g.tpm >= 1 && g.ftm >= 1)
					.sort((a, b) => b.pts - a.pts);
				for (const x of xs) {
					const y = games.filter((g) => g !== x && madeTwo(g) >= 1 && g.ftm >= 1)[0];
					if (!y) continue;
					let okay = true;
					while (okay && spareTwo(x) < 2) okay = borrow(x, "2a");
					while (okay && spareThree(y) < 1) okay = borrow(y, "3a");
					if (!okay) continue;
					x.tpm--; x.fgm++; x.ftm--;
					y.tpm++; y.ftm--;
					return true;
				}
				return false;
			}
			const xs = games.filter((g) => madeTwo(g) >= 2).sort((a, b) => b.pts - a.pts);
			for (const x of xs) {
				const y = games.filter((g) => g !== x && g.tpm >= 1)[0];
				if (!y) continue;
				let okay = true;
				while (okay && spareThree(x) < 1) okay = borrow(x, "3a");
				while (okay && spareFt(x) < 1) okay = borrow(x, "fta");
				while (okay && spareTwo(y) < 1) okay = borrow(y, "2a");
				while (okay && spareFt(y) < 1) okay = borrow(y, "fta");
				if (!okay) continue;
				x.tpm++; x.fgm--; x.ftm++;
				y.tpm--; y.ftm++;
				return true;
			}
			return false;
		};
		/* The last resort: one point moved between two games. A man with no
		   threes whose free-throw makes are all singles has no points-neutral
		   move left inside any one game — every odd night needs its one free
		   throw — so a point goes from one such night to another: the first
		   loses its free throw, the second turns its free throw and the point
		   into a two. Every season total is unchanged, which is the invariant
		   the log exists to keep; a night's score moving by a point is well
		   inside what the draw that produced it would have produced anyway. */
		const shiftPoint = (up) => {
			if (up) {
				const as = games.filter((g) => g.ftm >= 1 && g.pts >= 1).sort((a, b) => a.pts - b.pts);
				for (const a of as) {
					const b = games.filter((g) => g !== a && g.ftm >= 1)[0];
					if (!b) continue;
					let okay = true;
					while (okay && spareTwo(b) < 1) okay = borrow(b, "2a");
					if (!okay) continue;
					a.pts--; a.ftm--;
					b.pts++; b.ftm--; b.fgm++;
					return true;
				}
				return false;
			}
			const as = games.filter((g) => madeTwo(g) >= 1).sort((a, b) => b.pts - a.pts);
			for (const a of as) {
				const b = games.filter((g) => g !== a)[0];
				if (!b) continue;
				let okay = true;
				while (okay && spareFt(a) < 1) okay = borrow(a, "fta");
				while (okay && spareFt(b) < 1) okay = borrow(b, "fta");
				if (!okay) continue;
				a.pts--; a.fgm--; a.ftm++;
				b.pts++; b.ftm++;
				return true;
			}
			return false;
		};
		for (let guard = 0; guard < 400 && tot("fgm") !== fgmT; guard++) {
			const up = tot("fgm") < fgmT;
			const moved = up
				? exchange((g) => g.ftm >= 2, ["2a"],
					(g) => { g.fgm++; g.ftm -= 2; })
				: exchange((g) => madeTwo(g) >= 1, ["fta", "fta"],
					(g) => { g.fgm--; g.ftm += 2; });
			if (!moved && !compound(up) && !shiftPoint(up)) break;
		}
	}

	function meanOf(games, key) {
		if (!games.length) return 0;
		return games.reduce((a, g) => a + g[key], 0) / games.length;
	}

	function phaseSplits(games) {
		const reg = games.filter((g) => (g.stage || "reg") === "reg");
		const early = reg.filter((g) => g.when < 0.5);
		const late = reg.filter((g) => g.when >= 0.5);
		const mk = (l) => (l.length
			? { gp: l.length, ppg: meanOf(l, "pts"), rpg: meanOf(l, "reb"), apg: meanOf(l, "ast") }
			: null);
		return {
			nonConference: mk(reg.filter((g) => !g.conference && g.when < 0.5)),
			early: mk(early),
			late: mk(late),
		};
	}

	function postseasonSplit(games) {
		const post = games.filter((g) => g.stage && g.stage !== "reg");
		if (!post.length) return null;
		return {
			gp: post.length,
			ppg: meanOf(post, "pts"),
			rpg: meanOf(post, "reb"),
			apg: meanOf(post, "ast"),
			ncaa: games.filter((g) => g.stage === "ncaa").length,
		};
	}

	global.StatsSim = {
		simulateTeamStats, allocateMinutes, statLine, teamPools, gameLog,
		fitToPool, reconcileTeamTotals, teamBox, CONVERGENCE,
		defenseProfile, rosterDefenseProfile, rosterShooting,
		astWeight, stlWeight, rebWeight, passSkill,
		leagueEnv, LEAGUE_ENV, NCAA_ENV,
		TUNING, ROTATION_SHAPE, classYearIndex, experienceUsage, collegeRole,
		archetypeIdentity, IDENTITY_FTR, IDENTITY_PF,
		IDENTITY_REB, IDENTITY_AST, IDENTITY_STL, IDENTITY_BLK, IDENTITY_AXES,
	};
})(typeof window !== "undefined" ? window : self);
