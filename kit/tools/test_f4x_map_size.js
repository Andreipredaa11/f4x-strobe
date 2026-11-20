'use strict';

// Bigger Waze Map (apps/f4x_map_size) against a simulated Waze on cluster status, files and clock: it asks for a
// centred map window ("panel X Y W H") only while the Waze map is on the cluster, rewrites it at least every
// second, follows the size buttons, never takes over another app's window, and takes its own away when it stops.
//   node kit/tools/test_f4x_map_size.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..', '..'), KIT = path.join(ROOT, 'kit', 'runtime');
const APP = path.join(ROOT, 'apps', 'f4x_map_size');
const SPEC = JSON.parse(fs.readFileSync(path.join(APP, 'app.json'), 'utf8'));
const themes = require(path.join(KIT, 'themes'));
const { Recorder } = require(path.join(KIT, 'record'));

let passed = 0;
function check(name, fn) { try { fn(); passed++; console.log('ok   ' + name); } catch (e) { console.log('FAIL ' + name + ': ' + e.message); process.exitCode = 1; } }

const stubs = { './kit/mgu': { run(a) { stubs.app = a; } } };
const load = Module._load;
Module._load = function (req, parent, isMain) {
    if (stubs[req]) return stubs[req];
    if (req.startsWith('./kit/')) return load.call(this, path.join(KIT, req.slice(6)), parent, isMain);
    return load.call(this, req, parent, isMain);
};

let T = 1795200000000;
const now = () => T;
const files = {};
const writes = [];
const FILE = '/dev/shm/cluster-info/map_window.txt', STATUS = '/run/waze-on-cluster/status.json';
const enoent = () => { const e = new Error('ENOENT'); e.code = 'ENOENT'; return e; };
const memfs = {
    statSync(p) { if (!files[p]) throw enoent(); return { mtime: new Date(files[p].mtime) }; },
    readFileSync(p) { if (!files[p]) throw enoent(); return files[p].data; },
    writeFileSync(p, d) { files[p] = { data: String(d), mtime: T }; },
    renameSync(a, b) { files[b] = files[a]; delete files[a]; if (b === FILE) writes.push({ t: T, data: files[b].data }); },
    mkdirSync(p) { if (files[p + '/']) { const e = new Error('EEXIST'); e.code = 'EEXIST'; throw e; } files[p + '/'] = { data: '', mtime: T }; },
    unlinkSync(p) { if (!files[p]) throw enoent(); delete files[p]; },
};
let tool = true;      // Waze on cluster running: its status rewritten every second
const setStatus = (s) => { files[STATUS] = { data: JSON.stringify(Object.assign({ ev: 'status', cluster: 1 }, s)), mtime: T }; };

const S = {}; SPEC.settings.forEach((s) => { S[s.key] = s.default; });
const settings = { get: (k) => S[k], set: (k, v) => { S[k] = v; } };
const log = { info() {}, warn() {} };
const { MapWindow, rectOf, parseStatus, LIMIT } = require(path.join(APP, 'window.js'));
const mw = new MapWindow({ settings, log, now, fs: memfs });
function run(ms) {
    for (let i = 0; i < ms; i += 100) {
        T += 100;
        if (tool && files[STATUS] && T - files[STATUS].mtime >= 1000) files[STATUS].mtime = T;
        if (i % 500 === 0) mw.tick();
    }
}
const line = () => (files[FILE] ? files[FILE].data : null);

check('the window for the settings: 1280 x 560 centred by default; held to 1088-1920 x 480-720; moved down and held on the panel', () => {
    assert.deepStrictEqual(rectOf(settings), { x: 320, y: 80, w: 1280, h: 560 });
    const s = (o) => ({ get: (k) => o[k] });
    assert.deepStrictEqual(rectOf(s({ width: 4000, height: 100 })), { x: 0, y: 120, w: 1920, h: 480 });
    assert.deepStrictEqual(rectOf(s({ width: 1280, height: 560, offsetY: 60 })), { x: 320, y: 140, w: 1280, h: 560 });
    assert.deepStrictEqual(rectOf(s({ width: 1280, height: 720, offsetY: -60 })), { x: 320, y: 0, w: 1280, h: 720 });
    assert(LIMIT.minW === 1088 && LIMIT.maxW === 1920);
});
check('Waze status: the map on the cluster (map or panel, showing or starting); not on the HUD, not off', () => {
    assert(parseStatus({ state: 'showing', target: 'map', cluster: 1 }).live);
    assert(parseStatus({ state: 'starting', target: 'panel', cluster: 1 }).live);
    assert(!parseStatus({ state: 'idle', target: 'map', cluster: 1 }).live);
    assert(!parseStatus({ state: 'showing', target: 'hud', cluster: 1 }).live);
    assert(!parseStatus({ state: 'showing', target: 'map', cluster: 0 }).live);
});

check('no Waze on cluster: nothing written', () => { run(2000); assert(line() === null && /not running/.test(mw.state.why)); });
setStatus({ state: 'idle', target: 'map' });
check('the map not showing: nothing written', () => { run(2000); assert(line() === null && /not on the cluster/.test(mw.state.why)); });

setStatus({ state: 'showing', target: 'map' });
check('the map showing: "panel 320 80 1280 560", rewritten at least every second', () => {
    writes.length = 0;
    run(4000);
    assert.strictEqual(line(), 'panel 320 80 1280 560\n');
    assert(writes.length >= 3, writes.length + ' writes');
    for (let i = 1; i < writes.length; i++) assert(writes[i].t - writes[i - 1].t <= 1000, 'gap ' + (writes[i].t - writes[i - 1].t));
    assert(mw.state.asking);
});
setStatus({ state: 'showing', target: 'panel', window: '320,80,1280,560' });
check('the map moved (on the panel): still asked, the page says so', () => { run(1000); assert(mw.state.asking && /larger/.test(mw.state.why)); });

check('wider: written at once with the new size', () => {
    S.width = 1440;
    mw.tick();
    assert.strictEqual(line(), 'panel 240 80 1440 560\n');
});

check('switched off: the window removed', () => {
    S.enabled = false;
    run(600);
    assert(line() === null && !mw.state.asking && /switched off/.test(mw.state.why));
    S.enabled = true;
    run(600);
    assert(line() !== null);
});

check('another app\'s fresh window (a cluster layout): left alone, not overwritten, not removed', () => {
    files[FILE] = { data: 'panel 0 0 1920 720\n', mtime: T };
    run(500);
    assert.strictEqual(line(), 'panel 0 0 1920 720\n');
    assert(!mw.state.asking && /another app/.test(mw.state.why));
    files[FILE].mtime = T;            // the other app keeps it fresh
    run(500);
    assert.strictEqual(line(), 'panel 0 0 1920 720\n');
});
check('the other app gone (its file stale): this app\'s window again', () => {
    run(6000);
    assert.strictEqual(line(), 'panel 240 80 1440 560\n');
    assert(mw.state.asking);
});

check('Waze on cluster stopped (status 5 s old): the window removed', () => {
    tool = false;
    run(6000);
    assert(line() === null && /not running/.test(mw.state.why));
    tool = true; files[STATUS].mtime = T;
    run(1000);
    assert(line() !== null);
});

check('close: the window removed', () => { mw.close(); assert(line() === null && !mw.state.asking); });

(async () => {
    const clicks = {}, loops = {}, listeners = [];
    const S2 = {}; SPEC.settings.forEach((s) => { S2[s.key] = s.default; });
    const ctx = {
        ui: { onClick: (id, fn) => { clicks[id] = fn; }, text() {}, image: async () => {} },
        settings: { get: (k) => S2[k], set: (k, v) => { S2[k] = v; listeners.forEach((f) => f(k, v)); }, onChange: (f) => listeners.push(f) },
        log, spec: SPEC, loop: (n, fps, fn) => { loops[n] = fn; }, signals: { watch: () => Promise.resolve({}) },
        theme: () => themes.theme('m_tricolour'), canvas: (w, h) => new Recorder(w, h),
        windowFile: '/tmp/f4x-map-size-test/map_window.txt', statusPath: '/nonexistent/status.json',
    };
    require(path.join(APP, 'main.js'));
    const app = await stubs.app.start(ctx);
    await clicks.BTN_WIDER(); await clicks.BTN_TALLER();
    check('main: Wider +80, Taller +40', () => assert(S2.width === 1360 && S2.height === 600, S2.width + 'x' + S2.height));
    for (let i = 0; i < 20; i++) await clicks.BTN_WIDER();
    for (let i = 0; i < 20; i++) await clicks.BTN_SHORTER();
    check('main: held to 1920 x 480', () => assert(S2.width === 1920 && S2.height === 480));
    ctx.settings.set('reset', true);
    check('main: reset: 1280 x 560, centred, the reset switch off again', () => assert(S2.width === 1280 && S2.height === 560 && S2.offsetY === 0 && S2.reset === false));
    check('main: the values the buttons reach are in the settings\' lists', () => {
        const st = {}; SPEC.settings.forEach((s) => { st[s.key] = s; });
        for (let w = 1280; w <= 1920; w += 80) assert(st.width.steps.includes(w), 'width ' + w);
        for (let w = 1280; w >= 1088; w -= 80) assert(st.width.steps.includes(Math.max(1088, w)), 'width ' + w);
        for (let h = 480; h <= 720; h += 40) assert(st.height.steps.includes(h), 'height ' + h);
        assert(SPEC.startType === 'autostart');
    });
    await loops.MAIN();
    check('main: the page draws', () => assert(app.mw && app.render));
    app.mw.close();
    console.log(passed + ' checks passed');
    process.exit(process.exitCode || 0);
})().catch((e) => { console.error(e); process.exit(1); });
