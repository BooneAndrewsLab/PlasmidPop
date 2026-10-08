#!/bin/bash
D=/tmp/claude-9005/-home-matej-code-WebstormProjects-PlasmidPop/5650bcf6-b516-4dd6-b753-3c17ed1cdb04/scratchpad/audit/r7-diff
export PATH=/home/matej/Programs/miniconda3/envs/node/bin:$PATH
cd /home/matej/code/WebstormProjects/PlasmidPop
R7_CHK="$1" R7_OUT=$D/chk.txt npx vitest run src/__audit__/r7-diff/check.test.ts > $D/chk.log 2>&1; tail -3 $D/chk.log; cat $D/chk.txt
