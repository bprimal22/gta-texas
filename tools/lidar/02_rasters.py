"""Step 2: grid the cropped points at 0.5 m (campus x,z) and build a 1 m DTM.

Outputs tools/lidar/work/rasters.npz:
  dsm      max elevation of all non-noise returns (NAVD88 m), NaN where empty
  bld      max elevation of class-6 (building) returns, NaN where empty
  veg      max elevation of non-ground / non-building / non-noise / non-water returns
  vegn     number of such returns, vegmr  count of those that belong to multi-return pulses
  gnd      mean class-2 elevation per 0.5 m cell, NaN where empty
  dtm      ground surface (NAVD88 m) at 0.5 m: 1 m mean class-2, holes filled by Delaunay-linear
           interpolation, bilinear-resampled to 0.5 m
  dtm1     the 1 m DTM itself (x0 = GX0, z0 = GZ0, step 1 m)
"""
import numpy as np
from scipy.interpolate import griddata
from scipy.ndimage import map_coordinates

from common import GNX, GNZ, GX0, GZ0, RES, WORK

p = np.load(WORK / 'points.npz')
x, z, e, c, n = p['x'], p['z'], p['e'], p['c'], p['n']
print('points', len(x), flush=True)
ix = np.floor((x - GX0) / RES).astype(np.int64)
iz = np.floor((z - GZ0) / RES).astype(np.int64)
ok = (ix >= 0) & (ix < GNX) & (iz >= 0) & (iz < GNZ)
cell = np.where(ok, iz * GNX + ix, -1)
NOISE = np.isin(c, (7, 13, 14, 18))  # noise + wire classes


def grid_max(mask):
    out = np.full(GNX * GNZ, -np.inf, dtype=np.float32)
    m = mask & ok
    np.maximum.at(out, cell[m], e[m])
    out[np.isinf(out)] = np.nan
    return out.reshape(GNZ, GNX)


def grid_count(mask, size=GNX * GNZ, idx=None):
    idx = cell if idx is None else idx
    return np.bincount(idx[mask & ok], minlength=size)


dsm = grid_max(~NOISE)
print('dsm', flush=True)
bld = grid_max(c == 6)
vegmask = np.isin(c, (3, 4, 5))  # ASPRS low/medium/high vegetation
veg = grid_max(vegmask)
vegn = grid_count(vegmask).reshape(GNZ, GNX).astype(np.uint16)
vegmr = grid_count(vegmask & (n > 1)).reshape(GNZ, GNX).astype(np.uint16)
g = (c == 2) & ok
gs = np.bincount(cell[g], weights=e[g], minlength=GNX * GNZ)
gc = np.bincount(cell[g], minlength=GNX * GNZ)
gnd = np.where(gc > 0, gs / np.maximum(gc, 1), np.nan).reshape(GNZ, GNX).astype(np.float32)
print('grids', flush=True)

# 1 m DTM from class-2 means; fill holes (buildings, water) by linear interpolation.
NX1, NZ1 = GNX // 2, GNZ // 2
gs1 = gs.reshape(GNZ, GNX)[:NZ1 * 2, :NX1 * 2].reshape(NZ1, 2, NX1, 2).sum(axis=(1, 3))
gc1 = gc.reshape(GNZ, GNX)[:NZ1 * 2, :NX1 * 2].reshape(NZ1, 2, NX1, 2).sum(axis=(1, 3))
dtm1 = np.where(gc1 > 0, gs1 / np.maximum(gc1, 1), np.nan)
have = ~np.isnan(dtm1)
print('dtm1 coverage', have.mean(), flush=True)
jj, ii = np.nonzero(have)
mj, mi = np.nonzero(~have)
# Use only known cells near holes as interpolation support (keeps the triangulation small).
from scipy.ndimage import binary_dilation
support = have & binary_dilation(~have, iterations=6)
sj, si = np.nonzero(support)
fill = griddata(np.c_[si, sj], dtm1[sj, si], np.c_[mi, mj], method='linear')
dtm1[mj, mi] = fill
still = np.isnan(dtm1)
if still.any():
    near = griddata(np.c_[ii, jj], dtm1[jj, ii], np.c_[np.nonzero(still)[1], np.nonzero(still)[0]], method='nearest')
    dtm1[still] = near
dtm1 = dtm1.astype(np.float32)
# 0.5 m cell centres in 1 m-cell index space: (k + 0.5) * 0.5 - 0.5
cz = (np.arange(GNZ) + 0.5) * 0.5 - 0.5
cx = (np.arange(GNX) + 0.5) * 0.5 - 0.5
CZ, CX = np.meshgrid(cz, cx, indexing='ij')
dtm = map_coordinates(dtm1, [CZ.ravel(), CX.ravel()], order=1, mode='nearest').reshape(GNZ, GNX).astype(np.float32)
np.savez_compressed(WORK / 'rasters.npz', dsm=dsm, bld=bld, veg=veg, vegn=vegn, vegmr=vegmr, gnd=gnd,
                    dtm=dtm, dtm1=dtm1, gcount1=gc1.astype(np.uint16))
print('saved', dsm.shape, 'dsm coverage', np.isfinite(dsm).mean(), 'bld cells', np.isfinite(bld).sum())
