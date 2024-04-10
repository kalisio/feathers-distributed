#!/usr/bin/env bash
set -euo pipefail
# set -x

THIS_FILE=$(readlink -f "${BASH_SOURCE[0]}")
THIS_DIR=$(dirname "$THIS_FILE")
ROOT_DIR=$(dirname "$THIS_DIR")
WORKSPACE_DIR="$(dirname "$ROOT_DIR")"

. "$THIS_DIR/kash/kash.sh"

## Parse options
##

NODE_VER=16
MONGO_VER=""
CI_STEP_NAME="Run tests"
CODE_COVERAGE=false
while getopts "n:cr:" option; do
    case $option in
        n) # defines node version
            NODE_VER=$OPTARG
             ;;
        c) # publish code coverage
            CODE_COVERAGE=true
            ;;
        r) # report outcome to slack
            load_env_files "$WORKSPACE_DIR/development/common/SLACK_WEBHOOK_LIBS.enc.env"
            CI_STEP_NAME=$OPTARG
            trap 'slack_ci_report "$ROOT_DIR" "$CI_STEP_NAME" "$?" "$SLACK_WEBHOOK_LIBS"' EXIT
            ;;
        *)
            ;;
    esac
done

## Init workspace
##

. "$WORKSPACE_DIR/development/workspaces/libs/libs.sh" feathers-distributed

## Run tests
##

run_lib_tests "$ROOT_DIR" "$CODE_COVERAGE" "$NODE_VER" "$MONGO_VER"