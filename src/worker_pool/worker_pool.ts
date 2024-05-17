import { AsyncResource } from 'node:async_hooks';
import { EventEmitter } from 'node:events';
import { promisify } from 'node:util';
import { Worker } from 'node:worker_threads';

const kTaskInfo = Symbol('kTaskInfo');
const kWorkerFreedEvent = Symbol('kWorkerFreedEvent');

type Callback<T> = (err?: Error, v?: T) => void;

class PoolMember<T> extends Worker {
  [kTaskInfo]?: WorkerPoolTaskInfo<T> | null;
}

class WorkerPoolTaskInfo<T> extends AsyncResource {
  callback: Callback<T>;
  constructor(callback: Callback<T>) {
    super('WorkerPoolTaskInfo');
    this.callback = callback;
  }

  done(err?: Error, result?: any) {
    this.runInAsyncScope(this.callback, null, err, result);
    this.emitDestroy();  // `TaskInfo`s are used only once.
  }
}

export class WorkerPool<T> extends EventEmitter {
  numThreads: number;
  workers: PoolMember<T>[];
  freeWorkers: PoolMember<T>[];
  tasks: { task: { args: any[] }, callback: Callback<T> }[];

  runTaskAsync: (task: { args: any[] }) => Promise<any>;

  constructor(numThreads: number, taskHandler: (...args: any[]) => T) {
    super();
    this.numThreads = numThreads;
    this.workers = [];
    this.freeWorkers = [];
    this.tasks = [];
    this.runTaskAsync = promisify(this.runTask);

    for (let i = 0; i < numThreads; i++)
      this.addNewWorker(taskHandler);

    // Any time the kWorkerFreedEvent is emitted, dispatch
    // the next task pending in the queue, if any.
    this.on(kWorkerFreedEvent, () => {
      if (this.tasks.length > 0) {
        const taskDef = this.tasks.shift();
        if (taskDef) {
          const { task, callback } = taskDef;
          this.runTask(task, callback);
        }
      }
    });
  }

  addNewWorker(taskHandler: (...args: any[]) => any) {
    const worker = new PoolMember('./worker.js', { workerData: taskHandler.toString() });
    worker.on('message', (result) => {
      // In case of success: Call the callback that was passed to `runTask`,
      // remove the `TaskInfo` associated with the Worker, and mark it as free
      // again.
      worker[kTaskInfo]?.done(undefined, result);
      worker[kTaskInfo] = null;
      this.freeWorkers.push(worker);
      this.emit(kWorkerFreedEvent);
    });
    worker.on('error', (err) => {
      // In case of an uncaught exception: Call the callback that was passed to
      // `runTask` with the error.
      if (worker[kTaskInfo])
        worker[kTaskInfo].done(err, null);
      else
        this.emit('error', err);
      // Remove the worker from the list and start a new Worker to replace the
      // current one.
      this.workers.splice(this.workers.indexOf(worker), 1);
      this.addNewWorker(taskHandler);
    });
    this.workers.push(worker);
    this.freeWorkers.push(worker);
    this.emit(kWorkerFreedEvent);
  }

  runTask(task: { args: any[] }, callback: (err?: Error, v?: T) => void) {
    const worker = this.freeWorkers.pop();
    if (worker) {
      worker[kTaskInfo] = new WorkerPoolTaskInfo(callback);
      worker.postMessage(task);
    } else {
      // No free threads, wait until a worker thread becomes free.
      this.tasks.push({ task, callback });
      return;
    }
  }

  close() {
    for (const worker of this.workers) worker.terminate();
  }
}
