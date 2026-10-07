/* Sharing helpers that touch neither the DOM nor the engine: the link codec,
   deep-link fields, the command-line generator, the kept-class bundle and the
   batch contact sheet's CSV.

   They live apart from js/app.js so a Node test can read exactly what lands
   in an address bar, on a clipboard or in a downloaded file. Everything here
   is opt-in: a link written with nothing to compress is byte-for-byte the
   `#c=` link it always was, and a link in the old form still reads. */
(function (global) {
	"use strict";

	/* ------------------------------------------------------------- the codec

	   Two forms, told apart by the letter before the "=":

	     #c=<percent-encoded JSON>        the plain form, always readable
	     #z=<base64url of deflate-raw JSON>  written only when the plain form
	                                       would pass HASH_LIMIT

	   A link longer than the limit used to lose every lock. Deflate gets a
	   locks-heavy payload (repetitive JSON) to a fraction of its size, and
	   base64url keeps the result free of characters a browser re-encodes. */
	const HASH_LIMIT = 8000;

	const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

	function b64uEncode(bytes) {
		let out = "";
		const n = bytes.length;
		for (let i = 0; i < n; i += 3) {
			const a = bytes[i];
			const b = i + 1 < n ? bytes[i + 1] : 0;
			const c = i + 2 < n ? bytes[i + 2] : 0;
			out += B64[a >> 2] + B64[((a & 3) << 4) | (b >> 4)];
			if (i + 1 < n) out += B64[((b & 15) << 2) | (c >> 6)];
			if (i + 2 < n) out += B64[c & 63];
		}
		return out;
	}

	function b64uDecode(text) {
		const s = String(text || "").replace(/[=\s]+$/g, "");
		if (/[^A-Za-z0-9_-]/.test(s)) throw new Error("not base64url");
		if (s.length % 4 === 1) throw new Error("truncated base64url");
		const out = new Uint8Array(Math.floor((s.length * 3) / 4));
		let o = 0;
		for (let i = 0; i < s.length; i += 4) {
			const v = [0, 1, 2, 3].map((k) => (i + k < s.length ? B64.indexOf(s[i + k]) : 0));
			if (o < out.length) out[o++] = (v[0] << 2) | (v[1] >> 4);
			if (o < out.length) out[o++] = ((v[1] & 15) << 4) | (v[2] >> 2);
			if (o < out.length) out[o++] = ((v[2] & 3) << 6) | v[3];
		}
		return out;
	}

	const utf8 = (s) => (typeof TextEncoder === "function"
		? new TextEncoder().encode(s) : Uint8Array.from(unescape(encodeURIComponent(s)), (c) => c.charCodeAt(0)));
	const unutf8 = (b) => (typeof TextDecoder === "function"
		? new TextDecoder().decode(b) : decodeURIComponent(escape(String.fromCharCode.apply(null, b))));

	function plainBody(payload) { return encodeURIComponent(JSON.stringify(payload)); }
	function zipBody(deflated) { return b64uEncode(deflated); }

	/* Which form a location.hash is, and its body; null when it is neither. */
	function parseHash(hash) {
		const m = /[#&]([cz])=([^&]*)/.exec(String(hash || ""));
		if (!m || !m[2]) return null;
		return { kind: m[1], body: m[2] };
	}

	// The plain form, synchronously: undefined for a form that needs inflating.
	function decodePlain(body) {
		return JSON.parse(decodeURIComponent(body));
	}

	const canStream = () => typeof CompressionStream === "function" &&
		typeof DecompressionStream === "function" && typeof Response === "function";

	async function pipe(bytes, stream) {
		const w = stream.writable.getWriter();
		w.write(bytes).catch(() => {});
		w.close().catch(() => {});
		return new Uint8Array(await new Response(stream.readable).arrayBuffer());
	}
	const deflate = (bytes) => pipe(bytes, new CompressionStream("deflate-raw"));
	const inflate = (bytes) => pipe(bytes, new DecompressionStream("deflate-raw"));

	/* The address-bar fragment for a payload, shortest honest form first:

	     1. plain, when it fits;
	     2. compressed, when that fits;
	     3. the same two again without the locks (`overrides`, `fp`), with
	        `lean: true` so the caller can say the locks were left out.

	   `opts.deflate` replaces the stream (a test hands in zlib). Resolves to
	   { hash, form: "c"|"z", lean }. */
	async function encodeLink(payload, opts) {
		const o = opts || {};
		const limit = o.limit || HASH_LIMIT;
		const squeeze = o.deflate || (canStream() ? deflate : null);
		const attempt = async (p) => {
			if (!Object.keys(p).length) return { hash: "", form: "c" };
			const plain = plainBody(p);
			if (plain.length <= limit) return { hash: "#c=" + plain, form: "c" };
			if (squeeze) {
				const z = zipBody(await squeeze(utf8(JSON.stringify(p))));
				if (z.length <= limit && z.length < plain.length) return { hash: "#z=" + z, form: "z" };
			}
			return null;
		};
		const full = await attempt(payload);
		if (full) return Object.assign(full, { lean: false });
		const lean = Object.assign({}, payload);
		delete lean.overrides;
		delete lean.fp;
		const slim = await attempt(lean);
		if (slim) return Object.assign(slim, { lean: true });
		// Settings alone are over the limit: write them anyway, as plain.
		return { hash: Object.keys(lean).length ? "#c=" + plainBody(lean) : "", form: "c", lean: true };
	}

	// The payload a hash holds, or throws. `opts.inflate` replaces the stream.
	async function decodeLink(hash, opts) {
		const h = parseHash(hash);
		if (!h) return null;
		if (h.kind === "c") return decodePlain(h.body);
		const open = (opts && opts.inflate) || (canStream() ? inflate : null);
		if (!open) throw new Error("this browser cannot open a compressed link");
		return JSON.parse(unutf8(await open(b64uDecode(h.body))));
	}

	/* ------------------------------------------------------- deep-link fields

	   A link can name where to land: a tab, a prospect's page and a set of
	   compared prospects. They are keys into ONE class file, so they travel
	   with that file's fingerprint (`fp`) and are applied only when the file
	   on screen has the same one. */
	function deepFields(ctx) {
		const out = {};
		const c = ctx || {};
		if (c.tab && c.tab !== "board") out.tab = String(c.tab);
		if (c.player) out.pk = String(c.player);
		const cmp = (c.compare || []).filter((k) => typeof k === "string" && k);
		if (c.tab === "compare" && cmp.length) out.cmp = cmp.slice(0, 4);
		if (Object.keys(out).length && c.fp) out.fp = String(c.fp);
		return Object.keys(out).length ? out : {};
	}

	/* What a payload asks for, validated. `tabs` is the list of tab keys the
	   page has. Returns null when it asks for nothing. */
	function readDeep(payload, tabs) {
		if (!payload || typeof payload !== "object") return null;
		const d = {};
		if (typeof payload.tab === "string" && (!tabs || tabs.indexOf(payload.tab) !== -1)) d.tab = payload.tab;
		if (typeof payload.pk === "string" && payload.pk && payload.pk.length < 200) d.pk = payload.pk;
		if (Array.isArray(payload.cmp)) {
			const c = payload.cmp.filter((k) => typeof k === "string" && k && k.length < 200).slice(0, 4);
			if (c.length) d.cmp = c;
		}
		if (!Object.keys(d).length) return null;
		d.fp = typeof payload.fp === "string" ? payload.fp : null;
		return d;
	}

	// Whether a deep link may be applied to the file on screen.
	const deepApplies = (d, fileFp) => !!(d && d.fp && fileFp && d.fp === fileFp);

	/* ----------------------------------------------------- the command line

	   `bbgmdraft run file.json --seed S --set k=v ...`: the settings a link
	   carries, as the flags the CLI reads. Numbers, booleans and strings go
	   through --set; the note template goes through --notes; a table-valued
	   setting (the archetype and destination weights) has no flag form and
	   goes through `--settings file.json`, the page's own settings export. */
	function shellQuote(s) {
		s = String(s);
		if (s !== "" && /^[A-Za-z0-9_.,:=@%+\/-]+$/.test(s)) return s;
		return "'" + s.replace(/'/g, "'\\''") + "'";
	}

	const NOT_FLAGS = { seed: 1, overrides: 1, fp: 1, mu: 1, pinned: 1, tab: 1, pk: 1, cmp: 1,
		challenge: 1, ch: 1 };

	/* `delta` is the payload encodeConfig writes (settings that differ from
	   the defaults). Returns { text, notes } where `notes` are the comment lines
	   to print under the command. */
	function commandLine(o) {
		const delta = o.delta || {};
		const sets = [];
		const tables = [];
		let notesFlag = null;
		for (const k of Object.keys(delta).sort()) {
			if (NOT_FLAGS[k] || k.charAt(0) === "_") continue;
			const v = delta[k];
			if (k === "noteLines" && Array.isArray(v)) {
				notesFlag = v.length ? v.join(",") : "none";
				continue;
			}
			if (v !== null && typeof v === "object") { tables.push(k); continue; }
			if (v === null || v === undefined) continue;
			sets.push(k + "=" + (typeof v === "boolean" ? (v ? "true" : "false") : String(v)));
		}
		const parts = ["bbgmdraft", "run", shellQuote(o.file || "class.json")];
		if (o.year !== undefined && o.year !== null && o.year !== "") parts.push("--year", shellQuote(o.year));
		if (o.seed !== undefined && o.seed !== null && String(o.seed) !== "") parts.push("--seed", shellQuote(o.seed));
		for (const s of sets) parts.push("--set", shellQuote(s));
		if (notesFlag !== null) parts.push("--notes", shellQuote(notesFlag));
		const settingsFile = o.settingsFile || "settings.json";
		if (tables.length) parts.push("--settings", shellQuote(settingsFile));
		const notes = [];
		if (tables.length) {
			notes.push("# " + tables.join(", ") + (tables.length === 1 ? " is a table" : " are tables") +
				" and has no --set form: save the page's settings file (More ▾ → Export settings JSON) " +
				"as " + settingsFile + ". `--settings` is the command line's flag for it, so " +
				"it needs a bbgmdraft that has it.");
		}
		if (delta.mu && delta.mu.length) {
			notes.push("# Mutators (" + delta.mu.join(", ") + ") are a page feature; the command line runs without them.");
		}
		if (o.locks) {
			notes.push("# " + o.locks + " locked player" + (o.locks === 1 ? "" : "s") +
				" are not in the command; export them (More ▾ → locked prospects as CSV) if you need them.");
		}
		return { text: parts.join(" "), notes };
	}

	/* ------------------------------------------------------ kept classes (Q37)

	   A kept class is a run-history snapshot that is not subject to the
	   history's cap: the same fields restoreSession reads, a name and a note.
	   Exported and imported as one bundle. */
	const KEPT_FORMAT = "bbgm-draft-workshop/kept-classes";
	const KEPT_MAX = 200;

	const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
	const str = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");

	function cleanKept(b) {
		if (!isObj(b) || !isObj(b.cfg)) return null;
		const seed = b.seed !== undefined && b.seed !== null ? String(b.seed).slice(0, 200) : "";
		if (!seed) return null;
		const out = {
			id: str(b.id, 200) || ("kept/" + seed + "/" + (Number(b.at) || 0)),
			seed,
			keptName: str(b.keptName, 80).trim(),
			keptNote: str(b.keptNote, 2000),
			label: str(b.label, 200) || seed,
			name: str(b.name, 200),
			fingerprint: str(b.fingerprint, 40),
			flavor: typeof b.flavor === "string" ? b.flavor.slice(0, 80) : null,
			file: typeof b.file === "string" ? b.file.slice(0, 300) : null,
			fileFp: typeof b.fileFp === "string" ? b.fileFp.slice(0, 80) : null,
			season: Number.isFinite(Number(b.season)) ? Number(b.season) : null,
			at: Number.isFinite(Number(b.at)) ? Number(b.at) : 0,
			cfg: b.cfg,
			overrides: isObj(b.overrides) ? b.overrides : {},
			lastSeed: typeof b.lastSeed === "string" || typeof b.lastSeed === "number" ? b.lastSeed : null,
			kept: true,
		};
		const lists = (v) => (Array.isArray(v) ? v.filter(Array.isArray)
			.map((a) => a.filter((x) => typeof x === "string")) : undefined);
		const pool = lists(b.poolHistory);
		if (pool) out.poolHistory = pool;
		const anom = lists(b.anomalyHistory);
		if (anom) out.anomalyHistory = anom;
		if (Array.isArray(b.flavorHistory)) out.flavorHistory = b.flavorHistory.filter((x) => typeof x === "string");
		if (isObj(b.fileCfgs)) out.fileCfgs = b.fileCfgs;
		return out;
	}

	function keptList(v) {
		return (Array.isArray(v) ? v : []).map(cleanKept).filter(Boolean).slice(0, KEPT_MAX);
	}

	function makeBundle(list, now) {
		return { format: KEPT_FORMAT, v: 1, at: now || Date.now(), kept: keptList(list) };
	}

	// -> { list, dropped } or { error }
	function parseBundle(json) {
		if (typeof json === "string") {
			try { json = JSON.parse(json); } catch (e) { return { error: "That file is not JSON." }; }
		}
		if (!isObj(json) || json.format !== KEPT_FORMAT) {
			return { error: "That is not a bundle of kept classes." };
		}
		const raw = Array.isArray(json.kept) ? json.kept : [];
		const list = keptList(raw);
		return { list, dropped: raw.length - list.length };
	}

	/* The incoming classes added to the ones already kept; one with the same
	   id is the same class and is not added twice (the newer name and note
	   win). Newest first, capped. */
	function mergeKept(have, incoming) {
		const byId = new Map(have.map((k) => [k.id, k]));
		let added = 0;
		let updated = 0;
		for (const k of incoming) {
			if (byId.has(k.id)) { updated++; byId.set(k.id, Object.assign({}, byId.get(k.id), { keptName: k.keptName, keptNote: k.keptNote })); }
			else { added++; byId.set(k.id, k); }
		}
		const list = Array.from(byId.values()).sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, KEPT_MAX);
		return { list, added, updated };
	}

	/* ------------------------------------------- the batch contact sheet (Q27) */

	const csvCell = (v) => {
		const s = v === null || v === undefined ? "" : String(v);
		return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
	};

	const topLine = (t) => (t ? t.name + " (" + t.pos + " " + t.ovr + "/" + t.pot + ")" : "");

	// One CSV for a batch, one row per class.
	function contactCsv(rows) {
		const head = ["class", "seed", "flavor", "strangeness", "tall big in top 5", "mean ovr", "mean pot",
			"ppg", "champion", "top 1", "top 2", "top 3", "top 4", "top 5"];
		const lines = [head.join(",")];
		(rows || []).forEach((r, i) => {
			const top = Array.isArray(r.top5) ? r.top5 : [];
			lines.push([i + 1, r.seed, r.flavor, r.strangeness, r.tallBig ? "yes" : "no",
				Number.isFinite(r.ovr) ? r.ovr.toFixed(2) : "", Number.isFinite(r.pot) ? r.pot.toFixed(2) : "",
				Number.isFinite(r.ppg) ? r.ppg.toFixed(2) : "", r.champion,
				topLine(top[0]), topLine(top[1]), topLine(top[2]), topLine(top[3]), topLine(top[4])]
				.map(csvCell).join(","));
		});
		return lines.join("\r\n") + "\r\n";
	}

	global.Share = { HASH_LIMIT, KEPT_FORMAT, KEPT_MAX, b64uEncode, b64uDecode, plainBody, zipBody, parseHash,
		decodePlain, encodeLink, decodeLink, canStream, deepFields, readDeep, deepApplies,
		shellQuote, commandLine, cleanKept, keptList, makeBundle, parseBundle, mergeKept, contactCsv, topLine };
})(typeof window !== "undefined" ? window : self);
