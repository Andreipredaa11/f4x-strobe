'use strict';
/**
 * fullmap.js - the Waze map over the whole instrument cluster, with this app's own speed and engine speed on it.
 *
 * Waze on cluster (robertnisipeanu/idrive-apps, with its "Full cluster" mode) puts the map over the whole cluster
 * while an app keeps rewriting /dev/shm/full-cluster/request.json with {"v":1,"full":1,...}; it goes back to the
 * map area between the stock gauges once the file is 1.5 s old. The map then covers the stock speedometer, so this
 * app draws the speed itself, and asks only while it can:
 *
 *   1. The Waze map shows on the cluster (waze-on-cluster's /run/waze-on-cluster/status.json, at most 5 s old).
 *   2. The car's speed came in the last SIGNAL_MS (the real signal: never demo data).
 *   3. Its two readouts (speed left, engine speed right) are on the cluster: drawn on the renderer's panel target,
 *      class overlay, over the map, and the renderer says both are shown. Only then is the first ask written, so
 *      the speed is on screen before the map covers the stock one.
 *
 * Any of them gone: the ask is withdrawn at once ("full":0, then the file removed) and the map is back between the
 * stock gauges; the readouts stay until the status says the map is not full any more (or HIDE_AFTER_MS), so the
 * speed never disappears while the map still covers the stock one. The app stopping, hanging or being removed
 * stops the writes, and the tool gives the cluster back by itself within 1.5 s.
 *
 *   const fm = new FullMap({ settings, log, now, fs, ClusterRender, statusPath, requestPath });
 *   fm.speed(kmh); fm.rpm(rpm);       // from the car's signals
 *   fm.tick();                        // every TICK_MS: reads the status, decides, draws, writes the ask
 *   fm.state -> { asking, why, full, shown, ... } for the page
 */
const path = require('path');
const { Canvas, withAlpha } = require('./kit/canvas');

const APP = 'f4x_full_cluster';
const STATUS = '/run/waze-on-cluster/status.json';
const REQUEST = '/dev/shm/full-cluster/request.json';
const TICK_MS = 100;            // decisions and drawing
const ASK_EVERY_MS = 400;       // the ask rewritten this often (the tool's limit: 1500 ms)
const STATUS_EVERY_MS = 250;    // status.json read this often
const STATUS_OLD_MS = 5000;     // a status older than this: the tool is not running
const SIGNAL_MS = 2500;         // the speed older than this: not known
const HIDE_AFTER_MS = 3000;     // the readouts kept this long after the ask ends, at most (until the map is back)

/** Where the readouts go on the 1920x720 cluster: over the stock speedometer (left) and tachometer (right). */
const BOX = {
    speed: { x: 70, y: 190, w: 420, h: 340 },
    rpm: { x: 1430, y: 190, w: 420, h: 340 },
};

/**
 * Whether the Waze map shows on the cluster, from waze-on-cluster's status line: { live, full, target, state }.
 * live: showing on the cluster (map or panel), or starting on the panel in full (the moment it moves there).
 */
function parseStatus(s) {
    if (!s || typeof s !== 'object') return { live: false, full: false, target: null, state: null };
    const target = String(s.target || '').split('+')[0] || null;
    const onCluster = s.cluster !== 0 && (target === 'map' || target === 'panel');
    const full = s.full === 1 && target === 'panel';
    const live = onCluster && (s.state === 'showing' || (full && s.state === 'starting'));
    return { live, full, target, state: s.state || null };
}

const fmt = (n) => String(Math.round(n));

/** The box a readout is drawn in: the whole canvas (a cluster layer), or b on a larger one (the page). */
const boxOf = (cv, b) => b || { x: 0, y: 0, w: cv.w, h: cv.h };
function card(cv, t, b) {
    const r = Math.round(b.h * 0.1);
    cv.roundRect(b.x, b.y, b.w, b.h, r, withAlpha('#05080d', 0.82));
    cv.strokeRoundRect(b.x, b.y, b.w, b.h, r, 2, withAlpha(t.text || '#ffffff', 0.18));
}

/** The speed readout: the number large, the unit under it. b: where (default the whole canvas). */
function drawSpeed(cv, t, kmh, units, b) {
    b = boxOf(cv, b);
    card(cv, t, b);
    const v = kmh == null ? null : units === 'mph' ? kmh / 1.609344 : kmh;
    cv.text(v == null ? '--' : fmt(v), b.x + b.w / 2, b.y + b.h * 0.62, Math.round(b.h * 0.5), '#ffffff', { align: 'center', font: 'bold', literal: true });
    cv.text(units === 'mph' ? 'mph' : 'km/h', b.x + b.w / 2, b.y + b.h * 0.86, Math.round(b.h * 0.11), withAlpha('#ffffff', 0.65), { align: 'center', font: 'bold', literal: true });
}

/** The engine speed readout: an arc from 0 to max (red over 85 %), the rpm in the middle. b: where. */
function drawRpm(cv, t, rpm, max, b) {
    b = boxOf(cv, b);
    card(cv, t, b);
    const cx = b.x + b.w / 2, cy = b.y + b.h * 0.56, r1 = Math.min(b.w, b.h) * 0.42, r0 = r1 - Math.round(b.h * 0.07);
    const A0 = -120, A1 = 120, red = A0 + (A1 - A0) * 0.85;
    cv.arc(cx, cy, r0, r1, A0, red, withAlpha('#ffffff', 0.14));
    cv.arc(cx, cy, r0, r1, red, A1, withAlpha('#ff3030', 0.35));
    if (rpm != null) {
        const f = Math.max(0, Math.min(1, rpm / max)), a = A0 + (A1 - A0) * f;
        if (f > 0.005) cv.arc(cx, cy, r0, r1, A0, a, '#ffffff', { ramp: ['#9fd3ff', '#ffffff', '#ff3030'], rampFrom: A0, rampTo: A1 });
    }
    cv.text(rpm == null ? '--' : fmt(rpm / 100) + '00', cx, cy + b.h * 0.07, Math.round(b.h * 0.2), '#ffffff', { align: 'center', font: 'bold', literal: true });
    cv.text('rpm', cx, cy + b.h * 0.2, Math.round(b.h * 0.09), withAlpha('#ffffff', 0.65), { align: 'center', font: 'bold', literal: true });
}

class FullMap {
    constructor(o) {
        this.settings = o.settings; this.log = o.log;
        this.now = o.now || Date.now;
        this.fs = o.fs || require('fs');
        this.CR = o.ClusterRender || null;
        this.theme = o.theme || (() => ({ text: '#ffffff' }));
        this.statusPath = o.statusPath || STATUS;
        this.requestPath = o.requestPath || REQUEST;
        this.v = { kmh: null, kmhT: 0, rpm: null, rpmT: 0 };
        this.status = parseStatus(null); this.statusT = 0; this.statusRead = -1e12;
        this.cr = null; this.refs = {}; this.layerState = {}; this.cv = {}; this.drawn = {};
        this.asking = false; this.askedT = -1e12; this.endedT = null; this.visible = false;
        this.why = 'starting';
        this.warned = {};
    }

    speed(kmh) { if (typeof kmh === 'number' && kmh >= 0 && kmh < 400) { this.v.kmh = kmh; this.v.kmhT = this.now(); } }
    rpm(rpm) { if (typeof rpm === 'number' && rpm >= 0 && rpm < 12000) { this.v.rpm = rpm; this.v.rpmT = this.now(); } }

    _warn(k, m) { if (!this.warned[k]) { this.warned[k] = true; this.log.warn('full cluster: ' + m); } }

    _readStatus() {
        const t = this.now();
        if (t - this.statusRead < STATUS_EVERY_MS) return;
        this.statusRead = t;
        let txt, st;
        try { st = this.fs.statSync(this.statusPath); txt = this.fs.readFileSync(this.statusPath, 'utf8'); } catch (e) { this.status = parseStatus(null); this.statusT = 0; return; }
        let s;
        try { s = JSON.parse(txt); } catch (e) { return; }          // half written: the next read
        this.status = parseStatus(s);
        this.statusT = st && st.mtime ? st.mtime.getTime() : t;
    }

    _client() {
        if (this.cr) return this.cr;
        if (!this.CR) {
            try { this.CR = require('./cluster_render_client').ClusterRender; } catch (e) { this._warn('client', 'no render client: ' + e.message); return null; }
        }
        const cr = new this.CR(APP);
        cr.on('ready', () => { this.drawn = {}; });
        cr.on('layer', (ref, state, reason) => {
            for (const k of Object.keys(this.refs)) if (this.refs[k] === ref) {
                if (this.layerState[k] !== state) this.log.info('full cluster: ' + k + ' readout ' + state + (reason ? ' (' + reason + ')' : ''));
                this.layerState[k] = state;
            }
        });
        cr.on('disconnected', () => { this.layerState = {}; });
        cr.on('refused', (op, ref, reason) => this._warn('refused' + op, op + ' refused: ' + reason));
        cr.on('error', (e) => this._warn('error', String(e && e.message || e)));
        cr.connect();
        this.cr = cr;
        return cr;
    }

    _layers() {
        if (this.refs.speed && this.refs.rpm) return true;
        const cr = this._client();
        if (!cr) return false;
        for (const k of ['speed', 'rpm']) {
            if (this.refs[k]) continue;
            const b = BOX[k];
            this.cv[k] = new Canvas(b.w, b.h);
            this.refs[k] = cr.image({ target: 'panel', klass: 'overlay', z: 20, x: b.x, y: b.y, w: b.w, h: b.h, iw: b.w, ih: b.h, visible: false });
            if (!this.refs[k]) { this._warn('layer' + k, 'the renderer refused the ' + k + ' readout'); return false; }
        }
        return true;
    }

    _draw() {
        const t = this.theme(), units = this.settings.get('units') === 'mph' ? 'mph' : 'kmh';
        const max = Number(this.settings.get('rpmMax')) || 7000;
        const kmh = this.now() - this.v.kmhT <= SIGNAL_MS ? this.v.kmh : null, rpm = this.now() - this.v.rpmT <= SIGNAL_MS ? this.v.rpm : null;
        const keys = { speed: kmh == null ? '-' : units + fmt(units === 'mph' ? kmh / 1.609344 : kmh), rpm: rpm == null ? '-' : max + ':' + Math.round(rpm / 50) };
        for (const k of ['speed', 'rpm']) {
            if (this.drawn[k] === keys[k]) continue;
            const cv = this.cv[k];
            cv.clear('#00000000');
            if (k === 'speed') drawSpeed(cv, t, kmh, units); else drawRpm(cv, t, rpm, max);
            this.cr.pixels(this.refs[k], null, Buffer.from(cv.d.buffer, cv.d.byteOffset, cv.d.length));
            this.drawn[k] = keys[k];
        }
    }

    _show(on) {
        if (on === this.visible) return;
        this.visible = on;
        if (!this.cr) return;
        for (const k of ['speed', 'rpm']) if (this.refs[k]) this.cr.set(this.refs[k], { visible: on });
        if (!on) this.layerState = {};
    }

    _write(full) {
        const dir = path.dirname(this.requestPath), tmp = this.requestPath + '.tmp';
        try {
            try { this.fs.mkdirSync(dir, 0o755); } catch (e) { if (e.code !== 'EEXIST') throw e; }
            this.fs.writeFileSync(tmp, JSON.stringify({ v: 1, full: full ? 1 : 0, app: APP }) + '\n', { mode: 0o644 });
            this.fs.renameSync(tmp, this.requestPath);
            return true;
        } catch (e) { this._warn('write', 'cannot write ' + this.requestPath + ': ' + e.message); return false; }
    }

    _stopAsking(why) {
        if (this.asking) {
            this.log.info('full cluster: off (' + why + ')');
            this._write(false);
            try { this.fs.unlinkSync(this.requestPath); } catch (e) { /* gone */ }
            this.endedT = this.now();
        }
        this.asking = false;
    }

    /** Why the map may not be full now; null: it may. */
    _blocked() {
        if (this.settings.get('enabled') === false || this.settings.get('enabled') === 'off') return 'switched off';
        const t = this.now();
        if (!this.statusT || t - this.statusT > STATUS_OLD_MS) return 'Waze on cluster not running';
        if (!this.status.live) return 'the Waze map is not on the cluster';
        if (this.v.kmh == null || t - this.v.kmhT > SIGNAL_MS) return 'no speed from the car';
        return null;
    }

    tick() {
        this._readStatus();
        const t = this.now();
        const blocked = this._blocked();
        if (blocked) {
            this._stopAsking(blocked);
            this.why = blocked;
            // the readouts stay while the map may still cover the stock gauges
            if (this.visible) {
                if (!this.status.full || (this.endedT !== null && t - this.endedT > HIDE_AFTER_MS)) this._show(false);
                else if (this.cr && this.refs.speed) this._draw();
            }
            return;
        }
        if (!this._layers()) { this._stopAsking('no readouts'); this.why = 'the cluster renderer refused the readouts'; return; }
        this._draw();
        this._show(true);
        const shown = this.layerState.speed === 'shown' && this.layerState.rpm === 'shown';
        const failed = this.layerState.speed === 'error' || this.layerState.rpm === 'error';
        if (failed) { this._stopAsking('a readout failed'); this.why = 'a readout failed on the cluster'; return; }
        if (!this.asking) {
            if (!shown) { this.why = 'waiting for the readouts on the cluster'; return; }
            this.asking = true; this.endedT = null;
            this.log.info('full cluster: on (speed and engine speed on the cluster)');
        } else if (!shown && !(this.layerState.speed === 'waiting' || this.layerState.rpm === 'waiting')) {
            // (waiting: a warning has the cluster for a moment; the map is off then too)
            this._stopAsking('the readouts left the cluster');
            this.why = 'the readouts left the cluster';
            return;
        }
        if (t - this.askedT >= ASK_EVERY_MS) { if (this._write(true)) this.askedT = t; }
        this.why = this.status.full ? 'on: the map over the whole cluster' : 'asked: the map is moving';
    }

    /** For the page. */
    get state() {
        const t = this.now();
        return {
            asking: this.asking, why: this.why, full: this.status.full, waze: this.status.state, target: this.status.target,
            kmh: t - this.v.kmhT <= SIGNAL_MS ? this.v.kmh : null, rpm: t - this.v.rpmT <= SIGNAL_MS ? this.v.rpm : null,
            readouts: Object.assign({}, this.layerState), connected: !!(this.cr && this.cr.ready),
        };
    }

    /** Before the app goes: the ask withdrawn, the readouts hidden. */
    close() { this._stopAsking('the app stops'); this._show(false); }
}

module.exports = { FullMap, parseStatus, drawSpeed, drawRpm, BOX, APP, STATUS, REQUEST, TICK_MS, ASK_EVERY_MS, SIGNAL_MS, HIDE_AFTER_MS };
