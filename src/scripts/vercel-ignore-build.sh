#!/usr/bin/env bash
# Vercel "Ignored Build Step": exit 0 skips the build, exit 1 builds.
#
# The Hobby plan allows a limited number of deployments per day. Preview builds
# for backend-only or docs-only pushes used that quota up, and on 2026-11-06 the
# production build of main (f535d0a) was rejected with "Deployment rate limited",
# leaving maet-pi.vercel.app on an older commit. Production always builds; a
# preview builds only when an input of the frontend bundle changed.
#
# Wired through the Vercel project setting "Ignored Build Step"
# (commandForIgnoringBuildStep = "bash scripts/vercel-ignore-build.sh"), not a
# vercel.json: a vercel.json in the project root directory (src/) changed how
# Vercel packaged the SSR function and every page answered 500.
# Runs with the project root directory (src/) as cwd. Any git failure (for
# example a previous SHA missing from the shallow clone) falls through to a build.
set -u

if [ "${VERCEL_ENV:-}" = "production" ]; then
  echo "production deployment: building"
  exit 1
fi

base="${VERCEL_GIT_PREVIOUS_SHA:-}"
if [ -z "$base" ]; then
  echo "no previous deployment for this branch: building"
  exit 1
fi

git diff --quiet "$base" HEAD -- . ../shared ../package.json ../bun.lock ../tsconfig.json
status=$?
if [ "$status" -eq 0 ]; then
  echo "no frontend inputs changed since ${base:0:7}: skipping preview build"
  exit 0
fi
echo "frontend inputs changed (git diff exit $status): building"
exit 1
