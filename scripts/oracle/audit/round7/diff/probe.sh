#!/bin/bash
# usage: probe.sh tag seed...   (runs r6 probe, N=400, 4 at a time)
SP=/tmp/claude-9005/-home-matej-code-WebstormProjects-PlasmidPop/5650bcf6-b516-4dd6-b753-3c17ed1cdb04/scratchpad
D=$SP/audit/r7-diff
export PATH=/home/matej/Programs/miniconda3/envs/node/bin:$PATH
cd /home/matej/code/WebstormProjects/PlasmidPop
tag=$1; shift
run() { R6_SEED=$1 R6_N=${N:-400} R6_OUT=$D/$tag-$1.json npx vitest run ${PROBE:-src/__audit__/r6-diff/probe.test.ts} >$D/$tag-$1.log 2>&1; }
n=0
for s in "$@"; do run $s & n=$((n+1)); if [ $n -ge 8 ]; then wait; n=0; fi; done
wait
for s in "$@"; do echo -n "seed $s: "; python3 ${ORACLE:-$SP/oracle.py} $D/$tag-$s.json; done
