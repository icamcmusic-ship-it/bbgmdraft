/* Seeded RNG + distribution helpers. Deterministic so a seed always
   reproduces the exact same draft class. */
(function (global) {
	"use strict";

	// xmur3 string hash -> 32 bit seed
	function hashSeed(str) {
		let h = 1779033703 ^ String(str).length;
		for (let i = 0; i < String(str).length; i++) {
			h = Math.imul(h ^ String(str).charCodeAt(i), 3432918353);
			h = (h << 13) | (h >>> 19);
		}
		return function () {
			h = Math.imul(h ^ (h >>> 16), 2246822507);
			h = Math.imul(h ^ (h >>> 13), 3266489909);
			h ^= h >>> 16;
			return h >>> 0;
		};
	}

	function Rng(seed) {
		const seedString = seed === undefined ? String(Math.random()) : String(seed);
		// Kept so child() can derive from the seed itself rather than from the
		// parent's stream position.
		this.seedString = seedString;
		const next = hashSeed(seedString);
		let a = next();
		// mulberry32
		this.random = function () {
			a |= 0;
			a = (a + 0x6d2b79f5) | 0;
			let t = Math.imul(a ^ (a >>> 15), 1 | a);
			t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
	}

	Rng.prototype.uniform = function (lo, hi) {
		return lo + (hi - lo) * this.random();
	};

	Rng.prototype.int = function (lo, hi) {
		const v = Math.floor(lo + (hi - lo + 1) * this.random());
		return v > hi ? hi : v;
	};

	// Box-Muller
	Rng.prototype.normal = function (mean, sd) {
		let u = 0;
		let v = 0;
		while (u === 0) u = this.random();
		while (v === 0) v = this.random();
		return (
			mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
		);
	};

	// Normal truncated to [lo, hi] by resampling (bounded attempts).
	Rng.prototype.truncNormal = function (mean, sd, lo, hi) {
		for (let i = 0; i < 24; i++) {
			const x = this.normal(mean, sd);
			if (x >= lo && x <= hi) return x;
		}
		return Math.max(lo, Math.min(hi, mean));
	};

	Rng.prototype.chance = function (p) {
		return this.random() < p;
	};

	Rng.prototype.pick = function (arr) {
		return arr[Math.floor(this.random() * arr.length)];
	};

	// items: [{w: number, ...}] or parallel weights array
	Rng.prototype.weighted = function (items, weightFn) {
		const wf = weightFn || ((x) => x.w);
		let total = 0;
		for (const it of items) total += Math.max(0, wf(it));
		if (total <= 0) return this.pick(items);
		let r = this.random() * total;
		for (const it of items) {
			r -= Math.max(0, wf(it));
			if (r <= 0) return it;
		}
		return items[items.length - 1];
	};

	Rng.prototype.shuffle = function (arr) {
		const a = arr.slice();
		for (let i = a.length - 1; i > 0; i--) {
			const j = Math.floor(this.random() * (i + 1));
			[a[i], a[j]] = [a[j], a[i]];
		}
		return a;
	};

	/* Stable child RNG: derived from the parent's SEED, not from a draw off the
	   parent's stream. The old version called this.random(), which made every
	   child depend on how many children had been created before it — so the
	   documented "same seed, same class" guarantee would have broken silently
	   the first time anyone reordered a loop or added a filter.

	   new Rng("x").child("alpha") is now the same generator whether or not
	   child("beta") was created first. */
	Rng.prototype.child = function (key) {
		return new Rng(this.seedString + "|" + String(key));
	};

	function clamp(x, lo, hi) {
		return x < lo ? lo : x > hi ? hi : x;
	}

	global.BBGMRng = { Rng, clamp, hashSeed };
})(typeof window !== "undefined" ? window : self);
