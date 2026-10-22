import * as T from 'three';

/** Window-local coordinates for shallow coverings behind the existing glass.
 * These attributes do not move vertices or add collision geometry. Unselected
 * windows and doorway glazing receive an explicit disabled flag. */
export function addHistoricWindowCoordinates(
  geometry: T.BufferGeometry,
  x: number, y: number, width: number, height: number,
  right: T.Vector3, seed: number, enabled: boolean,
) {
  const positions = geometry.getAttribute('position');
  const window = new Float32Array(positions.count * 4);
  const axis = new Float32Array(positions.count * 4);
  for (let i = 0; i < positions.count; i++) {
    window.set([
      (positions.getX(i) - x) / width + .5,
      (positions.getY(i) - y) / height + .5,
      width, height,
    ], i * 4);
    axis.set([right.x, right.z, seed, enabled ? 1 : 0], i * 4);
  }
  geometry.setAttribute('historicWindow', new T.BufferAttribute(window, 4));
  geometry.setAttribute('historicWindowAxis', new T.BufferAttribute(axis, 4));
}

/** A bounded interior approximation, not reconstructed rooms. References
 * L007-h000/h180 show varied pale window coverings on EPS and BRB. Keep the
 * existing dielectric reflection term and shade the covering behind it. */
export function addHistoricWindowCoveringsShader(shader: {
  vertexShader: string; fragmentShader: string;
}) {
  const anchor = 'outgoingLight=totalSpecular+historicInterior*(vec3(1.)-historicFresnel);';
  if (!shader.fragmentShader.includes(anchor)) throw Error('Historic window interior shader anchor missing');
  shader.vertexShader = `attribute vec4 historicWindow;
    attribute vec4 historicWindowAxis;
    varying vec4 vHistoricWindow, vHistoricWindowAxis;
    varying vec3 vHistoricWindowRight, vHistoricWindowUp;
    ` + shader.vertexShader;
  shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>
    vHistoricWindow=historicWindow; vHistoricWindowAxis=historicWindowAxis;
    vHistoricWindowRight=mat3(viewMatrix)*vec3(historicWindowAxis.x,0.,historicWindowAxis.y);
    vHistoricWindowUp=mat3(viewMatrix)*vec3(0.,1.,0.);
  `);
  shader.fragmentShader = `varying vec4 vHistoricWindow, vHistoricWindowAxis;
    varying vec3 vHistoricWindowRight, vHistoricWindowUp;
    ` + shader.fragmentShader;
  shader.fragmentShader = shader.fragmentShader.replace(anchor, `
    if(vHistoricWindowAxis.w>.5){
      float hwSeed=historicGlassHash(vec2(vHistoricWindowAxis.z,17.4));
      // Some bays are open, others partly/fully screened. The distribution is
      // stable per architectural window, never repeated independently per pane.
      float hwDrop=hwSeed<.24 ? 0. : mix(.28,.98,fract(hwSeed*11.17));
      vec3 hwView=normalize(vViewPosition);
      vec2 hwOffset=vec2(dot(hwView,normalize(vHistoricWindowRight)),dot(hwView,normalize(vHistoricWindowUp)));
      vec2 hwUV=vHistoricWindow.xy-hwOffset*.18/max(historicFacing,.16)/max(vHistoricWindow.zw,vec2(.1));
      vec2 hwAA=max(fwidth(hwUV),vec2(.0001));
      vec2 hwEdge=smoothstep(vec2(0.),hwAA*1.5,hwUV)*smoothstep(vec2(0.),hwAA*1.5,1.-hwUV);
      float hwCover=smoothstep(1.-hwDrop-hwAA.y,1.-hwDrop+hwAA.y,hwUV.y)*hwEdge.x*hwEdge.y;
      // Fine horizontal slats fade to their mean below one pixel to avoid
      // moire as the character backs away from the facade.
      float hwSlat=(hwUV.y*vHistoricWindow.w)/.045;
      float hwSlatFade=1.-smoothstep(.3,1.,fwidth(hwSlat));
      float hwRib=.86+.14*cos(hwSlat*6.2831853)*hwSlatFade;
      float hwEdgeShade=mix(.67,1.,smoothstep(0.,.11,min(hwUV.x,1.-hwUV.x)));
      vec3 hwBlind=vec3(.94,1.,.97)*mix(.060,.105,fract(hwSeed*7.31))*hwRib*hwEdgeShade;
      historicInterior=mix(historicInterior,hwBlind,hwCover);
    }
    ${anchor}
  `);
}
