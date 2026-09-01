/* facesjs adapter. The face object in an uploaded draft class is already in
   facesjs's schema — BBGM uses the same library — and it was preserved
   through export and never rendered. The vendored IIFE build in
   js/vendor/facesjs.js hangs { display, generate } on window.FacesJS, which
   preserves the "open index.html off the disk, no build step" property.

   A player whose file carries no face (or a malformed one) gets one from
   generate(), seeded from his key so it is deterministic: the same prospect
   has the same face on every reroll, export and reload. */
(function (global) {
	"use strict";

	const cache = {};

	/* Basketball only. facesjs generates a jersey from every sport it knows,
	   so a third of the class turned up in baseball and hockey kit — the
	   "jersey*" ids are the basketball tank tops (the ones BBGM uses) and the
	   rest are football, baseball and hockey shirts. */
	const BASKETBALL_JERSEYS = ["jersey", "jersey2", "jersey3", "jersey4", "jersey5"];

	/* Kit colours per programme. facesjs draws teamColors[0] as the jersey
	   body and [1]/[2] as trim, and its default is one fixed washed-out blue —
	   so before this every player in every class wore the identical kit, which
	   is both dull and wrong: teammates should match and Duke should not look
	   like Gonzaga. These are plausible college combinations rather than
	   random hues, because a random triple in HSV space produces the clashing
	   mess that "just randomise it" always produces. */
	const KITS = [
		["#9e1b32", "#ffffff", "#63132a"],   // crimson
		["#13294b", "#e8c547", "#ffffff"],   // navy and gold
		["#00563f", "#ffffff", "#c8b273"],   // forest green
		["#f56600", "#0b2341", "#ffffff"],   // orange and navy
		["#4b2e83", "#e8d3a2", "#ffffff"],   // purple and gold
		["#0033a0", "#ffffff", "#c8102e"],   // royal blue
		["#8c1515", "#e0c88a", "#2e2d29"],   // cardinal
		["#6f263d", "#f2a900", "#ffffff"],   // maroon and gold
		["#101820", "#c5a900", "#ffffff"],   // black and gold
		["#6cace4", "#0b2341", "#ffffff"],   // sky and navy
		["#bb0000", "#8a8d8f", "#ffffff"],   // scarlet and grey
		["#00685e", "#ffffff", "#c4d600"],   // teal
		["#782f40", "#ceb888", "#ffffff"],   // garnet and gold
		["#003087", "#ff8200", "#ffffff"],   // blue and orange
		["#154734", "#a49665", "#ffffff"],   // hunter green
		["#7a0019", "#ffcc33", "#ffffff"],   // dark red and yellow
	];

	function hashOf(text) {
		let h = 2166136261;
		const s = String(text || "");
		for (let i = 0; i < s.length; i++) {
			h ^= s.charCodeAt(i);
			h = Math.imul(h, 16777619);
		}
		return h >>> 0;
	}

	function kitFor(team) {
		return KITS[hashOf(team) % KITS.length];
	}

	function seededFace(key) {
		const F = global.FacesJS;
		const k = String(key);
		if (cache[k]) return cache[k];
		const rng = new global.BBGMRng.Rng("face|" + k);
		/* facesjs draws with Math.random; swap it for the seeded stream for
		   the duration of the one call. Contained, synchronous, restored in
		   finally — and the only alternative is forking the library. */
		const orig = Math.random;
		Math.random = () => rng.random();
		try {
			// A men's draft class: without this, generate() draws from the
			// female hair and body ranges for about half the class.
			cache[k] = F.generate(undefined, { gender: "male" });
		} finally {
			Math.random = orig;
		}
		return cache[k];
	}

	/* Every feature facesjs needs to draw a complete face. A blob missing any
	   of them renders as a partial face — most visibly with no eyes — so a
	   file's face is used only when it is actually complete, and anything
	   short of that falls back to a generated one rather than to a portrait
	   with holes in it. */
	const REQUIRED = ["head", "eye", "eyebrow", "nose", "mouth", "ear", "hair", "body"];

	function usable(face) {
		if (!face || typeof face !== "object") return false;
		return REQUIRED.every((k) => face[k] && typeof face[k] === "object" &&
			typeof face[k].id === "string");
	}

	function faceOf(p) {
		const face = p && p.src && p.src.face;
		return usable(face) ? face : seededFace(p ? p.key : "unknown");
	}

	/* Two items in facesjs's range belong to other sports (or to December):
	   a Santa hat and a football facemask. Everything else — caps, headbands,
	   eye black, glasses — is left exactly as the library draws it, because
	   the point is BBGM's own aesthetic and not a house restyling of it. */
	const WRONG_SPORT = { "santa-hat": true };
	const ACCESSORY_SWAP = ["none", "none", "headband", "headband-high"];

	/* The face as it should be DRAWN: the player's own features, in his
	   programme's kit. The stored face is never mutated — a face round-trips
	   into the exported file exactly as it arrived. */
	function displayFace(p) {
		const base = faceOf(p);
		const key = p ? p.key : "unknown";
		const team = p ? (p.proClub || p.newCollege || "") : "";
		const out = Object.assign({}, base, {
			jersey: {
				id: BASKETBALL_JERSEYS[hashOf(key + "|jersey") % BASKETBALL_JERSEYS.length],
			},
			teamColors: kitFor(team),
		});
		if (base.accessories && WRONG_SPORT[base.accessories.id]) {
			out.accessories = {
				id: ACCESSORY_SWAP[hashOf(key + "|acc") % ACCESSORY_SWAP.length],
			};
		}
		if (base.glasses && base.glasses.id === "facemask") {
			out.glasses = { id: "none" };
		}
		return out;
	}

	/* --- drawing ---------------------------------------------------------

	   facesjs measures the container while it draws, so a container that is
	   not in the document yet measures zero and several features — the eyes
	   first — are scaled or positioned into nothing. Every caller here builds
	   its node before the view is attached (a player page is returned to its
	   caller; a table cell is built inside a detached row), so drawing
	   immediately produced a face with no eyes in every single place one
	   appeared.

	   Rendering is therefore QUEUED and flushed once the frame the view was
	   attached in has landed. A container that never made it into the
	   document is simply dropped. */
	let queue = [];
	let scheduled = false;

	function paint(container, p) {
		const F = global.FacesJS;
		if (!F || !F.display) return false;
		try {
			F.display(container, displayFace(p));
			return true;
		} catch (e) {
			try {
				F.display(container, seededFace(p ? p.key : "unknown"));
				return true;
			} catch (e2) {
				container.textContent = "";
				return false;
			}
		}
	}

	function flush() {
		scheduled = false;
		const pending = queue;
		queue = [];
		for (const item of pending) {
			if (!document.contains(item.container)) continue;
			paint(item.container, item.p);
		}
	}

	/* Render into a container element. Never throws: a face is decoration,
	   and a bad blob must not take a page down. */
	function render(container, p) {
		if (!global.FacesJS || !container) return false;
		// Already in the document (the editor drawer, a re-render into a live
		// node): draw straight away so there is no visible flash.
		if (document.contains(container)) return paint(container, p);
		queue.push({ container, p });
		if (!scheduled) {
			scheduled = true;
			const raf = global.requestAnimationFrame ||
				((fn) => setTimeout(fn, 0));
			raf(flush);
		}
		return true;
	}

	global.Faces = {
		render, flush, faceOf, displayFace, seededFace, usable, kitFor,
		BASKETBALL_JERSEYS, KITS,
	};
})(typeof window !== "undefined" ? window : self);
