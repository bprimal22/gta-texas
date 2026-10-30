import assert from 'node:assert/strict';
import { FramePacing } from '../lib/campus/render/frame-pacing.ts';
const active = {hidden:false,focused:true,quiet:false};
for(const refresh of [59.94,60,90,120,144,165]) {
 for(const fps of [30,60]) {
  const p=new FramePacing(`?fps=${fps}`);
  let frames=0, elapsed=0;
  for(let i=0;i<refresh*10;i++) {
   const dt=p.sample(i*1000/refresh,active);
   if(dt!==null){frames++;elapsed+=dt;}
  }
  assert(Math.abs(frames-Math.min(fps,refresh)*10)<=1,`${refresh}Hz / ${fps}fps pacing: ${frames}`);
  assert(elapsed>9.9 && elapsed<=10, 'active simulation follows real time');
 }
}
assert.equal(new FramePacing().playFps,30,'power saver defaults on for fresh loads');
assert.equal(new FramePacing('?fps=garbage').playFps,30);
const p=new FramePacing('?fps=60');
assert.equal(p.sample(0,active),0);
assert.equal(p.sample(10,{...active,focused:false}),null);
assert.equal(p.sample(100000,{...active,hidden:true}),null);
assert.equal(p.sample(100100,active),0,'resume discards inactive time');
assert.equal(p.sample(100117,active),.017);
assert.equal(p.sample(100118,{...active,quiet:true}),0);
assert.equal(p.sample(100200,{...active,quiet:true}),null);
assert(p.sample(100318,{...active,quiet:true})!==null);
assert.equal(p.sample(100319,active),0,'input wakes quiet mode immediately');
assert.equal(p.snapshot().targetFps,60);
p.setPowerSaving(true);
assert.equal(p.playFps,30);
assert.equal(p.sample(100320,active),0);
p.setPowerSaving(false);
assert.equal(p.playFps,60);
// rAF timestamps jitter around vsync (root's 60 Hz capture: 15.6–17.8 ms callbacks). A whole-refresh budget must keep
// one cadence (no 1/3-refresh judder pairs) and the fractional ones must keep their average rate.
for (const [hz, fps] of [[60, 30], [59.94, 30], [60, 60], [120, 30], [120, 60], [144, 30], [144, 60], [165, 30], [90, 60]]) {
 let seed = 7; const jitter = () => { seed = (seed * 16807) % 2147483647; return (seed / 2147483647 - .5) * 2.2; };
 const p = new FramePacing(`?fps=${fps}`), period = 1000 / hz, rendered = [];
 for (let i = 0; i < hz * 20; i++) {
  const t = i * period + jitter();
  if (p.sample(t, active) !== null) rendered.push(i);
 }
 const gaps = rendered.slice(1).map((v, i) => v - rendered[i]).slice(20);
 const ratio = hz / fps, counts = new Set(gaps);
 assert(Math.abs(rendered.length - Math.min(fps, hz) * 20) <= 2, `${hz}Hz / ${fps}fps jittered count ${rendered.length}`);
 if (Math.abs(ratio - Math.round(ratio)) < .05) assert.deepEqual([...counts], [Math.round(ratio)], `${hz}Hz / ${fps}fps jittered cadence ${[...counts].join(',')}`);
 else assert([...counts].every(g => g === Math.floor(ratio) || g === Math.ceil(ratio)), `${hz}Hz / ${fps}fps jittered gaps ${[...counts].join(',')}`);
}
console.log('PASS: 60–165 Hz pacing, jittered vsync cadence, 30/60 fps budgets, simulation time, quiet/input transitions, blur/visibility without catch-up');
