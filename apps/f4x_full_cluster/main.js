'use strict';
/**
 * Full Cluster Map - the Waze map over the whole instrument cluster, with the speed and engine speed drawn by this
 * app over it (fullmap.js). Needs Waze on cluster with its Full cluster mode.
 *
 * It starts with the head unit and works with its page closed. The page shows what it is doing and why, and the
 * two readouts as they are on the cluster.
 *
 * The car's speed (Vehicle2.statusCarSpeed2) and engine speed (CDS.statusEngineSpeed2) are read from the car's
 * own signals, never demo data: without a speed for 2.5 s the map goes back between the stock gauges.
 */
const mgu = require('./kit/mgu');
const G = require('./kit/gauges');
const { withAlpha } = require('./kit/canvas');
const { FullMap, drawSpeed, drawRpm, BOX, TICK_MS } = require('./fullmap');

const W = 1600, H = 520;
const GO = '#2fd27a';
const SPEED = 0.015625, RPM = 0.25, INVALID = 65535;

mgu.run({
    async start(ctx) {
        const { ui, settings, log } = ctx;
        const fm = new FullMap({ settings, log, theme: () => ctx.theme(), statusPath: ctx.statusPath, requestPath: ctx.requestPath,
            ClusterRender: ctx.ClusterRender });

        // the car's own signals, read again every 500 ms (a still car may not send a new speed)
        ctx.signals.watch('de.bmw.infotainment.vehicle.Vehicle2', '1', {
            statusCarSpeed2: (v) => { const k = v && v.speedVehicleCentreOfGravity; if (typeof k === 'number' && k !== INVALID) fm.speed(k * SPEED); },
        }, log, { pollMs: 500 }).catch((e) => log.warn('full cluster: speed: ' + e));
        ctx.signals.watch('de.bmw.infotainment.vehicle.CDS', '1', {
            statusEngineSpeed2: (v) => { const r = v && v.actualValueRPMEngineCrankshaft; if (typeof r === 'number' && r !== INVALID) fm.rpm(r * RPM); },
        }, log, { pollMs: 500 }).catch((e) => log.warn('full cluster: engine speed: ' + e));

        const timer = setInterval(() => { try { fm.tick(); } catch (e) { log.warn('full cluster: ' + (e && e.stack || e)); } }, TICK_MS);

        ui.onClick('BTN_TOGGLE', () => {
            const on = settings.get('enabled') !== false && settings.get('enabled') !== 'off';
            settings.set('enabled', !on);
            fm.tick();
            return render();
        });

        function render() {
            const t = ctx.theme();
            const cv = ctx.canvas(W, H).clear(t.bg);
            const s = fm.state;
            const on = settings.get('enabled') !== false && settings.get('enabled') !== 'off';
            G.panel(cv, t, 24, 44, 900, 468, 'Full Cluster Map');
            cv.roundRect(56, 110, 300, 70, 14, withAlpha(s.full ? GO : on ? '#ffad1f' : '#666b75', 0.9));
            cv.text(s.full ? 'FULL MAP' : on ? 'WAITING' : 'OFF', 206, 156, 30, '#ffffff', { align: 'center', font: 'bold', spacing: 2 });
            cv.text(on ? 'On / off button: switch off (the stock gauges back)' : 'On / off button: switch on', 380, 154, 20, t.text, { literal: true });
            const lines = [
                'Now: ' + s.why,
                'Waze map: ' + (s.waze || 'no status (Waze on cluster not running?)') + (s.target ? ' on ' + s.target : '') + (s.full ? ', over the whole cluster' : ''),
                'Speed: ' + (s.kmh == null ? 'no signal' : Math.round(s.kmh) + ' km/h') + '   ·   engine speed: ' + (s.rpm == null ? 'no signal' : Math.round(s.rpm) + ' rpm'),
                'Readouts on the cluster: speed ' + (s.readouts.speed || '-') + ', engine speed ' + (s.readouts.rpm || '-')
                    + (s.connected ? '' : '   ·   cluster renderer not connected'),
                'The map covers the stock gauges only while this app draws the speed. The warning lights stay on top.',
                'Without a speed for 2.5 s, or with this app stopped, the stock gauges come back by themselves.',
            ];
            lines.forEach((l, i) => cv.text(l, 56, 230 + i * 40, 19, i === 0 ? t.text : t.dim, { literal: true }));
            G.panel(cv, t, 948, 44, 628, 468, 'On the cluster');
            // the readouts as the cluster has them, two thirds the size
            const k = 2 / 3, bw = Math.round(BOX.speed.w * k), bh = Math.round(BOX.speed.h * k);
            drawSpeed(cv, t, s.kmh, settings.get('units'), { x: 972, y: 150, w: bw, h: bh });
            drawRpm(cv, t, s.rpm, Number(settings.get('rpmMax')) || 7000, { x: 1552 - bw, y: 150, w: bw, h: bh });
            G.frame(cv, t, ['Full Cluster Map'], 0, []);
            return ui.image('MAIN_GFX', cv);
        }
        ctx.loop('MAIN', 4, render);
        render().then(() => log.info('first frame done')).catch((e) => log.warn('first render: ' + e));
        process.on('exit', () => fm.close());
        process.on('SIGTERM', () => { fm.close(); clearInterval(timer); process.exit(0); });
        return { fm, render };
    },
});
