"""Shared constants and helpers for the LiDAR lane (USGS 3DEP TX Central B1 2017)."""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np

LANE = Path(__file__).resolve().parents[2]
TOOLS = LANE / 'tools' / 'lidar'
RAW = TOOLS / 'raw'
WORK = TOOLS / 'work'
DATA = LANE / 'public' / 'data'
DERIVED = DATA / 'derived'

# CONTRACT.md coordinates: metres, X east, Z south, origin lon/lat below.
LON0 = -97.73716
LAT0 = 30.2861
SX = 111320 * math.cos(math.radians(LAT0))
SZ = 110851.0
# Campus Y = NAVD88 metres - 165 (contract nominal; empirically checked in validate step).
NOMINAL_Y_OFFSET = -165.0
BOUNDS = (-760.0, -864.0, 1296.0, 1536.0)  # west, north, east, south
MARGIN = 40.0

TILES = [
    'USGS_LPC_TX_Central_B1_2017_stratmap17_50cm_3097433a3_LAS_2019.laz',
    'USGS_LPC_TX_Central_B1_2017_stratmap17_50cm_3097433a4_LAS_2019.laz',
    'USGS_LPC_TX_Central_B1_2017_stratmap17_50cm_3097433c1_LAS_2019.laz',
    'USGS_LPC_TX_Central_B1_2017_stratmap17_50cm_3097433c2_LAS_2019.laz',
]
URL_BASE = ('https://rockyweb.usgs.gov/vdelivery/Datasets/Staged/Elevation/LPC/Projects/'
            'USGS_LPC_TX_Central_B1_2017_LAS_2019/laz/')

# Raster grid (0.5 m) covering campus bounds + margin.
RES = 0.5
GX0 = BOUNDS[0] - MARGIN
GZ0 = BOUNDS[1] - MARGIN
GNX = int(round((BOUNDS[2] - BOUNDS[0] + 2 * MARGIN) / RES))
GNZ = int(round((BOUNDS[3] - BOUNDS[1] + 2 * MARGIN) / RES))


def lonlat_to_campus(lon, lat):
    return (np.asarray(lon) - LON0) * SX, -(np.asarray(lat) - LAT0) * SZ


def campus_to_lonlat(x, z):
    return np.asarray(x) / SX + LON0, LAT0 - np.asarray(z) / SZ


def load_json(path):
    with open(path) as f:
        return json.load(f)


def cell_of(x, z):
    ix = np.floor((np.asarray(x) - GX0) / RES).astype(np.int64)
    iz = np.floor((np.asarray(z) - GZ0) / RES).astype(np.int64)
    return ix, iz


def cell_center(ix, iz):
    return GX0 + (np.asarray(ix) + 0.5) * RES, GZ0 + (np.asarray(iz) + 0.5) * RES
