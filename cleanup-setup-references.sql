-- Cleanup orphaned setup references
-- Run with: sqlite3 lastest2.db < cleanup-setup-references.sql

-- 1. Clear tests.setup_test_id where referenced test doesn't exist
UPDATE tests
SET setup_test_id = NULL
WHERE setup_test_id IS NOT NULL
  AND setup_test_id NOT IN (SELECT id FROM tests);

-- 2. Clear tests.setup_script_id where referenced script doesn't exist
UPDATE tests
SET setup_script_id = NULL
WHERE setup_script_id IS NOT NULL
  AND setup_script_id NOT IN (SELECT id FROM setup_scripts);

-- 3. Clear repositories.default_setup_test_id where referenced test doesn't exist
UPDATE repositories
SET default_setup_test_id = NULL
WHERE default_setup_test_id IS NOT NULL
  AND default_setup_test_id NOT IN (SELECT id FROM tests);

-- 4. Clear repositories.default_setup_script_id where referenced script doesn't exist
UPDATE repositories
SET default_setup_script_id = NULL
WHERE default_setup_script_id IS NOT NULL
  AND default_setup_script_id NOT IN (SELECT id FROM setup_scripts);

-- 5. Clear suites.setup_test_id where referenced test doesn't exist
UPDATE suites
SET setup_test_id = NULL
WHERE setup_test_id IS NOT NULL
  AND setup_test_id NOT IN (SELECT id FROM tests);

-- 6. Clear suites.setup_script_id where referenced script doesn't exist
UPDATE suites
SET setup_script_id = NULL
WHERE setup_script_id IS NOT NULL
  AND setup_script_id NOT IN (SELECT id FROM setup_scripts);

-- 7. Clear builds.build_setup_test_id where referenced test doesn't exist
UPDATE builds
SET build_setup_test_id = NULL
WHERE build_setup_test_id IS NOT NULL
  AND build_setup_test_id NOT IN (SELECT id FROM tests);

-- 8. Clear builds.build_setup_script_id where referenced script doesn't exist
UPDATE builds
SET build_setup_script_id = NULL
WHERE build_setup_script_id IS NOT NULL
  AND build_setup_script_id NOT IN (SELECT id FROM setup_scripts);

-- Show results
SELECT 'Cleanup Complete!' as status;
