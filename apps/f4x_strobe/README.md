# F4x Strobe

BimmerLink-style light strobes for the BMW F40 (1 Series) and F44 (2 Series Gran Coupé) with iDrive 7, installed
from the MGU Store. It's a fork of [Light Show](https://github.com/eroobeeroo/idrive7-apps/tree/main/apps/light_show)
by eroobeeroo, which was built and tested on a G05.

> **Status: not yet tested on an F40 / F44.** The lamp commands come from BMW's body controller descriptions and
> from apps that work on G-series cars. Run the **Lamp check** first and photograph its page: it shows which body
> controller your car has and which lights answer.

## Use it parked, on private property

The app only runs when the car reports that it's standing still. A pattern stops as soon as the car moves, and
every run stops by itself after the time limit (1 to 30 minutes, 5 by default). Flashing high beams, strobes and
wig-wags on a public road is illegal in most countries, and they can be mistaken for an emergency vehicle.

## Patterns

**Strobes** flash the body controller's own light functions. The car does one flash per request and switches the
light off again by itself, so a flash stays short however slowly requests arrive. Nothing stays lit if the app or
the head unit stops.

| Pattern | What it does |
|---|---|
| High beam strobe | High beams, as fast as the car takes requests |
| Triple flash | Three high beam flashes, then a pause |
| Police | Cornering lights: three left, three right (high beams on cars without cornering lights) |
| High beam / fogs | High beams and front fogs in turn |
| Indicator wig-wag | A whole side's turn signals: two left, two right |
| Front and back | High beams, then rear fog and reversing lights |
| Rear strobe | Rear fog and reversing lights in turn |
| Every light in turn | Each light function once, round the car |

Light Show's original patterns (wig-wag, chase, sweep and the others) are still there. They switch individual lamp
outputs and only work where the Lamp check finds that the body controller accepts them.

**Speed.** Requests through the head unit take about 200 to 300 ms each, so a strobe runs at about 3 to 5 flashes
a second. For faster strobes, use Light Show's direct link (Network page): an ENET cable in the OBD port, plugged
into a travel router that the head unit joins over Wi-Fi.

## Lamp check

Run it once, parked. It takes about a minute. Watch the car or film it.

1. **Identifies** the body controller (reads only): which generation answers its lamp status (`BDC_G05`, or the
   older `BDC` generation), whether it has light functions, and each unit's SGBD index.
2. **Light functions**: each one flashed once. Any that are refused, like cornering lights on a car without them,
   are left out of the strobes, or replaced by the pattern's fallback.
3. **Lamp outputs** (Light Show's check): the output request layout, the time byte, a speed test, then each lamp
   in turn.

The results are saved and shown on the Strobe page (`Car: ...`) and the Lamp check page (`Light functions: ...`).

## Requests it sends

`lamps.js` `check()` refuses everything else before it reaches the car. The tests check this.

| Unit | Request | What |
|---|---|---|
| Body controller 0x40 | `10 03`, `10 01`, `3E 00` | Extended session, tester present every 2 s, default session at stop |
| | `22 F150`, `22 D542`, `22 E3B9`, `22 4500` | Identification, light functions, lamp output status (reads) |
| | `2E D542 00 <fn> <time, 10 ms>` | Light function for a time (max 5 s). Never brake light or emergency stop signal |
| | `2F E3B5 ...` or `2F 4501 ...` | One lamp output on / off / back to the car (BDC_G05 or older BDC). Never brake, tail or plate lights on/off |
| Headlight modules 0x43 / 0x44 | `22 F150`, `2E D6DC ...` | Identification; FLM02 light function (G05 headlights; F4x headlights will likely refuse) |

## Tests

```sh
node kit/tools/test_f4x_strobe.js
```

They run the app against a simulated body controller: allowed requests only, the parked-only gate, strobes as
timed functions only, fallbacks, the older body controller generation, and lamps given back at stop.

## License

[PolyForm Noncommercial License 1.0.0](../../LICENSE), like Light Show: free to use, change and share for
noncommercial purposes, with the license and its `Required Notice` lines kept. It can't be sold, and you can't
charge for installing it.

Required Notice: Copyright (C) 2026 eroobeeroo (https://github.com/eroobeeroo)
