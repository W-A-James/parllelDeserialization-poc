import { equal } from 'node:assert';


import { WorkerPool } from '../lib/worker_pool/worker_pool.js';

describe('WorkerPool', function() {
  it('accumulates results correctly', async () => {
    const workerPool = new WorkerPool(4, (start: bigint, end: bigint) => {
      let sum = 0n;
      for (let i = start; i < end; i++) {
        sum += i * i;
      }
      return sum;
    });

    const N = 5_000_000_000n;
    const promises: Promise<any>[] = [];

    for (let i = 0n; i < 4n; i++) {
      const n = N / 4n;
      promises.push(workerPool.runTaskAsync({ args: [i * n, i * n + n] }));
    }

    let serSum = 0n;
    for (let i = 0n; i < N; i++) {
      serSum += i;
    }

    const sum = (await Promise.all(promises)).reduce((acc, x) => acc + x);
    workerPool.close();

    equal(sum, serSum);
  })
});

