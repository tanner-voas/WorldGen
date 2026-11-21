import {test} from 'node:test';
import assert from 'node:assert/strict';
import {comparisonStages,elevationsAt,distanceScale} from '../src/render.js';

test('comparison uses the historical height field available in the save',()=>{
 const source=[];
 source[4]={elevations:[-.1,.2]};source[5]={water:[1,0]};
 source[6]={elevations:[-.3,.4]};source[7]={elevations:[-.3,.38]};
 assert.deepEqual(comparisonStages(5),[4]);
 assert.deepEqual(comparisonStages(6),[4,5]);
 assert.deepEqual(comparisonStages(12),[4,5,6]);
 assert.equal(elevationsAt(source,5),source[4].elevations);
 source[5].elevations=[-.2,.2];
 assert.equal(elevationsAt(source,5),source[5].elevations);
 assert.equal(elevationsAt(source,12),source[7].elevations);
});

test('scale bars show the distance spanned at fit and at high zoom',()=>{
 for(const kmPerPixel of [20,1,.005,.00009]){
  const bar=distanceScale(kmPerPixel,100);
  assert.ok(bar.pixels<=100&&bar.pixels>=39.9);
  assert.equal(bar.distance,bar.pixels*kmPerPixel);
 }
});
