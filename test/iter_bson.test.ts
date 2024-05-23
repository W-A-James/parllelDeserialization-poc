import { iterDeserialize } from '../lib/iter_bson.js';
import { serialize, deserialize, Code } from 'bson';
import { deepEqual } from 'node:assert';

describe('iterDeserialize()', function() {
  const d = (s: Uint8Array) => deserialize(s, { useBigInt64: true, promoteLongs: true, promoteValues: true, promoteBuffers: true });
  const table = [
    {
      input: {
        a: 1,
        b: 3,
        c: 4
      }, description: 'when deserializing flat document'
    },
    {
      input: {
        a: [1, 2, 3, 4, 5, 6],
      },
      description: 'when deserializing doc with flat array'
    },
    {
      input: {
        a: {
          b: {
            c: {
              d: 123,
              e: 100,
              f: true
            }
          }
        }
      }, description: 'when deserializing nested docs'
    },
    {
      input: {
        a: new Code((() => {
          // @ts-expect-error
          console.log(hello)
        }).toString(), { hello: true })
      }, description: 'when deserializing Code with Scope'
    }
  ];

  for (const { input, description } of table) {
    describe(description, function() {
      it('matches bson output', function() {
        const s = serialize(input);

        deepEqual(iterDeserialize(s), d(s));
      });
    });
  }
});
