# Bigger Waze Map

The Waze map (CarPlay or Android Auto, through **Waze on cluster**) larger on the instrument cluster, out to the
stock speedometer and rev counter, which stay as they are. For iDrive 7 cars with the 12.3" digital cluster.

> **Status: not yet tested in a car.** It needs **Waze on cluster with panel support** (the map window), built
> from [Andreipredaa11/idrive-apps](https://github.com/Andreipredaa11/idrive-apps) until it's in the original.

## Use

It starts with the head unit. Open it to set the size; the map follows within a second.

| Button | |
|---|---|
| Wider / Narrower | 80 px at a time, from 1088 (the stock box) to 1920 |
| Taller / Shorter | 40 px at a time, from 480 (the stock box) to 720 |
| Settings | On / off, move up or down, reset (1280 x 560, centred) |

The picture is the middle of the phone's map in the window's shape, stretched to fill it, so a much wider window
shows a little less of the map's top and bottom.

## How it works

While the Waze map shows on the cluster, the app keeps `/dev/shm/cluster-info/map_window.txt` fresh with one line,
`panel X Y W H`, the window centred on the cluster. Waze on cluster draws the map there, on the cluster's whole
panel, instead of in its own 1088 x 480 box. The app stopping, switched off or removed: the file goes stale within
3.5 s and the map is back in its box. It never takes over another app's window (Cluster Layouts, ID7 Cluster
Themes): a fresh window it didn't write is left alone.

## Tests

```sh
node kit/tools/test_f4x_map_size.js
```

## License

Under this repository's [LICENSE](../../LICENSE) (PolyForm Noncommercial 1.0.0). It uses the kit (`kit/runtime`,
MIT, cauliflowermossgrape).
