import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgv } from '../src/args.js';
import { compareTags, tagKey } from '../src/semver.js';

test('parseArgv: booleans, values, =values and positions', () => {
  const { _, flags } = parseArgv([
    'get', '7.0.0-rc14', '--all', '-o', 'protos', '--source=master', '--json', '--no-color',
  ]);
  assert.deepEqual(_, ['get', '7.0.0-rc14']);
  assert.equal(flags.all, true);
  assert.equal(flags.o, 'protos');
  assert.equal(flags.source, 'master');
  assert.equal(flags.json, true);
  assert.equal(flags.noColor, true);
});

test('compareTags: newest-first ordering incl. rc normalization', () => {
  const tags = ['v6.7.9', 'v7.0.0-rc.9', 'v7.0.0-rc14', 'v7.0.0-rc10', 'v7.0.0-rc13', '6.7.24', 'v7.0.0'];
  const sorted = [...tags].sort(compareTags);
  assert.deepEqual(sorted, [
    'v7.0.0', 'v7.0.0-rc14', 'v7.0.0-rc13', 'v7.0.0-rc10', 'v7.0.0-rc.9', '6.7.24', 'v6.7.9',
  ]);
});

test('tagKey: null for non-versions', () => {
  assert.equal(tagKey('update-proto/stable'), null);
  assert.deepEqual(tagKey('v7.0.0-rc.9'), [7, 0, 0, 9]);
});
