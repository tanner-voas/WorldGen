import test from 'node:test';
import assert from 'node:assert/strict';
import {insideGeometry} from '../src/engine.js';

test('world geometry uses world-coordinate-first signature for every outline',()=>{
 const cases=[
  {g:{shape:'rectangle',width:200,height:100},inside:[[0,0],[100,50],[200,100]],outside:[[-1,0],[201,50],[100,101]]},
  {g:{shape:'circle',width:200,height:200},inside:[[100,100],[100,0],[200,100]],outside:[[0,0],[200,200],[-1,100]]},
  {g:{shape:'ellipse',width:240,height:120},inside:[[120,60],[240,60],[120,0]],outside:[[0,0],[240,120],[120,121]]}
 ];
 for(const {g,inside,outside} of cases){
  for(const [x,y] of inside)assert.equal(insideGeometry(x,y,g),true,`${g.shape} interior ${x},${y}`);
  for(const [x,y] of outside)assert.equal(insideGeometry(x,y,g),false,`${g.shape} exterior ${x},${y}`);
 }
});
