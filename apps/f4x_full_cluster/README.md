# Full Cluster Map

The Waze map (CarPlay or Android Auto, through **Waze on cluster**) over the **whole instrument cluster** of an
iDrive 7 car with the 12.3" digital cluster, with this app's own **speed** (left) and **engine speed** (right) drawn
over it. The stock gauges are hidden while the map is full. The warning lights stay on top, and warnings and an
open door take the cluster back as usual.

> **Status: not yet tested in a car.** It needs **Waze on cluster with the Full cluster mode** (a change to
> robertnisipeanu/idrive-apps, published from your fork until it's in the original).

## How it works

1. Waze on cluster shows the map in its usual box between the stock gauges.
2. This app (it starts with the head unit) draws its two readouts on the cluster, over where the stock speedometer
   and tachometer are, and waits until the cluster renderer says both are on screen.
3. Then it asks Waze on cluster for the full cluster (`/dev/shm/full-cluster/request.json`, rewritten every
   0.4 s). The map moves under the readouts and covers the rest of the cluster: the middle of the map, in the
   cluster's shape, stretched to 1920x720.

The map only covers the stock speedometer while this app draws the speed. The stock gauges come back by
themselves, within about 1.5 s, when:

- the car's speed signal stops for 2.5 s (the app never uses demo data),
- the Waze map stops showing,
- a readout fails on the cluster,
- you switch it off (On / off on its page, or Settings),
- the app stops, hangs or is removed (the ask is no longer rewritten).

## Settings

| Setting | |
|---|---|
| Map over the whole cluster | On (default) or off |
| Speed in | km/h (default) or mph |
| Engine speed scale up to | 6000, 7000 (default) or 8000 rpm. The last 15 % is red |

## Limits

- The map is stretched about 1.76x, so it's softer than in its usual box. CarPlay's turn instructions stay in
  the middle.
- The bottom row of the cluster (range, outside temperature, time) is covered too.
- Only the 12.3" digital cluster (1920x720).

## Tests

```sh
node kit/tools/test_f4x_full_cluster.js
```

## License

Under this repository's [LICENSE](../../LICENSE) (PolyForm Noncommercial 1.0.0). It uses the kit
(`kit/runtime`, MIT, cauliflowermossgrape) and `cluster_render_client.js` (Robert Nisipeanu, MPL-2.0, see its
header).
