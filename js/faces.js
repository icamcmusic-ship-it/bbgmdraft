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
			cache[k] = F.generate();
		} finally {
			Math.random = orig;
		}
		return cache[k];
	}

	function faceOf(p) {
		const face = p && p.src && p.src.face;
		if (face && typeof face === "object" && face.head) return face;
		return seededFace(p ? p.key : "unknown");
	}

	/* Render into a container element. Never throws: a face is decoration,
	   and a bad blob must not take a page down. */
	function render(container, p, size) {
		const F = global.FacesJS;
		if (!F || !F.display || !container) return false;
		try {
			F.display(container, faceOf(p));
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

	global.Faces = { render, faceOf, seededFace };
})(typeof window !== "undefined" ? window : self);
