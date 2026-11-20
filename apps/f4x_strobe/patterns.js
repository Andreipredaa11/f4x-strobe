'use strict';
/**
 * patterns.js - the flash patterns and the player that runs one on the lamps (lamps.js).
 *
 * A pattern is frames: { on: [lamp ids lit in this frame], ms }. Between frames only the lamps that change are
 * sent. Two kinds:
 *   emergency: only lamps that are normally off while driving (high beams, fog lights, turn signals, rear fog,
 *              reversing lights); a lamp's dark phase gives it back to the car, so the low beams, tail lights and
 *              brake lights stay the car's own the whole time.
 *   show:      any lamp, held dark between flashes (parked: a light show).
 *   strobe:    the body controller's light functions (lamps.js FUNCS), BimmerLink style: frames { ms, fn: [names],
 *              len }, each name one request that lights that function for len ms (then dark by itself). The
 *              fastest the car allows over the head unit (~200-300 ms a request), and nothing is ever held.
 */
const { BY_ID, FLM_FLASH, BDC_FLASH, FUNCS } = require('./lamps');

const f = (ms, ...on) => ({ ms, on });
/** a strobe frame: these light functions, each lit for the flash length (setting Flash length), then dark for gap
 *  ms before the next frame */
const s = (gap, ...fn) => ({ gap, fn, on: [] });
/** a pause of ms (nothing lit) */
const x = (ms) => ({ ms, fn: [], on: [] });
const PATTERNS = [
    { id: 'police', name: 'Police', kind: 'strobe', what: 'Front: three high beam flashes. Back: three flashes of the reversing and rear fog lights',
        frames: [s(150, 'high'), s(150, 'high'), s(150, 'high'), x(200), s(150, 'reverse', 'rearFog'), s(150, 'reverse', 'rearFog'), s(150, 'reverse', 'rearFog'), x(200)] },
    { id: 'hb_strobe', name: 'High beam strobe', kind: 'strobe', what: 'The high beams, flash after flash',
        frames: [s(200, 'high')] },
    { id: 'hb_triple', name: 'Triple flash', kind: 'strobe', what: 'Three high beam flashes, then a pause',
        frames: [s(150, 'high'), s(150, 'high'), s(150, 'high'), x(700)] },
    { id: 'front_back', name: 'Front and back', kind: 'strobe', what: 'High beams, then the reversing and rear fog lights',
        frames: [s(200, 'high'), s(200, 'reverse', 'rearFog')] },
    { id: 'hb_ind', name: 'High beam / turn signals', kind: 'strobe', what: 'High beams and all turn signals in turn',
        frames: [s(200, 'high'), s(200, 'indL', 'indR')] },
    { id: 'ind_wigwag', name: 'Indicator wig-wag', kind: 'strobe', what: 'All turn signals of a side: two flashes left, two right',
        frames: [s(150, 'indL'), s(150, 'indL'), x(150), s(150, 'indR'), s(150, 'indR'), x(150)] },
    { id: 'rear_strobe', name: 'Rear strobe', kind: 'strobe', what: 'Rear fog light and reversing lights in turn',
        frames: [s(150, 'rearFog'), s(150, 'reverse')] },
    { id: 'every', name: 'Every light in turn', kind: 'strobe', what: 'Each light function once, round the car',
        frames: [s(150, 'high'), s(150, 'indL'), s(150, 'reverse'), s(150, 'rearFog'), s(150, 'indR'), x(400)] },
    { id: 'wigwag', name: 'Wig-wag', kind: 'emergency', what: 'High beams, left and right in turn',
        frames: [f(350, 'highL'), f(350, 'highR')] },
    { id: 'double', name: 'Double flash', kind: 'emergency', what: 'Two quick flashes left, then two right',
        frames: [f(90, 'highL'), f(70), f(90, 'highL'), f(160), f(90, 'highR'), f(70), f(90, 'highR'), f(160)] },
    { id: 'full', name: 'Front and rear', kind: 'emergency', what: 'High beams in turn, rear turn signals and rear fogs opposite',
        frames: [f(400, 'highL', 'indRR', 'rfogR'), f(400, 'highR', 'indRL', 'rfogL')] },
    { id: 'rear', name: 'Rear only', kind: 'emergency', what: 'Rear turn signals and rear fog lights in turn (pulled over, facing traffic)',
        frames: [f(350, 'indRL', 'rfogL'), f(350, 'indRR', 'rfogR')] },
    { id: 'corners', name: 'Corner strobe', kind: 'emergency', what: 'All turn signals, front and rear corners crossed',
        frames: [f(120, 'indFL', 'indRR'), f(80), f(120, 'indFL', 'indRR'), f(180), f(120, 'indFR', 'indRL'), f(80), f(120, 'indFR', 'indRL'), f(180)] },
    { id: 'chase', name: 'Chase', kind: 'show', what: 'Around the car, corner to corner',
        frames: [f(180, 'indFL', 'highL'), f(180, 'indFR', 'highR'), f(180, 'indSR', 'indRR'), f(180, 'indRL', 'indSL')] },
    { id: 'sweep', name: 'Sweep', kind: 'show', what: 'Across the front and back, out and back',
        frames: [f(140, 'indFL', 'rfogL'), f(140, 'revL'), f(140, 'highL'), f(140, 'highR'),
            f(140, 'revR'), f(140, 'indFR', 'rfogR'), f(140, 'revR'), f(140, 'highR'), f(140, 'highL'), f(140, 'revL')] },
    { id: 'all', name: 'Everything', kind: 'show', what: 'Every lamp on, then every lamp off',
        frames: [f(400, 'highL', 'highR', 'indFL', 'indFR', 'indSL', 'indSR', 'indRL', 'indRR',
            'rfogL', 'rfogR', 'revL', 'revR'), f(400)] },
    // burst: each frame's lamps lit by their lamp functions all at once (both sides together), each for the frame's
    // time and then dark by itself - fast, where switching a dozen lamps one by one (~300 ms a request) can't be
    { id: 'strobe', name: 'Strobe', kind: 'show', burst: true, what: 'Reversing lights, high beams and turn signals, both sides, in quick turn',
        frames: [f(150, 'revL', 'highL', 'indFL', 'indFR'), f(150)] },
    // a whole side's turn signals (front, mirror, rear) by its own lamp function: one request a flash, dark again by
    // itself - the fastest side to side the car allows (it takes one request at a time, ~300 ms each)
    { id: 'sides', name: 'Side to side', kind: 'show', burst: true, what: 'A whole side\'s turn signals: two flashes left, two right',
        frames: [f(150, 'indFL'), f(60), f(150, 'indFL'), f(200), f(150, 'indFR'), f(60), f(150, 'indFR'), f(200)] },
    // the reversing lights each by its own output (the body controller splits them; their lamp function lights both):
    // two blinks a side, then the other side (on and off each a request, ~0.3 s each on a G05)
    { id: 'revsides', name: 'Reverse side to side', kind: 'show', what: 'Reversing lights: two blinks left, two right',
        frames: [f(120, 'revL'), f(100), f(120, 'revL'), f(250), f(120, 'revR'), f(100), f(120, 'revR'), f(250)] },
    { id: 'blink', name: 'Blink', kind: 'show', what: 'Headlights and tail lights dark, then a flash, like a wink',
        frames: [f(120, 'highL', 'highR'), f(120), f(120, 'highL', 'highR'), f(500)] },
];
/* The car's own flashing modes (found by the lamp check's flash tries on a G05): one request and the unit flashes by
 * itself - both sides together even when one headlight module is asked (seen on the car), so light shows only - a headlight (L / R: its module) in panic mode or alarm flashing for whole seconds, the reversing lights'
 * flash for a time. The fast flashing the car allows: its diagnostic link takes ~3 requests a second. Frames: { ms,
 * act: [['L' | 'R', mode, seconds (0: off)] | ['fn', function, ms]] }, each act one request. */
const PANIC = FLM_FLASH.panic, ALARM = FLM_FLASH.alarm, REVFLASH = BDC_FLASH.reversing;
const m = (ms, ...act) => ({ ms, on: [], act });
PATTERNS.push(
    { id: 'revflash', name: 'Reverse flash', kind: 'show', modes: true, what: 'The reversing lights\' own flashing (both sides)',
        frames: [m(1800, ['fn', REVFLASH, 2000])] },
);
const PATTERN = {};
PATTERNS.forEach((p) => { PATTERN[p.id] = p; });

/** The lamps a pattern uses (each once); a strobe pattern's: its light functions' lamps. */
const lampsOf = (p) => Array.from(new Set([].concat(...p.frames.map((fr) => fr.on.concat(...(fr.fn || []).map((n) => FUNCS[n].lamps))))));
/** The light functions a strobe pattern flashes (each once, without fallbacks). */
const funcsOf = (p) => Array.from(new Set([].concat(...p.frames.map((fr) => fr.fn || []))));
/** An emergency pattern never takes over a lamp the car keeps on (or uses for braking) while driving. */
function safeForDriving(p) { return lampsOf(p).every((id) => BY_ID[id] && !BY_ID[id].usual); }

/**
 * Runs one pattern on the link until stopped.
 *   const pl = new Player(link, { usable(id) -> bool, viaFn(id) -> bool, onFrame(lit Set), log });
 *   viaFn(id): the lamp's own output is refused but its lamp function works and is its side's alone (the turn
 *   signals): lit with the function for the frame's time, which goes dark by itself
 *   pl.start(PATTERN.wigwag, 1);  pl.stop() -> Promise (every lamp back);  pl.running
 */
class Player {
    constructor(link, opts) {
        this.link = link; this.opts = opts || {};
        this.now = this.opts.now || Date.now;
        // a frame's wait ends early on stop (the lamps go back at once)
        this.wait = this.opts.wait || ((ms) => new Promise((r) => { const tm = setTimeout(r, ms); this.wake = () => { clearTimeout(tm); r(); }; }));
        this.wake = null;
        this.running = false; this.pattern = null; this.lit = new Set(); this.late = 0; this.frames = 0;
        this.stopping = null; this.error = null;
    }
    /** false while the last run still gives its lamps back (a start then would run two at once) */
    start(pattern, speed) {
        if (this.running || this.ending) return false;
        this.pattern = pattern; this.speed = speed || 1; this.running = true; this.ending = true; this.error = null; this.frames = 0; this.late = 0;
        this.loop = this._run().catch((e) => { this.error = String(e.message || e); this.opts.log && this.opts.log.warn('light show: ' + this.error); })
            .then(() => this._end()).then(() => { this.ending = false; }, () => { this.ending = false; });
        return true;
    }
    /** stop, and give every lamp back */
    stop() {
        this.running = false;
        if (this.wake) this.wake();
        return this.loop || Promise.resolve();
    }
    setPattern(p) { this.pattern = p; }
    async _run() {
        const ok = await this.link.start();
        // (strobe patterns need no output layout: the probe would flash a lamp of its own first)
        if (this.pattern.kind !== 'strobe' && !this.link.layout && !this.link.probed && this.opts.needsLayout && this.opts.needsLayout()) await this.link.probe();
        // lamps held dark while it runs (a light show starts dark: lamps on before it don't stay on); timed outputs are
        // sent again each frame (they go back by themselves), held ones once
        const dark = new Set(this.opts.dark ? await this.opts.dark(this.pattern) : []);
        const darkSent = new Set();
        this.darkCount = dark.size;
        if (!ok && this.opts.log) this.opts.log.warn('light show: no extended session: trying the lamps anyway');
        let i = 0;
        while (this.running) {
            // each frame lasts its time from when it starts, or as long as its requests take when the car is slower:
            // an even rhythm at whatever pace the link allows (never hurrying later frames to catch up)
            const f0 = this.now();
            const p = this.pattern, fr = p.frames[i % p.frames.length];
            if (p.kind === 'strobe') {
                // light functions: one request a flash, dark again by itself; a function the car refused is
                // replaced by the pattern's fallback (or left out)
                const lit = new Set();
                for (const want of fr.fn) {
                    if (!this.running) break;
                    const name = this._fnName(p, want);
                    if (!name) continue;
                    const r = await this.link.flash(name, this._flashMs() / this.speed);
                    if (r.ok) FUNCS[name].lamps.forEach((id) => lit.add(id));
                    else if (r.nrc !== null && this.opts.fnRefused) this.opts.fnRefused(name, r.nrc);
                }
                this.lit = lit;
                if (this.opts.onFrame) this.opts.onFrame(this.lit, i % p.frames.length);
                this.frames++;
                // a flash frame: lit for the flash length, then its gap; a pause: its own time
                const dur = fr.fn.length ? this._flashMs() + fr.gap : fr.ms;
                const left = f0 + dur / this.speed - this.now();
                if (left > 0) await this.wait(left); else if (fr.fn.length) this.late++;
                i++;
                continue;
            }
            if (p.modes) {
                // flashing modes: each act one request, the unit flashes by itself
                const lit = new Set();
                for (const a of fr.act) {
                    if (!this.running) break;
                    if (a[0] === 'fn') { await this.link.flashFn(a[1], a[2] / this.speed); ['revL', 'revR'].forEach((x) => lit.add(x)); }
                    else { await this.link.lvTry(a[0] === 'L' ? this.link.FLM_L : this.link.FLM_R, a[1], a[2]); if (a[2]) ['lowX', 'highX'].forEach((x) => lit.add(x.replace('X', a[0]))); }
                }
                this.lit = lit;
                if (this.opts.onFrame) this.opts.onFrame(this.lit, i % p.frames.length);
                this.frames++;
                const left = f0 + fr.ms / this.speed - this.now();
                if (left > 0) await this.wait(left); else this.late++;
                i++;
                continue;
            }
            if (p.burst) {
                // lamp functions, all at once, dark again by themselves
                if (fr.on.length) { await this.link.burst(fr.on, fr.ms / this.speed + 40); this.lit = new Set(fr.on.concat(fr.on.filter((id) => id !== 'indFL').map((id) => id.replace(/L$/, 'R')))); }
                else this.lit = new Set();
                if (this.opts.onFrame) this.opts.onFrame(this.lit, i % p.frames.length);
                this.frames++;
                const left = f0 + fr.ms / this.speed - this.now();
                if (left > 0) await this.wait(left); else this.late++;
                i++;
                continue;
            }
            const offAs = p.kind === 'emergency' && !this.link.noRelease ? 'release' : 'off';
            const want = new Set(fr.on.filter((id) => this._usable(id, p)));
            for (const id of dark) {
                if (!this.running || want.has(id) || this.lit.has(id) || (darkSent.has(id) && !this.link.timer)) continue;
                const r = await this.link.set(id, false, 'off', fr.ms / this.speed);
                if (r.ok) darkSent.add(id);
            }
            // lamps going dark first (a frame never has two sides lit at once), then the ones coming on
            for (const id of Array.from(this.lit)) if (!want.has(id)) { if (!this._fn(id)) await this.link.set(id, false, offAs); this.lit.delete(id); }
            for (const id of want) {
                if (!this.running) break;
                if (this.lit.has(id)) continue;
                const r = this._fn(id) ? await this.link.fn(id, fr.ms / this.speed + 60) : await this.link.set(id, true, null, fr.ms / this.speed);
                if (r.ok) this.lit.add(id);
                else if (r.nrc !== null && this.opts.refused) this.opts.refused(id, r.nrc);
            }
            if (this.opts.onFrame) this.opts.onFrame(this.lit, i % p.frames.length);
            this.frames++;
            const left = f0 + fr.ms / this.speed - this.now();
            if (left > 0) await this.wait(left); else this.late++;        // (late: frames the link made longer)
            i++;
        }
    }
    _fn(id) { return !!(this.opts.viaFn && this.opts.viaFn(id)); }
    /** how long a strobe flash is lit (ms): the Flash length setting, 250 when not given */
    _flashMs() { const v = this.opts.flashMs ? Number(this.opts.flashMs()) : 0; return v > 0 ? v : 250; }
    /** the light function a strobe frame flashes for want: itself, its fallback, or null (neither works) */
    _fnName(p, want) {
        const ok = (n) => FUNCS[n] && (!this.opts.fnUsable || this.opts.fnUsable(n));
        if (ok(want)) return want;
        const alt = p.fallback && p.fallback[want];
        return alt && ok(alt) ? alt : null;
    }
    _usable(id, p) {
        const l = BY_ID[id];
        if (!l) return false;
        // held-dark lamps (no single release) that are normally on would stay dark: never in an emergency pattern
        if (p.kind === 'emergency' && l.usual) return false;
        return !this.opts.usable || this.opts.usable(id);
    }
    async _end() {
        this.lit.clear();
        if (this.opts.onFrame) this.opts.onFrame(this.lit, -1);
        await this.link.stop();
    }
}

module.exports = { PATTERNS, PATTERN, Player, lampsOf, funcsOf, safeForDriving };
