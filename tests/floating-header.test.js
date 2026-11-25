import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const css=readFileSync(new URL('../src/styles.css',import.meta.url),'utf8');
test('UI-01: headers use the intended scroll container',()=>{
 assert.match(css,/#worldgen-root\{[^}]*position:fixed;inset:0/);
 assert.match(css,/\.wg-header\{[^}]*position:absolute/);
 assert.match(css,/\.wg-modal:not\(\.wg-3d-modal\) \.wg-modal-heading\{position:sticky/);
 assert.match(css,/\.wg-recovery-head\{position:sticky;top:0/);
 assert.match(readFileSync(new URL('../src/app.js',import.meta.url),'utf8'),/<header class="wg-recovery-head">/s);
});
