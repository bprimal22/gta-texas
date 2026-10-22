// b12 high-rise identity (profiles for generated West Campus high-rises + authored-tower audit + deep-West profiles).
// Data-only for the runtime: the archetype / catalog / per-volume massing patches are merged by the root into the owner
// context.json files (.work/INTEGRATION.json); applyDeepWestProfiles is the one optional runtime hook (deep-west index.ts).
export * from './profiles';
export * from './integration';
export * from './deep-west';
