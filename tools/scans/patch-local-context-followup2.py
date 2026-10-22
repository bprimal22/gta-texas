# Follow-up 2: let the game pass a scanned stadium sector through buildLocalContext to buildStadiumBowl.
import sys
p = sys.argv[1]; s = open(p).read()
def rep(a, b):
    global s
    if a not in s: raise SystemExit(f'anchor not found: {a[:80]!r}')
    s = s.replace(a, b, 1)
rep("import { buildStadiumBowl } from './stadium-bowl';", "import { buildStadiumBowl, type StadiumBowlOptions } from './stadium-bowl';")
rep("""  roofs?: RoofsLidar | null;
}""", """  roofs?: RoofsLidar | null;
  /** Stadium bowl options, e.g. a stand sector replaced by aligned photogrammetry. */
  stadium?: StadiumBowlOptions;
}""")
rep("""    (x, z) => ground.height(x, z), grid);""", """    (x, z) => ground.height(x, z), grid, o.stadium);""")
open(p, 'w').write(s); print('patched', p)
