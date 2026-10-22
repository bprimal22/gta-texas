#!/bin/sh
# Create an isolated whole-campus worker lane from root (literal excludes; never copies .work).
#   sh tools/blocks/make-lane.sh <block-id> [lane-dir-name]
set -eu
cd "$(dirname "$0")/../.."
lane=".work/wc-lanes/${2:-$1}"
[ -e "$lane" ] && { echo "lane exists: $lane"; exit 1; }
mkdir -p "$lane"
rsync -a --exclude='node_modules' --exclude='.work' --exclude='dist' --exclude='.git' --exclude='.vite-cache' ./ "$lane/"
ln -s ../../../node_modules "$lane/node_modules"
echo "lane $lane: $(du -sh "$lane" | cut -f1)"
