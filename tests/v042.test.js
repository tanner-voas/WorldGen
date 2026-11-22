import test from 'node:test';
import assert from 'node:assert/strict';
import {Terrain3DViewer,TERRAIN_VERTEX_SHADER,TERRAIN_FRAGMENT_SHADER} from '../src/terrain-3d.js';
import {buildAdaptiveTerrainLevels,buildUniformTerrainLevels} from '../src/terrain-3d-lod.js';

test('water depth is derived from the unexaggerated water level and shared base terrain',()=>{
 const vertex=TERRAIN_VERTEX_SHADER,fragment=TERRAIN_FRAGMENT_SHADER;
 // Uniform precision must match across stages (ES has different defaults).
 assert.match(vertex,/uniform highp int uWater;/);
 assert.match(fragment,/uniform highp int uWater;/);
 assert.match(vertex,/aPosition\.y\/uBaseHeightScale:aElevation/);
 assert.match(fragment,/vElevation-bedElevation\(\)/);
 assert.match(fragment,/texelFetch\(uTerrainFields,ivec3\(cell,0\),0\)/);
 assert.match(fragment,/f\.x\+f\.y<=1\.0\?a\+\(b-a\)\*f\.x\+\(c-a\)\*f\.y/);
 assert.match(fragment,/!river&&uHasDepthField!=0/);
 assert.doesNotMatch(fragment,/uHeightMultiplier/);
});

test('lighting and water use material roughness, view angle and stable filtered detail',()=>{
 const shader=TERRAIN_FRAGMENT_SHADER;
 assert.match(shader,/roughness=rock\*\.76.*wetland\*\.42/);
 assert.match(shader,/specularLight\(n,sun,view,roughness\)/);
 assert.match(shader,/albedo\*albedo\*irradiance/);
 assert.match(shader,/float horizon=1\.0-smoothstep/);
 assert.match(shader,/float fresnel=.*pow\(1\.0-facing,5\.0\)/);
 assert.match(shader,/dFdx\(p\)/);
 assert.match(shader,/vPosition\.xz\/max\(uWorldScale/);
 for(const kind of [1,2,3])assert.match(shader,new RegExp(`shadeWater\\(${kind},sun,view\\),view,distanceToEye\\),1\\.0`));
});

test('water draw path is opaque, uses depth writes, and retains the river depth bias',()=>{
 const cols=32,rows=32,inside=new Uint8Array((cols+1)*(rows+1)).fill(1);
 const s={cols,rows,planeWidth:4.8,planeDepth:4.8,levels:buildAdaptiveTerrainLevels(cols,rows,inside,4.8,4.8),
  uniformLevels:buildUniformTerrainLevels(cols,rows,inside),ocean:new Float32Array(18),seaLevel:.4,hydrology:{riverSegments:1}};
 const draws=[],uniforms=[];let mode=0,depth=false,blend=false,bias=false;
 const gl={COLOR_BUFFER_BIT:1,DEPTH_BUFFER_BIT:2,TRIANGLES:4,UNSIGNED_INT:5125,ELEMENT_ARRAY_BUFFER:34963,
  BLEND:3042,POLYGON_OFFSET_FILL:32823,viewport(){},clear(){},useProgram(){},uniformMatrix4fv(){},uniform3fv(){},uniform1f(){},
  uniform1i(location,value){uniforms.push([location,value]);if(location==='water')mode=value;},
  disable(cap){if(cap===this.BLEND)blend=false;if(cap===this.POLYGON_OFFSET_FILL)bias=false;},
  enable(cap){if(cap===this.BLEND)blend=true;if(cap===this.POLYGON_OFFSET_FILL)bias=true;},
  depthMask(v){depth=v;},bindVertexArray(){},bindBuffer(){},polygonOffset(){},drawElements(){},
  drawArrays(){draws.push({mode,depth,blend,bias});}};
 const viewer=Object.create(Terrain3DViewer.prototype);
 viewer.canvas={width:0,height:0,getBoundingClientRect:()=>({width:390,height:650})};
 Object.assign(viewer,{gl,surface:s,disposed:false,lost:false,program:{},target:[0,0,0],pitch:.94,yaw:-.72,distance:25,
  terrainVAO:{},waterVAO:{},waterLocation:'water',depthFieldLocation:'field',hydroGeometry:[{kind:2,vao:{},count:3},{kind:3,vao:{},count:3}],onStatus(){},
  levelBuffers:s.levels.map(l=>({step:l.step,tiles:l.tiles,count:l.indices.length,buffer:{}})),
  uniformLevelBuffers:s.uniformLevels.map(l=>({step:l.step,count:l.indices.length,buffer:{}}))});
 const previous=globalThis.window;
 try{
  globalThis.window={devicePixelRatio:1};viewer.draw();
  assert.deepEqual(draws,[{mode:2,depth:true,blend:false,bias:true},{mode:1,depth:true,blend:false,bias:false},{mode:3,depth:true,blend:false,bias:false}]);
  assert.ok(uniforms.some(([loc,v])=>loc==='field'&&v===0));
  assert.equal(depth,true);assert.equal(blend,false);assert.equal(bias,false);
 }finally{if(previous===undefined)delete globalThis.window;else globalThis.window=previous;}
});
