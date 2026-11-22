import test from 'node:test';
import assert from 'node:assert/strict';
import {fitTerrainCamera,orbitEye,pickRenderedRay,createLakeHeightLookup,clearTerrainEye,gridCrossingTimes,surfaceHeightAt} from '../src/terrain-3d-focus.js';
import {Terrain3DViewer,lookAtMatrix,perspectiveMatrix,multiplyMatrices} from '../src/terrain-3d.js';
const near=(a,b,epsilon=1e-6)=>assert.ok(Math.abs(a-b)<epsilon,`${a} != ${b}`);
function surface(heights=[0,0,0,0]){
 const vertexData=new Float32Array(4*7);
 for(let i=0;i<4;i++)vertexData.set([i%2*4-2,heights[i],Math.floor(i/2)*4-2,0,1,0,heights[i]],i*7);
 return {planeWidth:4,planeDepth:4,cols:1,rows:1,vertexData,insideMask:new Uint8Array(4).fill(1),heightScale:1,minY:Math.min(...heights),maxY:Math.max(...heights),seaLevel:-2};
}
const indices=new Uint32Array([0,2,1,1,2,3]);
const plane=(y)=>new Float32Array([-2,y,-2,-2,y,2,2,y,-2,2,y,-2,-2,y,2,2,y,2]);

test('Fit projects the complete world bounds into portrait, landscape, extreme dimensions and exaggerated relief',()=>{
 for(const [w,d] of [[4.8,4.8],[4.8,.012],[.012,4.8]])for(const aspect of [.35,.6,1,2,3])for(const multiplier of [1,10,200]){
  const s={planeWidth:w,planeDepth:d,minY:-.6,maxY:1.2},pitch=.94,yaw=-.72;
  const {target,distance}=fitTerrainCamera(s,pitch,yaw,aspect,multiplier);
  const eye=orbitEye(target,distance,pitch,yaw),m=multiplyMatrices(perspectiveMatrix(.77,aspect,.001,distance*4),lookAtMatrix(eye,target));
  for(const x of [-w/2,w/2])for(const y of [s.minY*multiplier,s.maxY*multiplier])for(const z of [-d/2,d/2]){
   const clip=[0,1,2,3].map(i=>m[i]*x+m[i+4]*y+m[i+8]*z+m[i+12]);
   assert.ok(clip[3]>0&&Math.abs(clip[0]/clip[3])<=.881&&Math.abs(clip[1]/clip[3])<=.881);
  }
 }
});

test('Exact triangle picking handles nonplanar quads, actual visible index ranges, and near-plane clipping',()=>{
 const s=surface([0,0,0,4]),frame={terrain:[{indices,count:6}],multiplier:1};
 // The center lies on the low diagonal, not the bilinear saddle (1).
 near(surfaceHeightAt(s,0,0),0);
 const p=pickRenderedRay(s,frame,[0,6,0],[0,-1,0]);near(p[1],0);
 const q=pickRenderedRay(s,frame,[1,6,1],[0,-1,0]);near(q[1],2);
 assert.equal(pickRenderedRay(s,{...frame,near:7},[0,6,0],[0,-1,0]),null);
 assert.equal(pickRenderedRay(s,{...frame,terrain:[{indices,start:0,count:3}]},[1,6,1],[0,-1,0]),null);
});

test('The nearest visible lake, sea or terrain surface is selected, including under relief scaling',()=>{
 const s=surface([-1,-1,-1,-1]);s.ocean=plane(-.5);s.hydrology={lakes:new Float32Array([0,1,0,0,1,2,2,1,0])};
 const frame={terrain:[{indices,count:6}],multiplier:3};
 near(pickRenderedRay(s,frame,[.5,6,.5],[0,-1,0])[1],3);
 near(pickRenderedRay(s,frame,[-.5,6,-.5],[0,-1,0])[1],-1.5);
 const lookup=createLakeHeightLookup(s);near(lookup(.5,.5),1);assert.equal(lookup(-.5,-.5),null);
 const high=surface([2,2,2,2]);high.hydrology=s.hydrology;high.ocean=s.ocean;
 near(pickRenderedRay(high,frame,[.5,9,.5],[0,-1,0])[1],6);
 assert.equal(pickRenderedRay(s,frame,[3,6,3],[0,-1,0]),null);
});

test('Picking follows the actual global morph and local refinement blend, without modifying geometry',()=>{
 const s=surface([0,0,0,0]);const fields=new Float32Array(2*4*4);
 for(let i=0;i<4;i++)fields[(4+i)*4]=2;
 s.morphFields={terrain:fields};
 const frame={terrain:[{indices,count:6,morph:{mode:1,from:0,to:1,weight:.25}}],multiplier:2};
 near(pickRenderedRay(s,frame,[0,10,0],[0,-1,0])[1],1);
 const fine=surface([4,4,4,4]).vertexData;
 const local={terrain:[{vertexData:fine,indices,count:6,morph:{mode:2,weight:.25}}],multiplier:2};
 const before=fine.slice();near(pickRenderedRay(s,local,[0,10,0],[0,-1,0])[1],2);assert.deepEqual(fine,before);
 near(pickRenderedRay(s,{...local,terrain:[{...local.terrain[0],morph:null}]},[0,10,0],[0,-1,0])[1],8);
});

test('Camera clearance raises the eye above intervening hills and water without moving the target',()=>{
 const target=[0,0,0],eye=[1,.1,0];
 const height=(x)=>Math.max(0,.8-Math.abs(x-.45)*8);
 const crossings=gridCrossingTimes([0,0],[20,0],20,1);
 const corrected=clearTerrainEye(eye,target,height,.05,.01,crossings);
 assert.deepEqual(target,[0,0,0]);assert.equal(corrected[0],1);assert.equal(corrected[2],0);
 assert.ok(corrected[1]*.45>.8);
 assert.deepEqual(clearTerrainEye([1,3,0],target,height,.05,.01),[1,3,0]);
});

function viewer(){
 const v=Object.create(Terrain3DViewer.prototype);
 Object.assign(v,{canvas:{getBoundingClientRect:()=>({left:0,top:0,width:390,height:600}),setPointerCapture(){},hasPointerCapture(){return false;}},surface:surface(),distance:4,pitch:.95,yaw:0,target:[0,0,0],heightMultiplier:1,pointers:new Map(),mode:'orbit',drawSoon(){}});
 return v;
}
test('Pan and anchored zoom use the actual viewport projection, with first pinch movement and capture cancellation handled',()=>{
 const v=viewer(),anchor={x:260,y:350},before=v._planePoint(anchor,0);
 v.zoom(.8,anchor);const after=v._planePoint(anchor,0);near(before[0],after[0]);near(before[1],after[1]);
 const destination={x:280,y:355};v.pan(20,5,anchor,destination);const moved=v._planePoint(destination,0);near(moved[0],before[0]);near(moved[1],before[1]);
 const ev=(id,x,y,type='pointerdown')=>({pointerId:id,clientX:x,clientY:y,pointerType:'touch',type,preventDefault(){}});
 v.pointerDown(ev(1,150,300));v.pointerDown(ev(2,250,300));const prior=v.distance;
 v.pointerMove(ev(2,275,300,'pointermove'));assert.ok(v.distance<prior);
 v.pointerUp(ev(2,275,300,'lostpointercapture'));assert.equal(v.pointers.size,1);assert.equal(v.gesture,null);assert.equal(v.lastTap,null);
 v.pointerUp(ev(1,150,300,'pointercancel'));assert.equal(v.pointers.size,0);
});

test('Fit remains active for viewport and relief changes until the user navigates, and lake focus tracks water level',()=>{
 const v=viewer();v.resetCamera();assert.equal(v.fitActive,true);const initial=v.distance;
 v.canvas.getBoundingClientRect=()=>({left:0,top:0,width:220,height:700});v._fitCamera();assert.ok(v.distance>initial);
 v.zoom(.8);assert.equal(v.fitActive,false);
 v.distance=.05;v.surface=surface([-1,-1,-1,-1]);v.surface.hydrology={lakes:plane(.3)};v.lakeHeightAt=createLakeHeightLookup(v.surface);v.target=[0,0,0];v._followTerrain();near(v.target[1],.3);
});
