'use strict';
/**
 * Bigger Waze Map - the Waze map on the instrument cluster larger, out to the stock speedometer and tachometer
 * (window.js). Needs Waze on cluster with panel support (the map window). The stock gauges stay as they are.
 *
 * It starts with the head unit and works with its page closed. Wider / Narrower / Taller / Shorter change the
 * size at once (the map follows within a second); Settings has on / off, up / down and the size reset.
 */
const mgu = require('./kit/mgu');
const G = require('./kit/gauges');
const { withAlpha } = require('./kit/canvas');
const { MapWindow, rectOf, PANEL, LIMIT, DEFAULT, TICK_MS } = require('./window');

const W = 1600, H = 520;
const GO = '#2fd27a';

mgu.run({
    async start(ctx) {
        const { ui, settings, log } = ctx;
        const mw = new MapWindow({ settings, log, file: ctx.windowFile, statusPath: ctx.statusPath });
        const timer = setInterval(() => { try { mw.tick(); } catch (e) { log.warn('map size: ' + (e && e.stack || e)); } }, TICK_MS);

        const size = (dw, dh) => () => {
            const r = rectOf(settings);
            if (dw) settings.set('width', Math.max(LIMIT.minW, Math.min(LIMIT.maxW, r.w + dw)));
            if (dh) settings.set('height', Math.max(LIMIT.minH, Math.min(LIMIT.maxH, r.h + dh)));
            mw.tick();
            return render();
        };
        ui.onClick('BTN_WIDER', size(2 * LIMIT.step, 0));
        ui.onClick('BTN_NARROWER', size(-2 * LIMIT.step, 0));
        ui.onClick('BTN_TALLER', size(0, LIMIT.step));
        ui.onClick('BTN_SHORTER', size(0, -LIMIT.step));
        if (settings.onChange) settings.onChange((key) => {
            if (key === 'reset' && settings.get('reset')) {
                settings.set('width', DEFAULT.w); settings.set('height', DEFAULT.h); settings.set('offsetY', 0); settings.set('reset', false);
            }
            mw.tick();
        });

        /** The cluster from the front, the stock map box and the window this app asks for. */
        function render() {
            const t = ctx.theme();
            const cv = ctx.canvas(W, H).clear(t.bg);
            const s = mw.state, r = s.rect;
            G.panel(cv, t, 24, 44, 640, 468, 'Bigger Waze Map');
            cv.roundRect(56, 110, 260, 64, 14, withAlpha(s.asking ? GO : settings.get('enabled') === false ? '#666b75' : '#ffad1f', 0.9));
            cv.text(s.asking ? 'LARGER' : settings.get('enabled') === false ? 'OFF' : 'WAITING', 186, 152, 28, '#ffffff', { align: 'center', font: 'bold', spacing: 2 });
            const lines = [
                'Map: ' + r.w + ' x ' + r.h + ' (the stock box is 1088 x 480)',
                'Now: ' + s.why,
                'Waze map: ' + (s.waze || 'no status') + (s.target ? ' on ' + s.target : ''),
                'Wider / Narrower: 80 px   ·   Taller / Shorter: 40 px',
                'Settings: on / off, move up or down, reset',
                'The stock speedometer and rev counter stay as they are.',
            ];
            lines.forEach((l, i) => cv.text(l, 56, 220 + i * 40, 19, i < 2 ? t.text : t.dim, { literal: true }));
            // the cluster, to scale
            G.panel(cv, t, 688, 44, 888, 468, 'On the cluster');
            const k = 840 / PANEL.w, ox = 712, oy = 120;
            cv.roundRect(ox, oy, PANEL.w * k, PANEL.h * k, 24, withAlpha('#ffffff', 0.06));
            cv.strokeRoundRect(ox, oy, PANEL.w * k, PANEL.h * k, 24, 2, withAlpha('#ffffff', 0.25));
            // the stock gauges, roughly (dials at the sides)
            cv.arc(ox + 150 * k, oy + 380 * k, 200 * k, 218 * k, -150, 120, withAlpha('#ffffff', 0.25));
            cv.arc(ox + 1770 * k, oy + 380 * k, 200 * k, 218 * k, -120, 150, withAlpha('#ffffff', 0.25));
            // the stock map box (1088 x 480, centred) and the window
            cv.strokeRoundRect(ox + 416 * k, oy + 120 * k, 1088 * k, 480 * k, 6, 2, withAlpha('#ffffff', 0.35));
            cv.roundRect(ox + r.x * k, oy + r.y * k, r.w * k, r.h * k, 8, withAlpha('#33a3ff', 0.45));
            cv.strokeRoundRect(ox + r.x * k, oy + r.y * k, r.w * k, r.h * k, 8, 2, '#33a3ff');
            cv.text('Waze map ' + r.w + ' x ' + r.h, ox + PANEL.w * k / 2, oy + (r.y + r.h / 2) * k + 8, 22, '#ffffff', { align: 'center', font: 'bold', literal: true });
            cv.text('Thin outline: the stock map box. The dials are only sketched: match the size to your car.', ox + 10, oy + PANEL.h * k + 30, 15, t.dim, { literal: true });
            G.frame(cv, t, ['Bigger Waze Map'], 0, []);
            return ui.image('MAIN_GFX', cv);
        }
        ctx.loop('MAIN', 4, render);
        render().then(() => log.info('first frame done')).catch((e) => log.warn('first render: ' + e));
        process.on('exit', () => mw.close());
        process.on('SIGTERM', () => { mw.close(); clearInterval(timer); process.exit(0); });
        return { mw, render };
    },
});
