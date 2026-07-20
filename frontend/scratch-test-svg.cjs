const { JSDOM } = require('jsdom');

const dom = new JSDOM('<!DOCTYPE html><div id="sheet"></div>');
global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;

const abcjs = require('abcjs');
const host = dom.window.document.getElementById('sheet');

const abc = `X:1
K:C
CDE F |]`;

abcjs.renderAbc(host, abc, { add_classes: true });

const svg = host.querySelector('svg');
console.log(svg.innerHTML);
