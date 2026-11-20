'use strict';
/**
 * window.js - the Waze map larger on the instrument cluster, out to the stock speedometer and tachometer.
 *
 * Waze on cluster (with its panel support) draws the map, while a map window is asked for, at that window on the
 * cluster's whole panel instead of in its own 1088x480 box: the ask is /dev/shm/cluster-info/map_window.txt, one
 * line "panel X Y W H", kept fresh (it goes stale after 3.5 s and the map goes back to its box). This app asks for
 * a window centred on the cluster, W x H from its settings, and nothing else: the stock gauges stay as they are.
 *
 * It asks only while the Waze map shows on the cluster, and never over another app's window (a cluster layout's):
 * a fresh file this app did not write is left alone. The app stopping stops the writes, and the map is back in
 * its box within seconds.
 *
 *   const mw = new MapWindow({ settings, log, now, fs });
 *   mw.tick();       // every TICK_MS
 *   mw.state         // { asking, why, rect, waze }
 */
const path = require('path');

const FILE = '/dev/shm/cluster-info/map_window.txt';
const STATUS = '/run/waze-on-cluster/status.json';
const PANEL = { w: 1920, h: 720 };
const LIMIT = { minW: 1088, maxW: 1920, minH: 480, maxH: 720, step: 40 };
const DEFAULT = { w: 1280, h: 560 };
const TICK_MS = 500;
const REWRITE_MS = 1000;        // the window rewritten this often (Waze on cluster: stale after 3500 ms)
const STATUS_OLD_MS = 5000;     // Waze on cluster's status older than this: not running
const OTHERS_MS = 5000;         // another app's window file younger than this: theirs, left alone

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const even4 = (v) => Math.round(v / 4) * 4;

/** The window for the settings: W x H (held to the limits), centred, moved down by dy (held on the panel). */
function rectOf(settings) {
    const w = even4(clamp(Number(settings.get('width')) || DEFAULT.w, LIMIT.minW, LIMIT.maxW));
    const h = even4(clamp(Number(settings.get('height')) || DEFAULT.h, LIMIT.minH, LIMIT.maxH));
    const dy = Number(settings.get('offsetY')) || 0;
    const x = Math.round((PANEL.w - w) / 2);
    const y = clamp(Math.round((PANEL.h - h) / 2) + dy, 0, PANEL.h - h);
    return { x, y, w, h };
}
const lineOf = (r) => 'panel ' + r.x + ' ' + r.y + ' ' + r.w + ' ' + r.h + '\n';

/** Waze on cluster's status: the map on the cluster ({ live, hosted, state, target }). */
function parseStatus(s) {
    if (!s || typeof s !== 'object') return { live: false, hosted: false, state: null, target: null };
    const target = String(s.target || '').split('+')[0] || null;
    const live = s.cluster !== 0 && (target === 'map' || target === 'panel') && (s.state === 'showing' || s.state === 'starting');
    return { live, hosted: !!s.hosted, state: s.state || null, target };
}

class MapWindow {
    constructor(o) {
        this.settings = o.settings; this.log = o.log;
        this.now = o.now || Date.now;
        this.fs = o.fs || require('fs');
        this.file = o.file || FILE;
        this.statusPath = o.statusPath || STATUS;
        this.asking = false; this.written = null; this.writtenT = -1e12; this.why = 'starting';
        this.status = parseStatus(null); this.statusT = 0;
        this.warned = {};
    }

    _warn(k, m) { if (!this.warned[k]) { this.warned[k] = true; this.log.warn('map size: ' + m); } }

    _readStatus() {
        try {
            const st = this.fs.statSync(this.statusPath);
            this.status = parseStatus(JSON.parse(this.fs.readFileSync(this.statusPath, 'utf8')));
            this.statusT = st.mtime.getTime();
        } catch (e) { if (e.code === 'ENOENT') { this.status = parseStatus(null); this.statusT = 0; } }   // (half written: the last one)
    }

    /** Whether the file there now is another app's fresh window. */
    _othersWindow() {
        let st, txt;
        try { st = this.fs.statSync(this.file); txt = this.fs.readFileSync(this.file, 'utf8'); } catch (e) { return false; }
        const ours = this.written !== null && txt === this.written;
        return !ours && this.now() - st.mtime.getTime() < OTHERS_MS;
    }

    _write(line) {
        const dir = path.dirname(this.file), tmp = path.join(dir, '.map_window.' + process.pid + '.tmp');
        try {
            try { this.fs.mkdirSync(dir, 0o1777); } catch (e) { if (e.code !== 'EEXIST') throw e; }
            this.fs.writeFileSync(tmp, line, { mode: 0o644 });
            this.fs.renameSync(tmp, this.file);
            this.written = line; this.writtenT = this.now();
            return true;
        } catch (e) { this._warn('write', 'cannot write ' + this.file + ': ' + e.message); return false; }
    }

    /** The ask withdrawn: the file removed, if it is still ours. */
    _stop(why) {
        if (this.asking) {
            let txt = null;
            try { txt = this.fs.readFileSync(this.file, 'utf8'); } catch (e) { /* gone */ }
            if (txt !== null && txt === this.written) { try { this.fs.unlinkSync(this.file); } catch (e) { /* gone */ } }
            this.log.info('map size: off (' + why + ')');
        }
        this.asking = false; this.written = null;
        this.why = why;
    }

    tick() {
        this._readStatus();
        const t = this.now();
        if (this.settings.get('enabled') === false) return this._stop('switched off');
        if (!this.statusT || t - this.statusT > STATUS_OLD_MS) return this._stop('Waze on cluster not running');
        if (this.status.hosted) return this._stop('another app hosts the map');
        if (!this.status.live) return this._stop('the Waze map is not on the cluster');
        if (this._othersWindow()) return this._stop('another app has the map window');
        const line = lineOf(rectOf(this.settings));
        if (line !== this.written || t - this.writtenT >= REWRITE_MS) {
            if (!this._write(line)) return this._stop('cannot write the window');
            if (!this.asking) this.log.info('map size: on, ' + line.trim());
            this.asking = true;
        }
        this.why = this.status.target === 'panel' ? 'on: the map larger' : 'asked: Waze on cluster moving the map (or not updated yet)';
        return undefined;
    }

    get state() { return { asking: this.asking, why: this.why, rect: rectOf(this.settings), waze: this.status.state, target: this.status.target }; }

    close() { this._stop('the app stops'); }
}

module.exports = { MapWindow, rectOf, lineOf, parseStatus, PANEL, LIMIT, DEFAULT, TICK_MS, FILE };
