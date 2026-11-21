import test from 'node:test';
import assert from 'node:assert/strict';
import {MIN_RENDER_STAGE,defaultRenderSettings,renderModeOptions,renderOptionSupport,outputDimensions,detailPreset,smoothstep} from '../src/render.js';

test('rendering activates from layer 5 and uses terrain-oriented stage options',()=>{
 assert.equal(MIN_RENDER_STAGE,5);
 assert.deepEqual(renderModeOptions(5).map(x=>x[0]),['satellite','relief']);
 assert.ok(renderModeOptions(9).some(([id])=>id==='hydrology'));
 assert.ok(renderModeOptions(11).some(([id])=>id==='biomes'));
 assert.ok(renderModeOptions(12).some(([id])=>id==='vegetation'));
 assert.equal(renderOptionSupport(7).hydro,false);
 assert.equal(renderOptionSupport(9).hydro,true);
 assert.equal(renderOptionSupport(11).biomeTint,true);
 assert.equal(renderOptionSupport(12).vegetationTint,true);
});

test('default render settings stay within valid bounds',()=>{
 const a=defaultRenderSettings(5),b=defaultRenderSettings(12);
 assert.equal(a.stage,5);
 assert.equal(b.stage,12);
 assert.equal(a.mode,'satellite');
 assert.ok(a.longEdge>=1024);
 assert.ok(b.longEdge>=a.longEdge);
 for(const value of [a.blend,a.relief,a.coast,b.hydro,b.biomeTint,b.vegetationTint])assert.ok(Number.isFinite(value));
});

test('output dimensions preserve aspect ratio and LOD presets become denser',()=>{
 assert.deepEqual(outputDimensions(2000,1000,1000),{width:1000,height:500,scale:0.5});
 assert.deepEqual(outputDimensions(800,1600,800),{width:400,height:800,scale:0.5});
 const preview=detailPreset('preview'),standard=detailPreset('standard'),ultra=detailPreset('ultra');
 assert.ok(preview.sampleStep>standard.sampleStep);
 assert.ok(ultra.sampleStep<standard.sampleStep);
 assert.ok(ultra.riverWidth>standard.riverWidth);
 assert.ok(smoothstep(0,1,-1)<0.001);
 assert.ok(smoothstep(0,1,2)>0.999);
});
