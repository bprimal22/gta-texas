# LiDAR-derived campus data (USGS 3DEP, 2017)

## Provenance
* Dataset: USGS Lidar Point Cloud **TX_Central_B1_2017** (StratMap 2017, 50 cm program), LAS 2019 delivery,
  tiles `3097433a3`, `a4`, `c1`, `c2`, from `rockyweb.usgs.gov`. U.S. Government work, **public domain**.
  Credit: U.S. Geological Survey, 3D Elevation Program. URLs, bytes and sha256 of every tile are in `sources.json`.
* Flown 2017-01-28 .. 2017-03-22 (tile metadata). That is the leaf-off season for deciduous trees; live oaks are evergreen.
* Classified point cloud (ASPRS LAS 1.4 PDRF 6). Within the campus bounds: 38.5 M points, about 7.3 pts/m².
  Classes: 2 ground 18.6 M, 6 building 8.0 M, 3/4/5 vegetation 10.5 M, 1 unclassified 1.1 M, plus 7/9/10/13/14 (noise, water, rail, wires).

## CRS and transformation
Source: `EPSG:6343` NAD83(2011) / UTM 14N, vertical NAVD88 (Geoid12B) in **metres** (`EPSG:5703`).
1. pyproj: EPSG:6343 to EPSG:6318 lon/lat.
2. Contract: `x = (lon + 97.73716) * 96182.6`, `z = -(lat - 30.2861) * 110851`.
3. Measured shift to match the campus.json 2023 footprints: **dx = -0.23 m, dz = -1.07 m** (added to LiDAR x,z).
   This is the median best-overlap shift over 280 footprints with clean overlap (per-building std 0.86 m in x, 0.56 m in z;
   median footprint IoU 0.78 before and 0.83 after the shift). A global search over the whole campus gives (-0.22, -1.09).
4. Elevation: campus Y = NAVD88 m - 165. Checked against observed ground at least 4 m from any footprint:
   * `terrain.json` (8 m grid, 39,453 nodes): median residual (campus - LiDAR) **+0.02 m**, MAD 0.15 m, P5..P95 -0.75..+0.66 m.
   * baked `offline-terrain-61` vertices (63,056): median **+0.04 m**, MAD 0.17 m, P5..P95 -0.69..+0.71 m.
   The contract's -165 is confirmed, so `verticalOffset.campusMinusNavd88m = -165.0` and
   `measuredMedianResidual = 0.02` = median(terrain.json Y - (NAVD88 - 165)).

## roofs-lidar.json (CONTRACT schema)
There is one entry per campus.json building id: 1278 unique ids. Id 699766 appears in two campus.json records, and the two are measured as one multipart footprint.
* `groundY`: the 10th percentile of class-2 ground cells in a ring 1.5 to 8 m outside the footprint, excluding other footprints. If there are fewer than 20 cells, the ring widens to 16 m. The value is campus Y. On sloped sites this is the low side.
* `heightP50/P95/Max`: class-6 surface (max return per 0.5 m cell) inside the footprint eroded by 0.75 m, minus `groundY`.
  Where class 6 is sparse but a non-vegetation structure is present (few multi-return pulses), the first-return surface is used and noted.
* `coverage`: the fraction of 0.5 m footprint cells that have a roof return.
* `roofType`/`pitchDeg`: 2 m x 2 m least-squares plane fits on the roof surface. Only fits with RMS < 0.15 m and at least 1.5 m inside the edge count.
  If less than 20 % of the fits are steeper than 12°, the roof is `flat`. Above 55 % it is `pitched`, and in between it is `mixed`. `pitchDeg` is the median slope of the steep fits (for flat roofs, the median of all fits).
* `tiers`: the 0.5 m height raster is first median-filtered over 2.5 m. Its heights are clustered into levels at least 3 m apart, with a minimum of 60 m² per level, and every connected piece smaller than 60 m² is merged into its neighbour.
  Each piece becomes one tier. Its `height` is the median raw height of the piece, `area` is in m², and `ring` is the outer ring only, simplified at 0.5 m, clipped to the footprint and given in campus x,z. Courtyard holes are dropped.
  Tiers are disjoint pieces. Because only outer rings are kept, a lower tier's ring can enclose a higher tier, so draw each tier from `groundY` to `groundY + height`; the taller tier then covers the lower one. Pieces lower than 2 m (open ground inside the footprint) are omitted.
  Pitched roofs come out as stepped tiers, and `roofType`/`pitchDeg` describe the actual roof form.
  206 measured buildings have no tier: they are under 60 m² or have no flat-enough piece. Use `heightP50`/`heightP95` on the whole footprint for those.
* `status`: `measured` 1145, `conflict` 133, `no-data` 0. A building is a `conflict` when any of these is true:
  * coverage < 0.3 (82 footprints have no roof returns at all, meaning they were built after 2017 or are small kiosks or sheds);
  * P95 < 0.5 h and h - P95 > 8 m;
  * coverage < 0.6 and |P95 - h| > max(8 m, 0.25 h).

  Conflicts still carry the 2017 statistics but `tiers: []`, and consumers should fall back to campus.json `h`.
  Examples: Moody Center 726134 has no 2017 returns. DKR North End Zone 655373 has coverage 0.44 and P95 53 m vs h 73 m. South End Zone 504014 has coverage 0.32 and P95 20 m vs h 41 m. Graduate Housing units, garages and several unnamed new towers (h 55..101 m) are also conflicts.
  The full list with notes is in `tools/lidar/work/report.json` and can be regenerated with `06_report.py`.

### Agreement with campus.json `h` (1145 measured)
| statistic | median diff | MAD | within 2 m | within 5 m | Pearson r |
|---|---|---|---|---|---|
| heightP95 - h | -0.18 m | 0.47 | 84.5 % | 95.4 % | 0.962 |
| heightMax - h | +0.30 m | 0.46 | 78.8 % | 93.8 % | 0.948 |
| heightP50 - h | -1.26 m | 0.94 | 65.9 % | 87.1 % | 0.912 |

There are 3 measured buildings where the LiDAR is 10 m or more higher than `h`: MAI (h = 15 is a base value; the tower is in the footprint), 551343 and 654319.
There are 10 where it is 10 m or more lower; they kept `measured` because their coverage and shape matched.

### Spot checks against independent heights
* **UT Tower**: the tower lies inside the MAI footprint 720180, at about (-212.4, -17.8) and 20 m x 20 m. The highest roof cells cluster at campus Y 110.0, with isolated returns up to 115.4 (finial or lightning mast).
  The ground is Y 15.4 at the north plaza and 16.7 at the south terrace, so the measured lantern top is 93.4 to 94.6 m above the adjacent ground. The published total height is 93.6 m (307 ft).
* **Texas Capitol** (533822): heightMax is 90.7 m above groundY 2.4, against a published height of 92.2 m (302.6 ft). The thin statue on top is under-sampled.

## canopy-trees.json
* Canopy height model, 0.5 m: the max of class 3/4/5 returns minus the DTM. Cells within 1 m of any 2023 footprint or 2017 class-6 return are removed, as is everything under 3 m.
  Single-cell pits are closed and the model is smoothed with a Gaussian of sigma 0.5 m.
* Tree tops are local maxima with a height-adaptive square window of radius `clamp(0.5 + 0.25 h, 2, 6)` m. Crowns come from a marker-controlled watershed.
  `crownRadius` = sqrt(area/π) of the crown cells at or above 50 % of the top height. `x,z` is the centroid of that 50 % crown, which is a better trunk proxy than the apex: 44 % vs 25 % of inventory trees fall within 3 m.
  `height` is the top height above the DTM, and `groundY` is the DTM under the crown centroid.
* Removed: segments under 3 m² of crown, low-multi-return segments under 15 m² (poles, signs), and anything outside the campus bounds.
* `confidence` (0.15..1) = 0.15 + 0.85 × (0.35·height term + 0.30·crown-area term + 0.35·multi-return term).
  Quantiles P5/P25/P50/P75/P95 are 0.51/0.66/0.78/0.92/1.0. 11,293 of 13,245 trees have confidence ≥ 0.6.
* **13,245 trees** over the campus bounds. Height P5/P25/P50/P75/P95 = 5.0/8.0/10.6/12.9/17.4 m. Crown radius P5/P25/P50/P75/P95 = 1.2/2.1/3.4/5.0/7.7 m.
* Hero corridors:
  * Speedway (x 0..40, z -150..150): **39** trees, or 93 for x -30..60. The TreeKeeper inventory has 34 trees in the same box.
  * East Mall (z 60..75, x -160..130): **19** trees, or 61 in the band z 45..90.

### Validation
* Speedway TreeKeeper inventory, 57 trees: 44 % have a detected tree within 3 m, 54 % within 5 m, and 53 % fall inside a detected crown.
  * Inventory trees taller than 10 m (n = 22): 77 % within 3 m and 95 % within 5 m. 100 % have canopy ≥ 3 m within 2 m.
  * Trees under 6 m (n = 28: redbuds, Mexican plums, young live oaks): 11 % within 3 m. 89 % of them sit under or beside canopy taller than 3 m that the LiDAR assigns to a larger neighbouring crown, or they were planted or grew after 2017.
    The Speedway Mall reconstruction finished after this flight.
  * For the 25 matched trees, the median LiDAR height minus the inventory height is +0.33 m.
* OSM trees in campus.json, 577: 49 % within 3 m and 67 % within 5 m. 71 % fall inside a detected crown.
  Of the OSM trees that have LiDAR canopy over them, 59 % are within 3 m and 79 % within 5 m.

## dtm-1m.bin.gz + dtm-1m.json (optional, NOT integrated)
The bare-earth DTM in campus Y on a 1 m grid covering the campus bounds. The format is in `dtm-1m.json`: gzip of int16 little-endian values with Y = value × 0.05.
71 % of the cells have observed ground. The rest (under buildings and water) are linearly interpolated. The file is 2.8 MB.

## Limitations
* **Vintage**: the data is from early 2017. Buildings finished or renovated afterwards are `conflict` (Moody Center, the DKR end zones, graduate housing, several towers), and trees planted, removed or grown since 2017 are missing or different.
  Trees on 2017 sites that now hold buildings are removed by the 2023 footprint mask.
* **Season**: leaf-off for deciduous species, so their crowns can come out smaller or lower and get lower confidence. Live oaks (evergreen) are well captured.
* **Occlusion and density**: about 7 pts/m², so many 0.5 m cells hold 1 to 2 points. Steep walls are not sampled.
  Understory trees beneath large live oaks are generally not separable, and large live oak crowns can split into 2 or 3 tops.
* Roof statistics use cell maxima, so parapets, HVAC units and masts raise P95 and max. Tiers are median-filtered over 2.5 m, so features smaller than about 60 m² are not represented.
* The horizontal shift is a single campus-wide median. Individual footprints still scatter by about 0.6 to 0.9 m (1σ), which includes digitising differences in the 2023 footprints.
* Nothing here is photogrammetry or a claim of a 1:1 model. These are measured height statistics and simplified level polygons.
