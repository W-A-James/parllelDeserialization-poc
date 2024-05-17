import { parentPort, workerData } from 'node:worker_threads';
let handler: (...args: any[]) => any;
if (parentPort) {
  handler = eval(workerData);

  parentPort.on('message', (task) => {
    parentPort?.postMessage(handler(...task.args));
  });
}
