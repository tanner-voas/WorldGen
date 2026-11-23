import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../src/styles.css',import.meta.url),'utf8');
test('world header puts the same host home/standalone refresh icon last',()=>{
 const block=src.slice(src.indexOf('function buildShell(){'),src.indexOf('<main class="wg-map-area">'));
 assert.ok(block.indexOf('data-action="save"')<block.indexOf('data-action="render"'));
 assert.ok(block.indexOf('data-action="render"')<block.indexOf('data-action="library"'));
 assert.ok(block.indexOf('data-action="library"')<block.indexOf('class="wg-icon-button wg-home"'));
 assert.match(block,/host\?\.returnToLauncher\?'home':'update'/);
 assert.match(src,/await flushPersist\(\).*localUpdateButton/);
 assert.match(css,/\.wg-header-svg\{/);
});
