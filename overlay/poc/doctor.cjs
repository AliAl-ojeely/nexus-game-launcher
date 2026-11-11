'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const files = [
  'overlay/poc/index.html',
  'overlay/poc/ui.css',
  'overlay/poc/host.cjs',
  'native/nexus-overlay/CMakeLists.txt',
  'native/nexus-overlay/build/bin/NexusOverlayHook.dll',
  'native/nexus-overlay/build/bin/NexusOverlayInjector.exe',
  'native/nexus-overlay/build/bin/NexusD3D11TestGame.exe',
];
console.log('Nexus overlay POC diagnostic:');
for (const file of files) console.log(fs.existsSync(path.join(root, file)) ? '[OK] ' : '[MISSING] ', file);
console.log('Platform:', process.platform, process.arch, 'Node:', process.version);
