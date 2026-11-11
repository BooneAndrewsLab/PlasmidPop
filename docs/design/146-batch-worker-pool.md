# 146. A worker pool for batch runs (#423)

Packet 2 of the batch design (note 141) measured 96 region rows at about
205 ms each through the engine path, 19.6-21.9 s in all, over the 15 s
trigger the plan set for a pool. This note is the pool.

## What was built

- `src/workers/analysisPool.ts`: `AnalysisPool`, a few `AnalysisClient`s, each
  with its own worker, sized by `poolSize(navigator.hardwareConcurrency)`: the
  cores, at least 1, at most 4. `analysisClient` stays one worker. The editor's
  scans share its queue and a cancel replaces its worker, so a batch cancel
  must not run through it. The pool's workers start on a client's first
  request and `batchSession` releases them (terminates them) when no run is
  left. `useEnzymes` is applied to both `analysisClient` and the pool, so an
  imported enzyme set reaches the pool's workers too (`persistence.ts`).
- `src/app/batchLanes.ts`: `runInLanes`, the loop both batch runners now use.
  One **lane** is one client. A free lane takes the next row, so rows start in
  order; `onRow` is called in row order (a finished row waits for the ones
  before it); progress is the mean of the rows' own fractions, so it never
  goes down; a failing row is a failed row in `task` and the rest go on; a
  cancel (an aborted signal or an `AnalysisCancelledError`) stops new rows and
  the run keeps the rows done in order **before the first one cut short**: the
  result is always a prefix, as the serial run's was. With one lane it is the
  serial run.
- `runPrimerBatch` and `runCloningBatch` take `clients` (one per lane) beside
  `client`; `batchSession` passes `batchLanes()`.

## Decisions

- **One client per lane, no scheduler.** A row's lane is fixed while it runs,
  so no counter of in-flight requests can drift, and a cancelled row's worker
  is replaced by its own client's `restart()` without touching another lane's.
  A cancel does restart each lane that has a row in flight; rows queued behind
  them were never sent.
- **Without `Worker` (tests, old runtimes)** `batchLanes()` is `[analysisClient]`,
  which runs on the calling thread: a second queue would add nothing, and the
  Batch page tests that spy on `analysisClient` keep working.
- **Per-row request cost.** Each row posts its template's bases (a few kb) to
  the worker it lands on; the snapshot of a mutagenesis template is built once
  per template and shared by the lanes.
- Tests run a small slice through fake clients and assert order, progress,
  cancel and a failed row; none asserts a wall clock (perf-notes, note 141).
