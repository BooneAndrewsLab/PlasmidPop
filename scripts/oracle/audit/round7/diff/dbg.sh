#!/bin/bash
D=/tmp/claude-9005/-home-matej-code-WebstormProjects-PlasmidPop/5650bcf6-b516-4dd6-b753-3c17ed1cdb04/scratchpad/audit/r7-diff
export PATH=/home/matej/Programs/miniconda3/envs/node/bin:$PATH
cd /home/matej/code/WebstormProjects/PlasmidPop
R7_DBG="$1" R7_DBG_OUT=$D/dbg.txt npx vitest run src/__audit__/r7-diff/debug.test.ts >/dev/null 2>&1; cat $D/dbg.txt
