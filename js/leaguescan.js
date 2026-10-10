/* READING A LEAGUE FILE WITHOUT HOLDING ALL OF IT (audit §3, L1-L4, L6, L9, L11).

   A BBGM league export is tens to hundreds of megabytes of JSON, and the
   tool reads nine of its top-level keys. The old path held the compressed
   bytes, the decompressed bytes, a whole-file string (two bytes a character)
   and the parsed object all at once, about five times the JSON size, and a
   file over 512 MiB of JSON could not be opened at all: V8 will not build a
   string that long and Chromium's TextDecoder returns "" instead of throwing.

   This file is a byte scanner that never builds the whole string:

   - createScanner() is fed the decompressed bytes chunk by chunk. It follows
     the JSON structure (depth, strings, escapes) and records each top-level
     key's byte range. The value of a key the tool reads is decoded and
     parsed on its own; `players` is parsed one element at a time, so no
     slice is ever bigger than one player. The big stores the tool never
     reads (box scores, events, team stats...) are skipped: only their byte
     range is kept, for the merge.
   - createSplicer() writes a merge: it re-reads the same bytes and copies
     every untouched store through as raw bytes, asking the caller for the
     new value of the keys it replaces (players, bbgmdraft).
   - sniff() names the wrong-type files (zip, UTF-16, not JSON) before any of
     that runs, so they get a sentence instead of a parser's error text.
   - scanBlob()/spliceBlob() are the browser halves (web streams); the CLI
     drives the same scanner and splicer over Node buffers.

   No DOM and no engine: this loads in the page, the worker and Node. */
(function (root) {
	"use strict";

	/* The stores a league carries that this tool never reads. Their bytes go
	   through a merge untouched; parsing them only cost memory and time.
	   Generic names a universe or class export might use (awards, meta) are
	   not in the list: a key is skipped only when it is one of these. */
	const SKIP_STORES = ["games", "events", "teamStats", "schedule", "playoffSeries",
		"messages", "playerFeats", "allStars", "headToHeads", "draftLotteryResults",
		"negotiations", "releasedPlayers", "scheduledEvents", "seasonLeaders",
		"savedTrades", "savedTradingBlock", "trade"];
	// Parsed one element at a time: the one store that can be huge AND is read.
	const PER_ELEMENT = ["players"];
	// V8's longest string, in UTF-16 code units.
	const MAX_STRING = 0x1fffffe8;

	const WS = new Uint8Array(256);
	WS[0x20] = WS[0x09] = WS[0x0a] = WS[0x0d] = 1;

	function fail(code, message) {
		const e = new Error(message);
		e.code = code;
		return e;
	}
	function mbText(n) {
		return n >= 1 << 20 ? (n / (1 << 20)).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";
	}

	/* WHAT KIND OF FILE IS THIS, from its first bytes (after any gzip layers
	   are off). Returns one of: "json" (starts with { or [), "zip", "utf16le",
	   "utf16be", "gzip" (still compressed: a double-gzipped file), "empty",
	   "notjson". */
	function sniff(head) {
		const h = head || new Uint8Array(0);
		if (!h.length) return "empty";
		if (h[0] === 0x1f && h[1] === 0x8b) return "gzip";
		if (h[0] === 0x50 && h[1] === 0x4b && (h[2] === 3 || h[2] === 5 || h[2] === 7)) return "zip";
		if (h[0] === 0xff && h[1] === 0xfe) return "utf16le";
		if (h[0] === 0xfe && h[1] === 0xff) return "utf16be";
		// UTF-16 without a byte-order mark: every other byte zero around a brace.
		if (h.length >= 4 && h[1] === 0 && h[3] === 0 && (h[0] === 0x7b || h[0] === 0x5b)) return "utf16le";
		if (h.length >= 4 && h[0] === 0 && h[2] === 0 && (h[1] === 0x7b || h[1] === 0x5b)) return "utf16be";
		let i = 0;
		if (h[0] === 0xef && h[1] === 0xbb && h[2] === 0xbf) i = 3;
		while (i < h.length && WS[h[i]]) i++;
		if (i >= h.length) return "empty";
		return h[i] === 0x7b || h[i] === 0x5b ? "json" : "notjson";
	}

	// The sentence for a kind sniff() refuses, or null for one it does not.
	function sniffMessage(kind) {
		if (kind === "zip") return "This is a .zip archive, not a league or class file — unzip it and drop the .json inside.";
		if (kind === "notjson") return "This is not a JSON file — drop a BBGM league or draft-class export (.json or .json.gz).";
		if (kind === "empty") return "The file is empty.";
		if (kind === "gzip") return "The file is gzipped more than three times over — unzip it first.";
		return null;
	}

	/* A gzip's own record of its unpacked size: the last four bytes (ISIZE,
	   modulo 4 GiB). Exact for a single-member gzip, which is what BBGM and
	   every browser write. */
	function gzipSize(tail4) {
		if (!tail4 || tail4.length < 4) return null;
		return (tail4[0] | (tail4[1] << 8) | (tail4[2] << 16)) + tail4[3] * 0x1000000;
	}

	/* Parse a JSON text the way the page used to, but say what a truncated
	   file is instead of quoting the parser. `bytes` is the size shown. */
	function parseText(text, bytes) {
		try {
			return JSON.parse(text);
		} catch (e) {
			const m = /position (\d+)/.exec(String(e && e.message));
			const at = m ? Number(m[1]) : -1;
			if (/Unexpected end|Unterminated/i.test(String(e && e.message)) ||
				(at >= 0 && at >= text.length * 0.99 - 2)) {
				throw fail("truncated", "The file stops partway (" + mbText(bytes || text.length) +
					") — the download or export did not finish. Export or download it again.");
			}
			throw e;
		}
	}

	/* THE SCANNER.

	   opts.keep(key) -> false skips a top-level key's value (only its range is
	   kept). Default: skip SKIP_STORES. opts.perElement: keys whose array value
	   is parsed one element at a time (default ["players"]).

	   push(chunk) feeds the next bytes; end() returns
	     { top: "object", data, keys, ranges, skipped, closeAt, length }
	   or, when the top level is not an object (a bare array of players),
	     { top: "other", bytes } for the caller to decode as a whole.
	   ranges[key] = [start, end): the value's bytes, without the whitespace
	   around it. closeAt is the offset of the closing brace. */
	function createScanner(opts) {
		const o = opts || {};
		const skipSet = new Set(o.skip || SKIP_STORES);
		const keep = typeof o.keep === "function" ? o.keep : (k) => !skipSet.has(k);
		const perEl = new Set(o.perElement || PER_ELEMENT);
		const decoder = new TextDecoder("utf-8");

		let pos = 0; // absolute offset of the current chunk
		let started = false;
		let top = null; // "object" | "other"
		let otherParts = null;
		let bomLeft = 3;
		let depth = 0;
		let inStr = false;
		let esc = false;
		let lastNonWs = -1; // absolute
		// Top-level phase: "key" (want a key or }), "inkey", "colon", "value", "inval".
		let phase = "key";
		let keyParts = [];
		let keyFrom = 0;
		let key = null;
		let valStart = -1;
		let mode = null; // "parse" | "skip" | "elements"
		let elStart = -1;
		let elems = null;
		let closed = false;
		let closeAt = -1;
		// The capture buffer: bytes from capStart (absolute) on.
		let cap = false;
		let capStart = -1;
		let capParts = [];
		let capFrom = 0;
		const data = {};
		const keys = [];
		const ranges = {};
		const skipped = [];

		function startCap(i) {
			cap = true;
			capStart = pos + i;
			capParts = [];
			capFrom = i;
		}
		function endCap(chunk, i, endAbs) {
			capParts.push(chunk.subarray(capFrom, i));
			cap = false;
			const len = endAbs - capStart;
			let buf;
			if (capParts.length === 1) buf = capParts[0];
			else {
				let n = 0;
				for (const p of capParts) n += p.length;
				buf = new Uint8Array(n);
				let at = 0;
				for (const p of capParts) { buf.set(p, at); at += p.length; }
			}
			capParts = [];
			return decoder.decode(buf.subarray(0, len));
		}
		function parsePart(text, what) {
			try { return JSON.parse(text); } catch (e) {
				throw new SyntaxError(String(e && e.message || e) + " (in " + what + ")");
			}
		}
		function finishValue(chunk, i) {
			const endAbs = lastNonWs + 1;
			ranges[key] = [valStart, endAbs];
			if (mode === "parse") data[key] = parsePart(endCap(chunk, i, endAbs), '"' + key + '"');
			else if (mode === "elements") data[key] = elems;
			key = null;
			mode = null;
			elems = null;
		}

		function push(chunk) {
			if (closed) { pos += chunk.length; return; }
			let i = 0;
			const n = chunk.length;
			if (!started) {
				while (bomLeft > 0 && i < n && chunk[i] === [0xef, 0xbb, 0xbf][3 - bomLeft]) { i++; bomLeft--; }
				bomLeft = 0;
				while (i < n && WS[chunk[i]]) i++;
				if (i >= n) { pos += n; return; }
				started = true;
				if (chunk[i] !== 0x7b) {
					top = "other";
					otherParts = [chunk.subarray(i)];
					pos += n;
					return;
				}
				top = "object";
				depth = 1;
				phase = "key";
				i++;
			}
			if (top === "other") { otherParts.push(chunk); pos += n; return; }
			if (cap) capFrom = 0;
			if (phase === "inkey") keyFrom = 0;
			for (; i < n; i++) {
				const c = chunk[i];
				if (inStr) {
					lastNonWs = pos + i;
					if (esc) esc = false;
					else if (c === 0x5c) esc = true;
					else if (c === 0x22) {
						inStr = false;
						if (phase === "inkey") {
							keyParts.push(chunk.subarray(keyFrom, i));
							let len = 0;
							for (const p of keyParts) len += p.length;
							const kb = new Uint8Array(len);
							let at = 0;
							for (const p of keyParts) { kb.set(p, at); at += p.length; }
							key = JSON.parse('"' + decoder.decode(kb) + '"');
							keyParts = [];
							phase = "colon";
						} else if (mode === "elements" && depth === 2) {
							// A string element closed; it ends at the next , or ].
						}
					}
					continue;
				}
				if (WS[c]) continue;
				if (depth === 1) {
					if (phase === "key") {
						if (c === 0x22) { inStr = true; phase = "inkey"; keyFrom = i + 1; keyParts = []; lastNonWs = pos + i; continue; }
						if (c === 0x7d) { closed = true; closeAt = pos + i; depth = 0; break; }
						if (c === 0x2c && keys.length) continue;
						throw fail("badjson", "This is not valid JSON (byte " + (pos + i) + ").");
					}
					if (phase === "colon") {
						if (c !== 0x3a) throw fail("badjson", "This is not valid JSON (byte " + (pos + i) + ").");
						phase = "value";
						continue;
					}
					if (phase === "value") {
						keys.push(key);
						valStart = pos + i;
						lastNonWs = pos + i;
						phase = "inval";
						if (!keep(key)) { mode = "skip"; skipped.push(key); }
						else if (perEl.has(key) && c === 0x5b) { mode = "elements"; elems = []; elStart = -1; }
						else { mode = "parse"; startCap(i); }
						if (c === 0x22) inStr = true;
						else if (c === 0x7b || c === 0x5b) depth = 2;
						continue;
					}
					// phase "inval" at depth 1: the value (a primitive, or a
					// container that has closed) ends at , or }.
					if (c === 0x2c || c === 0x7d) {
						finishValue(chunk, i);
						if (c === 0x7d) { closed = true; closeAt = pos + i; depth = 0; break; }
						phase = "key";
						continue;
					}
					lastNonWs = pos + i;
					continue;
				}
				// depth >= 2: inside a top-level value.
				if (mode === "elements" && depth === 2) {
					if (c === 0x2c || c === 0x5d) {
						if (elStart >= 0) {
							elems.push(parsePart(endCap(chunk, i, lastNonWs + 1), key + " #" + elems.length));
							elStart = -1;
						}
						if (c === 0x5d) { depth = 1; lastNonWs = pos + i; }
						continue;
					}
					if (elStart < 0) { elStart = pos + i; startCap(i); }
				}
				lastNonWs = pos + i;
				if (c === 0x22) inStr = true;
				else if (c === 0x7b || c === 0x5b) depth++;
				else if (c === 0x7d || c === 0x5d) depth--;
			}
			if (cap) { capParts.push(chunk.slice(capFrom)); capFrom = 0; }
			if (phase === "inkey" && inStr) keyParts.push(chunk.slice(keyFrom));
			pos += n;
		}

		function end() {
			if (!started) throw fail("empty", "The file is empty.");
			if (top === "other") {
				let len = 0;
				for (const p of otherParts) len += p.length;
				const bytes = new Uint8Array(len);
				let at = 0;
				for (const p of otherParts) { bytes.set(p, at); at += p.length; }
				return { top, bytes, length: pos };
			}
			if (!closed) {
				throw fail("truncated", "The file stops partway (" + mbText(pos) +
					") — the download or export did not finish. Export or download it again.");
			}
			if (skipped.length) {
				Object.defineProperty(data, "__omitted", { value: skipped.slice(), enumerable: false });
			}
			return { top, data, keys, ranges, skipped, closeAt, length: pos };
		}

		return { push, end, get position() { return pos; } };
	}

	/* THE SPLICER. Given the scan of a file (ranges, closeAt) and the keys to
	   replace, push() the same bytes again and get back a list of pieces:
	   Uint8Arrays to copy through, and {key} markers where the caller writes
	   that key's new value. {append: true} marks the spot before the closing
	   brace, where keys the file did not have are added. */
	function createSplicer(scan, replaceKeys) {
		const cuts = [];
		for (const k of replaceKeys) {
			if (scan.ranges[k]) cuts.push({ key: k, start: scan.ranges[k][0], end: scan.ranges[k][1] });
		}
		cuts.sort((a, b) => a.start - b.start);
		cuts.push({ append: true, start: scan.closeAt, end: scan.closeAt });
		let pos = 0;
		let ci = 0;
		function push(chunk) {
			const out = [];
			const n = chunk.length;
			let i = 0;
			while (i < n) {
				const abs = pos + i;
				const cut = cuts[ci];
				if (!cut) { out.push(chunk.subarray(i)); break; }
				if (abs < cut.start) {
					const take = Math.min(n - i, cut.start - abs);
					out.push(chunk.subarray(i, i + take));
					i += take;
					continue;
				}
				if (abs === cut.start && !cut.done) {
					cut.done = true;
					out.push(cut.append ? { append: true } : { key: cut.key });
				}
				if (abs < cut.end) { i += Math.min(n - i, cut.end - abs); continue; }
				ci++;
			}
			pos += n;
			return out;
		}
		return { push };
	}

	/* A value as JSON text in pieces of about a megabyte: an array is written
	   one element at a time, so no single string is the size of `players`. */
	function* valueChunks(v) {
		if (Array.isArray(v) && v.length > 64) {
			let buf = "[";
			for (let i = 0; i < v.length; i++) {
				buf += (i ? "," : "") + JSON.stringify(v[i]);
				if (buf.length > 1 << 20) { yield buf; buf = ""; }
			}
			yield buf + "]";
		} else yield JSON.stringify(v);
	}
	// The keys in `add` the scanned file does not have, as `,"key":value` text.
	function* addedChunks(scan, add) {
		let any = scan.keys.length > 0;
		for (const k of Object.keys(add || {})) {
			if (scan.ranges[k] || add[k] === undefined) continue;
			yield (any ? "," : "") + JSON.stringify(k) + ":";
			any = true;
			yield* valueChunks(add[k]);
		}
	}

	/* ------------------------------------------------ browser (web streams) */

	function readAll(stream) {
		return new Response(stream).arrayBuffer().then((b) => new Uint8Array(b));
	}

	// The first chunk of a stream, and a stream that still starts with it.
	function peek(stream) {
		const reader = stream.getReader();
		return reader.read().then(({ done, value }) => {
			const first = done ? new Uint8Array(0) : value;
			let sent = false;
			const rest = new ReadableStream({
				pull(ctl) {
					if (!sent) { sent = true; if (first.length) { ctl.enqueue(first); return; } }
					return reader.read().then((r) => { if (r.done) ctl.close(); else ctl.enqueue(r.value); });
				},
				cancel(why) { return reader.cancel(why); },
			});
			return { first, stream: rest };
		});
	}

	/* The decompressed bytes of a Blob, as a stream: as many gzip layers as
	   it has (a double-gzipped file is unwrapped, up to three), the bytes
	   counted as they leave the disk. Resolves to {stream, first, layers}. */
	function openBlob(blob, onBytes) {
		let seen = 0;
		let last = 0;
		const size = Number(blob.size) || 0;
		const counter = new TransformStream({
			transform(chunk, ctl) {
				seen += chunk.byteLength;
				if (onBytes && (seen - last >= size / 200 || seen === size)) { last = seen; onBytes(seen, size); }
				ctl.enqueue(chunk);
			},
		});
		let layers = 0;
		const step = (s) => peek(s).then(({ first, stream }) => {
			if (sniff(first) === "gzip" && layers < 3) {
				if (typeof DecompressionStream === "undefined") {
					throw fail("nogz", "this browser cannot open a .gz file — unzip it first");
				}
				layers++;
				return step(stream.pipeThrough(new DecompressionStream("gzip")));
			}
			return { first, stream, layers };
		});
		return step(blob.stream().pipeThrough(counter));
	}

	function gzFail(e) {
		if (e && (e.code || e.name === "AbortError")) return e;
		return fail("gzbad", "the .gz file is incomplete or corrupt — download or export it again");
	}

	// Lets the page paint between chunks: a macrotask every ~40 ms of work.
	function breather() {
		let t = Date.now();
		return () => {
			if (Date.now() - t < 40) return null;
			return new Promise((r) => setTimeout(() => { t = Date.now(); r(); }, 0));
		};
	}

	/* Scan a dropped Blob/File. opts: onBytes(seen, size), onUnpacked(n),
	   signal (an AbortSignal), keep/skip/perElement (see createScanner).
	   Resolves to {data, scan, gz, layers, bytes, kind}. A file that is not a
	   top-level object (a bare array, UTF-16) is decoded and parsed whole. */
	function scanBlob(blob, opts) {
		const o = opts || {};
		return openBlob(blob, o.onBytes).then(({ first, stream, layers }) => {
			const kind = sniff(first);
			const said = sniffMessage(kind);
			if (said) { stream.cancel().catch(() => null); throw fail(kind, said); }
			if (kind === "utf16le" || kind === "utf16be") {
				return readAll(stream).then((u8) => {
					const text = new TextDecoder(kind === "utf16le" ? "utf-16le" : "utf-16be").decode(u8)
						.replace(/^﻿/, "");
					return { data: parseText(text, u8.length), scan: null, gz: layers > 0, layers, bytes: u8.length, kind };
				}, (e) => { throw layers ? gzFail(e) : e; });
			}
			const sc = createScanner(o);
			const reader = stream.getReader();
			const pause = breather();
			const pump = () => {
				if (o.signal && o.signal.aborted) {
					reader.cancel().catch(() => null);
					const e = new Error("Cancelled.");
					e.name = "AbortError";
					return Promise.reject(e);
				}
				return reader.read().then(({ done, value }) => {
					if (done) return null;
					sc.push(value);
					if (o.onUnpacked) o.onUnpacked(sc.position);
					const p = pause();
					return p ? p.then(pump) : pump();
				});
			};
			return pump().catch((e) => {
				if (e && (e.code || e.name === "AbortError" || e instanceof SyntaxError)) throw e;
				throw layers ? gzFail(e) : e;
			}).then(() => {
				const scan = sc.end();
				if (scan.top === "other") {
					if (scan.bytes.length > MAX_STRING) throw tooLong(scan.bytes.length);
					const text = new TextDecoder("utf-8").decode(scan.bytes);
					if (!text.length && scan.bytes.length) throw tooLong(scan.bytes.length);
					return { data: parseText(text, scan.bytes.length), scan: null, gz: layers > 0, layers, bytes: scan.bytes.length, kind };
				}
				return { data: scan.data, scan, gz: layers > 0, layers, bytes: scan.length, kind };
			});
		});
	}

	function tooLong(n) {
		return fail("toolong", "This file is " + mbText(n) + " unpacked, and a browser cannot hold " +
			"one piece of text that large. Re-export the league without box scores and events " +
			"(BBGM's export options), or split it.");
	}

	/* Write a merge as a Blob: the source's bytes with `replace` keys swapped
	   for new values. replace: { key: value } (players is written one element
	   at a time), add: { key: value } for keys the file lacks. opts.gzip
	   compresses the output; opts.onProgress(frac). Needs the scan of the
	   SAME bytes (scanBlob's scan). */
	function spliceBlob(blob, scan, replace, add, opts) {
		const o = opts || {};
		const enc = new TextEncoder();
		const keysIn = Object.keys(replace);
		const total = scan.length || 1;
		return openBlob(blob, null).then(({ stream }) => {
			const reader = stream.getReader();
			const sp = createSplicer(scan, keysIn);
			let queue = [];
			let done = false;
			let copied = 0;
			const pause = breather();
			const valueText = valueChunks;
			const addText = () => addedChunks(scan, add);
			const out = new ReadableStream({
				pull(ctl) {
					const next = () => {
						if (queue.length) {
							const q = queue[0];
							if (q instanceof Uint8Array) { queue.shift(); ctl.enqueue(q); return null; }
							const r = q.next();
							if (r.done) { queue.shift(); return next(); }
							if (r.value) ctl.enqueue(enc.encode(r.value));
							return null;
						}
						if (done) { ctl.close(); return null; }
						const p = pause();
						return (p || Promise.resolve()).then(() => reader.read()).then((r) => {
							if (r.done) { done = true; return next(); }
							copied += r.value.length;
							if (o.onProgress) o.onProgress(Math.min(1, copied / total));
							queue = sp.push(r.value).map((piece) => (piece instanceof Uint8Array ? piece
								: piece.append ? addText() : valueText(replace[piece.key])));
							return next();
						});
					};
					return next();
				},
				cancel(why) { return reader.cancel(why); },
			});
			let s = out;
			if (o.gzip) s = s.pipeThrough(new CompressionStream("gzip"));
			return new Response(s).blob().then((b) => new Blob([b], {
				type: o.gzip ? "application/gzip" : "application/json",
			}));
		});
	}

	const api = {
		SKIP_STORES, PER_ELEMENT, MAX_STRING,
		sniff, sniffMessage, gzipSize, parseText, createScanner, createSplicer, tooLong, gzFail, valueChunks, addedChunks,
		scanBlob, spliceBlob, openBlob,
	};
	if (typeof module !== "undefined" && module.exports) module.exports = api;
	root.LeagueScan = api;
})(typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : this);
