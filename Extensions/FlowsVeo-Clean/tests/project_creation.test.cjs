const assert = require('node:assert/strict');
const { test } = require('node:test');
const vm = require('node:vm');

const { pageSource } = require('./helpers/modules.cjs');
const createProjectSource = pageSource('src/providers/google-flow/page/projects.js', 'runCreateProjectInPage');

function harness({ initialPath, nextPath = null, hasButton = true }) {
  const location = {
    origin: 'https://flow.google.com',
    pathname: initialPath,
  };
  const button = {
    textContent: 'New project',
    getAttribute: () => '',
    closest: () => button,
    click: () => {
      if (nextPath) location.pathname = nextPath;
    },
  };
  const document = {
    querySelectorAll: () => (hasButton ? [button] : []),
    querySelector: () => null,
  };
  const context = vm.createContext({
    location,
    document,
    Date: class extends Date {
      static now() { return context.__now += 1000; }
    },
    __now: 0,
    setTimeout: (callback) => { callback(); return 1; },
  });
  vm.runInContext(createProjectSource, context);
  return () => context.runCreateProjectInPage();
}

test('create project waits for a different Flow project id', async () => {
  const run = harness({
    initialPath: '/u/3/project/project-old',
    nextPath: '/u/3/project/project-new',
  });
  const result = await run();
  assert.equal(result.ok, true);
  assert.equal(result.flow_project_id, 'project-new');
});

test('create project never reports the existing project as newly created', async () => {
  const run = harness({ initialPath: '/u/3/project/project-old' });
  const result = await run();
  assert.equal(result.ok, false);
  assert.match(result.error, /project-old/);
});

test('create project fails when the Flow create button is unavailable', async () => {
  const run = harness({ initialPath: '/u/3/project/project-old', hasButton: false });
  const result = await run();
  assert.equal(result.ok, false);
  assert.match(result.error, /Không tìm thấy nút/);
});
