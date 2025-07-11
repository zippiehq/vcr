#!/bin/sh
cd packages/sample-python
date
node ../cli/dist/cli.js prune
date
node ../cli/dist/cli.js up
date
node ../cli/dist/cli.js up --profile test
date
node ../cli/dist/cli.js up --profile prod
date
node ../cli/dist/cli.js down
date
node ../cli/dist/cli.js prune
date
