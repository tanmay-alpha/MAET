#!/usr/bin/env bash
# Vercel "Ignored Build Step": exit 0 skips the build, exit 1 builds.
#
# The Hobby plan allows a limited number of deployments per day, shared by
# production and previews. Preview builds used that quota up twice: on
# 2026-11-06 the production build of main (f535d0a) was rejected with
# "Deployment rate limited", leaving maet-pi.vercel.app on an older commit, and
# on 2026-11-19 PR previews were rejected again. Previews also have no backend
# (VITE_API_URL is set for Production only), and CI already builds the frontend
# and runs the Playwright suite against it on every pull request.
#
# So production always builds, and a preview builds only when its commit
# message contains "[preview]".
#
# Wired through the Vercel project setting "Ignored Build Step":
#   if [ -f scripts/vercel-ignore-build.sh ]; then bash scripts/vercel-ignore-build.sh; else exit 1; fi
# not a vercel.json: a vercel.json in the project root directory (src/) changed
# how Vercel packaged the SSR function and every page answered 500.
set -u

if [ "${VERCEL_ENV:-}" = "production" ]; then
  echo "production deployment: building"
  exit 1
fi

case "${VERCEL_GIT_COMMIT_MESSAGE:-}" in
  *"[preview]"*)
    echo "commit message requests a preview: building"
    exit 1
    ;;
esac

echo "preview builds are opt-in (add [preview] to the commit message): skipping"
exit 0
