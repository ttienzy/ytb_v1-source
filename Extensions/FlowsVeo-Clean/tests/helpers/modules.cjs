const { buildSync } = require('esbuild');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const cache = new Map();
function moduleSource(files, { minify = process.env.TEST_MINIFY === '1' } = {}) {
  const key = JSON.stringify([files, minify]);
  if (!cache.has(key)) {
    cache.set(key, buildSync({
      absWorkingDir: root,
      stdin: { contents: files.map(file => `export * from './${file}';`).join('\n'), resolveDir: root },
      bundle: true, write: false, format: 'iife', globalName: '__testModules',
      platform: 'browser', target: 'chrome120', charset: 'utf8', legalComments: 'none',
      treeShaking: false, minifyIdentifiers: minify, minifyWhitespace: minify, minifySyntax: false,
    }).outputFiles[0].text);
  }
  return cache.get(key);
}
function loadModules(files, context, options) {
  vm.runInContext(moduleSource(files, options), context);
  Object.assign(context, context.__testModules);
  return context.__testModules;
}
function pageSource(file, name) {
  const context = vm.createContext({});
  const exports = loadModules([file], context);
  // Exactly the same isolation boundary as chrome.scripting.executeScript(func).
  return `var ${name} = (${exports[name].toString()});`;
}
module.exports = { moduleSource, loadModules, pageSource, root };
