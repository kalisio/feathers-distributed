#!/usr/bin/env bash
set -euo pipefail
# set -x

THIS_FILE=$(readlink -f "${BASH_SOURCE[0]}")
THIS_DIR=$(dirname "$THIS_FILE")
ROOT_DIR=$(dirname "$THIS_DIR")

. "$THIS_DIR/kash/kash.sh"

## Parse options
##

WORKSPACE_BRANCH=
WORKSPACE_TAG=

begin_group "Setting up workspace ..."

if [ "$CI" = true ]; then
    WORKSPACE_DIR="$(dirname "$ROOT_DIR")"
    DEVELOPMENT_REPO_URL="https://$GITHUB_DEVELOPMENT_PAT@github.com/kalisio/development.git"
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

    # NOTE: cloning feathers-distributed could be avoided if we could parse app_version from tag/branch name instead
    # In this case, the kli would clone feathers-distributed
    GIT_OPS="--recurse-submodules"
    if [ -n "$WORKSPACE_TAG" ] || [ -n "$WORKSPACE_BRANCH" ]; then
        GIT_OPS="$GIT_OPS --branch ${WORKSPACE_TAG:-$WORKSPACE_BRANCH}"
    fi
    git clone --depth 1 $GIT_OPS "$GITHUB_URL/kalisio/feathers-distributed.git" "$WORKSPACE_DIR/feathers-distributed"

    DEVELOPMENT_REPO_URL="$GITHUB_URL/kalisio/development.git"

    # unset KALISIO_DEVELOPMENT_DIR because we want kli to clone everyhting in $WORKSPACE_DIR
    unset KALISIO_DEVELOPMENT_DIR
fi

# clone development in $WORKSPACE_DIR
DEVELOPMENT_DIR="$WORKSPACE_DIR/development"
git clone --depth 1 "$DEVELOPMENT_REPO_URL" "$DEVELOPMENT_DIR"

end_group "Setting up workspace ..."
