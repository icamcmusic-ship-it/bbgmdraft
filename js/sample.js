/* A sample draft class, for evaluating the tool before exporting anything
   from the game. A first-time visitor with no BBGM file got a drop-a-file
   screen and nothing else; this is the same kind of synthetic class the
   calibration harness (tools/validate.js) runs on — a draft-slot-shaped
   overall curve, BBGM-style size-correlated ratings, frequency-weighted
   colleges and a share of blank ones — with names and birthplaces so the
   season reads like one. It is a fixture, not a real class: Try it, reroll
   it, then load your own. */
(function (global) {
	"use strict";

	const { Rng, clamp } = global.BBGMRng;
	const BB = global.BBGM;
	const C = global.Colleges;

	const FIRST = ["Jalen", "Marcus", "Tyrese", "Cameron", "Isaiah", "Jaylen", "Devin",
		"Kobe", "Darius", "Elijah", "Malik", "Zion", "Trey", "Caleb", "Amari", "Jaden",
		"Bryce", "Keon", "Tariq", "Josh", "Nikola", "Luka", "Dario", "Matteo", "Tomas",
		"Kai", "Andre", "Xavier", "Micah", "Reece", "Cole", "Tyler", "Chris", "Julian",
		"Omar", "Rasheed", "Grant", "Ethan", "Nate", "Dominic", "Cody", "Terrence",
		"Jordan", "Aaron", "Dylan", "Ian", "Sam", "Miles", "Jamal", "Vince"];
	const LAST = ["Williams", "Johnson", "Carter", "Brooks", "Mitchell", "Hendricks",
		"Okafor", "Thompson", "Reeves", "Garland", "Bates", "Coleman", "Diallo", "Foster",
		"Grant", "Harris", "Jenkins", "Kessler", "Lawson", "Morgan", "Nwosu", "Osei",
		"Pierce", "Quinn", "Ramirez", "Sanders", "Turner", "Vaughn", "Walker", "Young",
		"Jokic", "Petrovic", "Bogdanovic", "Markkanen", "Sarr", "Ndiaye", "Abdullahi",
		"Kuminga", "Wembanyama", "Daniels", "Hardaway", "Whitmore", "Sheppard", "Castle"];
	const HOME = [
		["Chicago, IL", 6], ["Atlanta, GA", 5], ["Houston, TX", 5], ["Los Angeles, CA", 5],
		["Philadelphia, PA", 4], ["Dallas, TX", 4], ["Charlotte, NC", 3], ["Memphis, TN", 3],
		["Detroit, MI", 3], ["Indianapolis, IN", 3], ["Phoenix, AZ", 2], ["Seattle, WA", 2],
		["Baltimore, MD", 2], ["New York, NY", 4], ["Minneapolis, MN", 2], ["Denver, CO", 2],
		["Toronto, Canada", 3], ["Montreal, Canada", 1], ["Belgrade, Serbia", 2],
		["Zagreb, Croatia", 1], ["Vilnius, Lithuania", 1], ["Paris, France", 2],
		["Madrid, Spain", 1], ["Melbourne, Australia", 2], ["Lagos, Nigeria", 2],
		["Dakar, Senegal", 1], ["Tokyo, Japan", 1], ["São Paulo, Brazil", 1],
	];

	const pickWeighted = (rng, rows) => {
		const total = rows.reduce((a, r) => a + r[1], 0);
		let x = rng.random() * total;
		for (const r of rows) {
			x -= r[1];
			if (x <= 0) return r[0];
		}
		return rows[rows.length - 1][0];
	};

	function makeClass(seed, n, season) {
		const rng = new Rng("sample:" + String(seed));
		const yr = Number.isFinite(season) ? season : 2026;
		const names = C.names;
		const weights = names.map((x) => C.frequencyOf(x));
		const wTotal = weights.reduce((a, b) => a + b, 0);
		const pickCollege = (r) => {
			let x = r * wTotal;
			for (let i = 0; i < names.length; i++) {
				x -= weights[i];
				if (x <= 0) return names[i];
			}
			return names[names.length - 1];
		};
		const count = Math.max(8, Math.min(120, Math.round(n || 70)));
		const players = [];
		const used = new Set();
		for (let i = 0; i < count; i++) {
			const pr = rng.child("p" + i);
			const hgt = clamp(Math.round(pr.normal(48, 17)), 5, 95);
			const b = (hgt - 30) / 55;
			let r = {};
			for (const k of BB.RATING_KEYS) r[k] = clamp(Math.round(pr.normal(45, 13)), 5, 90);
			r.hgt = hgt;
			r.tp = clamp(Math.round(pr.normal(52 - 22 * b, 12)), 5, 90);
			r.ft = clamp(Math.round(pr.normal(52 - 12 * b, 11)), 5, 90);
			r.ins = clamp(Math.round(pr.normal(40 + 16 * b, 11)), 5, 90);
			r.reb = clamp(Math.round(pr.normal(42 + 18 * b, 11)), 5, 90);
			r.pss = clamp(Math.round(pr.normal(55 - 20 * b, 12)), 5, 90);
			r.fuzz = 0;
			// A draft-slot-shaped curve: 53 at the top of the board to about
			// 22 at the bottom, with scouting noise.
			const slot = count > 1 ? i / (count - 1) : 0;
			const target = clamp(Math.round(53 - 31 * Math.pow(slot, 0.8) + pr.normal(0, 3.2)), 15, 62);
			const shifted = (d) => {
				const o = { fuzz: 0 };
				for (const k of BB.RATING_KEYS) {
					o[k] = k === "hgt" ? r.hgt : clamp(Math.round(r[k] + d), 1, 95);
				}
				return o;
			};
			let lo = -45;
			let hi = 45;
			for (let it = 0; it < 40; it++) {
				const mid = (lo + hi) / 2;
				if (BB.ovr(shifted(mid)) < target) lo = mid;
				else hi = mid;
			}
			r = shifted((lo + hi) / 2);
			r.ovr = BB.ovr(r);
			r.pot = clamp(r.ovr + Math.round(pr.uniform(3, 20)), r.ovr, 90);
			r.pos = BB.pos(r);
			r.skills = [];
			let first = pr.pick(FIRST);
			let last = pr.pick(LAST);
			for (let guard = 0; used.has(first + " " + last) && guard < 20; guard++) {
				first = pr.pick(FIRST);
				last = pr.pick(LAST);
			}
			used.add(first + " " + last);
			const loc = pickWeighted(pr, HOME);
			// Age spreads like a real class: mostly 19-21, a few 18s and 22s.
			const age = clamp(Math.round(pr.normal(19.9, 1.1)), 18, 23);
			players.push({
				pid: i,
				firstName: first, lastName: last,
				born: { year: yr - age, loc },
				hgt: 66 + Math.round((hgt / 100) * 24),
				weight: Math.round(165 + hgt * 0.9),
				college: pr.random() < 0.18 ? "" : pickCollege(pr.random()),
				draft: { year: yr, round: 1 + Math.floor(i / 30), pick: 1 + (i % 30) },
				ratings: [r],
			});
		}
		return { startingSeason: yr, players };
	}

	global.Sample = { makeClass };
})(typeof window !== "undefined" ? window : self);
