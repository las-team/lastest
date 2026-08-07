# syntax=docker/dockerfile:1
#
# Reproducible, multi-stage build for the Embedded Browser service.
#
# Uses pnpm — the same package manager, version and lockfile the repo develops
# and tests with — so the image ships the exact dependency tree that was tested
# on the host. pnpm is provisioned by corepack from the root package.json's
# `packageManager` field (version + integrity hash), so the image can never
# silently drift onto a different pnpm.
#
#   builder  — installs from the committed pnpm-lock.yaml (devDeps included,
#              tsup is a devDep), compiles `dist`, then `pnpm deploy`s a
#              self-contained production tree. tsup's `noExternal` inlines
#              @lastest/shared and @lastest/eb-protocol into the bundle, so the
#              runtime never imports them even though deploy copies them in.
#   runtime  — copies that tree onto the Playwright base image and runs it as
#              the non-root pwuser. No package manager, no lockfile, no install
#              step, no build tooling.
#
# Reproducibility + supply-chain:
#   - `--frozen-lockfile` installs strictly from the committed pnpm-lock.yaml
#     and fails (never mutates it) if a manifest has drifted — same inputs →
#     same tree, and the same tree CI and the host tested.
#   - Dependency lifecycle scripts are blocked by default in pnpm 10: only the
#     packages allowlisted in pnpm-workspace.yaml's `onlyBuiltDependencies` may
#     run one, and none of them are EB runtime dependencies.
#   - The `overrides` in pnpm-workspace.yaml (the repo's security pins) apply
#     here exactly as they do on the host; npm silently ignored all of them.

# ---- stage 1: builder -------------------------------------------------------
FROM node:22-slim AS builder

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable pnpm

WORKDIR /build

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/embedded-browser/package.json packages/embedded-browser/
COPY packages/eb-protocol/package.json packages/eb-protocol/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/mcp-server/package.json packages/mcp-server/
COPY packages/pool-service/package.json packages/pool-service/

# Install EB plus its workspace deps — the trailing `...` selects
# @lastest/shared and @lastest/eb-protocol as projects too, which tsup needs to
# type-check and inline.
RUN pnpm install --frozen-lockfile --filter @lastest/embedded-browser...

# Sources for the packages tsup compiles and inlines.
COPY packages/embedded-browser/tsup.config.ts packages/embedded-browser/
COPY packages/embedded-browser/tsconfig.json packages/embedded-browser/
COPY packages/embedded-browser/src/ packages/embedded-browser/src/
COPY packages/shared/src/ packages/shared/src/
COPY packages/eb-protocol/src/ packages/eb-protocol/src/

RUN rm -rf packages/embedded-browser/dist \
 && pnpm --filter @lastest/embedded-browser build

# Assemble EB's PRODUCTION dependency closure into a self-contained /deploy
RUN pnpm --filter @lastest/embedded-browser --prod \
      --config.inject-workspace-packages=true deploy /deploy

# ---- stage 2: runtime ------------------------------------------------------
FROM mcr.microsoft.com/playwright:v1.57.0-noble

# System ffmpeg for video watermarking (the Playwright-bundled ffmpeg is a
# stripped build without drawtext/overlay filters and no VP9 encoder).
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app/packages/embedded-browser

COPY --from=builder --chown=pwuser:pwuser /deploy ./
COPY --from=builder --chown=pwuser:pwuser \
     /build/packages/embedded-browser/dist ./dist

# Run as the non-root image user (pwuser, uid 1001) shipped by the Playwright
# base image. Running as root forced Chromium into --no-sandbox mode, leaving
# both untrusted user code and untrusted web content un-sandboxed as root.
USER pwuser

# Executed test code writes artifacts to RELATIVE paths — the executor passes
# `screenshotPath` as a bare "screenshot.png" and the download helper returns
# bare filenames — so they land in the process CWD. The app tree above is
# root-owned on purpose (pwuser can read/execute it but must not be able to
# rewrite its own code), which makes it unusable as the CWD: writing there
# fails with EACCES mid-test. Give the runtime a scratch dir it owns instead.
WORKDIR /home/pwuser/work

# The image's own default ports, all derived from STREAM_PORT (9223) in
# src/index.ts:
#   9223 stream · 9224 health (P+1) · 9225 CDP (P+2, bound to 127.0.0.1 only)
#   9235 CDP proxy (P+12) — the 0.0.0.0 listener other pods connect to, since
#                           Chromium hard-binds CDP itself to localhost.
EXPOSE 9223 9224 9235

# Health check (wget ships on the Playwright base image).
HEALTHCHECK --interval=10s --timeout=5s --retries=3 \
  CMD wget -q --spider http://localhost:9224/health || exit 1

# Absolute — the CWD is the scratch dir, not the app tree.
CMD ["node", "/app/packages/embedded-browser/dist/index.js"]
