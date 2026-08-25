'use strict';

// Preloaded before HomeCheck so all later consumers share the patched fs module.
const fs = require('node:fs');
const gracefulFs = require('graceful-fs');

const configuredLimit = Number(process.env.HOMECHECK_FILE_CONCURRENCY || 1);
const limit = Number.isInteger(configuredLimit) && configuredLimit > 0 ? configuredLimit : 1;

// Queue and retry EMFILE/ENFILE instead of replacing low-level descriptor lifecycle.
gracefulFs.gracefulify(fs);

const waiters = [];
let active = 0;

function drain() {
  while (active < limit && waiters.length > 0) {
    active += 1;
    waiters.shift()();
  }
}

function limitCallbackOperation(methodName) {
  const original = fs[methodName].bind(fs);
  fs[methodName] = function limitedOperation(...args) {
    const callbackIndex = args.length - 1;
    const callback = args[callbackIndex];
    if (typeof callback !== 'function') {
      return original(...args);
    }
    waiters.push(() => {
      args[callbackIndex] = (...callbackArgs) => {
        active = Math.max(0, active - 1);
        drain();
        callback(...callbackArgs);
      };
      original(...args);
    });
    drain();
  };
}

for (const methodName of ['readFile', 'readdir', 'writeFile', 'appendFile', 'copyFile']) {
  if (typeof fs[methodName] === 'function') {
    limitCallbackOperation(methodName);
  }
}
