import { serialize, deserialize, onDemand } from 'bson';


const d = {
  a: 10,
  b: true,
  c: 6n,
  d: {
    a: 1,
    b: /hello/,
    c: 1.2,
    d: {
      tweet: "hello darkness",
      subDoc: {
        a: 1.2,
        c: 14,
        has: {
          $key: 100,
          arr: [
            1, 2, 3, 4, 5, 6, 7, 8
          ]
        }
      }
    }
  }
};

type BSONElement = [
  /* type identifier */
  type: number,
  /* offset of name relative to start of _document_ */
  nameOffset: number,
  /*  length of name c-string */
  nameLength: number,
  /* offset of value relative to start of _document_ */
  offset: number,
  /* length of value */
  length: number
]

type QueueEntry = [
  /* offset of parent document relative to start of _buffer_ */
  parentOffset: number,
  /* type identifier */
  type: number,
  /* offset of name relative to start of _document_ */
  nameOffset: number,
  /*  length of name c-string */
  nameLength: number,
  /* offset of value relative to start of _document_ */
  offset: number,
  /* length of value */
  length: number
]
  ;
const s = serialize(d);

function getString(buffer: Uint8Array): string {
  const arr: string[] = [];
  for (const b of buffer) {
    arr.push(b.toString(16).padStart(2, '0'));
  }

  return arr.join(' ');
}

function traverse(bsonDoc: Uint8Array, f: (el: QueueEntry) => any) {
  const q: QueueEntry[] = [
    [0, 3, 0, 0, 0, Buffer.from(bsonDoc).readInt32LE(0)] // Root document
  ];
  while (q.length > 0) {
    const [totalOffset, type, _, __, docOffset, docLength] = q.pop() ?? [0, 0, 0, 0, 0, 0];
    if (type === 3 || type === 4) { // if parsing subdocument
      const slice = s.slice(totalOffset, totalOffset + docOffset + docLength);
      const elements = onDemand.parseToElements(slice);

      for (const [type, nameOffset, nameLength, offset, length] of elements) {
        f([totalOffset, type, nameOffset, nameLength, offset, length]);
        if (type === 4 || type === 3) { // Array or document
          q.push([
            totalOffset + offset,
            type,
            nameOffset,
            nameLength,
            offset,
            length]);
        }
      }
    } else {
      console.log('womp womp');
    }
  }
}

traverse(s, ([totalOffset, type, nameOffset, nameLength, offset, length]) => {
  const valueSlice = getString(s.slice(totalOffset + offset, totalOffset + offset + length));
  const name = onDemand.ByteUtils.toUTF8(s, totalOffset + nameOffset, totalOffset + nameOffset + nameLength, false);
  console.log(`type: ${type.toString().padStart(2, ' ')}, name: ${name}, value: ${valueSlice}`);
});
