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
console.log('PASS: 60–165 Hz pacing, 30/60 fps budgets, simulation time, quiet/input transitions, blur/visibility without catch-up');
