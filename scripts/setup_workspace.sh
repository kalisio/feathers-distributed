#!/usr/bin/env bash
set -euo pipefail
# set -x

THIS_FILE=$(readlink -f "${BASH_SOURCE[0]}")
THIS_DIR=$(dirname "$THIS_FILE")
ROOT_DIR=$(dirname "$THIS_DIR")

. "$THIS_DIR/kash/kash.sh"

WORKSPACE_BRANCH=
WORKSPACE_TAG=

begin_group "Setting up workspace ..."

if [ "$CI" = true ]; then
    WORKSPACE_DIR="$(dirname "$ROOT_DIR")"
    DEVELOPMENT_REPO_URL="https://$GITHUB_DEVELOPMENT_TOKEN@github.com/kalisio/development.git"
else
    while getopts "b:t" option; do
        case $option in
            b) # defines branch
                WORKSPACE_BRANCH=$OPTARG;;
            t) # defines venv tag
                WORKSPACE_TAG=$OPTARG;;
            *)
            ;;
        esac
    done

    shift $((OPTIND-1))
    WORKSPACE_DIR="$1"
    DEVELOPMENT_REPO_URL="$GITHUB_URL/kalisio/development.git"

    # Clone project in the workspace
    git_shallow_clone "$GITHUB_URL/kalisio/feathers-distributed.git" "$WORKSPACE_DIR/feathers-import-export" "${WORKSPACE_TAG:-${WORKSPACE_BRANCH:-}}"
fi

setup_lib_workspace "$WORKSPACE_DIR" "$DEVELOPMENT_REPO_URL" "https://github.com/kalisio/feathers-s3"

end_group "Setting up workspace ..."
