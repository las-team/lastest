-- Drop the legacy repo-wide "default" key from repositories.branch_base_urls.
--
-- Background: base URLs are per-branch (branch_base_urls keyed by branch name).
-- A special "default" key used to be written at repo creation + onboarding as a
-- fallback, but the per-branch base-URL UI never updated it, so it went stale
-- and (via pickRepoBaseUrl) shadowed real branch URLs — sending the QuickStart
-- scout to the wrong site (e.g. an excalidraw repo whose stale default was
-- https://playwright.dev). The code no longer reads or writes "default"; this
-- migration removes it from existing data.
--
-- The URL it held is preserved: it is folded into the repo's default branch
-- (or "main" when default_branch is null/empty) ONLY if that branch has no URL
-- yet. An explicit branch URL always wins. Empty "default" values are dropped.
--
-- Idempotent: only rows that still carry a "default" key are touched.
-- Run on every environment (local + each prod DB) BEFORE/with the code deploy.

UPDATE repositories
SET branch_base_urls =
  (branch_base_urls - 'default')
  || CASE
       -- branch already has a URL, or "default" is empty → just drop the key
       WHEN branch_base_urls ? COALESCE(NULLIF(default_branch, ''), 'main')
         THEN '{}'::jsonb
       WHEN COALESCE(branch_base_urls ->> 'default', '') = ''
         THEN '{}'::jsonb
       -- otherwise preserve the URL under the default branch
       ELSE jsonb_build_object(
              COALESCE(NULLIF(default_branch, ''), 'main'),
              branch_base_urls ->> 'default'
            )
     END
WHERE branch_base_urls ? 'default';
