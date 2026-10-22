// Contract for block-owned headless checks (scripts/harness/blocks/<id>.ts).
// `scene` is the real headless scene from context-check.ts run({ scan: true }) — see its return
// value (physics, RAPIER, player, world, walkway, context, travel, surface, groundRoots, blocks…).
export interface BlockCheckResult { ok: boolean; report: Record<string, unknown>; failures?: string[] }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type BlockCheck = (scene: any) => BlockCheckResult | Promise<BlockCheckResult>;
