#!/bin/sh
# Rebuild all LiDAR-derived products. Expects the 4 LAZ tiles in tools/lidar/raw/ (see public/data/derived/sources.json).
set -e
cd "$(dirname "$0")"
PY=../../.venv/bin/python
for s in 01_extract 02_rasters 03_validate 03b_calibrate 04_roofs 05_canopy 06_report 08_dtm 07_sources; do
  echo "== $s"; $PY $s.py
done
