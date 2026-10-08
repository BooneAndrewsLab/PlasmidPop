#!/bin/bash
# usage: chk.sh '<json cases>'
D=/tmp/claude-9005/-home-matej-code-WebstormProjects-PlasmidPop/60f50a2e-ea61-436a-ab4c-ad0e9ce471ed/scratchpad/audit/diff
export PATH=/home/matej/Programs/miniconda3/envs/node/bin:$PATH
cd /home/matej/code/WebstormProjects/PlasmidPop
R8_CHK="$1" R8_OUT=$D/chk.txt npx vitest run src/__audit__/r8-diff/check.test.ts > $D/chk.log 2>&1 || tail -30 $D/chk.log; cat $D/chk.txt
