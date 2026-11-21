import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {renderInsideGeometry,smoothNoise,terrainTexture} from '../src/render.js';

test('raster clipping uses world-coordinate-first geometry signature for every outline',()=>{
 const cases=[
  {g:{shape:'rectangle',width:200,height:100},inside:[[0,0],[100,50],[200,100]],outside:[[-1,0],[201,50],[100,101]]},
  {g:{shape:'circle',width:200,height:200},inside:[[100,100],[100,0],[200,100]],outside:[[0,0],[200,200],[-1,100]]},
  {g:{shape:'ellipse',width:240,height:120},inside:[[120,60],[240,60],[120,0]],outside:[[0,0],[240,120],[120,121]]}
 ];
 for(const {g,inside,outside} of cases){
  for(const [x,y] of inside)assert.equal(renderInsideGeometry(x,y,g),true,`${g.shape} interior ${x},${y}`);
  for(const [x,y] of outside)assert.equal(renderInsideGeometry(x,y,g),false,`${g.shape} exterior ${x},${y}`);
 }
});

test('raster renderer calls the checked coordinate wrapper rather than the reversed signature',()=>{
 const source=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
 assert.match(source,/if\(!renderInsideGeometry\(wx,wy,geometry\)\)/);
 assert.doesNotMatch(source,/insideGeometry\(geometry,wx,wy\)/);
});

test('subcell terrain texture is deterministic and spatially continuous',()=>{
 for(const [x,y] of [[0,0],[120.45,200.3],[-32.13,245.1]]){
  const a=terrainTexture(x,y,16);
  assert.equal(a,terrainTexture(x,y,16));
  assert.ok(a>=0&&a<=1);
  assert.ok(Math.abs(a-terrainTexture(x+.00001,y,16))<.001);
 }
 for(let i=0;i<100;i++)assert.ok(smoothNoise(i*.18,i*.12)>=0&&smoothNoise(i*.18,i*.12)<=1);
});
