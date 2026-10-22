// Local metre coordinates from the installed PCL facade, official GIS notch,
// UT Libraries photographs, and iteration58 raw source observations.
// The GIS notch is NOT treated as a surveyed rear door plane. Raw eye-height
// hits constrain the simplified rear plane; soffit/pier/door sizes are inferred.
export const pclEntryPlan = {
  faceA: [-85.87, 339.90], faceB: [-47.52, 338.96],
  start: 7.4, end: 36.7,
  front: .20, floorFront: 2.20,
  rearStart: -6.385, rearEnd: -7.805,
  soffitY: 4.20, roofThickness: .24,
  sideThickness: .44, rearThickness: .32, floorThickness: .35,
  floorLift: .008,
  pierFractions: [.32, .70], pierWidth: .48, pierDepth: .58,
  doorFractions: [.25, .50, .75], doorPairWidth: 1.92, doorHeight: 2.36,
  cofferPitch: 1.12, cofferWidth: .065, cofferDepth: .11,
} as const;
