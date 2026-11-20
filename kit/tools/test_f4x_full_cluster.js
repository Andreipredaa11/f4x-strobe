'use strict';

// Full Cluster Map (apps/f4x_full_cluster) against a simulated Waze on cluster status, cluster renderer and clock:
// it asks for the full map only with the Waze map on the cluster, a real speed from the car and both readouts
// shown on the cluster (first); it keeps asking while that holds (at least every 400 ms) and withdraws the ask at
// once when any of it goes; the readouts stay until the map has left the whole cluster; never on demo data.
//   node kit/tools/test_f4x_full_cluster.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const Module = require('module');

const ROOT = path.join(__dirname, '..', '..'), KIT = path.join(ROOT, 'kit', 'runtime');
const APP = path.join(ROOT, 'apps', 'f4x_full_cluster');
const SPEC = JSON.parse(fs.readFileSync(path.join(APP, 'app.json'), 'utf8'));
const themes = require(path.join(KIT, 'themes'));
const { Recorder } = require(path.join(KIT, 'record'));

let passed = 0;
function check(name, fn) { try { fn(); passed++; console.log('ok   ' + name); } catch (e) { console.log('FAIL ' + name + ': ' + e.message); process.exitCode = 1; } }

// the app's ./kit/... requires resolve to kit/runtime (as the build packs them)
const load = Module._load;
Module._load = function (req, parent, isMain) {
    if (stubs[req]) return stubs[req];
    if (req.startsWith('./kit/')) return load.call(this, path.join(KIT, req.slice(6)), parent, isMain);
    return load.call(this, req, parent, isMain);
};
const stubs = { './kit/mgu': { run(a) { stubs.app = a; } } };

/* ---------- the world: a clock, files, the renderer ---------- */
let T = 1795200000000;
const now = () => T;
const files = {};             // path -> { data, mtime }
const writes = [];            // every write of the ask: { t, data }
const memfs = {
    statSync(p) { if (!files[p]) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; } return { mtime: new Date(files[p].mtime) }; },
    readFileSync(p) { if (!files[p]) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; } return files[p].data; },
    writeFileSync(p, d) { files[p] = { data: String(d), mtime: T }; },
    renameSync(a, b) { files[b] = files[a]; delete files[a]; if (b === REQ) writes.push({ t: T, data: files[b].data }); },
    mkdirSync(p) { if (files[p + '/']) { const e = new Error('EEXIST'); e.code = 'EEXIST'; throw e; } files[p + '/'] = { data: '', mtime: T }; },
    unlinkSync(p) { delete files[p]; },
};
const STATUS = '/run/waze-on-cluster/status.json', REQ = '/dev/shm/full-cluster/request.json';
const setStatus = (s, at) => { files[STATUS] = { data: JSON.stringify(Object.assign({ ev: 'status', cluster: 1, hud: 0 }, s)), mtime: at === undefined ? T : at }; };
const ask = () => (files[REQ] ? JSON.parse(files[REQ].data) : null);

const renderers = [];
class FakeCR extends EventEmitter {
    constructor(app) { super(); this.app = app; this.layers = {}; this.n = 0; this.ready = false; this.pixelsSent = 0; renderers.push(this); }
    connect() { this.ready = true; setImmediate(() => this.emit('ready')); }
    image(o) { const r = ++this.n; this.layers[r] = Object.assign({}, o); return r; }
    set(r, o) { Object.assign(this.layers[r], o); }
    pixels(r, rects, px) { assert.strictEqual(px.length, this.layers[r].iw * this.layers[r].ih * 4); this.pixelsSent++; }
    drop(r) { delete this.layers[r]; }
    state(r, s) { this.emit('layer', r, s, ''); }
}

const S = {}; SPEC.settings.forEach((s) => { S[s.key] = s.default; });
const settings = { get: (k) => S[k], set: (k, v) => { S[k] = v; } };
const warns = [];
const log = { info() {}, warn: (m) => warns.push(m), error: (m) => warns.push(m) };

const { FullMap, parseStatus, drawSpeed, drawRpm, BOX } = require(path.join(APP, 'fullmap.js'));
const fm = new FullMap({ settings, log, now, fs: memfs, ClusterRender: FakeCR });
/** t ms on, ticking every 100 ms, the car's speed (and rpm) sent every 100 ms unless speed is null. */
function run(ms, speed, rpm) {
    for (let i = 0; i < ms; i += 100) {
        T += 100;
        if (speed !== null && speed !== undefined) fm.speed(speed);
        if (rpm !== null && rpm !== undefined) fm.rpm(rpm);
        if (files[STATUS] && files[STATUS].live) files[STATUS].mtime = T;     // the tool rewrites its status
        fm.tick();
    }
}
const live = () => { files[STATUS].live = true; };

check('status lines: the map on the cluster, full on the panel, starting while it moves there', () => {
    assert.deepStrictEqual(parseStatus({ state: 'showing', target: 'map', cluster: 1 }), { live: true, full: false, target: 'map', state: 'showing' });
    assert.strictEqual(parseStatus({ state: 'showing', target: 'panel', cluster: 1, full: 1 }).full, true);
    assert.strictEqual(parseStatus({ state: 'starting', target: 'panel', cluster: 1, full: 1 }).live, true);
    assert.strictEqual(parseStatus({ state: 'starting', target: 'map', cluster: 1 }).live, false);
    assert.strictEqual(parseStatus({ state: 'showing', target: 'map', cluster: 0 }).live, false);
    assert.strictEqual(parseStatus({ state: 'showing', target: 'hud', cluster: 1 }).live, false);
    assert.strictEqual(parseStatus(null).live, false);
});

check('no Waze on cluster: nothing asked, no readouts made', () => {
    run(1000, 50, 2000);
    assert(!ask() && !renderers.length && /not running/.test(fm.state.why), fm.state.why);
});

setStatus({ state: 'idle', target: 'map' }); live();
check('the Waze map not showing: nothing asked', () => {
    run(1000, 50, 2000);
    assert(!ask() && /not on the cluster/.test(fm.state.why), fm.state.why);
});

setStatus({ state: 'showing', target: 'map' }); live();
check('never on demo data: the map showing but no speed from the car, nothing asked', () => {
    run(3000, null, 2000);       // (the speed sent before is 2.5 s old by then)
    assert(!ask() && /no speed/.test(fm.state.why), fm.state.why);
    assert(!renderers.length || Object.values(renderers[0].layers).every((l) => l.visible === false), 'no readouts left up over the stock gauges');
});

let cr, sp, rp;
check('the map showing and a speed: the readouts made on the panel over the map, drawn and shown, but no ask before the renderer shows them', () => {
    run(500, 50, 2000);
    cr = renderers[0];
    const L = Object.values(cr.layers);
    assert(cr && cr.app === 'f4x_full_cluster' && L.length === 2, 'two layers');
    sp = 1; rp = 2;
    assert(L.every((l) => l.target === 'panel' && l.klass === 'overlay' && l.visible === true), JSON.stringify(L));
    assert.strictEqual(cr.layers[sp].x, BOX.speed.x); assert.strictEqual(cr.layers[rp].x, BOX.rpm.x);
    assert(cr.pixelsSent >= 2, 'pixels sent');
    assert(!ask() && /waiting for the readouts/.test(fm.state.why), fm.state.why);
});

check('one readout shown, the other not yet: still no ask', () => {
    cr.state(sp, 'shown');
    run(300, 50, 2000);
    assert(!ask());
});

check('both shown: asked, {"v":1,"full":1,"app":"f4x_full_cluster"}, and rewritten at least every 400 ms', () => {
    cr.state(rp, 'shown');
    writes.length = 0;
    run(2000, 50, 2000);
    assert.deepStrictEqual(ask(), { v: 1, full: 1, app: 'f4x_full_cluster' });
    assert(writes.length >= 4, writes.length + ' writes');
    for (let i = 1; i < writes.length; i++) assert(writes[i].t - writes[i - 1].t <= 500, 'gap ' + (writes[i].t - writes[i - 1].t));
    assert(fm.state.asking);
});

setStatus({ state: 'starting', target: 'panel', full: 1 }); live();
check('the map moving to the whole panel (starting, full): still asked (no flapping)', () => {
    run(600, 50, 2000);
    assert(fm.state.asking && ask().full === 1);
});
setStatus({ state: 'showing', target: 'panel', full: 1 }); live();
run(300, 50, 2000);

check('the speed lost: the ask withdrawn at once (full 0, then removed); the readouts still up while the map is full', () => {
    writes.length = 0;
    run(2600, null, 2000);      // 2.5 s without a speed: not known
    assert(!fm.state.asking && !files[REQ], 'ask removed');
    assert(writes.some((w) => JSON.parse(w.data).full === 0), 'full 0 written first');
    assert(cr.layers[sp].visible === true, 'speed readout kept while the map is full');
});
check('the map back between the gauges: the readouts hidden', () => {
    setStatus({ state: 'showing', target: 'map' }); live();
    run(500, null, 2000);
    assert(cr.layers[sp].visible === false && cr.layers[rp].visible === false);
});
check('the map still full but its status not changing: hidden 3 s after the ask ended at the latest', () => {
    run(300, 50, 2000);               // speed back: readouts up again ...
    cr.state(sp, 'shown'); cr.state(rp, 'shown');
    run(500, 50, 2000);
    assert(fm.state.asking);
    setStatus({ state: 'showing', target: 'panel', full: 1 }); live();
    run(500, 50, 2000);
    run(2600, null, 2000);            // ... lost again, the status still says full
    assert(!fm.state.asking && cr.layers[sp].visible === true, 'still up');
    run(3200, null, 2000);
    assert(cr.layers[sp].visible === false, 'hidden after HIDE_AFTER_MS');
});

check('switched off in its settings: the ask withdrawn', () => {
    setStatus({ state: 'showing', target: 'map' }); live();
    run(600, 50, 2000); cr.state(sp, 'shown'); cr.state(rp, 'shown'); run(600, 50, 2000);
    assert(fm.state.asking);
    S.enabled = false;
    run(300, 50, 2000);
    assert(!fm.state.asking && !files[REQ] && /switched off/.test(fm.state.why));
    S.enabled = true;
});

check('a readout failing on the renderer: the ask withdrawn', () => {
    run(600, 50, 2000); cr.state(sp, 'shown'); cr.state(rp, 'shown'); run(600, 50, 2000);
    assert(fm.state.asking);
    cr.state(rp, 'error');
    run(200, 50, 2000);
    assert(!fm.state.asking && !files[REQ]);
});

check('Waze on cluster stopped (its status 5 s old): the ask withdrawn', () => {
    cr.state(rp, 'shown'); cr.state(sp, 'shown');
    run(600, 50, 2000);
    assert(fm.state.asking, fm.state.why);
    files[STATUS].live = false;
    run(5200, 50, 2000);
    assert(!fm.state.asking && !files[REQ] && /not running/.test(fm.state.why), fm.state.why);
});

check('a warning taking the cluster (the readouts waiting): still asked; the readouts gone otherwise: withdrawn', () => {
    setStatus({ state: 'showing', target: 'map' }); live();
    cr.state(sp, 'shown'); cr.state(rp, 'shown');
    run(600, 50, 2000);
    assert(fm.state.asking);
    cr.state(sp, 'waiting'); cr.state(rp, 'waiting');
    run(600, 50, 2000);
    assert(fm.state.asking, 'kept while a warning has the cluster');
    cr.state(sp, 'hidden'); cr.state(rp, 'hidden');
    run(200, 50, 2000);
    assert(!fm.state.asking && !files[REQ]);
});

check('close (the app going): the ask withdrawn and the readouts hidden', () => {
    cr.state(sp, 'shown'); cr.state(rp, 'shown');
    run(600, 50, 2000);
    assert(fm.state.asking);
    fm.close();
    assert(!fm.state.asking && !files[REQ] && cr.layers[sp].visible === false);
});

check('the readouts draw on a software canvas and the GPU recorder, with and without values, km/h and mph', () => {
    const { Canvas } = require(path.join(KIT, 'canvas'));
    const t = themes.theme('m_tricolour');
    for (const cv of [new Canvas(BOX.speed.w, BOX.speed.h), new Recorder(1600, 520)]) {
        drawSpeed(cv, t, 87.4, 'kmh'); drawSpeed(cv, t, null, 'mph'); drawSpeed(cv, t, 120, 'mph', { x: 10, y: 10, w: 280, h: 227 });
        drawRpm(cv, t, 3450, 7000); drawRpm(cv, t, null, 6000); drawRpm(cv, t, 9000, 7000, { x: 300, y: 10, w: 280, h: 227 });
    }
});

check('the speed setting: mph shown as mph', () => {
    const { Canvas } = require(path.join(KIT, 'canvas'));
    const a = new Canvas(BOX.speed.w, BOX.speed.h), b = new Canvas(BOX.speed.w, BOX.speed.h);
    drawSpeed(a, themes.theme('m_tricolour'), 100, 'kmh'); drawSpeed(b, themes.theme('m_tricolour'), 100, 'mph');
    assert(!Buffer.from(a.d).equals(Buffer.from(b.d)));
});

/* ---------- the app as the head unit runs it ---------- */
(async () => {
    const watched = {}, clicks = {}, loops = {};
    const S2 = {}; SPEC.settings.forEach((s) => { S2[s.key] = s.default; });
    const ctx = {
        ui: { onClick: (id, fn) => { clicks[id] = fn; }, text() {}, image: async () => {} },
        settings: { get: (k) => S2[k], set: (k, v) => { S2[k] = v; }, onChange() {} },
        log, spec: SPEC, dataDir: '/tmp',
        signals: { watch: (iface, inst, h) => { Object.assign(watched, h); return Promise.resolve({}); } },
        loop: (name, fps, fn) => { loops[name] = fn; },
        theme: () => themes.theme('m_tricolour'), canvas: (w, h) => new Recorder(w, h),
        statusPath: '/nonexistent/status.json', requestPath: '/tmp/f4x-full-cluster-test/request.json', ClusterRender: FakeCR,
    };
    require(path.join(APP, 'main.js'));
    const app = await stubs.app.start(ctx);
    check('main: the car\'s speed and engine speed taken from their signals, scaled (0.015625 km/h, 0.25 rpm a bit)', () => {
        watched.statusCarSpeed2({ speedVehicleCentreOfGravity: 64 * 50 });
        watched.statusEngineSpeed2({ actualValueRPMEngineCrankshaft: 4 * 2500 });
        watched.statusCarSpeed2({ speedVehicleCentreOfGravity: 65535 });     // invalid: ignored
        const s = app.fm.state;
        assert(Math.round(s.kmh) === 50 && Math.round(s.rpm) === 2500, JSON.stringify(s));
    });
    await loops.MAIN();
    await clicks.BTN_TOGGLE();
    await loops.MAIN();
    check('main: the page draws, and On / off switches the setting', () => {
        assert(S2.enabled === false, 'switched off');
        assert(!warns.some((w) => /TypeError|ReferenceError|is not a function/.test(w)), warns.join(' | '));
    });
    check('the settings the app reads are all in app.json', () => {
        const keys = SPEC.settings.map((s) => s.key);
        ['enabled', 'units', 'rpmMax', 'theme'].forEach((k) => assert(keys.includes(k), k));
        assert(SPEC.startType === 'autostart', 'starts with the head unit');
    });
    console.log(passed + ' checks passed');
    process.exit(process.exitCode || 0);
})().catch((e) => { console.error(e); process.exit(1); });
