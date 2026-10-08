#!/bin/bash
# usage: MODE=mixed N=300 probe.sh tag seed...
D=/tmp/claude-9005/-home-matej-code-WebstormProjects-PlasmidPop/60f50a2e-ea61-436a-ab4c-ad0e9ce471ed/scratchpad/audit/diff
export PATH=/home/matej/Programs/miniconda3/envs/node/bin:$PATH
cd /home/matej/code/WebstormProjects/PlasmidPop
tag=$1; shift
run() { R8_MODE=${MODE:-mixed} R8_SEED=$1 R8_N=${N:-300} R8_OUT=$D/$tag-$1.json npx vitest run src/__audit__/r8-diff/probe.test.ts >$D/$tag-$1.log 2>&1 || tail -20 $D/$tag-$1.log; }
n=0
for s in "$@"; do run $s & n=$((n+1)); if [ $n -ge 6 ]; then wait; n=0; fi; done
wait
for s in "$@"; do echo -n "seed $s: "; /home/matej/Programs/miniconda3/envs/primer3/bin/python $D/oracle.py $D/$tag-$s.json; done
