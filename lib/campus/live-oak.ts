/**
 * Southern live-oak entry point. The earlier single-tree scaffold prototype
 * (48k/12k/3k instanced folded leaves per LOD, never wired into the scene) is
 * superseded by the shared procedural forms in ./vegetation/oak-forms.ts:
 * reference-guided low broad crowns, 2–4 crooked scaffold limbs, spray-card
 * foliage with sky holes, near/mid/far LODs plus baked impostors, drawn for
 * every tree through BatchedMesh (./vegetation/tree-batches.ts).
 */
export { FORM_SPECS, buildForm, treeForms, type TreeForm, type FormSpec, type CollisionCapsule } from './vegetation/oak-forms';
export { fitTree, LIMB_CLEARANCE } from './vegetation/tree-fit';
