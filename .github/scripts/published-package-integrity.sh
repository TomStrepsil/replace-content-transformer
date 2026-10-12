#!/usr/bin/env bash
# Prints the integrity hash of the npm package that <revision> would publish,
# ignoring its version. Every revision is packed with the npm version of the
# checkout this is run from, so revisions compare like for like. Revisions that
# predate prepublishOnly built via prepack, so whichever exists is run.
#
#   .github/scripts/published-package-integrity.sh <revision>
set -euo pipefail

export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
npm_version=$(npm --version)
npm() { corepack "npm@$npm_version" "$@"; }

source_directory=$(mktemp -d)
trap 'rm -rf "$source_directory"' EXIT

git archive "$1" | tar -x -C "$source_directory"
cd "$source_directory"

npm_flags=(--force --no-audit --no-fund --ignore-scripts)

npm ci "${npm_flags[@]}" >&2
npm run prepublishOnly --if-present --force >&2
npm run prepack --if-present --force >&2
npm pkg set version=0.0.0 --force

npm pack --dry-run --json "${npm_flags[@]}" | jq -r '.[].integrity'
