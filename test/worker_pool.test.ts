import { WorkerPool } from '../src/worker_pool/worker_pool';


(async function() {
  const workerPool = new WorkerPool(4, (nums: bigint[]) => {
    return nums.reduce((acc, x) => acc + x);
  });

  const numbers = Array.from({ length: 5_000_000 }, (_, i) => BigInt(i));

  const promises: Promise<any>[] = [];

  for (let i = 0; i < 4; i++) {
    const n = Math.floor(numbers.length / 4);
    promises.push(workerPool.runTaskAsync({ args: [numbers.slice(i * n, i * n + n)] }));
  }

  const values = await Promise.all(promises);
  console.log(values.reduce((acc, x) => acc + x));
  workerPool.close();
})();
