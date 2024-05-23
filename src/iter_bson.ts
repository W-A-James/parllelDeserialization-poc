import { serialize, deserialize, onDemand, Code } from 'bson';
import { inspect } from 'node:util';
import { deepEqual } from 'node:assert';


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
        codeWScope: new Code(() => {
          // @ts-expect-error 
          console.log(hello)
        }, { hello: 100 }),
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

export type QueueEntry = [
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
  length: number,
  root: Record<string, any> | any[]
]

type Queue = QueueEntry[];

const s = serialize(d);

function getBinString(buffer: Uint8Array): string {
  const arr: string[] = [];
  for (const b of buffer) {
    arr.push(b.toString(16).padStart(2, '0'));
  }

  return arr.join(' ');
}

function isArray(root: Record<string, any> | Array<any>, type: number): root is Array<any> {
  return type === 4;
}

function isDoc(root: Record<string, any> | Array<any>, type: number): root is Record<string, any> {
  return type === 3;
}

function parseRegex(slice: Uint8Array, offset: number): RegExp {
  // Find end of pattern
  let patternEnd = offset;
  while (slice[patternEnd] !== 0) patternEnd++;

  const patternString = onDemand.ByteUtils.toUTF8(slice, offset, patternEnd, false);

  let flagEnd = patternEnd + 1;
  while (slice[flagEnd] !== 0) flagEnd++;

  const flagString = onDemand.ByteUtils.toUTF8(slice, patternEnd + 1, flagEnd, false);
  return new RegExp(patternString, flagString);
}

function parseString(slice: Uint8Array, offset: number): string {
  const strLen = onDemand.NumberUtils.getInt32LE(slice, offset);
  const strStart = offset + 4;
  return onDemand.ByteUtils.toUTF8(slice, strStart, strStart + strLen - 1, false);
}

function parseBinary(slice: Uint8Array, offset: number): { subtype: number, binary: Uint8Array } {
  const len = onDemand.NumberUtils.getInt32LE(slice, offset);
  const subtype = slice[offset + 4];
  const binary = Buffer.copyBytesFrom(slice, offset + 5, offset + 5 + len);

  return {
    subtype,
    binary
  }
}

function parseFromElement(slice: Uint8Array, element: BSONElement): any {
  const [type, _, __, offset, length] = element;

  let high: bigint, low: bigint;
  switch (type) {
    case 3:
      return {}; // Returns empty document to be populated on next unshift from queue
    case 4:
      return []; // Returns empty array to be populated on next unshift from queue
    case 1: // double
      return onDemand.NumberUtils.getFloat64LE(slice, offset);
    case 2: // string
      return parseString(slice, offset);
    case 5: // binary
      return parseBinary(slice, offset);
    case 6: // undefined
      return undefined;
    case 7: // ObjectId
      return Buffer.copyBytesFrom(slice, offset, length);
    case 8: // bool
      return Boolean(slice[offset]);
    case 9: // date
      return onDemand.NumberUtils.getBigInt64LE(slice, offset);
    case 10: // null
      return null
    case 11: // regex
      return parseRegex(slice, offset);
    case 12: // dbpointer
      return { ns: parseString(slice, offset), oid: Buffer.copyBytesFrom(slice, offset + 4 + onDemand.NumberUtils.getInt32LE(slice, offset)) }
    case 13: // code
      return { code: parseString(slice, offset) }
    case 14: // symbol
      return { symbol: parseString(slice, offset) };
    case 15: // code w scope
      return { code: parseString(slice, offset + 4), scope: {} }
    case 16: // int
      return onDemand.NumberUtils.getInt32LE(slice, offset);
    case 17: // timestamp
      return onDemand.NumberUtils.getBigInt64LE(slice, offset);
    case 18: // long
      return onDemand.NumberUtils.getBigInt64LE(slice, offset);
    case 19: // decimal
      high = onDemand.NumberUtils.getBigInt64LE(slice, offset);
      low = onDemand.NumberUtils.getBigInt64LE(slice, offset + 8);
      return { high, low };
    case 255: // minkey
      return '$minkey';
    case 127: //maxkey
      return '$maxkey';
  }
}

function handleWithDocRoot(root: Record<string, any>, q: QueueEntry[], slice: Uint8Array, elements: Iterable<BSONElement>, totalOffset: number, f?: (el: QueueEntry) => any) {
  for (const [type, nameOffset, nameLength, offset, length] of elements) {
    if (f) f([totalOffset, type, nameOffset, nameLength, offset, length, root]);
    const name = onDemand.ByteUtils.toUTF8(slice, nameOffset, nameOffset + nameLength, false);

    const value = parseFromElement(slice, [type, nameOffset, nameLength, offset, length]);
    root[name] = value;
    if (type === 3) {
      q.push([
        totalOffset + offset,
        type,
        nameOffset,
        nameLength,
        offset,
        length, root[name]]);
    } else if (type === 4) {
      q.push([
        totalOffset + offset,
        type,
        nameOffset,
        nameLength,
        offset,
        length, root[name]]);
    } else if (type === 15) {
      const codeLength = onDemand.NumberUtils.getInt32LE(slice, offset + 4);
      q.push([
        // offset + int32(size of entire element) + int32(size of code string) + size of code string
        totalOffset + offset + 4 + 4 + codeLength, // FIXME: Correctly implement offset for scope for code w/scope
        type,
        nameOffset,
        nameLength,
        offset,
        length,
        root[name].scope]
      );
      console.log(root[name]);
    }
  }
}

function handleWithArrayRoot(root: any[], q: QueueEntry[], slice: Uint8Array, elements: Iterable<BSONElement>, totalOffset: number, f?: (el: QueueEntry) => any) {
  for (const el of elements) {
    if (f) f([totalOffset, ...el, root]);

    const value = parseFromElement(slice, el);
    const [type, nameOffset, nameLength, offset, length] = el;
    root.push(value);
    if (type === 3) {
      q.push([
        totalOffset + offset,
        type,
        nameOffset,
        nameLength,
        offset,
        length, root[root.length - 1]]);
    } else if (type === 4) {
      q.push([
        totalOffset + offset,
        type,
        nameOffset,
        nameLength,
        offset,
        length, root[root.length - 1]]);
    } else if (type === 15) {
      const codeLength = onDemand.NumberUtils.getInt32LE(slice, offset + 4);
      const docLength = onDemand.NumberUtils.getInt32LE(slice, offset + 4 + 4 + codeLength);
      q.push([
        // offset + int32(size of entire element) + int32(size of code string) + size of code string
        totalOffset + offset + docLength,
        type,
        nameOffset,
        nameLength,
        offset + 4 + 4 + 1 + codeLength,
        docLength,
        root[root.length - 1].scope]
      )
    }
  }
}

export function iterDeserialize(bsonDoc: Uint8Array, f?: (el: QueueEntry) => any) {
  const root: Record<string, any> = {};
  const q: Queue = [
    [0, 3, 0, 0, 0, onDemand.NumberUtils.getInt32LE(bsonDoc, 0), root] // Root document
  ];
  while (q.length > 0) {
    const [totalOffset, type, _, __, docOffset, docLength, root] = q.shift() ?? [0, 0, 0, 0, 0, 0, {} as Record<string, any>];
    // FIXME: not currently working for code w scope
    if (type === 3 || type === 4 || type === 15) { // if parsing subdocument or array or code with scope
      const slice = s.slice(totalOffset, totalOffset + docOffset + docLength);
      const elements = onDemand.parseToElements(slice);

      if (isDoc(root, type)) {
        handleWithDocRoot(root, q, slice, elements, totalOffset, f);
      } else if (isArray(root, type)) {
        handleWithArrayRoot(root, q, slice, elements, totalOffset, f);
      }
    } else {
      console.log('womp womp');
    }
  }
  return root;
}

iterDeserialize(s, () => { });

deepEqual(iterDeserialize(s, () => { }), deserialize(s, { promoteLongs: true, promoteValues: true, promoteBuffers: true, useBigInt64: true }))
