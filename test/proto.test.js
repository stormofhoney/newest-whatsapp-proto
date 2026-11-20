import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWaVersion, protoStats, topLevelBlocks, diffProtos } from '../src/proto.js';

const P_A = `syntax = "proto3";
package proto;

/// WhatsApp Version: 2.3000.111

message ADVDeviceIdentity {
    optional uint32 rawId = 1;
    optional uint64 timestamp = 2;
}

enum ADVEncryptionType {
    E2EE = 0;
    HOSTED = 1;
}
message Old {
    optional string x = 1;
}
`;

const P_B = `syntax = "proto3";
package proto;

/// WhatsApp Version: 2.3000.222

message ADVDeviceIdentity {
    optional uint32 rawId = 1;
    optional uint64 timestamp = 2;
    optional ADVEncryptionType accountType = 3;
}

enum ADVEncryptionType {
    E2EE = 0;
    HOSTED = 1;
}

message NewThing {
    optional string y = 1;
}

message Nested {
    optional string outer = 1;
    message Inner {
        optional string i = 1;
    }
}
`;

test('parseWaVersion reads the header comment', () => {
  assert.equal(parseWaVersion(P_A), '2.3000.111');
  assert.equal(parseWaVersion('no header here'), null);
});

test('topLevelBlocks: only top-level, nested messages belong to parent', () => {
  const blocks = topLevelBlocks(P_B);
  const names = blocks.map((b) => b.name);
  assert.deepEqual(names, ['ADVDeviceIdentity', 'ADVEncryptionType', 'NewThing', 'Nested']);
  assert.ok(blocks[3].body.includes('message Inner'));
});

test('protoStats counts top-level definitions', () => {
  const s = protoStats(P_A);
  assert.equal(s.messages, 2);
  assert.equal(s.enums, 1);
  assert.equal(s.lines, P_A.split('\n').length);
});

test('diffProtos: added / removed / changed + version delta', () => {
  const d = diffProtos(P_A, P_B);
  assert.equal(d.a.waVersion, '2.3000.111');
  assert.equal(d.b.waVersion, '2.3000.222');
  assert.deepEqual(d.added.map((x) => x.name), ['NewThing', 'Nested']);
  assert.deepEqual(d.removed.map((x) => x.name), ['Old']);
  assert.ok(d.changed.some((x) => x.name === 'ADVDeviceIdentity'));
  assert.ok(!d.changed.some((x) => x.name === 'Old'));
});
