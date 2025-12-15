#!/usr/bin/env bash
set -euo pipefail
# set -x

JOB_ID=$1

THIS_FILE=$(readlink -f "${BASH_SOURCE[0]}")
THIS_DIR=$(dirname "$THIS_FILE")

. "$THIS_DIR/kash/kash.sh"

### Github Actions

init_github_run_tests() {
    install_reqs age sops nvm node20 cc_test_reporter sonar_scanner_cli
}

init_github_additional_tests() {
    install_reqs age sops nvm node18 node22
}

begin_group "Init $CI_ID for $JOB_ID"

init_"${CI_ID}_${JOB_ID}"

end_group "Init $CI_ID for $JOB_ID"