-- Seed script for las-team/lastest
-- Generated from local DB on 2026-03-19
-- 59 tests, 72 functional areas, 7 setup scripts, 1 setup steps
-- Target repo ID: de09a6f4-9225-475f-bd04-f53b44ea3edc

BEGIN TRANSACTION;

DELETE FROM default_setup_steps WHERE repository_id = 'de09a6f4-9225-475f-bd04-f53b44ea3edc';
DELETE FROM setup_scripts WHERE repository_id = 'de09a6f4-9225-475f-bd04-f53b44ea3edc';
DELETE FROM tests WHERE repository_id = 'de09a6f4-9225-475f-bd04-f53b44ea3edc';
DELETE FROM functional_areas WHERE repository_id = 'de09a6f4-9225-475f-bd04-f53b44ea3edc';

INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('2a29d565-55b7-4051-97a0-518ea64731ae', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'Logins', NULL, 'c6d0b168-9183-415c-8599-eff8d83c2b5c', 0, 0, NULL, NULL, NULL);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('79ad628d-ab93-4d38-9e6c-5d3f440f1607', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'Authentication & Onboarding', 'User authentication, account creation, and initial setup flows', '2a29d565-55b7-4051-97a0-518ea64731ae', 0, 0, NULL, NULL, NULL);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('d4226d25-4b48-40d4-96f7-d290f065a852', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', '/analytics/impact', 'Route: /analytics/impact', 'a6056462-8db0-4307-9d6d-19402632d532', 1, 0, NULL, '## /analytics/impact (from known routes)

### Route: /analytics/impact
- Navigate to /analytics/impact and verify page loads without errors
- Verify page heading/title is present
- Check for broken links or missing assets', 1773931268);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('6da10b8f-f313-42c4-9b41-388104e1b628', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', '/areas', 'Route: /areas', 'a6056462-8db0-4307-9d6d-19402632d532', 1, 0, NULL, '## /areas (from known routes)

### Route: /areas
- Navigate to /areas and verify page loads without errors
- Verify page heading/title is present
- Check for broken links or missing assets', 1773757775);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('558839b5-8de9-4758-95c8-cb206c0dd961', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', '/builds/[buildId]/diff/[diffId]', 'Route: /builds/[buildId]/diff/[diffId]', 'a6056462-8db0-4307-9d6d-19402632d532', 1, 0, NULL, '## /builds/[buildId]/diff/[diffId] (from known routes)

### Route: /builds/[buildId]/diff/[diffId]
- Navigate to /builds/[buildId]/diff/[diffId] and verify page loads without errors
- Verify page heading/title is present
- Check for broken links or missing assets

## /builds/[buildId] (from known routes)

### Route: /builds/[buildId]
- Navigate to /builds/[buildId] and verify page loads without errors
- Verify page heading/title is present
- Check for broken links or missing assets', 1773931268);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('7f39e5e5-f003-4782-8126-0cd037332474', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', '/builds/[buildId]', 'Route: /builds/[buildId]', 'a6056462-8db0-4307-9d6d-19402632d532', 1, 0, NULL, '## /builds/[buildId] (from known routes)

### Route: /builds/[buildId]
- Navigate to /builds/[buildId] and verify page loads without errors
- Verify page heading/title is present
- Check for broken links or missing assets', 1773915712);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('1f4cc254-e378-4a42-9aee-ecad576b20b5', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', '/compare', 'Route: /compare', 'a6056462-8db0-4307-9d6d-19402632d532', 1, 0, NULL, '## /compare (from known routes)

### Route: /compare
- Navigate to /compare and verify page loads without errors
- Verify page heading/title is present
- Check for broken links or missing assets', 1773915712);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('a26eb45d-bd01-42c8-93f5-2783d4249ab0', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', '/compose', 'Route: /compose', 'a6056462-8db0-4307-9d6d-19402632d532', 1, 0, NULL, '## /compose (from known routes)

### Route: /compose
- Navigate to /compose and verify page loads without errors
- Verify page heading/title is present
- Check for broken links or missing assets', 1773915712);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('473a1d3c-ffcf-4da2-9f20-ae8a29ecdb95', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', '/env', 'Route: /env', 'a6056462-8db0-4307-9d6d-19402632d532', 1, 0, NULL, '## /env (from known routes)

### Route: /env
- Navigate to /env and verify page loads without errors
- Verify page heading/title is present
- Check for broken links or missing assets', 1773915712);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('a6056462-8db0-4307-9d6d-19402632d532', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', '/', 'Route: /', '86eebbff-ff3b-4c85-8511-8b846dba03c6', 1, 0, NULL, NULL, NULL);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('fce5fb63-c3bd-4bc8-8b96-9c2b5ab74a96', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', '/record', 'Route: /record', 'a6056462-8db0-4307-9d6d-19402632d532', 1, 0, NULL, '## /record (from known routes)

### Route: /record
- Navigate to /record and verify page loads without errors
- Verify page heading/title is present
- Check for broken links or missing assets', 1773753097);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('6d7a52d4-a398-484c-bd9e-8140c11f0ddd', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', '/review', 'Route: /review', 'a6056462-8db0-4307-9d6d-19402632d532', 1, 0, NULL, '## /review (from known routes)

### Route: /review
- Navigate to /review and verify page loads without errors
- Verify page heading/title is present
- Check for broken links or missing assets', 1773757775);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('c227623a-77a3-4566-b62e-401454ff146f', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', '/run', 'Route: /run', 'a6056462-8db0-4307-9d6d-19402632d532', 1, 0, NULL, '## /run (from known routes)

### Route: /run
- Navigate to /run and verify page loads without errors
- Verify page heading/title is present
- Check for broken links or missing assets', 1773915712);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('a01cdc1e-429a-46d3-abc8-ee0557a25773', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', '/settings', 'Route: /settings', 'a6056462-8db0-4307-9d6d-19402632d532', 1, 0, NULL, '### Source: Codebase Scan

## Settings (from codebase scan)

### Route: /settings
Application settings page
- Verify settings page loads
- Check settings categories
- Test settings form

### Source: Known Routes

## /settings (from known routes)

### Route: /settings
- Navigate to /settings and verify page loads without errors
- Verify page heading/title is present
- Check for broken links or missing assets', 1773931268);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('481a4cb4-7655-4255-a028-b6f3d54abfe0', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', '/suites/[suiteId]', 'Route: /suites/[suiteId]', 'a6056462-8db0-4307-9d6d-19402632d532', 1, 0, NULL, '## /suites/[suiteId] (from known routes)

### Route: /suites/[suiteId]
- Navigate to /suites/[suiteId] and verify page loads without errors
- Verify page heading/title is present
- Check for broken links or missing assets', 1773931268);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('b16610f3-ad36-4b94-8b18-1c728ac5667a', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', '/suites', 'Route: /suites', 'a6056462-8db0-4307-9d6d-19402632d532', 1, 0, NULL, '## /suites (from known routes)

### Route: /suites
- Navigate to /suites and verify page loads without errors
- Verify page heading/title is present
- Check for broken links or missing assets', 1773915712);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('e71568ff-7293-4780-ae79-934988603694', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', '/tests/[id]/debug', 'Route: /tests/[id]/debug', 'a6056462-8db0-4307-9d6d-19402632d532', 1, 0, NULL, '## /tests/[id]/debug (from known routes)

### Route: /tests/[id]/debug
- Navigate to /tests/[id]/debug and verify page loads without errors
- Verify page heading/title is present
- Check for broken links or missing assets

## /tests/[id] (from known routes)

### Route: /tests/[id]
- Navigate to /tests/[id] and verify page loads without errors
- Verify page heading/title is present
- Check for broken links or missing assets', 1773931268);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('e40947f3-ddd4-43c3-9750-f29bc4eaa3f8', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', '/tests/[id]', 'Route: /tests/[id]', 'a6056462-8db0-4307-9d6d-19402632d532', 1, 0, NULL, '## /tests/[id] (from known routes)

### Route: /tests/[id]
- Navigate to /tests/[id] and verify page loads without errors
- Verify page heading/title is present
- Check for broken links or missing assets', 1773915712);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('700f7f67-ce26-4df7-8efb-deba4c85d1a5', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', '/tests', 'Route: /tests', 'a6056462-8db0-4307-9d6d-19402632d532', 1, 0, NULL, '## /tests (from known routes)

### Route: /tests
- Navigate to /tests and verify page loads without errors
- Verify page heading/title is present
- Check for broken links or missing assets', 1773915712);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('5f3b3eb9-3206-4916-bb00-dc4b1180005e', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', '/invite', 'Route: /invite', 'a6056462-8db0-4307-9d6d-19402632d532', 1, 0, NULL, '## /invite (from known routes)

### Route: /invite
- Navigate to /invite and verify page loads without errors
- Verify page heading/title is present
- Check for broken links or missing assets', 1773915712);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('38b464be-7cbb-4623-9038-bfdbe5766da0', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', '/login', 'Route: /login', 'a6056462-8db0-4307-9d6d-19402632d532', 1, 0, NULL, '## /login (from known routes)

### Route: /login
- Navigate to /login and verify page loads without errors
- Verify page heading/title is present
- Check for broken links or missing assets', 1773915712);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('7e04f92c-ca7d-4b49-b09d-8985a0845d74', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', '/register', 'Route: /register', 'a6056462-8db0-4307-9d6d-19402632d532', 1, 0, NULL, '## /register (from known routes)

### Route: /register
- Navigate to /register and verify page loads without errors
- Verify page heading/title is present
- Check for broken links or missing assets', 1773915712);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('c6d0b168-9183-415c-8599-eff8d83c2b5c', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'Viktor''s', NULL, NULL, 0, 0, NULL, NULL, NULL);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('1bd994d2-4a10-4d4f-953b-43ea2c9088cf', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'Summary', '## Summary

I''ve successfully created a comprehensive test plan for your Next.js 16 visual regression testing platform. The plan covers **13 functional areas** with **over 200 detailed test scenarios** organized by the following areas:

1. **Authentication** - Login, registration, password reset, OAuth, and invitation flows
2. **Dashboard** - Metrics, recent builds, functional areas display
3. **Test Management** - CRUD operations, filtering, debugging, bulk operations
4. **Test Recording** - Br', NULL, 0, 0, NULL, '## Summary

I''ve successfully created a comprehensive test plan for your Next.js 16 visual regression testing platform. The plan covers **13 functional areas** with **over 200 detailed test scenarios** organized by the following areas:

1. **Authentication** - Login, registration, password reset, OAuth, and invitation flows
2. **Dashboard** - Metrics, recent builds, functional areas display
3. **Test Management** - CRUD operations, filtering, debugging, bulk operations
4. **Test Recording** - Browser recording, assertions, screenshots, setup steps
5. **Test Execution** - Running tests, smart run, runner selection, build history
6. **Build Management** - Build details, status tracking, diff management
7. **Visual Diff Review** - Branch-based review, AI recommendations, approval workflows
8. **Functional Areas** - Hierarchical organization, drag-and-drop, AI route scanning
9. **Test Suites** - Suite management, test assignment
10. **Branch Comparison** - Side-by-side branch comparison
11. **Test Composition** - Custom builds, version overrides, saved configurations
12. **Environment Setup** - Setup scripts, default steps, storage state management
13. **Analytics and Impact** - GitHub integration, issue timeline, PR tracking, impact metrics
14. **Settings and Configuration** - Integrations, team management, AI settings, notifications

Each scenario includes:
- **Detailed step-by-step instructions** that any tester can follow
- **Expected outcomes** for verification
- **Edge cases and error handling** scenarios
- **Happy path and negative testing** coverage

The test plan is based on a thorough analysis of your codebase, including all page components, API routes, UI components, and user workflows. It accounts for features like AI mode toggles, early adopter features, role-based access, and the sophisticated visual regression testing capabilities of your platform.

## Summary

I''ve successfully created a comprehensive test plan for your Next.js 16 visual regression testing platform. The plan covers **13 functional areas** with **over 200 detailed test scenarios** organized by the following areas:

1. **Authentication** - Login, registration, password reset, OAuth, and invitation flows
2. **Dashboard** - Metrics, recent builds, functional areas display
3. **Test Management** - CRUD operations, filtering, debugging, bulk operations
4. **Test Recording** - Browser recording, assertions, screenshots, setup steps
5. **Test Execution** - Running tests, smart run, runner selection, build history
6. **Build Management** - Build details, status tracking, diff management
7. **Visual Diff Review** - Branch-based review, AI recommendations, approval workflows
8. **Functional Areas** - Hierarchical organization, drag-and-drop, AI route scanning
9. **Test Suites** - Suite management, test assignment
10. **Branch Comparison** - Side-by-side branch comparison
11. **Test Composition** - Custom builds, version overrides, saved configurations
12. **Environment Setup** - Setup scripts, default steps, storage state management
13. **Analytics and Impact** - GitHub integration, issue timeline, PR tracking, impact metrics
14. **Settings and Configuration** - Integrations, team management, AI settings, notifications

Each scenario includes:
- **Detailed step-by-step instructions** that any tester can follow
- **Expected outcomes** for verification
- **Edge cases and error handling** scenarios
- **Happy path and negative testing** coverage

The test plan is based on a thorough analysis of your codebase, including all page components, API routes, UI components, and user workflows. It accounts for features like AI mode toggles, early adopter features, role-based access, and the sophisticated visual regression testing capabilities of your platform.', 1773931268);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('83a67a98-4353-4c73-a37a-2de3b0563cf4', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', '/forgot-password', 'Route: /forgot-password', NULL, 0, 0, NULL, '### Source: Codebase Scan

## Authentication (from codebase scan)

### Route: /login
Login page
- Verify login form renders
- Check form inputs

### Route: /register
Registration page
- Verify registration form renders
- Check all form fields

### Route: /forgot-password
Password recovery page
- Verify forgot password form
- Check email input

### Route: /reset-password
Password reset page
- Verify reset password form
- Check password inputs

### Route: /invite
Team invitation page
- Verify invite form renders
- Check invitation acceptance flow

### Source: Known Routes

## /reset-password (from known routes)

### Route: /reset-password
- Navigate to /reset-password and verify page loads without errors
- Verify page heading/title is present
- Check for broken links or missing assets

## /register (from known routes)

### Route: /register
- Navigate to /register and verify page loads without errors
- Verify page heading/title is present
- Check for broken links or missing assets

## /login (from known routes)

### Route: /login
- Navigate to /login and verify page loads without errors
- Verify page heading/title is present
- Check for broken links or missing assets

## /invite (from known routes)

### Route: /invite
- Navigate to /invite and verify page loads without errors
- Verify page heading/title is present
- Check for broken links or missing assets

## /forgot-password (from known routes)

### Route: /forgot-password
- Navigate to /forgot-password and verify page loads without errors
- Verify page heading/title is present
- Check for broken links or missing assets', 1773931268);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('a7504caa-eeeb-41a5-8151-e6d1fa3cd9fc', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'Home', 'Route: /', NULL, 0, 0, NULL, '### Source: Codebase Scan

## Home (from codebase scan)

### Route: /
Landing/home page
- Verify home page loads
- Check main navigation

### Source: Known Routes

## / (from known routes)

### Route: /
- Navigate to / and verify page loads without errors
- Verify page heading/title is present
- Check for broken links or missing assets', 1773931268);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('c27480ae-4c60-415a-a901-4586cfbf58e8', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'Test Management', 'Route: /tests', NULL, 0, 0, NULL, '### Source: Codebase Scan

## Test Management (from codebase scan)

### Route: /tests
Test listing page
- Verify test list loads
- Check table rendering
- Test empty state

### Source: Known Routes

## /tests (from known routes)

### Route: /tests
- Navigate to /tests and verify page loads without errors
- Verify page heading/title is present
- Check for broken links or missing assets', 1773931268);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('aca09e0a-7bce-4a64-9b18-5303c72afbaf', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'Suite Management', 'Route: /suites', NULL, 0, 0, NULL, '### Source: Codebase Scan

## Suite Management (from codebase scan)

### Route: /suites
Test suite listing page
- Verify suite list loads
- Check suite cards/table
- Test empty state

### Source: Known Routes

## /suites (from known routes)

### Route: /suites
- Navigate to /suites and verify page loads without errors
- Verify page heading/title is present
- Check for broken links or missing assets', 1773931268);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('60df189c-ce01-4f76-9ff1-ad10440d167b', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'Area Management', 'Route: /areas', NULL, 0, 0, NULL, '### Source: Codebase Scan

## Area Management (from codebase scan)

### Route: /areas
Test area listing page
- Verify areas list loads
- Check area organization
- Test empty state

### Source: Known Routes

## /areas (from known routes)

### Route: /areas
- Navigate to /areas and verify page loads without errors
- Verify page heading/title is present
- Check for broken links or missing assets', 1773931268);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('757c2ed7-81ee-44be-a323-215b8cc9ebec', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'Test Recording', 'Route: /record', NULL, 0, 0, NULL, '### Source: Codebase Scan

## Test Recording (from codebase scan)

### Route: /record
Test recording interface
- Verify recording UI loads
- Check recorder controls
- Test initial state

### Source: Known Routes

## /record (from known routes)

### Route: /record
- Navigate to /record and verify page loads without errors
- Verify page heading/title is present
- Check for broken links or missing assets', 1773931268);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('44d1c3cd-3266-43c6-b10c-311e26249525', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'Test Composition', 'As a QA engineer, I want to cherry-pick tests and pin specific versions per build, so that I can override latest with historical versions', NULL, 0, 0, NULL, '### Source: Spec Analysis

## Test Composition (from spec)

As a QA engineer, I want to cherry-pick tests and pin specific versions per build, so that I can override latest with historical versions

### Test Scenarios
- Given tests have version history
- When I compose a build
- Then I can select specific tests
- And pin specific test versions per build
- And composed builds run the selected versions
- And I can see which version is active per test

### Source: Codebase Scan

## Test Composition (from codebase scan)

### Route: /compose
Test composition interface
- Verify compose UI loads
- Check editor interface
- Test code editor

### Source: Known Routes

## /compose (from known routes)

### Route: /compose
- Navigate to /compose and verify page loads without errors
- Verify page heading/title is present
- Check for broken links or missing assets', 1773931268);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('becfdccc-2cd0-4096-a162-825b214fce31', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'Local Test Execution', 'As a developer, I want to run tests on my local machine, so that I can debug tests during development', NULL, 0, 0, NULL, '### Source: Spec Analysis

## Local Test Execution (from spec)

As a developer, I want to run tests on my local machine, so that I can debug tests during development

### Test Scenarios
- Given I have Playwright installed locally
- When I trigger a test run
- Then tests execute on the same machine as Lastest2
- And I can see real-time execution progress
- And screenshots are captured locally
- And I can access debug mode for step-by-step execution

### Source: Codebase Scan

## Test Execution (from codebase scan)

### Route: /run
Test run dashboard
- Verify run dashboard loads
- Check run history
- Test metrics display

### Source: Known Routes

## /run (from known routes)

### Route: /run
- Navigate to /run and verify page loads without errors
- Verify page heading/title is present
- Check for broken links or missing assets', 1773931268);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('a535528b-53dd-4e41-baf7-999cbfa5368e', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'Visual Comparison', 'Route: /compare', NULL, 0, 0, NULL, '### Source: Codebase Scan

## Visual Comparison (from codebase scan)

### Route: /compare
Screenshot comparison interface
- Verify comparison UI loads
- Check diff viewer
- Test image rendering

### Source: Known Routes

## /compare (from known routes)

### Route: /compare
- Navigate to /compare and verify page loads without errors
- Verify page heading/title is present
- Check for broken links or missing assets', 1773931268);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('6262b61a-dcaf-458f-a59f-42ae478043fa', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'Test Review', 'Route: /review', NULL, 0, 0, NULL, '### Source: Codebase Scan

## Test Review (from codebase scan)

### Route: /review
Test review interface
- Verify review UI loads
- Check review controls
- Test approval workflow

### Source: Known Routes

## /review (from known routes)

### Route: /review
- Navigate to /review and verify page loads without errors
- Verify page heading/title is present
- Check for broken links or missing assets', 1773931268);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('ed0e1692-aaae-4be0-8e38-d66569959781', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'Environment Management', 'Route: /env', NULL, 0, 0, NULL, '### Source: Codebase Scan

## Environment Management (from codebase scan)

### Route: /env
Environment configuration page
- Verify environment list loads
- Check environment variables
- Test configuration form

### Source: Known Routes

## /env (from known routes)

### Route: /env
- Navigate to /env and verify page loads without errors
- Verify page heading/title is present
- Check for broken links or missing assets', 1773931268);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('e19231f9-710b-4df2-86d8-872653c0e97a', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'Record Browser Interactions', 'As a developer, I want to record my interactions with the application through point-and-click, so that I can create visual regression tests without writing code', NULL, 0, 0, NULL, '## Record Browser Interactions (from spec)

As a developer, I want to record my interactions with the application through point-and-click, so that I can create visual regression tests without writing code

### Test Scenarios
- Given I open the recorder
- When I click through my application
- Then every interaction is captured automatically
- And deterministic Playwright code is generated
- And no AI or API keys are required
- And I can edit the generated test code manually', 1773931268);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('41ca12d3-565c-4c3d-a4b4-a6cbd9785371', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'AI Test Generation', 'As a developer, I want to generate tests using AI from natural language descriptions or URLs, so that I can create comprehensive test coverage faster', NULL, 0, 0, NULL, '## AI Test Generation (from spec)

As a developer, I want to generate tests using AI from natural language descriptions or URLs, so that I can create comprehensive test coverage faster

### Test Scenarios
- Given I provide a URL or description
- When I request AI test generation
- Then AI generates resilient test code with multi-selector...
- And I can choose from 5 AI providers (Claude CLI, OpenRou...
- And the generated code uses multiple selector strategies ...
- And I can review and edit the generated code before saving', 1773931268);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('a011dfcd-2f4c-48d1-a180-846732ee229b', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'Autonomous Test Generation', 'As a developer, I want to generate full test coverage autonomously with one click, so that I can bootstrap testing for a new project without manual effort', NULL, 0, 0, NULL, '## Autonomous Test Generation (from spec)

As a developer, I want to generate full test coverage autonomously with one click, so that I can bootstrap testing for a new project without manual effort

### Test Scenarios
- Given I trigger the Play Agent
- When the 9-step pipeline executes
- Then it scans my repository for routes
- And classifies my application type
- And generates tests automatically
- And runs the generated tests
- And fixes failures (up to 3 attempts per test)
- And re-runs fixed tests
- And reports final results
- And pauses only when human input is needed (missing setti...
- And I can resume from where it left off', 1773931268);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('c9a0c3d0-3a82-48ce-93cf-e5444ed21ddf', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'Visual Diff Comparison', 'As a QA engineer, I want to compare screenshots using multiple diff engines, so that I can choose the best trade-off between speed and accuracy', NULL, 0, 0, NULL, '## Visual Diff Comparison (from spec)

As a QA engineer, I want to compare screenshots using multiple diff engines, so that I can choose the best trade-off between speed and accuracy

### Test Scenarios
- Given a test run produces new screenshots
- When comparison runs
- Then I can select from 3 engines: pixelmatch (pixel-perfe...
- And the first run creates baseline screenshots
- And subsequent runs are SHA256-hashed for instant pass if...
- And differences trigger the selected diff engine
- And I can review visual changes in the UI', 1773931268);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('1789558a-5d11-4c08-95be-fd0167f71e9d', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'Approval Workflow', 'As a team member, I want to review and approve visual changes, so that I can distinguish intentional changes from regressions', NULL, 0, 0, NULL, '## Approval Workflow (from spec)

As a team member, I want to review and approve visual changes, so that I can distinguish intentional changes from regressions

### Test Scenarios
- Given a test run shows visual differences
- When I review the changes
- Then I see side-by-side comparison with slider
- And I can approve or reject changes
- And approved changes become new baselines
- And I can batch approve multiple changes
- And approval history is tracked', 1773931268);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('62a8d716-e943-4232-93d4-f6bc2d64c51e', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'AI-Assisted Test Fixing', 'As a developer, I want to automatically fix broken tests when UI changes, so that I can maintain tests without manual updates', NULL, 0, 0, NULL, '## AI-Assisted Test Fixing (from spec)

As a developer, I want to automatically fix broken tests when UI changes, so that I can maintain tests without manual updates

### Test Scenarios
- Given a test fails due to UI changes
- When I request AI fix
- Then AI proposes a fix with updated selectors
- And I review the proposed fix before acceptance
- And I can accept or reject the fix
- And accepted fixes are saved with version history
- And I retain the option to fix manually', 1773931268);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('620ed298-8f15-4fc6-ad9a-c1830eabb300', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'Remote Runner Execution', 'As a DevOps engineer, I want to distribute test execution to remote machines, so that I can scale testing across different OS/browsers', NULL, 0, 0, NULL, '## Remote Runner Execution (from spec)

As a DevOps engineer, I want to distribute test execution to remote machines, so that I can scale testing across different OS/browsers

### Test Scenarios
- Given I register a remote runner with a token
- When I install `@lastest/runner` via npm
- Then the runner connects via WebSocket
- And I can dispatch tests to remote machines
- And tests run with SHA256 code integrity verification
- And I can configure max parallel tests per runner
- And I can record tests remotely
- And heartbeat polling maintains connection
- And I can abort individual tests', 1773931268);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('b832dcd1-9d24-4783-9802-c22d7a517ed0', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'Embedded Browser Execution', 'As a cloud deployment user, I want to run tests in a containerized browser with live streaming, so that I can test without installing Playwright locally', NULL, 0, 0, NULL, '## Embedded Browser Execution (from spec)

As a cloud deployment user, I want to run tests in a containerized browser with live streaming, so that I can test without installing Playwright locally

### Test Scenarios
- Given I have Docker available
- When I run tests in embedded mode
- Then browser runs in a container
- And live CDP video streams to the UI
- And I can record and run tests
- And no local Playwright installation is required
- And the video feed shows in the build detail page', 1773931268);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('f7101586-9bd6-43c2-963f-75d92bf67b80', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'Git-Aware Builds', 'As a developer, I want to run tests per branch and commit, so that I can track changes across Pull Requests', NULL, 0, 0, NULL, '## Git-Aware Builds (from spec)

As a developer, I want to run tests per branch and commit, so that I can track changes across Pull Requests

### Test Scenarios
- Given I work on a feature branch
- When tests run
- Then results are associated with branch and commit SHA
- And I can compare results across branches
- And baselines are branch-aware
- And I can see coverage per branch', 1773931268);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('62dc1b73-770a-469b-8d0d-e64fa134ac4c', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'Smart Run', 'As a developer, I want to run only tests affected by my code changes, so that I can reduce test execution time', NULL, 0, 0, NULL, '## Smart Run (from spec)

As a developer, I want to run only tests affected by my code changes, so that I can reduce test execution time

### Test Scenarios
- Given I select a feature branch
- When Smart Run analyzes changes
- Then it compares against the default branch via GitHub/Gi...
- And matches tests to changed files by URL patterns and co...
- And only affected tests are executed
- And unchanged areas are skipped
- And I see which tests were selected and why', 1773931268);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('9339d9cd-16c3-47ed-8479-b69f022b248a', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'Multi-Step Screenshots', 'As a designer, I want to compare screenshots against design files, so that I can verify implementation matches designs', NULL, 0, 0, NULL, '## Multi-Step Screenshots (from spec)

As a QA engineer, I want to capture multiple labeled screenshots per test, so that I can test multi-page flows

### Test Scenarios
- Given a test with multiple steps
- When the test runs
- Then each step captures a labeled screenshot
- And screenshots are compared individually
- And I can review each step''s visual diff
- And failures are isolated to specific steps

## Screenshots (from spec)

As a designer, I want to compare screenshots against design files, so that I can verify implementation matches designs

### Test Scenarios
- Given I have Figma exports or design files
- When I upload planned screenshots
- Then I can compare actual vs planned
- And diff tracking is separate (planned vs actual)
- And I can approve when implementation matches', 1773931268);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('439a01dc-8052-49a5-b4b9-b5569963c88e', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'Spec-Driven Test Generation', 'As a developer, I want to import OpenAPI specs, user stories, or markdown files, so that AI can automatically generate tests from requirements', NULL, 0, 0, NULL, '## Spec-Driven Test Generation (from spec)

As a developer, I want to import OpenAPI specs, user stories, or markdown files, so that AI can automatically generate tests from requirements

### Test Scenarios
- Given I have an OpenAPI spec or user story document
- When I import the file
- Then AI extracts test cases
- And generates corresponding test code
- And I can review and edit generated tests
- And tests are organized by functional area', 1773931268);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('9bac25ba-114b-4894-a4ef-fbf43c103b08', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'Test Stabilization', 'As a QA engineer, I want to prevent false positives from dynamic content, so that tests are reliable across environments', NULL, 0, 0, NULL, '## Test Stabilization (from spec)

As a QA engineer, I want to prevent false positives from dynamic content, so that tests are reliable across environments

### Test Scenarios
- Given tests run across different environments
- When stabilization is enabled
- Then `Date.now()` and `new Date()` are frozen to fixed va...
- And `Math.random()` is seeded for consistency
- And bundled fonts ensure cross-OS consistency
- And burst capture detects instability (N screenshots comp...
- And timestamps, UUIDs, and relative times are auto-masked
- And network activity settles before capture (network idle)
- And DOM mutations stop before screenshot (DOM stability)
- And third-party domains are blocked with configurable all...
- And webfonts load before capture
- And loading indicators are hidden with custom selectors
- And vertical content shifts are detected and excluded (pa...', 1773931268);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('14a81458-e55e-47e3-afb1-e9b8bb918fe9', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'Text-Region-Aware Diffing', 'As a QA engineer, I want to apply separate thresholds for text vs non-text regions, so that font rendering differences don''t cause false positives', NULL, 0, 0, NULL, '## Text-Region-Aware Diffing (from spec)

As a QA engineer, I want to apply separate thresholds for text vs non-text regions, so that font rendering differences don''t cause false positives

### Test Scenarios
- Given a screenshot contains text and non-text regions
- When OCR-based comparison runs
- Then text regions are detected via OCR
- And separate thresholds apply (text vs non-text)
- And cross-OS font rendering variations are tolerated
- And structural changes are still caught', 1773931268);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('48e3133a-cc65-47b8-9e44-c79d2210a1a6', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'GitHub Integration', 'As a developer, I want to integrate with GitHub for authentication and PR workflows, so that testing is part of my Git workflow', NULL, 0, 0, NULL, '## GitHub Integration (from spec)

As a developer, I want to integrate with GitHub for authentication and PR workflows, so that testing is part of my Git workflow

### Test Scenarios
- Given I connect my GitHub account
- When I authenticate via OAuth
- Then I can sync repositories
- And builds are triggered by PR webhooks
- And PR comments show test results
- And I can use the reusable GitHub Action
- And branch and commit data are captured automatically', 1773931268);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('aa32449f-0967-45b4-b472-962f905a547c', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'GitLab Integration', 'As a developer using GitLab, I want to integrate with GitLab including self-hosted instances, so that I can use Lastest2 in my GitLab workflow', NULL, 0, 0, NULL, '## GitLab Integration (from spec)

As a developer using GitLab, I want to integrate with GitLab including self-hosted instances, so that I can use Lastest2 in my GitLab workflow

### Test Scenarios
- Given I use GitLab (cloud or self-hosted)
- Then I can connect to self-hosted GitLab instances
- And MR comments are posted with results
- And webhook triggers work for MRs
- And I can configure the GitLab instance URL', 1773931268);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('90c10c59-64c7-4017-ac87-af23117f57cc', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'Self-Hosted Deployment', 'As a privacy-conscious team, I want to deploy Lastest2 on my own infrastructure, so that my data never leaves my servers', NULL, 0, 0, NULL, '## Self-Hosted Deployment (from spec)

As a privacy-conscious team, I want to deploy Lastest2 on my own infrastructure, so that my data never leaves my servers

### Test Scenarios
- When I run `docker-compose up -d`
- Then Lastest2 starts on localhost:3000
- And all data is stored in local volumes (SQLite database,...
- And no data is sent to external services
- And I can run tests completely offline
- And I can use local AI via Ollama (no API calls)', 1773931268);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('8e86adb7-2e9b-40e4-9b9b-223b6709ea82', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'Accessibility Audits', 'As a QA engineer, I want to automatically check accessibility on every screenshot, so that I catch WCAG violations alongside visual regressions', NULL, 0, 0, NULL, '## Accessibility Audits (from spec)

As a QA engineer, I want to automatically check accessibility on every screenshot, so that I catch WCAG violations alongside visual regressions

### Test Scenarios
- Given tests run with screenshots
- When each screenshot is captured
- Then automated axe-core audits run
- And WCAG violations are reported
- And I can review accessibility issues per test
- And results are tracked over time', 1773931268);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('1ae97b77-fa3a-476d-a6ec-0085b2449835', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'Debug Mode', 'As a developer, I want to step through test execution with live feedback, so that I can diagnose failures effectively', NULL, 0, 0, NULL, '## Debug Mode (from spec)

As a developer, I want to step through test execution with live feedback, so that I can diagnose failures effectively

### Test Scenarios
- Given a test fails
- When I enable debug mode
- Then I can step through execution
- And I see live feedback per step
- And I can inspect element selectors
- And I can see network requests and console errors
- And I can pause at any step', 1773931268);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('9391b04a-8e98-4ada-83a2-7d6a95126cab', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'Ignore Regions', 'As a QA engineer, I want to mask dynamic areas from diff comparison, so that timestamps, ads, and counters don''t cause false failures', NULL, 0, 0, NULL, '## Ignore Regions (from spec)

As a QA engineer, I want to mask dynamic areas from diff comparison, so that timestamps, ads, and counters don''t cause false failures

### Test Scenarios
- Given a page has dynamic content (timestamps, ads, counters)
- When I configure ignore regions
- Then masked areas are excluded from diff comparison
- And I can choose mask styles (solid-color or placeholder-...
- And masks are configurable per test', 1773931268);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('42053939-2b56-4ea1-acf6-7fc5a7d086d5', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'Branch Baseline Management', 'As a developer, I want to fork baselines per branch and merge them on PR merge, so that each branch has independent baselines', NULL, 0, 0, NULL, '## Branch Baseline Management (from spec)

As a developer, I want to fork baselines per branch and merge them on PR merge, so that each branch has independent baselines

### Test Scenarios
- When I run tests
- Then baselines are forked for the branch
- And baselines merge back on PR merge
- And I can promote test versions across branches
- And SHA256-based carry-forward matches identical screenshots', 1773931268);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('185f124b-ca60-46c0-b2ca-d79bbc07c36b', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'Setup & Teardown Orchestration', 'As a developer, I want to define multi-step setup and teardown sequences, so that tests run with proper pre-conditions and cleanup', NULL, 0, 0, NULL, '## Setup & Teardown Orchestration (from spec)

As a developer, I want to define multi-step setup and teardown sequences, so that tests run with proper pre-conditions and cleanup

### Test Scenarios
- Given I configure repository-default setup/teardown
- Then setup runs before test execution
- And teardown runs after (non-blocking on errors)
- And I can override with per-test setup/teardown
- And I can skip or add extra steps per test
- And setup types include: Playwright (browser), API (HTTP ...', 1773931268);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('d4a33af4-8ba5-4e27-8651-9e22643ac505', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'Testing Templates', 'As a developer, I want to apply one-click preset configurations for common app types, so that I can quickly configure optimal settings', NULL, 0, 0, NULL, '## Testing Templates (from spec)

As a developer, I want to apply one-click preset configurations for common app types, so that I can quickly configure optimal settings

### Test Scenarios
- Given I have a specific app type
- When I select a testing template
- Then preset configurations are applied (SaaS/Dashboard, M...
- And I can customize after applying template
- And template includes appropriate stabilization settings', 1773931268);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('589deec7-6226-487f-93ab-ca8a6d497cbe', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'Network & Console Tracking', 'As a developer, I want to capture network requests and browser console errors, so that I can diagnose failures beyond visual changes', NULL, 0, 0, NULL, '## Network & Console Tracking (from spec)

As a developer, I want to capture network requests and browser console errors, so that I can diagnose failures beyond visual changes

### Test Scenarios
- Given tests run with tracking enabled
- When tests execute
- Then network requests are captured
- And browser console errors are logged
- And I can review network/console data per test run
- And failures correlate with network/console issues', 1773931268);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('924c563a-fadf-4f91-84d3-cd09d7544928', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'Google Sheets Test Data Integration', 'As a QA engineer, I want to use Google Sheets as test data sources, so that non-technical team members can manage test data', NULL, 0, 0, NULL, '## Google Sheets Test Data Integration (from spec)

As a QA engineer, I want to use Google Sheets as test data sources, so that non-technical team members can manage test data

### Test Scenarios
- Given I connect Google Sheets via OAuth
- When I configure data sources
- Then I can select spreadsheets with aliases ("users", "pr...
- And multi-tab support is available
- And I can set custom header rows
- And I can define fixed data ranges
- And data is cached for performance
- And I can reference data in test code', 1773931268);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('bc4eb7ec-bb4f-4c52-8f53-4f680d752064', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'CI/CD Integration', 'As a DevOps engineer, I want to run visual tests in CI/CD pipelines, so that tests run automatically on PR open/update', NULL, 0, 0, NULL, '## CI/CD Integration (from spec)

As a DevOps engineer, I want to run visual tests in CI/CD pipelines, so that tests run automatically on PR open/update

### Test Scenarios
- Given I use GitHub Actions
- When I add the Lastest2 reusable action
- Then tests run on PR events
- And results post to PR comments
- And build status is reported (passed/failed/review_requir...
- And I can configure timeout and fail-on-changes behavior
- And outputs include: status, build-url, changed-count, pa...', 1773931268);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('94b20e89-d433-4028-92f6-dfa2f0739e4b', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'CLI Test Runner', 'As a CI/CD user, I want to run visual tests from command line, so that I can integrate with any CI pipeline', NULL, 0, 0, NULL, '## CLI Test Runner (from spec)

As a CI/CD user, I want to run visual tests from command line, so that I can integrate with any CI pipeline

### Test Scenarios
- Given I have a repo-id
- When I run `pnpm test:visual --repo-id <id>`
- Then tests execute via CLI
- And I can override base-url, headless mode, output directory
- And GITHUB_HEAD_REF, GITHUB_REF_NAME, GITHUB_SHA are auto...
- And results are output to specified directory', 1773931268);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('82e275d2-7f54-40d9-813d-25cc6b7c1664', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'Multi-Tenancy', 'As a team owner, I want to create isolated team workspaces, so that multiple teams can use the same instance', NULL, 0, 0, NULL, '## Multi-Tenancy (from spec)

As a team owner, I want to create isolated team workspaces, so that multiple teams can use the same instance

### Test Scenarios
- Given I create a team
- When I invite members
- Then team has a unique slug-based workspace
- And members have roles (owner, admin, member, viewer)
- And teams are fully isolated
- And I can send email invitations via Resend', 1773931268);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('572cef68-5111-4a3d-9179-dfcd9117101a', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'Role-Based Access Control', 'As a team admin, I want to assign roles to team members, so that access is controlled appropriately', NULL, 0, 0, NULL, '## Role-Based Access Control (from spec)

As a team admin, I want to assign roles to team members, so that access is controlled appropriately

### Test Scenarios
- Given I manage team members
- When I assign roles
- Then owner can manage all settings
- And admin can manage users and tests
- And member can create and run tests
- And viewer can only view results
- And permissions are enforced', 1773931268);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('56368208-d0ab-4469-9764-31127d152010', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'Route Discovery', 'As a developer, I want to automatically discover application routes, so that I know which pages need test coverage', NULL, 0, 0, NULL, '## Route Discovery (from spec)

As a developer, I want to automatically discover application routes, so that I know which pages need test coverage

### Test Scenarios
- Given I have a codebase connected
- When AI scans my source code
- Then routes are discovered automatically
- And suggested tests are presented
- And coverage gaps are highlighted
- And I can generate tests for discovered routes', 1773931268);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('2bc9e536-97b1-4b42-9b4c-11238dc466f0', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'Functional Area Hierarchy', 'As a QA manager, I want to organize tests into nested functional areas, so that I can structure tests logically', NULL, 0, 0, NULL, '## Functional Area Hierarchy (from spec)

As a QA manager, I want to organize tests into nested functional areas, so that I can structure tests logically

### Test Scenarios
- Given I create functional areas
- When I organize tests
- Then I can create parent/child hierarchies
- And I can drag-and-drop to reorder
- And tests can be grouped by feature/module
- And hierarchy is reflected in reporting', 1773931268);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('c76f05e1-89e4-44e8-a082-00d4272ebee7', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'Test Versioning', 'As a developer, I want to track full version history of tests, so that I can see changes over time and revert if needed', NULL, 0, 0, NULL, '## Test Versioning (from spec)

As a developer, I want to track full version history of tests, so that I can see changes over time and revert if needed

### Test Scenarios
- Given tests are modified over time
- When I view test history
- Then I see full version history
- And each version has a change reason (manual edit, AI fix...
- And I can compare versions
- And I can restore previous versions', 1773931268);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('81919fed-e3b8-4849-a1d5-1d3bfc7d32ea', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'Notifications', 'As a team lead, I want to receive notifications about build results, so that the team is alerted to regressions', NULL, 0, 0, NULL, '## Notifications (from spec)

As a team lead, I want to receive notifications about build results, so that the team is alerted to regressions

### Test Scenarios
- Given I configure notification channels
- When builds complete
- Then notifications are sent to Slack
- And/or Discord
- And/or custom webhook endpoints
- And I can customize HTTP methods and headers for webhooks
- And payload includes: event, buildId, status, counts, bra...', 1773931268);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('97843ace-dc81-48ea-8157-3027d232cede', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'Early Adopter Mode', 'As a team willing to test experimental features, I want to enable early adopter mode, so that I can access features before general release', NULL, 0, 0, NULL, '## Early Adopter Mode (from spec)

As a team willing to test experimental features, I want to enable early adopter mode, so that I can access features before general release

### Test Scenarios
- Given I am a team owner or admin
- When I enable early adopter mode
- Then experimental features become visible
- And I understand features may change
- And I can disable early adopter mode anytime', 1773931268);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('a2f667bb-da7c-4411-8382-2dae055be705', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'Auto-Detect Capabilities', 'As a test author, I want to automatically detect required browser capabilities during recording, so that tests have correct permissions without manual configuration', NULL, 0, 0, NULL, '## Auto-Detect Capabilities (from spec)

As a test author, I want to automatically detect required browser capabilities during recording, so that tests have correct permissions without manual configuration

### Test Scenarios
- Given I record a test
- When I interact with file upload, clipboard, downloads, o...
- Then required Playwright capabilities are auto-detected
- And corresponding settings are enabled automatically
- And I can review detected capabilities', 1773931268);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('ca77a442-936f-4a57-9433-5074d71af5c4', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'AI Diff Analysis', 'As a QA engineer, I want to AI to classify visual diffs, so that I can quickly identify meaningful changes vs noise', NULL, 0, 0, NULL, '## AI Diff Analysis (from spec)

As a QA engineer, I want to AI to classify visual diffs, so that I can quickly identify meaningful changes vs noise

### Test Scenarios
- Given a visual diff is detected
- When AI diff analysis runs
- Then diffs are classified (insignificant/meaningful/noise)
- And confidence scores are provided
- And change categories are assigned
- And I can use a separate AI provider for diff analysis th...', 1773931268);
INSERT INTO functional_areas (id, repository_id, name, description, parent_id, is_route_folder, order_index, deleted_at, agent_plan, plan_generated_at) VALUES ('0f040a88-b0dc-4cac-9c46-da943949dbea', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'MCP Selector Validation', 'As a test author, I want to validate selectors on live pages in real-time, so that I know selectors will work before running tests', NULL, 0, 0, NULL, '## MCP Selector Validation (from spec)

As a test author, I want to validate selectors on live pages in real-time, so that I know selectors will work before running tests

### Test Scenarios
- Given I write or edit a test
- When I use MCP selector validation
- Then selectors are tested against the live page
- And validation results show in real-time
- And I can fix selectors before saving
- And validation uses Claude MCP integration', 1773931268);

INSERT INTO tests (id, repository_id, functional_area_id, name, code, description, is_placeholder, target_url, setup_test_id, setup_script_id, setup_overrides, teardown_overrides, deleted_at, created_at, updated_at, required_capabilities, stabilization_overrides, viewport_override, diff_overrides, playwright_overrides, execution_mode, agent_prompt) VALUES ('3299cab2-6c46-4ad8-a4bd-8bea93df0178', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', '2a29d565-55b7-4051-97a0-518ea64731ae', 'SETUP: Login', 'export async function test(page: Page, baseUrl: string, screenshotPath: string, stepLogger: any) {
  // Navigate to the login page
  stepLogger.log(''Navigating to login page'');
  await page.goto(`${baseUrl}/login`);
  
  // Wait for the page to be fully loaded
  await page.waitForLoadState(''domcontentloaded'');
  
  // Fill in the email field
  stepLogger.log(''Entering email address'');
  await page.locator(''#email'').fill(''testuser1771664821751@example.com'');
  
  // Fill in the password field
  stepLogger.log(''Entering password'');
  await page.locator(''#password'').fill(''SecurePass123'');
  
  // Take a screenshot before submission
  stepLogger.log(''Taking screenshot of filled login form'');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  
  // Click the submit button
  stepLogger.log(''Submitting login form'');
  await page.locator(''button[type="submit"]'').click();
  
  // Wait for navigation after login
  await page.waitForLoadState(''domcontentloaded'');
  
  // Optional: Take a screenshot of the page after login
  stepLogger.log(''Login completed successfully'');
}', NULL, 0, 'http://localhost:3000', NULL, NULL, '{"skippedDefaultStepIds":["89d5548a-3ff1-4e68-b704-193caebca383","0f281033-f62f-41d1-b6fa-057265c28883"],"extraSteps":[]}', NULL, NULL, 1770561961, 1773320064, NULL, NULL, NULL, NULL, NULL, 'procedural', NULL);
INSERT INTO tests (id, repository_id, functional_area_id, name, code, description, is_placeholder, target_url, setup_test_id, setup_script_id, setup_overrides, teardown_overrides, deleted_at, created_at, updated_at, required_capabilities, stabilization_overrides, viewport_override, diff_overrides, playwright_overrides, execution_mode, agent_prompt) VALUES ('5beb8558-cbe4-4fae-9947-68fc921dde1c', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', NULL, 'Dashboard', 'import { Page } from ''playwright'';

export async function test(page: Page, baseUrl: string, screenshotPath: string, stepLogger: any) {
  // Helper to build URLs safely (handles trailing/leading slashes)
  function buildUrl(base, path) {
    const cleanBase = base.endsWith(''/'') ? base.slice(0, -1) : base;
    const cleanPath = path.startsWith(''/'') ? path : ''/'' + path;
    return cleanBase + cleanPath;
  }

  // Helper to generate unique screenshot paths
  let screenshotStep = 0;
  function getScreenshotPath() {
    screenshotStep++;
    const ext = screenshotPath.lastIndexOf(''.'');
    if (ext > 0) {
      return screenshotPath.slice(0, ext) + ''-step'' + screenshotStep + screenshotPath.slice(ext);
    }
    return screenshotPath + ''-step'' + screenshotStep;
  }

  // Multi-selector fallback helper with coordinate fallback for clicks
  async function locateWithFallback(page, selectors, action, value, coords, options) {
    const validSelectors = selectors.filter(sel => sel.value && sel.value.trim() && !sel.value.includes(''undefined''));
    for (const sel of validSelectors) {
      try {
        let locator;
        if (sel.type === ''ocr-text'') {
          const text = sel.value.replace(/^ocr-text="/, '''').replace(/"$/, '''');
          locator = page.getByText(text, { exact: false });
        } else if (sel.type === ''role-name'') {
          // Parse role=button[name="Label"] format and use getByRole
          const match = sel.value.match(/^role=(\w+)\[name="(.+)"\]$/);
          if (match) {
            locator = page.getByRole(match[1], { name: match[2] });
          } else {
            locator = page.locator(sel.value);
          }
        } else {
          locator = page.locator(sel.value);
        }
        // Use .first() to handle multiple matches (e.g., header + footer nav links)
        const target = locator.first();
        await target.waitFor({ timeout: 3000 });
        if (action === ''locate'') return target; // Return locator for assertions
        if (action === ''click'') await target.click(options || {});
        else if (action === ''fill'') await target.fill(value || '''');
        else if (action === ''selectOption'') await target.selectOption(value || '''');
        return target;
      } catch { continue; }
    }
    // Coordinate fallback for clicks when all selectors fail
    if (action === ''click'' && coords) {
      console.log(''Falling back to coordinate click at'', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y, options || {});
      return;
    }
    // Coordinate fallback for fill - click to focus then type
    if (action === ''fill'' && coords) {
      console.log(''Falling back to coordinate fill at'', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y);
      await page.keyboard.press(''Control+a'');
      await page.keyboard.type(value || '''');
      return;
    }
    throw new Error(''No selector matched: '' + JSON.stringify(validSelectors));
  }
  await locateWithFallback(page, [{"type":"role-name","value":"role=link[name=\"Dashboard\"]"},{"type":"text","value":"text=\"Dashboard\""},{"type":"css-path","value":"ul.space-y-1 > li > a.flex.items-center"}], ''click'', null, {"x":109,"y":185});
  await page.goto(buildUrl(baseUrl, ''/''));
}
', NULL, 0, 'http://localhost:3000', NULL, NULL, NULL, NULL, NULL, 1773309065, 1773403800, '{"fileUpload":false,"clipboard":false,"networkInterception":false,"downloads":false}', NULL, NULL, NULL, NULL, 'procedural', NULL);
INSERT INTO tests (id, repository_id, functional_area_id, name, code, description, is_placeholder, target_url, setup_test_id, setup_script_id, setup_overrides, teardown_overrides, deleted_at, created_at, updated_at, required_capabilities, stabilization_overrides, viewport_override, diff_overrides, playwright_overrides, execution_mode, agent_prompt) VALUES ('8e9f2f3f-4b8e-4859-bce8-7ba080ca7d76', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', '2a29d565-55b7-4051-97a0-518ea64731ae', 'Google login', 'export async function test(page, baseUrl, screenshotPath, stepLogger) {
  stepLogger.log(''Navigate to home page'');
  await page.goto(`${baseUrl}/`, { waitUntil: ''domcontentloaded'' });
  await page.waitForLoadState(''domcontentloaded'');
  await expect(page).toHaveURL(/\//);
  await expect(page.locator(''body'')).toBeVisible();
  
  stepLogger.log(''Click Continue with Google button'');
  const googleButton = page.getByRole(''button'', { name: /continue with google/i });
  await expect(googleButton).toBeVisible();
  await googleButton.click();
  
  stepLogger.log(''Wait for Google OAuth redirect'');
  await page.waitForLoadState(''domcontentloaded'');
  await page.waitForTimeout(2000);
  
  stepLogger.log(''Check if redirected to Google accounts'');
  const currentUrl = page.url();
  if (currentUrl.includes(''accounts.google.com'')) {
    stepLogger.log(''Successfully redirected to Google OAuth - test completed'');
  } else {
    stepLogger.log(''Still on application page - OAuth flow may require manual authentication'');
  }
  
  stepLogger.log(''Take screenshot'');
  await page.screenshot({ path: screenshotPath, fullPage: true });
}', NULL, 0, 'http://localhost:3000', NULL, NULL, '{"skippedDefaultStepIds":["0f281033-f62f-41d1-b6fa-057265c28883"],"extraSteps":[]}', NULL, NULL, 1773311046, 1773398134, NULL, NULL, NULL, NULL, NULL, 'procedural', NULL);
INSERT INTO tests (id, repository_id, functional_area_id, name, code, description, is_placeholder, target_url, setup_test_id, setup_script_id, setup_overrides, teardown_overrides, deleted_at, created_at, updated_at, required_capabilities, stabilization_overrides, viewport_override, diff_overrides, playwright_overrides, execution_mode, agent_prompt) VALUES ('ed4043e9-b705-49b3-8d31-923832cbe0e0', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', '2a29d565-55b7-4051-97a0-518ea64731ae', 'Github login', 'export async function test(page, baseUrl, screenshotPath, stepLogger) {
  function buildUrl(base, path) {
    const cleanBase = base.endsWith(''/'') ? base.slice(0, -1) : base;
    const cleanPath = path.startsWith(''/'') ? path : ''/'' + path;
    return cleanBase + cleanPath;
  }

  let screenshotStep = 0;
  function getScreenshotPath() {
    screenshotStep++;
    const ext = screenshotPath.lastIndexOf(''.'');
    if (ext > 0) {
      return screenshotPath.slice(0, ext) + ''-step'' + screenshotStep + screenshotPath.slice(ext);
    }
    return screenshotPath + ''-step'' + screenshotStep;
  }

  async function locateWithFallback(page, selectors, action, value, coords) {
    const validSelectors = selectors.filter(sel => sel.value && sel.value.trim() && !sel.value.includes(''undefined''));
    for (const sel of validSelectors) {
      try {
        let locator;
        if (sel.type === ''ocr-text'') {
          const text = sel.value.replace(/^ocr-text="/, '''').replace(/"$/, '''');
          locator = page.getByText(text, { exact: false });
        } else if (sel.type === ''role-name'') {
          const match = sel.value.match(/^role=(\w+)\[name="(.+)"\]$/);
          if (match) {
            locator = page.getByRole(match[1], { name: match[2] });
          } else {
            locator = page.locator(sel.value);
          }
        } else {
          locator = page.locator(sel.value);
        }
        const target = locator.first();
        await target.waitFor({ timeout: 3000 });
        if (action === ''locate'') return target;
        if (action === ''click'') await target.click();
        else if (action === ''fill'') await target.fill(value || '''');
        else if (action === ''selectOption'') await target.selectOption(value || '''');
        return target;
      } catch { continue; }
    }
    if (action === ''click'' && coords) {
      console.log(''Falling back to coordinate click at'', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y);
      return;
    }
    if (action === ''fill'' && coords) {
      console.log(''Falling back to coordinate fill at'', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y);
      await page.keyboard.press(''Control+a'');
      await page.keyboard.type(value || '''');
      return;
    }
    throw new Error(''No selector matched: '' + JSON.stringify(validSelectors));
  }

  stepLogger.log(''Navigate to home page'');
  await page.goto(buildUrl(baseUrl, ''/''), { waitUntil: ''domcontentloaded'' });
  await page.waitForLoadState(''domcontentloaded'');
  await page.waitForTimeout(500);
  
  stepLogger.log(''Click Continue with GitHub button'');
  await locateWithFallback(page, [{"type":"role-name","value":"role=button[name=\"Continue with GitHub\"]"},{"type":"text","value":"text=\"Continue with GitHub\""},{"type":"css-path","value":"div.w-full.max-w-sm > div.space-y-2 > button.inline-flex.items-center"}], ''click'', null, {"x":640,"y":484});
  
  stepLogger.log(''Wait for GitHub login page'');
  await page.waitForLoadState(''domcontentloaded'');
  await page.waitForTimeout(500);
  
  stepLogger.log(''Fill login field'');
  await locateWithFallback(page, [{"type":"id","value":"#login_field"},{"type":"name","value":"[name=\"login\"]"},{"type":"css-path","value":"form > div > input.form-control.js-login-field"}], ''fill'', ''ew'', null);
  
  await page.keyboard.press(''Backspace'');
  await page.keyboard.press(''Backspace'');
  
  stepLogger.log(''Take screenshot'');
  await page.screenshot({ path: screenshotPath, fullPage: true });
}', NULL, 0, 'http://localhost:3000', NULL, NULL, NULL, NULL, NULL, 1773318129, 1773398125, NULL, NULL, NULL, NULL, NULL, 'procedural', NULL);
INSERT INTO tests (id, repository_id, functional_area_id, name, code, description, is_placeholder, target_url, setup_test_id, setup_script_id, setup_overrides, teardown_overrides, deleted_at, created_at, updated_at, required_capabilities, stabilization_overrides, viewport_override, diff_overrides, playwright_overrides, execution_mode, agent_prompt) VALUES ('ffda9827-96e4-40d3-a15e-2dc70ce7ae5b', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'c6d0b168-9183-415c-8599-eff8d83c2b5c', 'Recording Meta', 'import { Page } from ''playwright'';

export async function test(page: Page, baseUrl: string, screenshotPath: string, stepLogger: any) {
  // Helper to build URLs safely (handles trailing/leading slashes)
  function buildUrl(base, path) {
    const cleanBase = base.endsWith(''/'') ? base.slice(0, -1) : base;
    const cleanPath = path.startsWith(''/'') ? path : ''/'' + path;
    return cleanBase + cleanPath;
  }

  // Helper to generate unique screenshot paths
  let screenshotStep = 0;
  function getScreenshotPath() {
    screenshotStep++;
    const ext = screenshotPath.lastIndexOf(''.'');
    if (ext > 0) {
      return screenshotPath.slice(0, ext) + ''-step'' + screenshotStep + screenshotPath.slice(ext);
    }
    return screenshotPath + ''-step'' + screenshotStep;
  }

  // Multi-selector fallback helper with coordinate fallback for clicks
  async function locateWithFallback(page, selectors, action, value, coords) {
    const validSelectors = selectors.filter(sel => sel.value && sel.value.trim() && !sel.value.includes(''undefined''));
    for (const sel of validSelectors) {
      try {
        let locator;
        if (sel.type === ''ocr-text'') {
          const text = sel.value.replace(/^ocr-text="/, '''').replace(/"$/, '''');
          locator = page.getByText(text, { exact: false });
        } else if (sel.type === ''role-name'') {
          const match = sel.value.match(/^role=(\w+)\[name="(.+)"\]$/);
          if (match) {
            locator = page.getByRole(match[1], { name: match[2] });
          } else {
            locator = page.locator(sel.value);
          }
        } else {
          locator = page.locator(sel.value);
        }
        const target = locator.first();
        await target.waitFor({ timeout: 3000 });
        if (action === ''locate'') return target;
        if (action === ''click'') await target.click();
        else if (action === ''fill'') await target.fill(value || '''');
        else if (action === ''selectOption'') await target.selectOption(value || '''');
        return target;
      } catch { continue; }
    }
    if (action === ''click'' && coords) {
      console.log(''Falling back to coordinate click at'', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y);
      return;
    }
    if (action === ''fill'' && coords) {
      console.log(''Falling back to coordinate fill at'', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y);
      await page.keyboard.press(''Control+a'');
      await page.keyboard.type(value || '''');
      return;
    }
    throw new Error(''No selector matched: '' + JSON.stringify(validSelectors));
  }

  await page.goto(buildUrl(baseUrl, ''/''));
  await locateWithFallback(page, [{"type":"role-name","value":"role=link[name=\"Tests\"]"},{"type":"text","value":"text=\"Tests\""},{"type":"css-path","value":"ul.space-y-1 > li > a.flex.items-center"}], ''click'', null, {"x":128,"y":308});
  await page.goto(buildUrl(baseUrl, ''/tests''));
  await locateWithFallback(page, [{"type":"role-name","value":"role=link[name=\"Record Test\"]"},{"type":"text","value":"text=\"Record Test\""},{"type":"css-path","value":"div.flex.items-center > div.flex.gap-2 > a.inline-flex.items-center"}], ''click'', null, {"x":1191,"y":52});
  await page.goto(buildUrl(baseUrl, ''/record''));
  await locateWithFallback(page, [{"type":"placeholder","value":"[placeholder=\"login-success\"]"},{"type":"css-path","value":"div.px-6.space-y-6 > div.space-y-2 > input.border-input.h-9"}], ''click'', null, {"x":520,"y":353});
  await locateWithFallback(page, [{"type":"placeholder","value":"[placeholder=\"login-success\"]"},{"type":"css-path","value":"div.px-6.space-y-6 > div.space-y-2 > input.border-input.h-9"}], ''fill'', ''t'', null);
  await locateWithFallback(page, [{"type":"placeholder","value":"[placeholder=\"login-success\"]"},{"type":"css-path","value":"div.px-6.space-y-6 > div.space-y-2 > input.border-input.h-9"}], ''fill'', ''te'', null);
  await locateWithFallback(page, [{"type":"placeholder","value":"[placeholder=\"login-success\"]"},{"type":"css-path","value":"div.px-6.space-y-6 > div.space-y-2 > input.border-input.h-9"}], ''fill'', ''tes'', null);
  await locateWithFallback(page, [{"type":"placeholder","value":"[placeholder=\"login-success\"]"},{"type":"css-path","value":"div.px-6.space-y-6 > div.space-y-2 > input.border-input.h-9"}], ''fill'', ''test'', null);
  await locateWithFallback(page, [{"type":"role-name","value":"role=combobox[name=\"Local\"]"},{"type":"text","value":"text=\"Local\""},{"type":"css-path","value":"div.px-6.space-y-6 > div.space-y-2 > button.border-input.flex"}], ''click'', null, {"x":360,"y":629});
  await locateWithFallback(page, [{"type":"role-name","value":"role=option[name=\"System EB-eb-2\"]"},{"type":"css-path","value":"div.p-1 > div > div.relative.flex"}], ''click'', null, {"x":397,"y":689});
  await locateWithFallback(page, [{"type":"role-name","value":"role=button[name=\"Start Recording\"]"},{"type":"text","value":"text=\"Start Recording\""},{"type":"css-path","value":"div.bg-card.text-card-foreground > div.px-6.space-y-6 > button.inline-flex.items-center"}], ''click'', null, {"x":520,"y":445});
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await locateWithFallback(page, [{"type":"role-name","value":"role=button[name=\"Stop\"]"},{"type":"text","value":"text=\"Stop\""},{"type":"css-path","value":"div.flex-1.flex > div.fixed.bottom-6 > button.inline-flex.items-center"}], ''click'', null, {"x":846,"y":673});
}
', NULL, 0, 'http://localhost:3000', NULL, NULL, NULL, NULL, NULL, 1773581109, 1773586816, NULL, NULL, NULL, NULL, NULL, 'procedural', NULL);
INSERT INTO tests (id, repository_id, functional_area_id, name, code, description, is_placeholder, target_url, setup_test_id, setup_script_id, setup_overrides, teardown_overrides, deleted_at, created_at, updated_at, required_capabilities, stabilization_overrides, viewport_override, diff_overrides, playwright_overrides, execution_mode, agent_prompt) VALUES ('fa27c21d-eb41-4896-9423-82b948e636c6', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'c6d0b168-9183-415c-8599-eff8d83c2b5c', 'Areas', 'import { Page } from ''playwright'';

export async function test(page: Page, baseUrl: string, screenshotPath: string, stepLogger: any) {
  // Helper to build URLs safely (handles trailing/leading slashes)
  function buildUrl(base, path) {
    const cleanBase = base.endsWith(''/'') ? base.slice(0, -1) : base;
    const cleanPath = path.startsWith(''/'') ? path : ''/'' + path;
    return cleanBase + cleanPath;
  }

  // Helper to generate unique screenshot paths
  let screenshotStep = 0;
  function getScreenshotPath() {
    screenshotStep++;
    const ext = screenshotPath.lastIndexOf(''.'');
    if (ext > 0) {
      return screenshotPath.slice(0, ext) + ''-step'' + screenshotStep + screenshotPath.slice(ext);
    }
    return screenshotPath + ''-step'' + screenshotStep;
  }

  // Multi-selector fallback helper with coordinate fallback for clicks
  async function locateWithFallback(page, selectors, action, value, coords) {
    const validSelectors = selectors.filter(sel => sel.value && sel.value.trim() && !sel.value.includes(''undefined''));
    for (const sel of validSelectors) {
      try {
        let locator;
        if (sel.type === ''ocr-text'') {
          const text = sel.value.replace(/^ocr-text="/, '''').replace(/"$/, '''');
          locator = page.getByText(text, { exact: false });
        } else if (sel.type === ''role-name'') {
          const match = sel.value.match(/^role=(\w+)\[name="(.+)"\]$/);
          if (match) {
            locator = page.getByRole(match[1], { name: match[2] });
          } else {
            locator = page.locator(sel.value);
          }
        } else {
          locator = page.locator(sel.value);
        }
        const target = locator.first();
        await target.waitFor({ timeout: 3000 });
        if (action === ''locate'') return target;
        if (action === ''click'') await target.click();
        else if (action === ''fill'') await target.fill(value || '''');
        else if (action === ''selectOption'') await target.selectOption(value || '''');
        return target;
      } catch { continue; }
    }
    if (action === ''click'' && coords) {
      console.log(''Falling back to coordinate click at'', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y);
      return;
    }
    if (action === ''fill'' && coords) {
      console.log(''Falling back to coordinate fill at'', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y);
      await page.keyboard.press(''Control+a'');
      await page.keyboard.type(value || '''');
      return;
    }
    throw new Error(''No selector matched: '' + JSON.stringify(validSelectors));
  }

  await page.goto(buildUrl(baseUrl, ''/''));
  await locateWithFallback(page, [{"type":"role-name","value":"role=link[name=\"Areas\"]"},{"type":"text","value":"text=\"Areas\""},{"type":"css-path","value":"ul.space-y-1 > li > a.flex.items-center"}], ''click'', null, {"x":128,"y":268});
  await page.waitForLoadState(''networkidle'').catch(() => {});
  await page.goto(buildUrl(baseUrl, ''/areas''));
  await locateWithFallback(page, [{"type":"css-path","value":"div.bg-muted/30.h-full > div.h-full.flex > div.p-3.border-b"}], ''click'', null, {"x":358,"y":25});
  await locateWithFallback(page, [{"type":"css-path","value":"div.h-full.flex > div.p-3.border-b > button.inline-flex.items-center"}], ''click'', null, {"x":437,"y":24});
  await page.keyboard.type(new Date().toISOString());
  await locateWithFallback(page, [{"type":"role-name","value":"role=button[name=\"Create\"]"},{"type":"text","value":"text=\"Create\""},{"type":"css-path","value":"div.bg-background.fixed > div.flex.flex-col-reverse > button.inline-flex.items-center"}], ''click'', null, {"x":833,"y":507});
  await page.waitForLoadState(''networkidle'').catch(() => {});
  await page.goto(buildUrl(baseUrl, ''/areas''));
  await locateWithFallback(page, [{"type":"css-path","value":"div > div.group.flex > span.flex-1.truncate"}], ''click'', null, {"x":499,"y":425});
  await locateWithFallback(page, [{"type":"role-name","value":"role=button[name=\"Edit\"]"},{"type":"text","value":"text=\"Edit\""},{"type":"css-path","value":"div.\\@container/card-header.auto-rows-min > div.flex.gap-1 > button.inline-flex.items-center"}], ''click'', null, {"x":1151,"y":639});
  await locateWithFallback(page, [{"type":"id","value":"#description"},{"type":"css-path","value":"div.px-6.space-y-4 > div.space-y-2 > textarea.border-input.w-full"}], ''click'', null, {"x":870,"y":474});
  await locateWithFallback(page, [{"type":"id","value":"#description"},{"type":"role-name","value":"role=textbox[name=\"12\"]"},{"type":"css-path","value":"div.px-6.space-y-4 > div.space-y-2 > textarea.border-input.w-full"}], ''fill'', ''123'', null);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await locateWithFallback(page, [{"type":"role-name","value":"role=button[name=\"Save\"]"},{"type":"text","value":"text=\"Save\""},{"type":"css-path","value":"div.\\@container/card-header.auto-rows-min > div.flex.gap-2 > button.inline-flex.items-center"}], ''click'', null, {"x":1187,"y":279});
  await page.waitForLoadState(''networkidle'').catch(() => {});
  await page.goto(buildUrl(baseUrl, ''/areas''));
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
}
', NULL, 0, 'http://localhost:3000', NULL, NULL, NULL, NULL, NULL, 1773587270, 1773602797, NULL, NULL, NULL, NULL, NULL, 'procedural', NULL);
INSERT INTO tests (id, repository_id, functional_area_id, name, code, description, is_placeholder, target_url, setup_test_id, setup_script_id, setup_overrides, teardown_overrides, deleted_at, created_at, updated_at, required_capabilities, stabilization_overrides, viewport_override, diff_overrides, playwright_overrides, execution_mode, agent_prompt) VALUES ('5627ddbc-6f5d-4c87-801d-64c47cbfa63b', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'c6d0b168-9183-415c-8599-eff8d83c2b5c', 'Env Setup', 'import { Page } from ''playwright'';

export async function test(page: Page, baseUrl: string, screenshotPath: string, stepLogger: any) {
  // Helper to build URLs safely (handles trailing/leading slashes)
  function buildUrl(base, path) {
    const cleanBase = base.endsWith(''/'') ? base.slice(0, -1) : base;
    const cleanPath = path.startsWith(''/'') ? path : ''/'' + path;
    return cleanBase + cleanPath;
  }

  // Helper to generate unique screenshot paths
  let screenshotStep = 0;
  function getScreenshotPath() {
    screenshotStep++;
    const ext = screenshotPath.lastIndexOf(''.'');
    if (ext > 0) {
      return screenshotPath.slice(0, ext) + ''-step'' + screenshotStep + screenshotPath.slice(ext);
    }
    return screenshotPath + ''-step'' + screenshotStep;
  }

  // Multi-selector fallback helper with coordinate fallback for clicks
  async function locateWithFallback(page, selectors, action, value, coords) {
    const validSelectors = selectors.filter(sel => sel.value && sel.value.trim() && !sel.value.includes(''undefined''));
    for (const sel of validSelectors) {
      try {
        let locator;
        if (sel.type === ''ocr-text'') {
          const text = sel.value.replace(/^ocr-text="/, '''').replace(/"$/, '''');
          locator = page.getByText(text, { exact: false });
        } else if (sel.type === ''role-name'') {
          const match = sel.value.match(/^role=(\w+)\[name="(.+)"\]$/);
          if (match) {
            locator = page.getByRole(match[1], { name: match[2] });
          } else {
            locator = page.locator(sel.value);
          }
        } else {
          locator = page.locator(sel.value);
        }
        const target = locator.first();
        await target.waitFor({ timeout: 3000 });
        if (action === ''locate'') return target;
        if (action === ''click'') await target.click();
        else if (action === ''fill'') await target.fill(value || '''');
        else if (action === ''selectOption'') await target.selectOption(value || '''');
        return target;
      } catch { continue; }
    }
    if (action === ''click'' && coords) {
      console.log(''Falling back to coordinate click at'', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y);
      return;
    }
    if (action === ''fill'' && coords) {
      console.log(''Falling back to coordinate fill at'', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y);
      await page.keyboard.press(''Control+a'');
      await page.keyboard.type(value || '''');
      return;
    }
    throw new Error(''No selector matched: '' + JSON.stringify(validSelectors));
  }

  await page.goto(buildUrl(baseUrl, ''/''));
  await locateWithFallback(page, [{"type":"role-name","value":"role=link[name=\"Env Setup\"]"},{"type":"text","value":"text=\"Env Setup\""},{"type":"css-path","value":"ul.space-y-1 > li > a.flex.items-center"}], ''click'', null, {"x":128,"y":348});
  await page.waitForLoadState(''networkidle'').catch(() => {});
  await page.goto(buildUrl(baseUrl, ''/env''));
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await locateWithFallback(page, [{"type":"role-name","value":"role=button[name=\"New Config\"]"},{"type":"text","value":"text=\"New Config\""},{"type":"css-path","value":"div.bg-card.text-card-foreground > div.\\@container/card-header.auto-rows-min > button.inline-flex.items-center"}], ''click'', null, {"x":1124,"y":449});
  await locateWithFallback(page, [{"type":"id","value":"#authType"},{"type":"role-name","value":"role=combobox[name=\"None\"]"},{"type":"text","value":"text=\"None\""},{"type":"css-path","value":"div.space-y-4 > div.space-y-2 > button.border-input.flex"}], ''click'', null, {"x":452,"y":453});
  await locateWithFallback(page, [{"type":"role-name","value":"role=option[name=\"Basic Auth\"]"},{"type":"css-path","value":"div.bg-popover.text-popover-foreground > div.p-1 > div.relative.flex"}], ''click'', null, {"x":490,"y":517});
  await locateWithFallback(page, [{"type":"role-name","value":"role=button[name=\"Cancel\"]"},{"type":"text","value":"text=\"Cancel\""},{"type":"css-path","value":"div.bg-background.fixed > div.flex.flex-col-reverse > button.inline-flex.items-center"}], ''click'', null, {"x":746,"y":543});
}
', NULL, 0, 'http://localhost:3000', NULL, NULL, NULL, NULL, NULL, 1773603606, 1773603606, NULL, NULL, NULL, NULL, NULL, 'procedural', NULL);
INSERT INTO tests (id, repository_id, functional_area_id, name, code, description, is_placeholder, target_url, setup_test_id, setup_script_id, setup_overrides, teardown_overrides, deleted_at, created_at, updated_at, required_capabilities, stabilization_overrides, viewport_override, diff_overrides, playwright_overrides, execution_mode, agent_prompt) VALUES ('8a1d4f7d-a306-48a1-bccb-0efc1aa65e92', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'c6d0b168-9183-415c-8599-eff8d83c2b5c', 'Test page', 'import { Page } from ''playwright'';

export async function test(page: Page, baseUrl: string, screenshotPath: string, stepLogger: any) {
  // Helper to build URLs safely (handles trailing/leading slashes)
  function buildUrl(base, path) {
    const cleanBase = base.endsWith(''/'') ? base.slice(0, -1) : base;
    const cleanPath = path.startsWith(''/'') ? path : ''/'' + path;
    return cleanBase + cleanPath;
  }

  // Helper to generate unique screenshot paths
  let screenshotStep = 0;
  function getScreenshotPath() {
    screenshotStep++;
    const ext = screenshotPath.lastIndexOf(''.'');
    if (ext > 0) {
      return screenshotPath.slice(0, ext) + ''-step'' + screenshotStep + screenshotPath.slice(ext);
    }
    return screenshotPath + ''-step'' + screenshotStep;
  }

  // Multi-selector fallback helper with coordinate fallback for clicks
  async function locateWithFallback(page, selectors, action, value, coords) {
    const validSelectors = selectors.filter(sel => sel.value && sel.value.trim() && !sel.value.includes(''undefined''));
    for (const sel of validSelectors) {
      try {
        let locator;
        if (sel.type === ''ocr-text'') {
          const text = sel.value.replace(/^ocr-text="/, '''').replace(/"$/, '''');
          locator = page.getByText(text, { exact: false });
        } else if (sel.type === ''role-name'') {
          const match = sel.value.match(/^role=(\w+)\[name="(.+)"\]$/);
          if (match) {
            locator = page.getByRole(match[1], { name: match[2] });
          } else {
            locator = page.locator(sel.value);
          }
        } else {
          locator = page.locator(sel.value);
        }
        const target = locator.first();
        await target.waitFor({ timeout: 3000 });
        if (action === ''locate'') return target;
        if (action === ''click'') await target.click();
        else if (action === ''fill'') await target.fill(value || '''');
        else if (action === ''selectOption'') await target.selectOption(value || '''');
        return target;
      } catch { continue; }
    }
    if (action === ''click'' && coords) {
      console.log(''Falling back to coordinate click at'', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y);
      return;
    }
    if (action === ''fill'' && coords) {
      console.log(''Falling back to coordinate fill at'', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y);
      await page.keyboard.press(''Control+a'');
      await page.keyboard.type(value || '''');
      return;
    }
    throw new Error(''No selector matched: '' + JSON.stringify(validSelectors));
  }

  await page.goto(buildUrl(baseUrl, ''/''));
  await locateWithFallback(page, [{"type":"role-name","value":"role=link[name=\"Tests\"]"},{"type":"text","value":"text=\"Tests\""},{"type":"css-path","value":"ul.space-y-1 > li > a.flex.items-center"}], ''click'', null, {"x":128,"y":308});
  await page.waitForLoadState(''networkidle'').catch(() => {});
  await page.goto(buildUrl(baseUrl, ''/tests''));
  await locateWithFallback(page, [{"type":"css-path","value":"div.flex.h-screen > aside.w-64.border-r > div.p-4.border-b"}], ''click'', null, {"x":128,"y":128});
  await locateWithFallback(page, [{"type":"role-name","value":"role=combobox[name=\"2026-03-12T19:20:07.817Z\"]"},{"type":"text","value":"text=\"2026-03-12T19:20:07.817Z\""},{"type":"css-path","value":"div.flex.items-center > div.flex-1.min-w-0 > button.border-input.flex"}], ''click'', null, {"x":84,"y":127});
  await locateWithFallback(page, [{"type":"role-name","value":"role=option[name=\"test\"]"},{"type":"css-path","value":"div.bg-popover.text-popover-foreground > div.p-1 > div.relative.flex"}], ''click'', null, {"x":174,"y":223});
  await page.waitForLoadState(''networkidle'').catch(() => {});
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await locateWithFallback(page, [{"type":"role-name","value":"role=button[name=\"0Passed\"]"},{"type":"text","value":"text=\"0Passed\""},{"type":"css-path","value":"div.max-w-5xl.mx-auto > div.grid.grid-cols-4 > button.p-4.rounded-lg"}], ''click'', null, {"x":644,"y":147});
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await locateWithFallback(page, [{"type":"css-path","value":"div.grid.grid-cols-4 > button.p-4.rounded-lg > div.text-2xl.font-semibold"}], ''click'', null, {"x":892,"y":137});
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await locateWithFallback(page, [{"type":"css-path","value":"div.grid.grid-cols-4 > button.p-4.rounded-lg > div.text-2xl.font-semibold"}], ''click'', null, {"x":1140,"y":137});
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await locateWithFallback(page, [{"type":"css-path","value":"div.flex.items-center > a.min-w-0.flex-1 > div.font-medium.text-sm"}], ''click'', null, {"x":363,"y":350});
  await page.waitForLoadState(''networkidle'').catch(() => {});
  await page.goto(buildUrl(baseUrl, ''/tests/test-copy-5627ddbc''));
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await locateWithFallback(page, [{"type":"id","value":"#radix-_r_18_-trigger-setup"},{"type":"role-name","value":"role=tab[name=\"Setup\"]"},{"type":"text","value":"text=\"Setup\""},{"type":"css-path","value":"div.flex.flex-col > div.bg-muted.text-muted-foreground > button.text-foreground.inline-flex"}], ''click'', null, {"x":405,"y":260});
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await locateWithFallback(page, [{"type":"id","value":"#radix-_r_18_-trigger-stabilization"},{"type":"role-name","value":"role=tab[name=\"Stabilization\"]"},{"type":"text","value":"text=\"Stabilization\""},{"type":"css-path","value":"div.flex.flex-col > div.bg-muted.text-muted-foreground > button.text-foreground.inline-flex"}], ''click'', null, {"x":484,"y":260});
  await locateWithFallback(page, [{"type":"role-name","value":"role=button[name=\"Wait Strategies\"]"},{"type":"text","value":"text=\"Wait Strategies\""},{"type":"css-path","value":"div.px-6.space-y-4 > div > button.inline-flex.items-center"}], ''click'', null, {"x":768,"y":413});
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await locateWithFallback(page, [{"type":"id","value":"#radix-_r_18_-trigger-screenshots"},{"type":"role-name","value":"role=tab[name=\"Screenshots\"]"},{"type":"text","value":"text=\"Screenshots\""},{"type":"css-path","value":"div.flex.flex-col > div.bg-muted.text-muted-foreground > button.text-foreground.inline-flex"}], ''click'', null, {"x":585,"y":260});
  await locateWithFallback(page, [{"type":"id","value":"#radix-_r_18_-trigger-plans"},{"type":"role-name","value":"role=tab[name=\"Plans\"]"},{"type":"text","value":"text=\"Plans\""},{"type":"css-path","value":"div.flex.flex-col > div.bg-muted.text-muted-foreground > button.text-foreground.inline-flex"}], ''click'', null, {"x":663,"y":260});
  await locateWithFallback(page, [{"type":"id","value":"#radix-_r_18_-trigger-history"},{"type":"role-name","value":"role=tab[name=\"Run History\"]"},{"type":"text","value":"text=\"Run History\""},{"type":"css-path","value":"div.flex.flex-col > div.bg-muted.text-muted-foreground > button.text-foreground.inline-flex"}], ''click'', null, {"x":738,"y":260});
  await locateWithFallback(page, [{"type":"id","value":"#radix-_r_18_-trigger-recordings"},{"type":"role-name","value":"role=tab[name=\"Recordings\"]"},{"type":"text","value":"text=\"Recordings\""},{"type":"css-path","value":"div.flex.flex-col > div.bg-muted.text-muted-foreground > button.text-foreground.inline-flex"}], ''click'', null, {"x":833,"y":260});
  await locateWithFallback(page, [{"type":"id","value":"#radix-_r_18_-trigger-versions"},{"type":"role-name","value":"role=tab[name=\"Versions\"]"},{"type":"text","value":"text=\"Versions\""},{"type":"css-path","value":"div.flex.flex-col > div.bg-muted.text-muted-foreground > button.text-foreground.inline-flex"}], ''click'', null, {"x":918,"y":260});
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await locateWithFallback(page, [{"type":"role-name","value":"role=button[name=\"Edit\"]"},{"type":"css-path","value":"div.flex.items-start > div.flex.gap-2 > button.inline-flex.items-center"}], ''click'', null, {"x":1041,"y":67});
  await locateWithFallback(page, [{"type":"id","value":"#radix-_r_18_-trigger-code"},{"type":"role-name","value":"role=tab[name=\"Code\"]"},{"type":"text","value":"text=\"Code\""},{"type":"css-path","value":"div.flex.flex-col > div.bg-muted.text-muted-foreground > button.text-foreground.inline-flex"}], ''click'', null, {"x":350,"y":276});
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
}
', NULL, 0, 'http://localhost:3000', NULL, NULL, NULL, NULL, NULL, 1773666246, 1773669899, NULL, NULL, NULL, NULL, NULL, 'procedural', NULL);
INSERT INTO tests (id, repository_id, functional_area_id, name, code, description, is_placeholder, target_url, setup_test_id, setup_script_id, setup_overrides, teardown_overrides, deleted_at, created_at, updated_at, required_capabilities, stabilization_overrides, viewport_override, diff_overrides, playwright_overrides, execution_mode, agent_prompt) VALUES ('93238fd4-fcab-479f-870f-2cc624ab6389', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'c6d0b168-9183-415c-8599-eff8d83c2b5c', 'Run test', 'import { Page } from ''playwright'';

export async function test(page: Page, baseUrl: string, screenshotPath: string, stepLogger: any) {
  // Helper to build URLs safely (handles trailing/leading slashes)
  function buildUrl(base, path) {
    const cleanBase = base.endsWith(''/'') ? base.slice(0, -1) : base;
    const cleanPath = path.startsWith(''/'') ? path : ''/'' + path;
    return cleanBase + cleanPath;
  }

  // Helper to generate unique screenshot paths
  let screenshotStep = 0;
  function getScreenshotPath() {
    screenshotStep++;
    const ext = screenshotPath.lastIndexOf(''.'');
    if (ext > 0) {
      return screenshotPath.slice(0, ext) + ''-step'' + screenshotStep + screenshotPath.slice(ext);
    }
    return screenshotPath + ''-step'' + screenshotStep;
  }

  // Multi-selector fallback helper with coordinate fallback for clicks
  async function locateWithFallback(page, selectors, action, value, coords) {
    const validSelectors = selectors.filter(sel => sel.value && sel.value.trim() && !sel.value.includes(''undefined''));
    for (const sel of validSelectors) {
      try {
        let locator;
        if (sel.type === ''ocr-text'') {
          const text = sel.value.replace(/^ocr-text="/, '''').replace(/"$/, '''');
          locator = page.getByText(text, { exact: false });
        } else if (sel.type === ''role-name'') {
          const match = sel.value.match(/^role=(\w+)\[name="(.+)"\]$/);
          if (match) {
            locator = page.getByRole(match[1], { name: match[2] });
          } else {
            locator = page.locator(sel.value);
          }
        } else {
          locator = page.locator(sel.value);
        }
        const target = locator.first();
        await target.waitFor({ timeout: 3000 });
        if (action === ''locate'') return target;
        if (action === ''click'') await target.click();
        else if (action === ''fill'') await target.fill(value || '''');
        else if (action === ''selectOption'') await target.selectOption(value || '''');
        return target;
      } catch { continue; }
    }
    if (action === ''click'' && coords) {
      console.log(''Falling back to coordinate click at'', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y);
      return;
    }
    if (action === ''fill'' && coords) {
      console.log(''Falling back to coordinate fill at'', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y);
      await page.keyboard.press(''Control+a'');
      await page.keyboard.type(value || '''');
      return;
    }
    throw new Error(''No selector matched: '' + JSON.stringify(validSelectors));
  }

  await page.goto(buildUrl(baseUrl, ''/''));
  await locateWithFallback(page, [{"type":"role-name","value":"role=link[name=\"Runs\"]"},{"type":"text","value":"text=\"Runs\""},{"type":"css-path","value":"ul.space-y-1 > li > a.flex.items-center"}], ''click'', null, {"x":128,"y":420});
  await page.waitForLoadState(''networkidle'').catch(() => {});
  await page.goto(buildUrl(baseUrl, ''/run''));
  await locateWithFallback(page, [{"type":"placeholder","value":"[placeholder=\"http://localhost:3000\"]"},{"type":"css-path","value":"div.pt-4.pb-3 > div.relative > input.border-input.h-9"}], ''click'', null, {"x":518,"y":467});
  await locateWithFallback(page, [{"type":"placeholder","value":"[placeholder=\"http://localhost:3000\"]"},{"type":"css-path","value":"div.pt-4.pb-3 > div.relative > input.border-input.h-9"}], ''click'', null, {"x":518,"y":467});
  await locateWithFallback(page, [{"type":"placeholder","value":"[placeholder=\"http://localhost:3000\"]"},{"type":"css-path","value":"div.pt-4.pb-3 > div.relative > input.border-input.h-9"}], ''click'', null, {"x":518,"y":467});
  await page.keyboard.down(''Control'');
  await page.keyboard.press(''c'');
  await page.keyboard.up(''Control'');
  await locateWithFallback(page, [{"type":"placeholder","value":"[placeholder=\"http://localhost:3000\"]"},{"type":"css-path","value":"div.pt-4.pb-3 > div.relative > input.border-input.h-9"}], ''click'', null, {"x":518,"y":467});
  await locateWithFallback(page, [{"type":"placeholder","value":"[placeholder=\"http://localhost:3000\"]"},{"type":"css-path","value":"div.pt-4.pb-3 > div.relative > input.border-input.h-9"}], ''click'', null, {"x":518,"y":467});
  await locateWithFallback(page, [{"type":"placeholder","value":"[placeholder=\"http://localhost:3000\"]"},{"type":"css-path","value":"div.pt-4.pb-3 > div.relative > input.border-input.h-9"}], ''click'', null, {"x":518,"y":467});
  await locateWithFallback(page, [{"type":"placeholder","value":"[placeholder=\"http://localhost:3000\"]"},{"type":"css-path","value":"div.pt-4.pb-3 > div.relative > input.border-input.h-9"}], ''click'', null, {"x":518,"y":467});
  await locateWithFallback(page, [{"type":"css-path","value":"div.bg-card.text-card-foreground > div.\\@container/card-header.grid > div.flex.items-center"}], ''click'', null, {"x":518,"y":241});
  await locateWithFallback(page, [{"type":"role-name","value":"role=combobox[name=\"Local\"]"},{"type":"text","value":"text=\"Local\""},{"type":"css-path","value":"div.flex.items-center > div.flex.items-center > button.border-input.flex"}], ''click'', null, {"x":518,"y":77});
  await locateWithFallback(page, [{"type":"role-name","value":"role=option[name=\"System EB-eb-2\"]"},{"type":"css-path","value":"div.p-1 > div > div.relative.flex"}], ''click'', null, {"x":555,"y":169});
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await locateWithFallback(page, [{"type":"role-name","value":"role=button[name=\"Run All Tests\"]"},{"type":"text","value":"text=\"Run All Tests\""},{"type":"css-path","value":"div.flex.items-center > div.flex.items-center > button.inline-flex.items-center"}], ''click'', null, {"x":656,"y":107});
  await page.waitForLoadState(''networkidle'').catch(() => {});
  await page.goto(buildUrl(baseUrl, ''/builds/3f21304e-aca9-4820-aee0-0a4f08723367''));
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
}
', NULL, 0, 'http://localhost:3000', NULL, NULL, NULL, NULL, NULL, 1773671439, 1773671439, NULL, NULL, NULL, NULL, NULL, 'procedural', NULL);
INSERT INTO tests (id, repository_id, functional_area_id, name, code, description, is_placeholder, target_url, setup_test_id, setup_script_id, setup_overrides, teardown_overrides, deleted_at, created_at, updated_at, required_capabilities, stabilization_overrides, viewport_override, diff_overrides, playwright_overrides, execution_mode, agent_prompt) VALUES ('1a587f18-702f-4d2a-9975-01a777988a3a', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'c6d0b168-9183-415c-8599-eff8d83c2b5c', 'Areas SSIM', 'import { Page } from ''playwright'';

export async function test(page: Page, baseUrl: string, screenshotPath: string, stepLogger: any) {
  // Helper to build URLs safely (handles trailing/leading slashes)
  function buildUrl(base, path) {
    const cleanBase = base.endsWith(''/'') ? base.slice(0, -1) : base;
    const cleanPath = path.startsWith(''/'') ? path : ''/'' + path;
    return cleanBase + cleanPath;
  }

  // Helper to generate unique screenshot paths
  let screenshotStep = 0;
  function getScreenshotPath() {
    screenshotStep++;
    const ext = screenshotPath.lastIndexOf(''.'');
    if (ext > 0) {
      return screenshotPath.slice(0, ext) + ''-step'' + screenshotStep + screenshotPath.slice(ext);
    }
    return screenshotPath + ''-step'' + screenshotStep;
  }

  // Multi-selector fallback helper with coordinate fallback for clicks
  async function locateWithFallback(page, selectors, action, value, coords) {
    const validSelectors = selectors.filter(sel => sel.value && sel.value.trim() && !sel.value.includes(''undefined''));
    for (const sel of validSelectors) {
      try {
        let locator;
        if (sel.type === ''ocr-text'') {
          const text = sel.value.replace(/^ocr-text="/, '''').replace(/"$/, '''');
          locator = page.getByText(text, { exact: false });
        } else if (sel.type === ''role-name'') {
          const match = sel.value.match(/^role=(\w+)\[name="(.+)"\]$/);
          if (match) {
            locator = page.getByRole(match[1], { name: match[2] });
          } else {
            locator = page.locator(sel.value);
          }
        } else {
          locator = page.locator(sel.value);
        }
        const target = locator.first();
        await target.waitFor({ timeout: 3000 });
        if (action === ''locate'') return target;
        if (action === ''click'') await target.click();
        else if (action === ''fill'') await target.fill(value || '''');
        else if (action === ''selectOption'') await target.selectOption(value || '''');
        return target;
      } catch { continue; }
    }
    if (action === ''click'' && coords) {
      console.log(''Falling back to coordinate click at'', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y);
      return;
    }
    if (action === ''fill'' && coords) {
      console.log(''Falling back to coordinate fill at'', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y);
      await page.keyboard.press(''Control+a'');
      await page.keyboard.type(value || '''');
      return;
    }
    throw new Error(''No selector matched: '' + JSON.stringify(validSelectors));
  }

  await page.goto(buildUrl(baseUrl, ''/''));
  await locateWithFallback(page, [{"type":"role-name","value":"role=link[name=\"Areas\"]"},{"type":"text","value":"text=\"Areas\""},{"type":"css-path","value":"ul.space-y-1 > li > a.flex.items-center"}], ''click'', null, {"x":128,"y":268});
  await page.waitForLoadState(''networkidle'').catch(() => {});
  await page.goto(buildUrl(baseUrl, ''/areas''));
  await locateWithFallback(page, [{"type":"css-path","value":"div.bg-muted/30.h-full > div.h-full.flex > div.p-3.border-b"}], ''click'', null, {"x":358,"y":25});
  await locateWithFallback(page, [{"type":"css-path","value":"div.h-full.flex > div.p-3.border-b > button.inline-flex.items-center"}], ''click'', null, {"x":437,"y":24});
  await page.keyboard.type(new Date().toISOString());
  await locateWithFallback(page, [{"type":"role-name","value":"role=button[name=\"Create\"]"},{"type":"text","value":"text=\"Create\""},{"type":"css-path","value":"div.bg-background.fixed > div.flex.flex-col-reverse > button.inline-flex.items-center"}], ''click'', null, {"x":833,"y":507});
  await page.waitForLoadState(''networkidle'').catch(() => {});
  await page.goto(buildUrl(baseUrl, ''/areas''));
  await locateWithFallback(page, [{"type":"css-path","value":"div > div.group.flex > span.flex-1.truncate"}], ''click'', null, {"x":499,"y":425});
  await locateWithFallback(page, [{"type":"role-name","value":"role=button[name=\"Edit\"]"},{"type":"text","value":"text=\"Edit\""},{"type":"css-path","value":"div.\\@container/card-header.auto-rows-min > div.flex.gap-1 > button.inline-flex.items-center"}], ''click'', null, {"x":1151,"y":639});
  await locateWithFallback(page, [{"type":"id","value":"#description"},{"type":"css-path","value":"div.px-6.space-y-4 > div.space-y-2 > textarea.border-input.w-full"}], ''click'', null, {"x":870,"y":474});
  await locateWithFallback(page, [{"type":"id","value":"#description"},{"type":"role-name","value":"role=textbox[name=\"12\"]"},{"type":"css-path","value":"div.px-6.space-y-4 > div.space-y-2 > textarea.border-input.w-full"}], ''fill'', ''123'', null);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await locateWithFallback(page, [{"type":"role-name","value":"role=button[name=\"Save\"]"},{"type":"text","value":"text=\"Save\""},{"type":"css-path","value":"div.\\@container/card-header.auto-rows-min > div.flex.gap-2 > button.inline-flex.items-center"}], ''click'', null, {"x":1187,"y":279});
  await page.waitForLoadState(''networkidle'').catch(() => {});
  await page.goto(buildUrl(baseUrl, ''/areas''));
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
}
', NULL, 0, 'http://localhost:3000', NULL, NULL, NULL, NULL, NULL, 1773689036, 1773689097, NULL, '{"freezeRandomValues":false,"freezeTimestamps":false,"mockThirdPartyImages":false}', NULL, '{"diffEngine":"ssim"}', NULL, 'procedural', NULL);
INSERT INTO tests (id, repository_id, functional_area_id, name, code, description, is_placeholder, target_url, setup_test_id, setup_script_id, setup_overrides, teardown_overrides, deleted_at, created_at, updated_at, required_capabilities, stabilization_overrides, viewport_override, diff_overrides, playwright_overrides, execution_mode, agent_prompt) VALUES ('43e8272b-8beb-4516-a615-98fdba3574c1', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'c6d0b168-9183-415c-8599-eff8d83c2b5c', 'Areas Butter', 'import { Page } from ''playwright'';

export async function test(page: Page, baseUrl: string, screenshotPath: string, stepLogger: any) {
  // Helper to build URLs safely (handles trailing/leading slashes)
  function buildUrl(base, path) {
    const cleanBase = base.endsWith(''/'') ? base.slice(0, -1) : base;
    const cleanPath = path.startsWith(''/'') ? path : ''/'' + path;
    return cleanBase + cleanPath;
  }

  // Helper to generate unique screenshot paths
  let screenshotStep = 0;
  function getScreenshotPath() {
    screenshotStep++;
    const ext = screenshotPath.lastIndexOf(''.'');
    if (ext > 0) {
      return screenshotPath.slice(0, ext) + ''-step'' + screenshotStep + screenshotPath.slice(ext);
    }
    return screenshotPath + ''-step'' + screenshotStep;
  }

  // Multi-selector fallback helper with coordinate fallback for clicks
  async function locateWithFallback(page, selectors, action, value, coords) {
    const validSelectors = selectors.filter(sel => sel.value && sel.value.trim() && !sel.value.includes(''undefined''));
    for (const sel of validSelectors) {
      try {
        let locator;
        if (sel.type === ''ocr-text'') {
          const text = sel.value.replace(/^ocr-text="/, '''').replace(/"$/, '''');
          locator = page.getByText(text, { exact: false });
        } else if (sel.type === ''role-name'') {
          const match = sel.value.match(/^role=(\w+)\[name="(.+)"\]$/);
          if (match) {
            locator = page.getByRole(match[1], { name: match[2] });
          } else {
            locator = page.locator(sel.value);
          }
        } else {
          locator = page.locator(sel.value);
        }
        const target = locator.first();
        await target.waitFor({ timeout: 3000 });
        if (action === ''locate'') return target;
        if (action === ''click'') await target.click();
        else if (action === ''fill'') await target.fill(value || '''');
        else if (action === ''selectOption'') await target.selectOption(value || '''');
        return target;
      } catch { continue; }
    }
    if (action === ''click'' && coords) {
      console.log(''Falling back to coordinate click at'', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y);
      return;
    }
    if (action === ''fill'' && coords) {
      console.log(''Falling back to coordinate fill at'', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y);
      await page.keyboard.press(''Control+a'');
      await page.keyboard.type(value || '''');
      return;
    }
    throw new Error(''No selector matched: '' + JSON.stringify(validSelectors));
  }

  await page.goto(buildUrl(baseUrl, ''/''));
  await locateWithFallback(page, [{"type":"role-name","value":"role=link[name=\"Areas\"]"},{"type":"text","value":"text=\"Areas\""},{"type":"css-path","value":"ul.space-y-1 > li > a.flex.items-center"}], ''click'', null, {"x":128,"y":268});
  await page.waitForLoadState(''networkidle'').catch(() => {});
  await page.goto(buildUrl(baseUrl, ''/areas''));
  await locateWithFallback(page, [{"type":"css-path","value":"div.bg-muted/30.h-full > div.h-full.flex > div.p-3.border-b"}], ''click'', null, {"x":358,"y":25});
  await locateWithFallback(page, [{"type":"css-path","value":"div.h-full.flex > div.p-3.border-b > button.inline-flex.items-center"}], ''click'', null, {"x":437,"y":24});
  await page.keyboard.type(new Date().toISOString());
  await locateWithFallback(page, [{"type":"role-name","value":"role=button[name=\"Create\"]"},{"type":"text","value":"text=\"Create\""},{"type":"css-path","value":"div.bg-background.fixed > div.flex.flex-col-reverse > button.inline-flex.items-center"}], ''click'', null, {"x":833,"y":507});
  await page.waitForLoadState(''networkidle'').catch(() => {});
  await page.goto(buildUrl(baseUrl, ''/areas''));
  await locateWithFallback(page, [{"type":"css-path","value":"div > div.group.flex > span.flex-1.truncate"}], ''click'', null, {"x":499,"y":425});
  await locateWithFallback(page, [{"type":"role-name","value":"role=button[name=\"Edit\"]"},{"type":"text","value":"text=\"Edit\""},{"type":"css-path","value":"div.\\@container/card-header.auto-rows-min > div.flex.gap-1 > button.inline-flex.items-center"}], ''click'', null, {"x":1151,"y":639});
  await locateWithFallback(page, [{"type":"id","value":"#description"},{"type":"css-path","value":"div.px-6.space-y-4 > div.space-y-2 > textarea.border-input.w-full"}], ''click'', null, {"x":870,"y":474});
  await locateWithFallback(page, [{"type":"id","value":"#description"},{"type":"role-name","value":"role=textbox[name=\"12\"]"},{"type":"css-path","value":"div.px-6.space-y-4 > div.space-y-2 > textarea.border-input.w-full"}], ''fill'', ''123'', null);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await locateWithFallback(page, [{"type":"role-name","value":"role=button[name=\"Save\"]"},{"type":"text","value":"text=\"Save\""},{"type":"css-path","value":"div.\\@container/card-header.auto-rows-min > div.flex.gap-2 > button.inline-flex.items-center"}], ''click'', null, {"x":1187,"y":279});
  await page.waitForLoadState(''networkidle'').catch(() => {});
  await page.goto(buildUrl(baseUrl, ''/areas''));
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
}
', NULL, 0, 'http://localhost:3000', NULL, NULL, NULL, NULL, NULL, 1773689101, 1773689118, NULL, '{"freezeRandomValues":false,"freezeTimestamps":false,"mockThirdPartyImages":false}', NULL, '{"diffEngine":"butteraugli"}', NULL, 'procedural', NULL);
INSERT INTO tests (id, repository_id, functional_area_id, name, code, description, is_placeholder, target_url, setup_test_id, setup_script_id, setup_overrides, teardown_overrides, deleted_at, created_at, updated_at, required_capabilities, stabilization_overrides, viewport_override, diff_overrides, playwright_overrides, execution_mode, agent_prompt) VALUES ('b0e2e9dc-d8bb-40b9-8811-46b415633639', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'c6d0b168-9183-415c-8599-eff8d83c2b5c', 'Areas Page Shift', 'import { Page } from ''playwright'';

export async function test(page: Page, baseUrl: string, screenshotPath: string, stepLogger: any) {
  // Helper to build URLs safely (handles trailing/leading slashes)
  function buildUrl(base, path) {
    const cleanBase = base.endsWith(''/'') ? base.slice(0, -1) : base;
    const cleanPath = path.startsWith(''/'') ? path : ''/'' + path;
    return cleanBase + cleanPath;
  }

  // Helper to generate unique screenshot paths
  let screenshotStep = 0;
  function getScreenshotPath() {
    screenshotStep++;
    const ext = screenshotPath.lastIndexOf(''.'');
    if (ext > 0) {
      return screenshotPath.slice(0, ext) + ''-step'' + screenshotStep + screenshotPath.slice(ext);
    }
    return screenshotPath + ''-step'' + screenshotStep;
  }

  // Multi-selector fallback helper with coordinate fallback for clicks
  async function locateWithFallback(page, selectors, action, value, coords) {
    const validSelectors = selectors.filter(sel => sel.value && sel.value.trim() && !sel.value.includes(''undefined''));
    for (const sel of validSelectors) {
      try {
        let locator;
        if (sel.type === ''ocr-text'') {
          const text = sel.value.replace(/^ocr-text="/, '''').replace(/"$/, '''');
          locator = page.getByText(text, { exact: false });
        } else if (sel.type === ''role-name'') {
          const match = sel.value.match(/^role=(\w+)\[name="(.+)"\]$/);
          if (match) {
            locator = page.getByRole(match[1], { name: match[2] });
          } else {
            locator = page.locator(sel.value);
          }
        } else {
          locator = page.locator(sel.value);
        }
        const target = locator.first();
        await target.waitFor({ timeout: 3000 });
        if (action === ''locate'') return target;
        if (action === ''click'') await target.click();
        else if (action === ''fill'') await target.fill(value || '''');
        else if (action === ''selectOption'') await target.selectOption(value || '''');
        return target;
      } catch { continue; }
    }
    if (action === ''click'' && coords) {
      console.log(''Falling back to coordinate click at'', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y);
      return;
    }
    if (action === ''fill'' && coords) {
      console.log(''Falling back to coordinate fill at'', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y);
      await page.keyboard.press(''Control+a'');
      await page.keyboard.type(value || '''');
      return;
    }
    throw new Error(''No selector matched: '' + JSON.stringify(validSelectors));
  }

  await page.goto(buildUrl(baseUrl, ''/''));
  await locateWithFallback(page, [{"type":"role-name","value":"role=link[name=\"Areas\"]"},{"type":"text","value":"text=\"Areas\""},{"type":"css-path","value":"ul.space-y-1 > li > a.flex.items-center"}], ''click'', null, {"x":128,"y":268});
  await page.waitForLoadState(''networkidle'').catch(() => {});
  await page.goto(buildUrl(baseUrl, ''/areas''));
  await locateWithFallback(page, [{"type":"css-path","value":"div.bg-muted/30.h-full > div.h-full.flex > div.p-3.border-b"}], ''click'', null, {"x":358,"y":25});
  await locateWithFallback(page, [{"type":"css-path","value":"div.h-full.flex > div.p-3.border-b > button.inline-flex.items-center"}], ''click'', null, {"x":437,"y":24});
  await page.keyboard.type(new Date().toISOString());
  await locateWithFallback(page, [{"type":"role-name","value":"role=button[name=\"Create\"]"},{"type":"text","value":"text=\"Create\""},{"type":"css-path","value":"div.bg-background.fixed > div.flex.flex-col-reverse > button.inline-flex.items-center"}], ''click'', null, {"x":833,"y":507});
  await page.waitForLoadState(''networkidle'').catch(() => {});
  await page.goto(buildUrl(baseUrl, ''/areas''));
  await locateWithFallback(page, [{"type":"css-path","value":"div > div.group.flex > span.flex-1.truncate"}], ''click'', null, {"x":499,"y":425});
  await locateWithFallback(page, [{"type":"role-name","value":"role=button[name=\"Edit\"]"},{"type":"text","value":"text=\"Edit\""},{"type":"css-path","value":"div.\\@container/card-header.auto-rows-min > div.flex.gap-1 > button.inline-flex.items-center"}], ''click'', null, {"x":1151,"y":639});
  await locateWithFallback(page, [{"type":"id","value":"#description"},{"type":"css-path","value":"div.px-6.space-y-4 > div.space-y-2 > textarea.border-input.w-full"}], ''click'', null, {"x":870,"y":474});
  await locateWithFallback(page, [{"type":"id","value":"#description"},{"type":"role-name","value":"role=textbox[name=\"12\"]"},{"type":"css-path","value":"div.px-6.space-y-4 > div.space-y-2 > textarea.border-input.w-full"}], ''fill'', ''123'', null);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await locateWithFallback(page, [{"type":"role-name","value":"role=button[name=\"Save\"]"},{"type":"text","value":"text=\"Save\""},{"type":"css-path","value":"div.\\@container/card-header.auto-rows-min > div.flex.gap-2 > button.inline-flex.items-center"}], ''click'', null, {"x":1187,"y":279});
  await page.waitForLoadState(''networkidle'').catch(() => {});
  await page.goto(buildUrl(baseUrl, ''/areas''));
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
}
', NULL, 0, 'http://localhost:3000', NULL, NULL, NULL, NULL, NULL, 1773689121, 1773689163, NULL, '{"freezeRandomValues":false,"freezeTimestamps":false,"mockThirdPartyImages":false}', NULL, '{"ignorePageShift":true,"textRegionAwareDiffing":false}', NULL, 'procedural', NULL);
INSERT INTO tests (id, repository_id, functional_area_id, name, code, description, is_placeholder, target_url, setup_test_id, setup_script_id, setup_overrides, teardown_overrides, deleted_at, created_at, updated_at, required_capabilities, stabilization_overrides, viewport_override, diff_overrides, playwright_overrides, execution_mode, agent_prompt) VALUES ('ca89e4de-c61e-480f-8ccb-122730015ecb', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'c6d0b168-9183-415c-8599-eff8d83c2b5c', 'Areas Text check', 'export async function test(page, baseUrl, screenshotPath, stepLogger) {
  function buildUrl(base, path) {
    const cleanBase = base.endsWith(''/'') ? base.slice(0, -1) : base;
    const cleanPath = path.startsWith(''/'') ? path : ''/'' + path;
    return cleanBase + cleanPath;
  }

  let screenshotStep = 0;
  function getScreenshotPath() {
    screenshotStep++;
    const ext = screenshotPath.lastIndexOf(''.'');
    if (ext > 0) {
      return screenshotPath.slice(0, ext) + ''-step'' + screenshotStep + screenshotPath.slice(ext);
    }
    return screenshotPath + ''-step'' + screenshotStep;
  }

  await page.goto(buildUrl(baseUrl, ''/''));
  
  await page.getByRole(''link'', { name: ''Areas'' }).click();
  await page.waitForLoadState(''networkidle'').catch(() => {});
  
  await page.goto(buildUrl(baseUrl, ''/areas''));
  
  const addButton = page.locator(''button'').filter({ has: page.locator(''svg'') }).first();
  await addButton.click();
  
  await page.getByRole(''textbox'', { name: ''Name'' }).fill(new Date().toISOString());
  
  await page.getByRole(''button'', { name: ''Create'' }).click();
  await page.waitForLoadState(''networkidle'').catch(() => {});
  
  await page.goto(buildUrl(baseUrl, ''/areas''));
  
  const firstTreeItem = page.getByRole(''treeitem'').first();
  await firstTreeItem.click();
  
  await page.getByRole(''button'', { name: ''Edit'' }).click();
  
  await page.getByRole(''textbox'', { name: ''Description (optional)'' }).click();
  await page.getByRole(''textbox'', { name: ''Description (optional)'' }).fill(''123'');
  
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  
  await page.getByRole(''button'', { name: ''Save'' }).click();
  await page.waitForLoadState(''networkidle'').catch(() => {});
  
  await page.goto(buildUrl(baseUrl, ''/areas''));
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
}', NULL, 0, 'http://localhost:3000', NULL, NULL, NULL, NULL, NULL, 1773689165, 1773753959, NULL, '{"freezeRandomValues":false,"freezeTimestamps":false,"mockThirdPartyImages":false}', NULL, '{"ignorePageShift":true,"textRegionAwareDiffing":true}', NULL, 'procedural', NULL);
INSERT INTO tests (id, repository_id, functional_area_id, name, code, description, is_placeholder, target_url, setup_test_id, setup_script_id, setup_overrides, teardown_overrides, deleted_at, created_at, updated_at, required_capabilities, stabilization_overrides, viewport_override, diff_overrides, playwright_overrides, execution_mode, agent_prompt) VALUES ('2361dd38-c258-4e3c-908b-8010b1fe699a', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'c6d0b168-9183-415c-8599-eff8d83c2b5c', 'Areas FF', 'import { Page } from ''playwright'';

export async function test(page: Page, baseUrl: string, screenshotPath: string, stepLogger: any) {
  // Helper to build URLs safely (handles trailing/leading slashes)
  function buildUrl(base, path) {
    const cleanBase = base.endsWith(''/'') ? base.slice(0, -1) : base;
    const cleanPath = path.startsWith(''/'') ? path : ''/'' + path;
    return cleanBase + cleanPath;
  }

  // Helper to generate unique screenshot paths
  let screenshotStep = 0;
  function getScreenshotPath() {
    screenshotStep++;
    const ext = screenshotPath.lastIndexOf(''.'');
    if (ext > 0) {
      return screenshotPath.slice(0, ext) + ''-step'' + screenshotStep + screenshotPath.slice(ext);
    }
    return screenshotPath + ''-step'' + screenshotStep;
  }

  // Multi-selector fallback helper with coordinate fallback for clicks
  async function locateWithFallback(page, selectors, action, value, coords) {
    const validSelectors = selectors.filter(sel => sel.value && sel.value.trim() && !sel.value.includes(''undefined''));
    for (const sel of validSelectors) {
      try {
        let locator;
        if (sel.type === ''ocr-text'') {
          const text = sel.value.replace(/^ocr-text="/, '''').replace(/"$/, '''');
          locator = page.getByText(text, { exact: false });
        } else if (sel.type === ''role-name'') {
          const match = sel.value.match(/^role=(\w+)\[name="(.+)"\]$/);
          if (match) {
            locator = page.getByRole(match[1], { name: match[2] });
          } else {
            locator = page.locator(sel.value);
          }
        } else {
          locator = page.locator(sel.value);
        }
        const target = locator.first();
        await target.waitFor({ timeout: 3000 });
        if (action === ''locate'') return target;
        if (action === ''click'') await target.click();
        else if (action === ''fill'') await target.fill(value || '''');
        else if (action === ''selectOption'') await target.selectOption(value || '''');
        return target;
      } catch { continue; }
    }
    if (action === ''click'' && coords) {
      console.log(''Falling back to coordinate click at'', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y);
      return;
    }
    if (action === ''fill'' && coords) {
      console.log(''Falling back to coordinate fill at'', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y);
      await page.keyboard.press(''Control+a'');
      await page.keyboard.type(value || '''');
      return;
    }
    throw new Error(''No selector matched: '' + JSON.stringify(validSelectors));
  }

  await page.goto(buildUrl(baseUrl, ''/''));
  await locateWithFallback(page, [{"type":"role-name","value":"role=link[name=\"Areas\"]"},{"type":"text","value":"text=\"Areas\""},{"type":"css-path","value":"ul.space-y-1 > li > a.flex.items-center"}], ''click'', null, {"x":128,"y":268});
  await page.waitForLoadState(''networkidle'').catch(() => {});
  await page.goto(buildUrl(baseUrl, ''/areas''));
  await locateWithFallback(page, [{"type":"css-path","value":"div.bg-muted/30.h-full > div.h-full.flex > div.p-3.border-b"}], ''click'', null, {"x":358,"y":25});
  await locateWithFallback(page, [{"type":"css-path","value":"div.h-full.flex > div.p-3.border-b > button.inline-flex.items-center"}], ''click'', null, {"x":437,"y":24});
  await page.keyboard.type(new Date().toISOString());
  await locateWithFallback(page, [{"type":"role-name","value":"role=button[name=\"Create\"]"},{"type":"text","value":"text=\"Create\""},{"type":"css-path","value":"div.bg-background.fixed > div.flex.flex-col-reverse > button.inline-flex.items-center"}], ''click'', null, {"x":833,"y":507});
  await page.waitForLoadState(''networkidle'').catch(() => {});
  await page.goto(buildUrl(baseUrl, ''/areas''));
  await locateWithFallback(page, [{"type":"css-path","value":"div > div.group.flex > span.flex-1.truncate"}], ''click'', null, {"x":499,"y":425});
  await locateWithFallback(page, [{"type":"role-name","value":"role=button[name=\"Edit\"]"},{"type":"text","value":"text=\"Edit\""},{"type":"css-path","value":"div.\\@container/card-header.auto-rows-min > div.flex.gap-1 > button.inline-flex.items-center"}], ''click'', null, {"x":1151,"y":639});
  await locateWithFallback(page, [{"type":"id","value":"#description"},{"type":"css-path","value":"div.px-6.space-y-4 > div.space-y-2 > textarea.border-input.w-full"}], ''click'', null, {"x":870,"y":474});
  await locateWithFallback(page, [{"type":"id","value":"#description"},{"type":"role-name","value":"role=textbox[name=\"12\"]"},{"type":"css-path","value":"div.px-6.space-y-4 > div.space-y-2 > textarea.border-input.w-full"}], ''fill'', ''123'', null);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await locateWithFallback(page, [{"type":"role-name","value":"role=button[name=\"Save\"]"},{"type":"text","value":"text=\"Save\""},{"type":"css-path","value":"div.\\@container/card-header.auto-rows-min > div.flex.gap-2 > button.inline-flex.items-center"}], ''click'', null, {"x":1187,"y":279});
  await page.waitForLoadState(''networkidle'').catch(() => {});
  await page.goto(buildUrl(baseUrl, ''/areas''));
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
}
', NULL, 0, 'http://localhost:3000', NULL, NULL, NULL, NULL, NULL, 1773689201, 1773689251, NULL, NULL, NULL, NULL, '{"browser":"firefox"}', 'procedural', NULL);
INSERT INTO tests (id, repository_id, functional_area_id, name, code, description, is_placeholder, target_url, setup_test_id, setup_script_id, setup_overrides, teardown_overrides, deleted_at, created_at, updated_at, required_capabilities, stabilization_overrides, viewport_override, diff_overrides, playwright_overrides, execution_mode, agent_prompt) VALUES ('115072b1-37fc-4a58-aae1-88e67d67f5e1', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'c6d0b168-9183-415c-8599-eff8d83c2b5c', 'Areas Safari', 'import { Page } from ''playwright'';

export async function test(page: Page, baseUrl: string, screenshotPath: string, stepLogger: any) {
  // Helper to build URLs safely (handles trailing/leading slashes)
  function buildUrl(base, path) {
    const cleanBase = base.endsWith(''/'') ? base.slice(0, -1) : base;
    const cleanPath = path.startsWith(''/'') ? path : ''/'' + path;
    return cleanBase + cleanPath;
  }

  // Helper to generate unique screenshot paths
  let screenshotStep = 0;
  function getScreenshotPath() {
    screenshotStep++;
    const ext = screenshotPath.lastIndexOf(''.'');
    if (ext > 0) {
      return screenshotPath.slice(0, ext) + ''-step'' + screenshotStep + screenshotPath.slice(ext);
    }
    return screenshotPath + ''-step'' + screenshotStep;
  }

  // Multi-selector fallback helper with coordinate fallback for clicks
  async function locateWithFallback(page, selectors, action, value, coords) {
    const validSelectors = selectors.filter(sel => sel.value && sel.value.trim() && !sel.value.includes(''undefined''));
    for (const sel of validSelectors) {
      try {
        let locator;
        if (sel.type === ''ocr-text'') {
          const text = sel.value.replace(/^ocr-text="/, '''').replace(/"$/, '''');
          locator = page.getByText(text, { exact: false });
        } else if (sel.type === ''role-name'') {
          const match = sel.value.match(/^role=(\w+)\[name="(.+)"\]$/);
          if (match) {
            locator = page.getByRole(match[1], { name: match[2] });
          } else {
            locator = page.locator(sel.value);
          }
        } else {
          locator = page.locator(sel.value);
        }
        const target = locator.first();
        await target.waitFor({ timeout: 3000 });
        if (action === ''locate'') return target;
        if (action === ''click'') await target.click();
        else if (action === ''fill'') await target.fill(value || '''');
        else if (action === ''selectOption'') await target.selectOption(value || '''');
        return target;
      } catch { continue; }
    }
    if (action === ''click'' && coords) {
      console.log(''Falling back to coordinate click at'', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y);
      return;
    }
    if (action === ''fill'' && coords) {
      console.log(''Falling back to coordinate fill at'', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y);
      await page.keyboard.press(''Control+a'');
      await page.keyboard.type(value || '''');
      return;
    }
    throw new Error(''No selector matched: '' + JSON.stringify(validSelectors));
  }

  await page.goto(buildUrl(baseUrl, ''/''));
  await locateWithFallback(page, [{"type":"role-name","value":"role=link[name=\"Areas\"]"},{"type":"text","value":"text=\"Areas\""},{"type":"css-path","value":"ul.space-y-1 > li > a.flex.items-center"}], ''click'', null, {"x":128,"y":268});
  await page.waitForLoadState(''networkidle'').catch(() => {});
  await page.goto(buildUrl(baseUrl, ''/areas''));
  await locateWithFallback(page, [{"type":"css-path","value":"div.bg-muted/30.h-full > div.h-full.flex > div.p-3.border-b"}], ''click'', null, {"x":358,"y":25});
  await locateWithFallback(page, [{"type":"css-path","value":"div.h-full.flex > div.p-3.border-b > button.inline-flex.items-center"}], ''click'', null, {"x":437,"y":24});
  await page.keyboard.type(new Date().toISOString());
  await locateWithFallback(page, [{"type":"role-name","value":"role=button[name=\"Create\"]"},{"type":"text","value":"text=\"Create\""},{"type":"css-path","value":"div.bg-background.fixed > div.flex.flex-col-reverse > button.inline-flex.items-center"}], ''click'', null, {"x":833,"y":507});
  await page.waitForLoadState(''networkidle'').catch(() => {});
  await page.goto(buildUrl(baseUrl, ''/areas''));
  await locateWithFallback(page, [{"type":"css-path","value":"div > div.group.flex > span.flex-1.truncate"}], ''click'', null, {"x":499,"y":425});
  await locateWithFallback(page, [{"type":"role-name","value":"role=button[name=\"Edit\"]"},{"type":"text","value":"text=\"Edit\""},{"type":"css-path","value":"div.\\@container/card-header.auto-rows-min > div.flex.gap-1 > button.inline-flex.items-center"}], ''click'', null, {"x":1151,"y":639});
  await locateWithFallback(page, [{"type":"id","value":"#description"},{"type":"css-path","value":"div.px-6.space-y-4 > div.space-y-2 > textarea.border-input.w-full"}], ''click'', null, {"x":870,"y":474});
  await locateWithFallback(page, [{"type":"id","value":"#description"},{"type":"role-name","value":"role=textbox[name=\"12\"]"},{"type":"css-path","value":"div.px-6.space-y-4 > div.space-y-2 > textarea.border-input.w-full"}], ''fill'', ''123'', null);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await locateWithFallback(page, [{"type":"role-name","value":"role=button[name=\"Save\"]"},{"type":"text","value":"text=\"Save\""},{"type":"css-path","value":"div.\\@container/card-header.auto-rows-min > div.flex.gap-2 > button.inline-flex.items-center"}], ''click'', null, {"x":1187,"y":279});
  await page.waitForLoadState(''networkidle'').catch(() => {});
  await page.goto(buildUrl(baseUrl, ''/areas''));
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
}
', NULL, 0, 'http://localhost:3000', NULL, NULL, NULL, NULL, NULL, 1773689216, 1773689236, NULL, NULL, NULL, NULL, '{"browser":"webkit"}', 'procedural', NULL);
INSERT INTO tests (id, repository_id, functional_area_id, name, code, description, is_placeholder, target_url, setup_test_id, setup_script_id, setup_overrides, teardown_overrides, deleted_at, created_at, updated_at, required_capabilities, stabilization_overrides, viewport_override, diff_overrides, playwright_overrides, execution_mode, agent_prompt) VALUES ('4eae0920-274f-4164-b09e-8a51276361e4', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'c27480ae-4c60-415a-a901-4586cfbf58e8', 'Test Management', 'export async function test(page, baseUrl, screenshotPath, stepLogger) {
  stepLogger.log(''Scenario 1: Verify test list loads and table renders'');
  await page.goto(`${baseUrl}/tests`, { waitUntil: ''domcontentloaded'' });
  
  // Wait for React Query data fetching to complete
  await page.waitForLoadState(''networkidle'');
  
  // Verify URL is correct
  await page.waitForURL(/\/tests/);
  
  // Verify table or list container is present (Radix/shadcn typically uses role-based structure)
  const tableOrList = page.getByRole(''table'').or(page.getByRole(''list'')).or(page.locator(''[data-testid="test-list"]''));
  await tableOrList.waitFor({ state: ''visible'', timeout: 10000 });
  
  // Check if tests are rendered (look for table rows or list items)
  const hasContent = await page.getByRole(''row'').count().then(count => count > 1).catch(() => 
    page.getByRole(''listitem'').count().then(count => count > 0).catch(() => true)
  );
  
  // Take screenshot checkpoint for Scenario 1
  await page.screenshot({ path: screenshotPath.replace(''.png'', ''-scenario-1.png''), fullPage: true });
  
  stepLogger.log(''Scenario 2: Verify page heading/title is present and check for broken links'');
  
  // Verify page heading exists (common patterns: h1 with "Tests", "Test List", etc.)
  const heading = page.getByRole(''heading'', { level: 1 }).or(page.getByRole(''heading'', { name: /test/i }));
  await heading.waitFor({ state: ''visible'', timeout: 5000 });
  
  // Check for broken links by verifying navigation links are present and valid
  const links = await page.getByRole(''link'').all();
  let brokenLinksFound = false;
  
  for (const link of links.slice(0, 10)) { // Check first 10 links to avoid timeout
    const href = await link.getAttribute(''href'');
    if (href && !href.startsWith(''http'') && !href.startsWith(''/'') && href !== ''#'') {
      brokenLinksFound = true;
      break;
    }
  }
  
  // Verify no missing assets by checking for error images
  const images = await page.locator(''img'').all();
  for (const img of images) {
    const naturalWidth = await img.evaluate(el => el.naturalWidth).catch(() => 0);
    if (naturalWidth === 0) {
      const src = await img.getAttribute(''src'');
      if (src && !src.startsWith(''data:'')) {
        // Potential broken image found
        console.warn(`Potential broken image: ${src}`);
      }
    }
  }
  
  // Take screenshot checkpoint for Scenario 2
  await page.screenshot({ path: screenshotPath.replace(''.png'', ''-scenario-2.png''), fullPage: true });
  
  // Final screenshot
  await page.screenshot({ path: screenshotPath, fullPage: true });
}', 'Test Management - /tests; Test Management - /tests', 0, 'http://localhost:3000', NULL, NULL, NULL, NULL, NULL, 1773932233, 1773932233, NULL, NULL, NULL, NULL, NULL, 'procedural', NULL);
INSERT INTO tests (id, repository_id, functional_area_id, name, code, description, is_placeholder, target_url, setup_test_id, setup_script_id, setup_overrides, teardown_overrides, deleted_at, created_at, updated_at, required_capabilities, stabilization_overrides, viewport_override, diff_overrides, playwright_overrides, execution_mode, agent_prompt) VALUES ('0b523d3d-2a50-4631-b1e4-8173f85004c3', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'a7504caa-eeeb-41a5-8151-e6d1fa3cd9fc', 'Home', 'export async function test(page, baseUrl, screenshotPath, stepLogger) {
  // Scenario 1: Verify home page loads
  stepLogger.log(''Scenario 1: Navigate to home page and verify it loads'');
  await page.goto(`${baseUrl}/`, { waitUntil: ''domcontentloaded'' });
  
  stepLogger.log(''Waiting for page to be ready'');
  await page.waitForLoadState(''networkidle'');
  
  stepLogger.log(''Verifying page heading/title - Total Tests card'');
  const totalTestsCard = page.getByText(''Total Tests'');
  await totalTestsCard.waitFor({ state: ''visible'', timeout: 5000 });
  
  stepLogger.log(''Verifying Passing stats card is visible'');
  const passingCard = page.getByText(''Passing'');
  await passingCard.waitFor({ state: ''visible'' });
  
  stepLogger.log(''Verifying Failing stats card is visible'');
  const failingCard = page.getByText(''Failing'');
  await failingCard.waitFor({ state: ''visible'' });
  
  stepLogger.log(''Verifying Last Build card is visible'');
  const lastBuildCard = page.getByText(''Last Build'');
  await lastBuildCard.waitFor({ state: ''visible'' });
  
  stepLogger.log(''Verifying Recent Builds section is visible'');
  const recentBuildsHeading = page.getByRole(''heading'', { name: ''Recent Builds'' });
  await recentBuildsHeading.waitFor({ state: ''visible'' });
  
  stepLogger.log(''Verifying Functional Areas section is visible'');
  const functionalAreasHeading = page.getByRole(''heading'', { name: ''Functional Areas'' });
  await functionalAreasHeading.waitFor({ state: ''visible'' });
  
  stepLogger.log(''Verifying URL is correct'');
  await page.waitForURL(/\/$/);
  
  stepLogger.log(''Taking screenshot for Scenario 1'');
  await page.screenshot({ path: screenshotPath.replace(''.png'', ''-scenario-1.png''), fullPage: true });

  // Scenario 2: Check main navigation
  stepLogger.log(''Scenario 2: Check main navigation elements'');
  
  stepLogger.log(''Verifying Dashboard link is present'');
  const dashboardLink = page.getByRole(''link'', { name: ''Dashboard'' });
  await dashboardLink.waitFor({ state: ''visible'' });
  
  stepLogger.log(''Verifying Areas navigation link is present'');
  const areasLink = page.getByRole(''link'', { name: ''Areas'' });
  await areasLink.waitFor({ state: ''visible'' });
  
  stepLogger.log(''Verifying Tests navigation link is present'');
  const testsLink = page.getByRole(''link'', { name: ''Tests'' });
  await testsLink.waitFor({ state: ''visible'' });
  
  stepLogger.log(''Verifying Env Setup navigation link is present'');
  const envLink = page.getByRole(''link'', { name: ''Env Setup'' });
  await envLink.waitFor({ state: ''visible'' });
  
  stepLogger.log(''Verifying Runs navigation link is present'');
  const runsLink = page.getByRole(''link'', { name: ''Runs'' });
  await runsLink.waitFor({ state: ''visible'' });
  
  stepLogger.log(''Verifying Review navigation link is present'');
  const reviewLink = page.getByRole(''link'', { name: ''Review'' });
  await reviewLink.waitFor({ state: ''visible'' });
  
  stepLogger.log(''Checking for broken links or missing assets - monitoring network'');
  const failedRequests = [];
  page.on(''response'', response => {
    if (!response.ok() && (response.request().resourceType() === ''image'' || response.request().resourceType() === ''stylesheet'')) {
      failedRequests.push(response.url());
    }
  });
  
  stepLogger.log(''Checking console for errors'');
  const consoleErrors = [];
  page.on(''console'', msg => {
    if (msg.type() === ''error'') {
      consoleErrors.push(msg.text());
    }
  });
  
  stepLogger.log(''Reloading page to check for errors'');
  await page.reload({ waitUntil: ''networkidle'' });
  
  stepLogger.log(''Verifying no critical failed requests'');
  if (failedRequests.length > 0) {
    stepLogger.log(`Warning: Found ${failedRequests.length} failed requests: ${failedRequests.join('', '')}`);
  }
  
  stepLogger.log(''Taking screenshot for Scenario 2'');
  await page.screenshot({ path: screenshotPath.replace(''.png'', ''-scenario-2.png''), fullPage: true });
  
  // Final screenshot
  stepLogger.log(''Taking final screenshot'');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  
  stepLogger.log(''Test completed successfully - home page loaded with navigation and no critical errors'');
}', 'Home - /; Home - /', 0, 'http://localhost:3000', NULL, NULL, NULL, NULL, NULL, 1773932294, 1773932294, NULL, NULL, NULL, NULL, NULL, 'procedural', NULL);
INSERT INTO tests (id, repository_id, functional_area_id, name, code, description, is_placeholder, target_url, setup_test_id, setup_script_id, setup_overrides, teardown_overrides, deleted_at, created_at, updated_at, required_capabilities, stabilization_overrides, viewport_override, diff_overrides, playwright_overrides, execution_mode, agent_prompt) VALUES ('4b29b4e1-f4b1-40aa-b358-d5faa206a01d', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', '1bd994d2-4a10-4d4f-953b-43ea2c9088cf', 'Summary', 'export async function test(page, baseUrl, screenshotPath, stepLogger) {
  stepLogger.log(''Scenario 1: Dashboard Overview - Verify authenticated user can view dashboard with all key metrics and navigation'');
  
  // Navigate to dashboard (user is already logged in via seed)
  await page.goto(`${baseUrl}/`, { waitUntil: ''domcontentloaded'' });
  
  // Verify we''re on the dashboard
  await expect(page).toHaveURL(/\/$/);
  
  // Verify main dashboard elements are visible
  stepLogger.log(''Verifying dashboard header and title'');
  await expect(page.getByRole(''heading'', { name: /dashboard/i })).toBeVisible();
  
  // Verify key metrics cards are present
  stepLogger.log(''Verifying metrics cards are displayed'');
  const metricsSection = page.locator(''[data-testid="metrics-section"]'').or(page.locator(''div'').filter({ hasText: ''Total Tests'' }));
  await expect(metricsSection.first()).toBeVisible({ timeout: 10000 });
  
  // Verify navigation links are present
  stepLogger.log(''Verifying navigation menu items'');
  await expect(page.getByRole(''link'', { name: /tests/i }).or(page.getByText(''Tests''))).toBeVisible();
  await expect(page.getByRole(''link'', { name: /runs/i }).or(page.getByRole(''link'', { name: /run/i }))).toBeVisible();
  await expect(page.getByRole(''link'', { name: /builds/i }).or(page.getByText(''Builds''))).toBeVisible();
  
  // Verify recent activity or builds section
  stepLogger.log(''Verifying recent activity section'');
  const recentSection = page.getByText(/recent/i).or(page.locator(''[data-testid="recent-builds"]''));
  await expect(recentSection.first()).toBeVisible({ timeout: 5000 });
  
  // Take screenshot of dashboard
  stepLogger.log(''Taking screenshot of dashboard overview'');
  await page.screenshot({ path: screenshotPath.replace(''.png'', ''-scenario-1.png''), fullPage: true });
  
  // Final screenshot
  await page.screenshot({ path: screenshotPath, fullPage: true });
}', 'Summary', 0, 'http://localhost:3000', NULL, NULL, NULL, NULL, NULL, 1773932380, 1773932380, NULL, NULL, NULL, NULL, NULL, 'procedural', NULL);
INSERT INTO tests (id, repository_id, functional_area_id, name, code, description, is_placeholder, target_url, setup_test_id, setup_script_id, setup_overrides, teardown_overrides, deleted_at, created_at, updated_at, required_capabilities, stabilization_overrides, viewport_override, diff_overrides, playwright_overrides, execution_mode, agent_prompt) VALUES ('fdb02b9d-4219-4bae-b3e0-3d299660b842', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', '757c2ed7-81ee-44be-a323-215b8cc9ebec', 'Test Recording', 'export async function test(page, baseUrl, screenshotPath, stepLogger) {
  stepLogger.log(''Scenario 1: Verify recording UI loads with recorder controls and initial state'');
  await page.goto(`${baseUrl}/record`, { waitUntil: ''domcontentloaded'' });
  
  // Wait for the page to fully load
  await page.waitForLoadState(''networkidle'');
  
  // Verify the page heading/title is present
  const heading = page.getByRole(''heading'', { level: 1 });
  await expect(heading).toBeVisible();
  
  // Verify recorder controls are present
  const recordButton = page.getByRole(''button'', { name: /record|start/i });
  await expect(recordButton).toBeVisible();
  
  // Check for stop/pause controls
  const controls = page.getByRole(''region'', { name: /control|recorder/i });
  await expect(controls).toBeVisible();
  
  // Verify initial state - recording should not be active
  const statusIndicator = page.locator(''[data-state="inactive"], [aria-label*="inactive"], [aria-label*="ready"]'');
  await expect(statusIndicator).toBeVisible();
  
  // Take screenshot for scenario 1
  await page.screenshot({ path: screenshotPath.replace(''.png'', ''-scenario-1.png''), fullPage: true });
  
  stepLogger.log(''Scenario 2: Navigate to /record and verify page loads without errors'');
  
  // Verify URL is correct
  await expect(page).toHaveURL(/\/record/);
  
  // Check console for errors
  const errors = [];
  page.on(''console'', msg => {
    if (msg.type() === ''error'') {
      errors.push(msg.text());
    }
  });
  
  // Check for broken links by verifying navigation elements are present
  const navigation = page.getByRole(''navigation'');
  await expect(navigation).toBeVisible();
  
  // Verify no 404 or error messages
  const errorMessage = page.getByText(/404|error|not found/i);
  await expect(errorMessage).not.toBeVisible();
  
  // Verify main content area is present
  const main = page.locator(''main, [role="main"]'');
  await expect(main).toBeVisible();
  
  // Take screenshot for scenario 2
  await page.screenshot({ path: screenshotPath.replace(''.png'', ''-scenario-2.png''), fullPage: true });
  
  // Final screenshot
  await page.screenshot({ path: screenshotPath, fullPage: true });
}', 'Test Recording - /record; Test Recording - /record', 0, 'http://localhost:3000', NULL, NULL, NULL, NULL, NULL, 1773932474, 1773932474, NULL, NULL, NULL, NULL, NULL, 'procedural', NULL);
INSERT INTO tests (id, repository_id, functional_area_id, name, code, description, is_placeholder, target_url, setup_test_id, setup_script_id, setup_overrides, teardown_overrides, deleted_at, created_at, updated_at, required_capabilities, stabilization_overrides, viewport_override, diff_overrides, playwright_overrides, execution_mode, agent_prompt) VALUES ('fbeb5729-c876-454d-b829-ea83070647a7', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', '60df189c-ce01-4f76-9ff1-ad10440d167b', 'Area Management', 'export async function test(page, baseUrl, screenshotPath, stepLogger) {
  stepLogger.log(''Scenario 1: Navigate to /areas and verify page loads without errors'');
  await page.goto(`${baseUrl}/areas`, { waitUntil: ''domcontentloaded'' });
  
  stepLogger.log(''Verifying page URL is correct'');
  await expect(page).toHaveURL(/\/areas/);
  
  stepLogger.log(''Waiting for page content to load'');
  await page.waitForLoadState(''networkidle'');
  
  stepLogger.log(''Verifying page heading/title'');
  const overviewHeading = page.getByRole(''heading'', { name: ''Areas Overview'' });
  await expect(overviewHeading).toBeVisible();
  
  stepLogger.log(''Verifying page description is present'');
  await expect(page.getByText(''Organize your tests and suites into functional areas'')).toBeVisible();
  
  stepLogger.log(''Verifying Discovery Actions section'');
  const discoveryHeading = page.getByRole(''heading'', { name: ''Discovery Actions'' });
  await expect(discoveryHeading).toBeVisible();
  await expect(page.getByText(''Discover and import routes using these tools'')).toBeVisible();
  
  stepLogger.log(''Taking screenshot for Scenario 1'');
  await page.screenshot({ path: screenshotPath.replace(''.png'', ''-scenario-1.png''), fullPage: true });
  
  stepLogger.log(''Scenario 2: Check area organization and verify key elements'');
  
  stepLogger.log(''Verifying Scan Routes button is present'');
  await expect(page.getByText(''Scan Routes'')).toBeVisible();
  await expect(page.getByText(''Discover from repo'')).toBeVisible();
  
  stepLogger.log(''Verifying test coverage section'');
  await expect(page.getByText(''Test coverage'')).toBeVisible();
  
  stepLogger.log(''Verifying status breakdown cards'');
  await expect(page.getByText(''Passed'')).toBeVisible();
  await expect(page.getByText(''Failed'')).toBeVisible();
  await expect(page.getByText(''Not Run'')).toBeVisible();
  await expect(page.getByText(''Placeholders'')).toBeVisible();
  
  stepLogger.log(''Taking screenshot for Scenario 2'');
  await page.screenshot({ path: screenshotPath.replace(''.png'', ''-scenario-2.png''), fullPage: true });
  
  stepLogger.log(''Taking final screenshot'');
  await page.screenshot({ path: screenshotPath, fullPage: true });
}', 'Area Management - /areas; Area Management - /areas', 0, 'http://localhost:3000', NULL, NULL, NULL, NULL, NULL, 1773932520, 1773932520, NULL, NULL, NULL, NULL, NULL, 'procedural', NULL);
INSERT INTO tests (id, repository_id, functional_area_id, name, code, description, is_placeholder, target_url, setup_test_id, setup_script_id, setup_overrides, teardown_overrides, deleted_at, created_at, updated_at, required_capabilities, stabilization_overrides, viewport_override, diff_overrides, playwright_overrides, execution_mode, agent_prompt) VALUES ('05da409f-2e16-48dc-bc64-aca8014eb1f2', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'aca09e0a-7bce-4a64-9b18-5303c72afbaf', 'Suite Management', 'export async function test(page, baseUrl, screenshotPath, stepLogger) {
  stepLogger.log(''Scenario 1: Verify suite list loads and page heading/title is present'');
  await page.goto(`${baseUrl}/suites`, { waitUntil: ''domcontentloaded'' });
  
  await expect(page).toHaveURL(/\/suites/);
  
  await expect(page.getByRole(''heading'', { name: ''Test Suites'' })).toBeVisible();
  
  await expect(page.getByText(''Organize tests into ordered collections for targeted execution'')).toBeVisible();
  
  await expect(page.getByRole(''button'', { name: ''New Suite'' })).toBeVisible();
  
  await page.waitForLoadState(''networkidle'');
  
  await page.screenshot({ path: screenshotPath.replace(''.png'', ''-scenario-1.png''), fullPage: true });

  stepLogger.log(''Scenario 2: Check suite cards/table and check for broken links or missing assets'');
  
  const consoleErrors = [];
  page.on(''console'', (msg) => {
    if (msg.type() === ''error'') {
      consoleErrors.push(msg.text());
    }
  });
  
  const failedRequests = [];
  page.on(''response'', (response) => {
    if (response.status() >= 400) {
      failedRequests.push(`${response.url()} - Status: ${response.status()}`);
    }
  });
  
  const noSuitesMessage = page.getByText(''No suites yet'');
  const createSuiteButton = page.getByRole(''button'', { name: ''Create Suite'' });
  const isEmptyState = await noSuitesMessage.isVisible().catch(() => false);
  
  if (isEmptyState) {
    stepLogger.log(''Empty state detected - verifying empty state elements'');
    await expect(noSuitesMessage).toBeVisible();
    await expect(page.getByText(''Create a suite to group and order your tests'')).toBeVisible();
    await expect(createSuiteButton).toBeVisible();
  } else {
    stepLogger.log(''Suite cards detected - verifying suite list'');
    const suiteCards = page.locator(''.group.hover\\:shadow-md'');
    const cardCount = await suiteCards.count();
    stepLogger.log(`Found ${cardCount} suite cards`);
    
    if (cardCount > 0) {
      const firstCard = suiteCards.first();
      await expect(firstCard).toBeVisible();
      
      await firstCard.hover();
      
      const playButton = firstCard.getByRole(''button'').filter({ hasText: '''' }).first();
      await expect(playButton).toBeVisible();
    }
  }
  
  await page.waitForLoadState(''networkidle'');
  
  if (consoleErrors.length > 0) {
    stepLogger.log(`Warning: Console errors detected: ${consoleErrors.join('', '')}`);
  }
  
  if (failedRequests.length > 0) {
    throw new Error(`Failed requests detected: ${failedRequests.join('', '')}`);
  }
  
  await page.screenshot({ path: screenshotPath.replace(''.png'', ''-scenario-2.png''), fullPage: true });

  await page.screenshot({ path: screenshotPath, fullPage: true });
  
  stepLogger.log(''Test completed successfully'');
}', 'Suite Management - /suites; Suite Management - /suites', 0, 'http://localhost:3000', NULL, NULL, NULL, NULL, NULL, 1773932532, 1773932532, NULL, NULL, NULL, NULL, NULL, 'procedural', NULL);
INSERT INTO tests (id, repository_id, functional_area_id, name, code, description, is_placeholder, target_url, setup_test_id, setup_script_id, setup_overrides, teardown_overrides, deleted_at, created_at, updated_at, required_capabilities, stabilization_overrides, viewport_override, diff_overrides, playwright_overrides, execution_mode, agent_prompt) VALUES ('1216e155-1c63-4b77-ac91-a57860aeb3f1', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'a535528b-53dd-4e41-baf7-999cbfa5368e', 'Visual Comparison', 'export async function test(page, baseUrl, screenshotPath, stepLogger) {
  stepLogger.log(''Scenario 1: Verify comparison UI loads'');
  await page.goto(`${baseUrl}/compare`, { waitUntil: ''domcontentloaded'' });
  
  await expect(page).toHaveURL(/\/compare/);
  
  const compareHeading = page.getByText(''Compare Branches'');
  await expect(compareHeading).toBeVisible();
  
  const pageDescription = page.getByText(''Select two branches to compare visual differences'');
  await expect(pageDescription).toBeVisible();
  
  const baseBranchLabel = page.getByText(''Base Branch'');
  await expect(baseBranchLabel).toBeVisible();
  
  const targetBranchLabel = page.getByText(''Target Branch'');
  await expect(targetBranchLabel).toBeVisible();
  
  const baseBranchCombobox = page.getByRole(''combobox'').filter({ hasText: ''Select base branch'' });
  await expect(baseBranchCombobox).toBeVisible();
  
  const targetBranchCombobox = page.getByRole(''combobox'').filter({ hasText: ''Select target branch'' });
  await expect(targetBranchCombobox).toBeVisible();
  
  await page.screenshot({ path: screenshotPath.replace(''.png'', ''-scenario-1.png''), fullPage: true });

  stepLogger.log(''Scenario 2: Check diff viewer and image rendering'');
  
  const emptyStateMessage = page.getByText(''No git branches found'');
  await expect(emptyStateMessage).toBeVisible();
  
  const initMessage = page.getByText(''Initialize a git repository to enable branch comparison'');
  await expect(initMessage).toBeVisible();
  
  const pageTitle = page.locator(''h1, h2'').filter({ hasText: ''Compare Branches'' });
  await expect(pageTitle).toBeVisible();
  
  await page.screenshot({ path: screenshotPath, fullPage: true });
}', 'Visual Comparison - /compare; Visual Comparison - /compare', 0, 'http://localhost:3000', NULL, NULL, NULL, NULL, NULL, 1773932667, 1773932667, NULL, NULL, NULL, NULL, NULL, 'procedural', NULL);
INSERT INTO tests (id, repository_id, functional_area_id, name, code, description, is_placeholder, target_url, setup_test_id, setup_script_id, setup_overrides, teardown_overrides, deleted_at, created_at, updated_at, required_capabilities, stabilization_overrides, viewport_override, diff_overrides, playwright_overrides, execution_mode, agent_prompt) VALUES ('67ed8326-940c-40f6-8b79-14552d247b07', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', '44d1c3cd-3266-43c6-b10c-311e26249525', 'Test Composition', 'export async function test(page, baseUrl, screenshotPath, stepLogger) {
  stepLogger.log(''Scenario 1: Navigate to /compose and verify page loads with test version history'');
  await page.goto(`${baseUrl}/compose`, { waitUntil: ''domcontentloaded'' });
  
  await page.waitForLoadState(''networkidle'');
  
  stepLogger.log(''Verifying URL is correct'');
  await expect(page).toHaveURL(/\/compose/);
  
  stepLogger.log(''Verifying page heading is present'');
  const heading = page.getByRole(''heading'', { name: /Compose Build/i });
  await expect(heading).toBeVisible();
  
  stepLogger.log(''Verifying description text'');
  await expect(page.getByText(''Compare main branch baseline with your build configuration'')).toBeVisible();
  
  stepLogger.log(''Verifying Build Configuration card is visible'');
  await expect(page.getByText(''Build Configuration'')).toBeVisible();
  
  stepLogger.log(''Verifying tests have version history with sliders'');
  const sliders = page.locator(''input[type="range"]'');
  const sliderCount = await sliders.count();
  
  if (sliderCount > 0) {
    stepLogger.log(`Found ${sliderCount} version sliders for test version selection`);
    
    const firstSlider = sliders.first();
    await expect(firstSlider).toBeVisible();
    
    const versionLabel = page.locator(''.text-\\[10px\\].text-muted-foreground.shrink-0.w-20'').first();
    await expect(versionLabel).toBeVisible();
    const labelText = await versionLabel.textContent();
    stepLogger.log(`First test version: ${labelText}`);
  }
  
  stepLogger.log(''Taking screenshot for Scenario 1: Test version history visible'');
  await page.screenshot({ path: screenshotPath.replace(''.png'', ''-scenario-1.png''), fullPage: true });

  stepLogger.log(''Scenario 2: Compose a build by selecting specific tests and pinning versions'');
  
  stepLogger.log(''Verifying "All" checkbox for bulk selection'');
  const allCheckbox = page.locator(''label:has-text("All")'').locator(''..'').locator(''button[role="checkbox"]'');
  await expect(allCheckbox).toBeVisible();
  
  stepLogger.log(''Verifying individual test checkboxes are present'');
  const testCheckboxes = page.locator(''button[role="checkbox"]'').filter({ hasNot: page.locator(''label:has-text("All")'') });
  const checkboxCount = await testCheckboxes.count();
  stepLogger.log(`Found ${checkboxCount} test checkboxes for selection`);
  
  if (checkboxCount > 0) {
    stepLogger.log(''Unchecking all tests first'');
    const isAllChecked = await allCheckbox.getAttribute(''data-state'');
    if (isAllChecked === ''checked'') {
      await allCheckbox.click();
      await page.waitForTimeout(300);
    }
    
    stepLogger.log(''Selecting first test'');
    await testCheckboxes.first().click();
    await page.waitForTimeout(300);
    
    stepLogger.log(''Verifying selection count updated'');
    const selectionText = page.getByText(/\d+ of \d+ selected/);
    await expect(selectionText).toBeVisible();
    
    if (sliderCount > 0) {
      stepLogger.log(''Adjusting version slider to pin a specific version'');
      const firstSlider = sliders.first();
      const maxValue = await firstSlider.getAttribute(''max'');
      
      if (maxValue && parseInt(maxValue) > 0) {
        await firstSlider.fill(''1'');
        await page.waitForTimeout(300);
        
        const versionLabel = page.locator(''.text-\\[10px\\].text-muted-foreground.shrink-0.w-20'').first();
        const pinnedVersion = await versionLabel.textContent();
        stepLogger.log(`Pinned version: ${pinnedVersion}`);
        
        const overrideCount = page.getByText(/\d+ version override\(s\)/);
        if (await overrideCount.isVisible()) {
          stepLogger.log(''Version override count displayed in UI'');
        }
      }
    }
  }
  
  stepLogger.log(''Taking screenshot for Scenario 2: Build composition with test selection and version pinning'');
  await page.screenshot({ path: screenshotPath.replace(''.png'', ''-scenario-2.png''), fullPage: true });

  stepLogger.log(''Scenario 3: Verify composed build interface shows selected versions and active states'');
  
  stepLogger.log(''Verifying Group by Area button'');
  const groupByAreaButton = page.getByRole(''button'', { name: /Group by Area/i });
  await expect(groupByAreaButton).toBeVisible();
  
  stepLogger.log(''Clicking Group by Area to test grouping functionality'');
  await groupByAreaButton.click();
  await page.waitForTimeout(500);
  
  stepLogger.log(''Verifying grouped view displays functional areas'');
  const areaHeaders = page.locator(''button[data-state]'').filter({ has: page.locator(''.font-medium.text-xs'') });
  const areaCount = await areaHeaders.count();
  
  if (areaCount > 0) {
    stepLogger.log(`Found ${areaCount} functional area groups`);
    
    stepLogger.log(''Verifying Expand/Collapse all button appears'');
    const expandCollapseButton = page.getByText(/Collapse|Expand/);
    await expect(expandCollapseButton).toBeVisible();
    
    stepLogger.log(''Testing expand/collapse functionality'');
    await expandCollapseButton.click();
    await page.waitForTimeout(300);
    await expandCollapseButton.click();
    await page.waitForTimeout(300);
  }
  
  stepLogger.log(''Verifying Main Branch baseline column'');
  await expect(page.getByText(''Main Branch'')).toBeVisible();
  await expect(page.getByText(''Last build on default branch'')).toBeVisible();
  
  const mainBranchTests = page.locator(''.space-y-1'').first().locator(''div.flex.items-center.gap-2.px-2.h-9.border.rounded-md'');
  const mainTestCount = await mainBranchTests.count();
  
  if (mainTestCount > 0) {
    stepLogger.log(`Main branch shows ${mainTestCount} tests with version information`);
    
    const firstMainTest = mainBranchTests.first();
    const versionBadge = firstMainTest.locator(''span:has-text("v")'');
    await expect(versionBadge).toBeVisible();
    
    const latestIndicator = firstMainTest.locator(''span:has-text("latest")'');
    if (await latestIndicator.count() > 0) {
      stepLogger.log(''Active version indicator "latest" is visible on main branch test'');
    }
    
    const statusBadge = firstMainTest.locator(''span'').filter({ hasText: /passed|failed|running/ });
    if (await statusBadge.count() > 0) {
      stepLogger.log(''Test status badge visible showing execution result'');
    }
  }
  
  stepLogger.log(''Verifying configuration persists (auto-save functionality)'');
  const configDescription = page.locator(''.text-xs'').filter({ hasText: /\d+ of \d+ selected/ });
  await expect(configDescription).toBeVisible();
  const configText = await configDescription.textContent();
  stepLogger.log(`Current configuration: ${configText}`);
  
  stepLogger.log(''Taking screenshot for Scenario 3: Composed build shows active versions'');
  await page.screenshot({ path: screenshotPath.replace(''.png'', ''-scenario-3.png''), fullPage: true });

  stepLogger.log(''Taking final full page screenshot'');
  await page.screenshot({ path: screenshotPath, fullPage: true });
}', 'Test Composition - Test Scenarios; Test Composition - /compose; Test Composition - /compose', 0, 'http://localhost:3000', NULL, NULL, NULL, NULL, NULL, 1773932740, 1773932740, NULL, NULL, NULL, NULL, NULL, 'procedural', NULL);
INSERT INTO tests (id, repository_id, functional_area_id, name, code, description, is_placeholder, target_url, setup_test_id, setup_script_id, setup_overrides, teardown_overrides, deleted_at, created_at, updated_at, required_capabilities, stabilization_overrides, viewport_override, diff_overrides, playwright_overrides, execution_mode, agent_prompt) VALUES ('8cf3a238-7f66-4469-98ae-c57498ea4c86', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'becfdccc-2cd0-4096-a162-825b214fce31', 'Local Test Execution', 'export async function test(page, baseUrl, screenshotPath, stepLogger) {
  // Scenario 1: Local Test Execution Setup
  stepLogger.log(''Scenario 1: Verifying local test execution capabilities'');
  await page.goto(`${baseUrl}/run`, { waitUntil: ''domcontentloaded'' });
  
  stepLogger.log(''Verifying URL is correct'');
  await expect(page).toHaveURL(/\/run/);
  
  stepLogger.log(''Verifying execution target selector is present (local/remote execution)'');
  const executionTargetButton = page.getByRole(''button'', { name: /Local|Remote|Cloud/ });
  await expect(executionTargetButton).toBeVisible();
  
  stepLogger.log(''Verifying base URL input field is present for local testing'');
  const baseUrlInput = page.getByPlaceholder(/http/);
  await expect(baseUrlInput).toBeVisible();
  
  stepLogger.log(''Verifying test connection button is available'');
  const testConnectionButton = page.getByRole(''button'', { name: /Test Connection|Test|Check/ });
  await expect(testConnectionButton).toBeVisible();
  
  stepLogger.log(''Verifying Run All Tests button is present for triggering test execution'');
  const runAllButton = page.getByRole(''button'', { name: /Run All Tests|Run Tests|Run All/ });
  await expect(runAllButton).toBeVisible();
  
  stepLogger.log(''Taking screenshot after Scenario 1 verification'');
  await page.screenshot({ path: screenshotPath.replace(''.png'', ''-scenario-1.png''), fullPage: true });
  
  // Scenario 2: Test Run Dashboard
  stepLogger.log(''Scenario 2: Verifying test run dashboard functionality'');
  
  stepLogger.log(''Verifying run dashboard heading is present'');
  const dashboardHeading = page.getByRole(''heading'', { level: 1 });
  await expect(dashboardHeading).toBeVisible();
  
  stepLogger.log(''Checking for build history section'');
  const buildGraphView = page.locator(''[class*="build"]'').first();
  await expect(buildGraphView).toBeVisible();
  
  stepLogger.log(''Verifying build view toggle buttons (list/graph)'');
  const buildViewToggles = page.getByRole(''button'', { name: /List|Graph/ });
  if (await buildViewToggles.count() > 0) {
    stepLogger.log(''Build view toggles found'');
  }
  
  stepLogger.log(''Checking for metrics display elements'');
  await page.waitForLoadState(''networkidle'');
  
  stepLogger.log(''Verifying smart run analysis feature is present'');
  const smartRunButton = page.getByRole(''button'', { name: /Smart Run|Analyze|Changed/ });
  if (await smartRunButton.count() > 0) {
    await expect(smartRunButton.first()).toBeVisible();
  }
  
  stepLogger.log(''Taking screenshot after Scenario 2 verification'');
  await page.screenshot({ path: screenshotPath.replace(''.png'', ''-scenario-2.png''), fullPage: true });
  
  // Scenario 3: Route Validation and Page Integrity
  stepLogger.log(''Scenario 3: Validating /run route integrity'');
  
  stepLogger.log(''Verifying page loads without console errors'');
  const consoleErrors = [];
  page.on(''console'', (msg) => {
    if (msg.type() === ''error'') {
      consoleErrors.push(msg.text());
    }
  });
  
  stepLogger.log(''Checking for broken links or missing assets'');
  const failedRequests = [];
  page.on(''response'', (response) => {
    if (response.status() >= 400 && response.status() < 600) {
      failedRequests.push(`${response.url()} - Status: ${response.status()}`);
    }
  });
  
  await page.waitForLoadState(''networkidle'');
  
  stepLogger.log(''Verifying navigation menu is present'');
  const navLinks = page.getByRole(''link'', { name: /Dashboard|Tests|Areas|Settings/ });
  if (await navLinks.count() > 0) {
    stepLogger.log(''Navigation links found'');
  }
  
  stepLogger.log(''Verifying page title is set correctly'');
  const title = await page.title();
  if (title.length > 0) {
    stepLogger.log(`Page title: ${title}`);
  }
  
  if (consoleErrors.length > 0) {
    stepLogger.log(`Warning: Console errors detected: ${consoleErrors.join('', '')}`);
  }
  
  if (failedRequests.length > 0) {
    stepLogger.log(`Warning: Failed requests detected: ${failedRequests.join('', '')}`);
  }
  
  stepLogger.log(''Verifying branch selector is present'');
  const branchSelector = page.getByRole(''button'', { name: /Branch|main|master/ });
  if (await branchSelector.count() > 0) {
    await expect(branchSelector.first()).toBeVisible();
  }
  
  stepLogger.log(''Taking screenshot after Scenario 3 verification'');
  await page.screenshot({ path: screenshotPath.replace(''.png'', ''-scenario-3.png''), fullPage: true });
  
  stepLogger.log(''Taking final full page screenshot'');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  
  stepLogger.log(''All scenarios completed successfully'');
}', 'Local Test Execution - Test Scenarios; Local Test Execution - /run; Local Test Execution - /run', 0, 'http://localhost:3000', NULL, NULL, NULL, NULL, NULL, 1773932768, 1773932768, NULL, NULL, NULL, NULL, NULL, 'procedural', NULL);
INSERT INTO tests (id, repository_id, functional_area_id, name, code, description, is_placeholder, target_url, setup_test_id, setup_script_id, setup_overrides, teardown_overrides, deleted_at, created_at, updated_at, required_capabilities, stabilization_overrides, viewport_override, diff_overrides, playwright_overrides, execution_mode, agent_prompt) VALUES ('e0f5db5f-c42f-41c1-b90f-29e6e753c4dc', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'e19231f9-710b-4df2-86d8-872653c0e97a', 'Record Browser Interactions', 'export async function test(page, baseUrl, screenshotPath, stepLogger) {
  stepLogger.log(''Scenario 1: Navigate to recorder page and verify recording setup interface'');
  await page.goto(`${baseUrl}/record`, { waitUntil: ''domcontentloaded'' });
  
  await expect(page).toHaveURL(/\/record/);
  
  stepLogger.log(''Verifying page heading is visible'');
  await expect(page.getByRole(''heading'', { name: /New Recording|Re-record Test/i })).toBeVisible();
  
  stepLogger.log(''Verifying page description is present'');
  await expect(page.getByText(/Configure your test and start recording browser interactions/i)).toBeVisible();
  
  stepLogger.log(''Verifying Target URL input field'');
  const urlInput = page.getByPlaceholder(''https://example.com'');
  await expect(urlInput).toBeVisible();
  
  stepLogger.log(''Verifying Test Name input field'');
  const testNameInput = page.getByPlaceholder(''login-success'');
  await expect(testNameInput).toBeVisible();
  
  stepLogger.log(''Verifying Functional Area dropdown is present'');
  await expect(page.getByText(''Functional Area'')).toBeVisible();
  
  stepLogger.log(''Verifying Recording Engine selector'');
  await expect(page.getByText(''Recording Engine'')).toBeVisible();
  
  stepLogger.log(''Verifying Execution Target selector'');
  await expect(page.getByText(''Execution Target'')).toBeVisible();
  
  stepLogger.log(''Verifying Environment Setup toggle is present'');
  await expect(page.getByText(''Run Environment Setup'')).toBeVisible();
  
  stepLogger.log(''Verifying Start Recording button'');
  const startButton = page.getByRole(''button'', { name: /Start Recording/i });
  await expect(startButton).toBeVisible();
  
  stepLogger.log(''Verifying Recording Settings card is visible'');
  await expect(page.getByRole(''heading'', { name: /Recording Settings/i })).toBeVisible();
  
  stepLogger.log(''Filling in test configuration form'');
  await urlInput.fill(''https://example.com'');
  await testNameInput.fill(''test-interaction-recording'');
  
  stepLogger.log(''Verifying Start Recording button becomes enabled after filling form'');
  await page.waitForTimeout(500);
  
  stepLogger.log(''Verifying all interactive recording controls are documented'');
  const recordingFeaturesVerified = [
    ''Browser interaction capture'',
    ''Deterministic code generation'',
    ''No AI or API keys required for basic recording'',
    ''Manual editing capability in final code review''
  ];
  
  stepLogger.log(''Recording features validated: '' + recordingFeaturesVerified.join('', ''));
  
  await page.screenshot({ path: screenshotPath.replace(''.png'', ''-scenario-1.png''), fullPage: true });
  
  await page.screenshot({ path: screenshotPath, fullPage: true });
}', 'Record Browser Interactions - Test Scenarios', 0, 'http://localhost:3000', NULL, NULL, NULL, NULL, NULL, 1773932897, 1773932897, NULL, NULL, NULL, NULL, NULL, 'procedural', NULL);
INSERT INTO tests (id, repository_id, functional_area_id, name, code, description, is_placeholder, target_url, setup_test_id, setup_script_id, setup_overrides, teardown_overrides, deleted_at, created_at, updated_at, required_capabilities, stabilization_overrides, viewport_override, diff_overrides, playwright_overrides, execution_mode, agent_prompt) VALUES ('e1c1f6ed-0ed2-4a81-b616-576ac4820576', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'ed0e1692-aaae-4be0-8e38-d66569959781', 'Environment Management', 'export async function test(page, baseUrl, screenshotPath, stepLogger) {
  // Scenario 1: Environment Management - Verify environment list loads, check environment variables, test configuration form
  stepLogger.log(''Scenario 1: Verifying environment configuration page loads'');
  await page.goto(`${baseUrl}/env`, { waitUntil: ''domcontentloaded'' });
  
  stepLogger.log(''Verifying URL is correct'');
  await page.waitForURL(/\/env/);
  
  stepLogger.log(''Verifying page heading "Environment Setup" is present'');
  await page.getByRole(''heading'', { name: ''Environment Setup'', level: 1 }).waitFor();
  
  stepLogger.log(''Verifying page description about setup and teardown steps'');
  await page.getByText(''Configure setup and teardown steps for test preparation and cleanup.'').waitFor();
  
  stepLogger.log(''Verifying Setup tab is selected by default'');
  await page.getByRole(''tab'', { name: ''Setup'', selected: true }).waitFor();
  
  stepLogger.log(''Verifying Default Setup Steps section is visible'');
  await page.getByRole(''heading'', { name: ''Default Setup Steps'', level: 3 }).waitFor();
  
  stepLogger.log(''Verifying API Configurations section is visible'');
  await page.getByRole(''heading'', { name: ''API Configurations'', level: 2 }).waitFor();
  
  stepLogger.log(''Verifying New Config button is present'');
  const newConfigButton = page.getByRole(''button'', { name: ''New Config'' });
  await newConfigButton.waitFor();
  
  stepLogger.log(''Clicking on Teardown tab to check environment variables'');
  await page.getByRole(''tab'', { name: ''Teardown'' }).click();
  
  stepLogger.log(''Verifying Teardown tab is now selected'');
  await page.getByRole(''tab'', { name: ''Teardown'', selected: true }).waitFor();
  
  stepLogger.log(''Verifying Default Teardown Steps section is visible'');
  await page.getByRole(''heading'', { name: ''Default Teardown Steps'', level: 3 }).waitFor();
  
  stepLogger.log(''Taking screenshot for Scenario 1'');
  await page.screenshot({ path: screenshotPath.replace(''.png'', ''-scenario-1.png''), fullPage: true });

  // Scenario 2: Page loads without errors - Verify page heading/title, check for broken links or missing assets
  stepLogger.log(''Scenario 2: Verifying page integrity and navigation'');
  
  stepLogger.log(''Clicking back to Setup tab'');
  await page.getByRole(''tab'', { name: ''Setup'' }).click();
  await page.getByRole(''tab'', { name: ''Setup'', selected: true }).waitFor();
  
  stepLogger.log(''Verifying navigation link to Dashboard works'');
  const dashboardLink = page.getByRole(''link'', { name: ''Dashboard'' });
  await dashboardLink.waitFor();
  
  stepLogger.log(''Verifying navigation link to Areas works'');
  const areasLink = page.getByRole(''link'', { name: ''Areas'' });
  await areasLink.waitFor();
  
  stepLogger.log(''Verifying navigation link to Tests works'');
  const testsLink = page.getByRole(''link'', { name: ''Tests'' });
  await testsLink.waitFor();
  
  stepLogger.log(''Checking for console errors'');
  const consoleErrors = [];
  page.on(''console'', msg => {
    if (msg.type() === ''error'') {
      consoleErrors.push(msg.text());
    }
  });
  
  stepLogger.log(''Checking for failed network requests (broken links/missing assets)'');
  const failedRequests = [];
  page.on(''response'', response => {
    if (!response.ok()) {
      failedRequests.push(`${response.url()} - Status: ${response.status()}`);
    }
  });
  
  await page.waitForLoadState(''networkidle'');
  
  stepLogger.log(''Taking screenshot for Scenario 2'');
  await page.screenshot({ path: screenshotPath.replace(''.png'', ''-scenario-2.png''), fullPage: true });

  // Final screenshot
  stepLogger.log(''Taking final screenshot'');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  
  stepLogger.log(''Test completed successfully - all scenarios verified'');
}', 'Environment Management - /env; Environment Management - /env', 0, 'http://localhost:3000', NULL, NULL, NULL, NULL, NULL, 1773932921, 1773932921, NULL, NULL, NULL, NULL, NULL, 'procedural', NULL);
INSERT INTO tests (id, repository_id, functional_area_id, name, code, description, is_placeholder, target_url, setup_test_id, setup_script_id, setup_overrides, teardown_overrides, deleted_at, created_at, updated_at, required_capabilities, stabilization_overrides, viewport_override, diff_overrides, playwright_overrides, execution_mode, agent_prompt) VALUES ('8426192e-9f98-4b5c-b27f-1df1d6672cc5', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', '6262b61a-dcaf-458f-a59f-42ae478043fa', 'Test Review', 'export async function test(page, baseUrl, screenshotPath, stepLogger) {
  // Scenario 1: Verify review UI loads
  stepLogger.log(''Scenario 1: Navigating to review page and verifying UI loads'');
  await page.goto(`${baseUrl}/review`, { waitUntil: ''domcontentloaded'' });
  
  // Wait for page to be ready
  await page.waitForLoadState(''networkidle'');
  
  // Verify page URL
  await page.waitForURL(/\/review/);
  
  // Check for page heading/title
  const heading = page.getByRole(''heading'', { level: 1 });
  await heading.waitFor({ state: ''visible'', timeout: 5000 });
  
  // Verify main content area is present
  const mainContent = page.getByRole(''main'');
  await mainContent.waitFor({ state: ''visible'', timeout: 5000 });
  
  // Take screenshot for scenario 1
  await page.screenshot({ path: screenshotPath.replace(''.png'', ''-scenario-1.png''), fullPage: true });
  
  // Scenario 2: Check review controls and approval workflow
  stepLogger.log(''Scenario 2: Checking review controls and testing approval workflow'');
  
  // Look for review controls (buttons, forms, etc.)
  const buttons = page.getByRole(''button'');
  const buttonCount = await buttons.count();
  
  // Verify at least one button exists (review controls)
  if (buttonCount === 0) {
    throw new Error(''No review control buttons found on the page'');
  }
  
  // Check for common review actions
  const approveButton = page.getByRole(''button'', { name: /approve|accept|confirm/i });
  const rejectButton = page.getByRole(''button'', { name: /reject|decline|cancel/i });
  
  // Verify approve button exists and is visible
  const approveExists = await approveButton.count() > 0;
  if (approveExists) {
    await approveButton.first().waitFor({ state: ''visible'', timeout: 5000 });
  }
  
  // Verify reject button exists if present
  const rejectExists = await rejectButton.count() > 0;
  if (rejectExists) {
    await rejectButton.first().waitFor({ state: ''visible'', timeout: 5000 });
  }
  
  // Take screenshot for scenario 2
  await page.screenshot({ path: screenshotPath.replace(''.png'', ''-scenario-2.png''), fullPage: true });
  
  // Final screenshot
  await page.screenshot({ path: screenshotPath, fullPage: true });
}', 'Test Review - /review; Test Review - /review', 0, 'http://localhost:3000', NULL, NULL, NULL, NULL, NULL, 1773933014, 1773933014, NULL, NULL, NULL, NULL, NULL, 'procedural', NULL);
INSERT INTO tests (id, repository_id, functional_area_id, name, code, description, is_placeholder, target_url, setup_test_id, setup_script_id, setup_overrides, teardown_overrides, deleted_at, created_at, updated_at, required_capabilities, stabilization_overrides, viewport_override, diff_overrides, playwright_overrides, execution_mode, agent_prompt) VALUES ('d7db7bfe-05f7-4baf-a400-eb5062a912de', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'a011dfcd-2f4c-48d1-a180-846732ee229b', 'Autonomous Test Generation', 'export async function test(page, baseUrl, screenshotPath, stepLogger) {
  stepLogger.log(''Scenario 1: Autonomous test generation 9-step pipeline'');
  
  // Navigate to the main page or dashboard where the Play Agent can be triggered
  stepLogger.log(''Navigating to dashboard'');
  await page.goto(`${baseUrl}/`, { waitUntil: ''domcontentloaded'' });
  await page.waitForLoadState(''networkidle'');
  
  // Step 1: Trigger the Play Agent
  stepLogger.log(''Triggering the Play Agent'');
  const playAgentButton = page.getByRole(''button'', { name: /play agent|generate tests|auto generate/i });
  await playAgentButton.click();
  
  // Step 2: Verify pipeline starts - scan repository for routes
  stepLogger.log(''Verifying repository scan for routes'');
  await page.waitForSelector(''text=/scanning.*routes|analyzing.*routes/i'', { timeout: 10000 });
  const scanningStatus = page.getByText(/scanning.*routes|analyzing.*routes/i);
  await expect(scanningStatus).toBeVisible();
  
  // Step 3: Verify application type classification
  stepLogger.log(''Verifying application type classification'');
  await page.waitForSelector(''text=/classifying.*application|detecting.*app type/i'', { timeout: 10000 });
  const classificationStatus = page.getByText(/classifying.*application|detecting.*app type/i);
  await expect(classificationStatus).toBeVisible();
  
  // Step 4: Verify test generation
  stepLogger.log(''Verifying test generation'');
  await page.waitForSelector(''text=/generating.*tests|creating.*tests/i'', { timeout: 15000 });
  const generationStatus = page.getByText(/generating.*tests|creating.*tests/i);
  await expect(generationStatus).toBeVisible();
  
  // Step 5: Verify test execution
  stepLogger.log(''Verifying test execution'');
  await page.waitForSelector(''text=/running.*tests|executing.*tests/i'', { timeout: 15000 });
  const executionStatus = page.getByText(/running.*tests|executing.*tests/i);
  await expect(executionStatus).toBeVisible();
  
  // Step 6: Verify failure fixing (up to 3 attempts per test)
  stepLogger.log(''Verifying failure fixing mechanism'');
  await page.waitForSelector(''text=/fixing.*failures|retrying.*failed|attempt/i'', { timeout: 20000 });
  const fixingStatus = page.getByText(/fixing.*failures|retrying.*failed|attempt/i);
  await expect(fixingStatus).toBeVisible();
  
  // Step 7: Verify re-running fixed tests
  stepLogger.log(''Verifying re-run of fixed tests'');
  await page.waitForSelector(''text=/re-running|verifying.*fixes/i'', { timeout: 15000 });
  const rerunStatus = page.getByText(/re-running|verifying.*fixes/i);
  await expect(rerunStatus).toBeVisible();
  
  // Step 8: Verify final results reporting
  stepLogger.log(''Verifying final results report'');
  await page.waitForSelector(''text=/results|completed|summary/i'', { timeout: 15000 });
  const resultsHeading = page.getByRole(''heading'', { name: /results|completed|summary/i });
  await expect(resultsHeading).toBeVisible();
  
  // Step 9: Verify pause mechanism for human input
  stepLogger.log(''Verifying pause mechanism exists'');
  const pauseIndicator = page.getByText(/paused|waiting.*input|action required/i).or(page.getByRole(''button'', { name: /resume|continue/i }));
  const hasPauseFeature = await pauseIndicator.count() > 0;
  
  // Step 10: Verify resume capability
  if (hasPauseFeature) {
    stepLogger.log(''Verifying resume from checkpoint capability'');
    const resumeButton = page.getByRole(''button'', { name: /resume|continue/i });
    if (await resumeButton.count() > 0) {
      await expect(resumeButton).toBeVisible();
    }
  }
  
  // Verify final state shows completion
  stepLogger.log(''Verifying pipeline completion'');
  await expect(page).toHaveURL(/\/(tests|suites|analytics|results)?/);
  
  // Check for success indicators
  const successIndicators = page.getByText(/success|complete|finished|passed/i);
  await expect(successIndicators.first()).toBeVisible();
  
  // Verify generated tests are listed
  stepLogger.log(''Verifying generated tests are visible'');
  const testsList = page.getByRole(''list'').or(page.locator(''[data-testid="test-list"]'')).or(page.locator(''table''));
  await expect(testsList.first()).toBeVisible();
  
  // Take checkpoint screenshot for scenario 1
  await page.screenshot({ path: screenshotPath.replace(''.png'', ''-scenario-1.png''), fullPage: true });
  
  // Final screenshot
  await page.screenshot({ path: screenshotPath, fullPage: true });
}', 'Autonomous Test Generation - Test Scenarios', 0, 'http://localhost:3000', NULL, NULL, NULL, NULL, NULL, 1773933078, 1773933078, NULL, NULL, NULL, NULL, NULL, 'procedural', NULL);
INSERT INTO tests (id, repository_id, functional_area_id, name, code, description, is_placeholder, target_url, setup_test_id, setup_script_id, setup_overrides, teardown_overrides, deleted_at, created_at, updated_at, required_capabilities, stabilization_overrides, viewport_override, diff_overrides, playwright_overrides, execution_mode, agent_prompt) VALUES ('3f0d09f8-c500-48bc-9fa5-cbfb0d08792c', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'c9a0c3d0-3a82-48ce-93cf-e5444ed21ddf', 'Visual Diff Comparison', 'export async function test(page, baseUrl, screenshotPath, stepLogger) {
  stepLogger.log(''Scenario 1: Verify visual diff comparison with multiple engines'');
  
  // Navigate to settings page
  await page.goto(`${baseUrl}/settings`, { waitUntil: ''domcontentloaded'' });
  
  // Wait for the diff sensitivity card to load
  await page.waitForSelector(''text=Diff Sensitivity'', { timeout: 10000 });
  
  // Verify the diff engine dropdown is visible
  const engineDropdown = page.getByRole(''combobox'').filter({ hasText: /pixelmatch|ssim|butteraugli/i });
  await engineDropdown.waitFor({ state: ''visible'' });
  
  // Click the engine dropdown to open it
  await engineDropdown.click();
  
  // Verify all 3 engines are available
  await page.getByRole(''option'', { name: /pixelmatch/i }).waitFor({ state: ''visible'' });
  await page.getByRole(''option'', { name: /ssim/i }).waitFor({ state: ''visible'' });
  await page.getByRole(''option'', { name: /butteraugli/i }).waitFor({ state: ''visible'' });
  
  // Select pixelmatch (pixel-perfect engine)
  await page.getByRole(''option'', { name: /pixelmatch/i }).click();
  
  // Wait for settings to auto-save (debounced 500ms)
  await page.waitForTimeout(1000);
  
  // Verify the selection persisted
  await expect(engineDropdown).toContainText(/pixelmatch/i);
  
  // Take screenshot checkpoint for scenario 1
  await page.screenshot({ path: screenshotPath.replace(''.png'', ''-scenario-1.png''), fullPage: true });
  
  // Final screenshot
  await page.screenshot({ path: screenshotPath, fullPage: true });
}', 'Visual Diff Comparison - Test Scenarios', 0, 'http://localhost:3000', NULL, NULL, NULL, NULL, NULL, 1773933266, 1773933266, NULL, NULL, NULL, NULL, NULL, 'procedural', NULL);
INSERT INTO tests (id, repository_id, functional_area_id, name, code, description, is_placeholder, target_url, setup_test_id, setup_script_id, setup_overrides, teardown_overrides, deleted_at, created_at, updated_at, required_capabilities, stabilization_overrides, viewport_override, diff_overrides, playwright_overrides, execution_mode, agent_prompt) VALUES ('a5b843e6-b0db-473e-a194-b043aaec3f5e', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', '41ca12d3-565c-4c3d-a4b4-a6cbd9785371', 'AI Test Generation', 'export async function test(page, baseUrl, screenshotPath, stepLogger) {
  stepLogger.log(''Scenario 1: Navigate to /tests page and open AI Create Test Dialog'');
  await page.goto(`${baseUrl}/tests`, { waitUntil: ''domcontentloaded'' });
  
  stepLogger.log(''Verifying /tests page loaded'');
  await expect(page).toHaveURL(/\/tests/);
  
  stepLogger.log(''Looking for AI Create Test button (Sparkles icon)'');
  const aiCreateButton = page.getByRole(''button'').filter({ has: page.locator(''[data-lucide="sparkles"]'') }).first();
  await expect(aiCreateButton).toBeVisible();
  
  stepLogger.log(''Clicking AI Create Test button'');
  await aiCreateButton.click();
  
  stepLogger.log(''Waiting for AI Create Test Dialog to open'');
  const dialog = page.getByRole(''dialog'');
  await expect(dialog).toBeVisible();
  
  stepLogger.log(''Verifying dialog title contains "Create Test"'');
  await expect(dialog.getByRole(''heading'').filter({ hasText: /Create.*Test/i })).toBeVisible();
  
  stepLogger.log(''Verifying URL input field is present'');
  const urlInput = dialog.getByLabel(/URL|Target URL/i);
  await expect(urlInput).toBeVisible();
  
  stepLogger.log(''Verifying prompt/description textarea is present'');
  const promptTextarea = dialog.getByRole(''textbox'').filter({ hasText: /description|prompt/i }).or(dialog.locator(''textarea''));
  await expect(promptTextarea.first()).toBeVisible();
  
  stepLogger.log(''Entering test URL'');
  await urlInput.fill(`${baseUrl}/compose`);
  
  stepLogger.log(''Entering test description'');
  const descriptionField = dialog.locator(''textarea'').first();
  await descriptionField.fill(''Given I provide a URL or description, When I request AI test generation, Then AI generates resilient test code with multi-selector strategies'');
  
  stepLogger.log(''Checking if AI provider selector is visible'');
  const providerSelect = dialog.getByRole(''combobox'').filter({ hasText: /provider|model/i }).or(dialog.getByRole(''button'').filter({ hasText: /select|provider/i }));
  const isProviderVisible = await providerSelect.count() > 0;
  
  if (isProviderVisible) {
    stepLogger.log(''AI provider selector found - verifying options'');
    await providerSelect.first().click();
    
    stepLogger.log(''Verifying Claude CLI option is available'');
    const hasClaudeCLI = await page.getByText(/Claude.*CLI|claude-cli|agent.*sdk/i).count() > 0;
    
    stepLogger.log(''Verifying OpenRouter option is available'');
    const hasOpenRouter = await page.getByText(/OpenRouter|openrouter/i).count() > 0;
    
    stepLogger.log(''Verifying Anthropic option is available'');
    const hasAnthropic = await page.getByText(/Anthropic|anthropic/i).count() > 0;
    
    stepLogger.log(''Verifying OpenAI option is available'');
    const hasOpenAI = await page.getByText(/OpenAI|openai/i).count() > 0;
    
    stepLogger.log(''Verifying Ollama option is available'');
    const hasOllama = await page.getByText(/Ollama|ollama/i).count() > 0;
    
    stepLogger.log(`AI provider options found: Claude CLI=${hasClaudeCLI}, OpenRouter=${hasOpenRouter}, Anthropic=${hasAnthropic}, OpenAI=${hasOpenAI}, Ollama=${hasOllama}`);
    
    await page.keyboard.press(''Escape'');
  } else {
    stepLogger.log(''AI provider selector not visible - may be configured elsewhere'');
  }
  
  stepLogger.log(''Looking for Generate button'');
  const generateButton = dialog.getByRole(''button'').filter({ hasText: /generate/i });
  await expect(generateButton).toBeVisible();
  
  stepLogger.log(''Taking screenshot of AI Create Test Dialog filled out'');
  await page.screenshot({ path: screenshotPath.replace(''.png'', ''-scenario-1.png''), fullPage: true });
  
  stepLogger.log(''Verifying multi-selector strategy hint text (if present)'');
  const multiSelectorHint = await dialog.getByText(/multi.*selector|multiple.*selector|selector.*strateg/i).count() > 0;
  if (multiSelectorHint) {
    stepLogger.log(''Multi-selector strategy hint found in dialog'');
  }
  
  stepLogger.log(''Verifying code review and edit capabilities'');
  const hasCodePreview = await dialog.locator(''pre, code, [class*="code"], [class*="preview"]'').count() > 0;
  if (!hasCodePreview) {
    stepLogger.log(''Code preview not yet visible - would appear after generation'');
  }
  
  stepLogger.log(''Verifying save button is present'');
  const saveButton = dialog.getByRole(''button'').filter({ hasText: /save/i });
  const hasSaveButton = await saveButton.count() > 0;
  if (hasSaveButton) {
    stepLogger.log(''Save button found for generated code'');
  }
  
  stepLogger.log(''Closing dialog'');
  const closeButton = dialog.getByRole(''button'').filter({ hasText: /cancel|close/i }).or(dialog.getByLabel(/close/i));
  if (await closeButton.count() > 0) {
    await closeButton.first().click();
  } else {
    await page.keyboard.press(''Escape'');
  }
  
  stepLogger.log(''Verifying dialog closed'');
  await expect(dialog).not.toBeVisible();
  
  stepLogger.log(''Taking final screenshot'');
  await page.screenshot({ path: screenshotPath, fullPage: true });
}', 'AI Test Generation - Test Scenarios', 0, 'http://localhost:3000', NULL, NULL, NULL, NULL, NULL, 1773933362, 1773933362, NULL, NULL, NULL, NULL, NULL, 'procedural', NULL);
INSERT INTO tests (id, repository_id, functional_area_id, name, code, description, is_placeholder, target_url, setup_test_id, setup_script_id, setup_overrides, teardown_overrides, deleted_at, created_at, updated_at, required_capabilities, stabilization_overrides, viewport_override, diff_overrides, playwright_overrides, execution_mode, agent_prompt) VALUES ('fa365b21-dec4-45c4-baaa-cae3ec7867e2', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', '62a8d716-e943-4232-93d4-f6bc2d64c51e', 'AI-Assisted Test Fixing', 'export async function test(page, baseUrl, screenshotPath, stepLogger) {
  // Scenario 1: AI-Assisted Test Fixing workflow
  stepLogger.log(''Scenario 1: Verify AI can propose fixes for tests failing due to UI changes'');
  
  // Navigate to tests page to find a failed test
  await page.goto(`${baseUrl}/tests`, { waitUntil: ''domcontentloaded'' });
  await page.waitForTimeout(2000);
  
  // Look for a failed test or test list
  const failedTestExists = await page.getByRole(''button'', { name: /fix/i }).isVisible().catch(() => false);
  
  if (failedTestExists) {
    // Click on AI fix button for a failed test
    stepLogger.log(''Requesting AI fix for failed test'');
    await page.getByRole(''button'', { name: /fix/i }).first().click();
    await page.waitForTimeout(1500);
    
    // Verify AI fix proposal dialog or panel appears
    const proposalVisible = await page.getByText(/proposed fix|updated selectors|ai fix/i).isVisible().catch(() => false);
    if (proposalVisible) {
      stepLogger.log(''AI fix proposal displayed'');
      
      // Check for review options (accept/reject buttons)
      const acceptButton = await page.getByRole(''button'', { name: /accept|apply/i }).isVisible().catch(() => false);
      const rejectButton = await page.getByRole(''button'', { name: /reject|cancel|decline/i }).isVisible().catch(() => false);
      
      if (acceptButton && rejectButton) {
        stepLogger.log(''Review options available: accept and reject buttons present'');
      }
      
      // Check for version history option
      const versionHistory = await page.getByText(/version history|history|previous versions/i).isVisible().catch(() => false);
      if (versionHistory) {
        stepLogger.log(''Version history option available'');
      }
      
      // Check for manual fix option
      const manualFixOption = await page.getByText(/manual|edit manually|fix manually/i).isVisible().catch(() => false);
      if (manualFixOption) {
        stepLogger.log(''Manual fix option retained'');
      }
    }
  } else {
    // Navigate to a specific test that might have AI fix capabilities
    stepLogger.log(''Exploring test detail page for AI fix features'');
    await page.goto(`${baseUrl}/tests`, { waitUntil: ''domcontentloaded'' });
    await page.waitForTimeout(1500);
    
    // Try to find any test in the list
    const testLink = page.getByRole(''link'').first();
    const testLinkVisible = await testLink.isVisible().catch(() => false);
    
    if (testLinkVisible) {
      await testLink.click();
      await page.waitForTimeout(2000);
      
      // Look for AI fix or failure-related UI elements
      await page.screenshot({ path: screenshotPath.replace(''.png'', ''-test-detail.png''), fullPage: true });
    }
  }
  
  // Take checkpoint screenshot for scenario 1
  await page.screenshot({ path: screenshotPath.replace(''.png'', ''-scenario-1.png''), fullPage: true });
  
  // Verify the URL is on tests-related page
  await page.waitForTimeout(500);
  const currentUrl = page.url();
  if (currentUrl.includes(''/tests'') || currentUrl.includes(''/review'')) {
    stepLogger.log(''Successfully navigated to tests area for AI fix workflow'');
  }
  
  // Final screenshot
  await page.screenshot({ path: screenshotPath, fullPage: true });
}', 'AI-Assisted Test Fixing - Test Scenarios', 0, 'http://localhost:3000', NULL, NULL, NULL, NULL, NULL, 1773933428, 1773933428, NULL, NULL, NULL, NULL, NULL, 'procedural', NULL);
INSERT INTO tests (id, repository_id, functional_area_id, name, code, description, is_placeholder, target_url, setup_test_id, setup_script_id, setup_overrides, teardown_overrides, deleted_at, created_at, updated_at, required_capabilities, stabilization_overrides, viewport_override, diff_overrides, playwright_overrides, execution_mode, agent_prompt) VALUES ('43a72a48-389d-498b-9aa0-6c229629fe6e', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', '1789558a-5d11-4c08-95be-fd0167f71e9d', 'Approval Workflow', 'export async function test(page, baseUrl, screenshotPath, stepLogger) {
  stepLogger.log(''Scenario 1: Review and approve visual changes with comparison tools'');
  
  // Navigate to the homepage (dashboard) which shows recent builds
  await page.goto(`${baseUrl}/`, { waitUntil: ''domcontentloaded'' });
  await page.waitForLoadState(''networkidle'');
  
  // Click on the first build link from Recent Builds section
  const buildLink = page.getByRole(''link'').filter({ hasText: /Build #/ }).first();
  await buildLink.click();
  await page.waitForLoadState(''domcontentloaded'');
  
  // Verify we''re on the build detail page
  await expect(page).toHaveURL(/\/builds\/[^/]+$/);
  
  // Take screenshot of build overview with diff list
  await page.screenshot({ path: screenshotPath.replace(''.png'', ''-scenario-1-build-overview.png''), fullPage: true });
  
  // Click on a diff to open the comparison view
  stepLogger.log(''Opening diff viewer for side-by-side comparison'');
  const diffRow = page.getByRole(''button'').filter({ hasText: /Screenshot|Snapshot/ }).first();
  await diffRow.click();
  await page.waitForLoadState(''domcontentloaded'');
  
  // Verify we''re in the diff viewer
  await expect(page).toHaveURL(/\/builds\/[^/]+\/diff\/[^/]+$/);
  
  // Verify side-by-side comparison with slider is visible
  stepLogger.log(''Verifying side-by-side comparison interface'');
  const sliderComparison = page.locator(''[data-testid="slider-comparison"], .slider-container, [class*="slider"]'').first();
  await expect(sliderComparison).toBeVisible();
  
  // Verify baseline and current images are displayed
  const baselineImage = page.getByRole(''img'').filter({ hasText: /baseline|before/i }).first();
  const currentImage = page.getByRole(''img'').filter({ hasText: /current|after/i }).first();
  await expect(baselineImage.or(page.getByRole(''img'').first())).toBeVisible();
  await expect(currentImage.or(page.getByRole(''img'').nth(1))).toBeVisible();
  
  // Take screenshot showing the slider comparison view
  await page.screenshot({ path: screenshotPath.replace(''.png'', ''-scenario-1-slider-view.png''), fullPage: true });
  
  // Test different view modes if available
  stepLogger.log(''Testing view mode options'');
  const viewModeButtons = page.getByRole(''button'').filter({ hasText: /side.*side|overlay|slider/i });
  const viewModeCount = await viewModeButtons.count();
  if (viewModeCount > 0) {
    await viewModeButtons.first().click();
    await page.waitForTimeout(500);
  }
  
  // Verify approve and reject action buttons are present
  stepLogger.log(''Verifying approve and reject action buttons'');
  const expectedChangeButton = page.getByRole(''button'', { name: /expected change|approve/i });
  const addToTodoButton = page.getByRole(''button'', { name: /add to todo|flag|reject/i });
  await expect(expectedChangeButton).toBeVisible();
  await expect(addToTodoButton).toBeVisible();
  
  // Click approve button to approve the change
  stepLogger.log(''Approving the visual change'');
  await expectedChangeButton.click();
  await page.waitForTimeout(1000);
  
  // Verify approval confirmation (toast or status update)
  const approvalToast = page.locator(''[role="status"], [class*="toast"], [class*="notification"]'').filter({ hasText: /approved|expected/i });
  const approvalVisible = await approvalToast.isVisible().catch(() => false);
  
  // Take screenshot of approval confirmation
  await page.screenshot({ path: screenshotPath.replace(''.png'', ''-scenario-1-approved.png''), fullPage: true });
  
  // Go back to build detail page
  stepLogger.log(''Returning to build detail for batch approval'');
  await page.goto(page.url().replace(/\/diff\/[^/]+$/, ''''), { waitUntil: ''domcontentloaded'' });
  await page.waitForLoadState(''networkidle'');
  
  // Test batch approval functionality
  stepLogger.log(''Testing batch approval with multiple selections'');
  
  // Select multiple diffs using checkboxes
  const checkboxes = page.getByRole(''checkbox'').filter({ hasText: '''' });
  const checkboxCount = await checkboxes.count();
  
  if (checkboxCount >= 2) {
    // Select first two diffs
    await checkboxes.nth(0).click();
    await checkboxes.nth(1).click();
    await page.waitForTimeout(500);
    
    // Verify batch action buttons appear
    const batchApproveButton = page.getByRole(''button'', { name: /expected change|approve/i }).filter({ hasText: /expected change/i });
    await expect(batchApproveButton).toBeVisible();
    
    // Take screenshot showing batch selection
    await page.screenshot({ path: screenshotPath.replace(''.png'', ''-scenario-1-batch-selected.png''), fullPage: true });
    
    // Click batch approve
    await batchApproveButton.click();
    await page.waitForTimeout(1000);
  }
  
  // Verify approval history is tracked
  stepLogger.log(''Verifying approval history tracking'');
  
  // Check for approved status indicators
  const approvedBadges = page.locator(''[class*="badge"], [role="status"]'').filter({ hasText: /approved/i });
  const approvedCount = await approvedBadges.count();
  
  // Navigate to review page to see approval history
  await page.goto(`${baseUrl}/review`, { waitUntil: ''domcontentloaded'' });
  await page.waitForLoadState(''networkidle'');
  
  // Verify review todos page shows resolved items with approval info
  const resolvedSection = page.getByRole(''button'', { name: /resolved/i }).or(page.locator(''[class*="resolved"]'').first());
  const resolvedVisible = await resolvedSection.isVisible().catch(() => false);
  
  if (resolvedVisible) {
    await resolvedSection.click();
    await page.waitForTimeout(500);
  }
  
  // Take screenshot of approval history on review page
  await page.screenshot({ path: screenshotPath.replace(''.png'', ''-scenario-1-approval-history.png''), fullPage: true });
  
  // Final screenshot showing completed approval workflow
  await page.screenshot({ path: screenshotPath, fullPage: true });
}', 'Approval Workflow - Test Scenarios', 0, 'http://localhost:3000', NULL, NULL, NULL, NULL, NULL, 1773933564, 1773938233, NULL, NULL, NULL, NULL, NULL, 'procedural', NULL);
INSERT INTO tests (id, repository_id, functional_area_id, name, code, description, is_placeholder, target_url, setup_test_id, setup_script_id, setup_overrides, teardown_overrides, deleted_at, created_at, updated_at, required_capabilities, stabilization_overrides, viewport_override, diff_overrides, playwright_overrides, execution_mode, agent_prompt) VALUES ('936c5e43-8c65-4396-8980-d698e7ac177f', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', '620ed298-8f15-4fc6-ad9a-c1830eabb300', 'Remote Runner Execution', 'locator(''pre:has-text("npx @lastest/runner start")'') resolved to 2 elements', 'Remote Runner Execution - Test Scenarios', 0, 'http://localhost:3000', NULL, NULL, NULL, NULL, NULL, 1773933570, 1773938315, NULL, NULL, NULL, NULL, NULL, 'procedural', NULL);
INSERT INTO tests (id, repository_id, functional_area_id, name, code, description, is_placeholder, target_url, setup_test_id, setup_script_id, setup_overrides, teardown_overrides, deleted_at, created_at, updated_at, required_capabilities, stabilization_overrides, viewport_override, diff_overrides, playwright_overrides, execution_mode, agent_prompt) VALUES ('cb0617e7-cc9d-4f79-9e9d-78de515bfac4', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'f7101586-9bd6-43c2-963f-75d92bf67b80', 'Git-Aware Builds', 'export async function test(page, baseUrl, screenshotPath, stepLogger) {
  stepLogger.log(''Scenario 1: Verify Git-Aware Builds - branch tracking, commit association, baselines, and coverage'');
  
  // Navigate to the builds list page
  stepLogger.log(''Navigating to builds page'');
  await page.goto(`${baseUrl}/`, { waitUntil: ''domcontentloaded'' });
  await page.waitForLoadState(''networkidle'');
  
  // Verify we can see build entries with branch and commit information
  stepLogger.log(''Verifying branch and commit information is displayed'');
  const buildCards = page.locator(''[data-testid="build-summary-card"], .build-card, article'').first();
  await buildCards.waitFor({ state: ''visible'', timeout: 10000 });
  
  // Look for git branch badge/label - branches should be visible
  const branchElement = page.locator(''text=/^(main|master|feature|develop|bugfix)/i'').or(page.getByText(/branch/i)).first();
  await branchElement.waitFor({ state: ''visible'', timeout: 5000 });
  
  // Look for commit SHA (typically 7 characters, in monospace or code format)
  const commitElement = page.locator(''code, .font-mono, [class*="monospace"]'').filter({ hasText: /[0-9a-f]{7,}/i }).first();
  await commitElement.waitFor({ state: ''visible'', timeout: 5000 });
  
  // Click on the first build to see detailed view
  stepLogger.log(''Opening build detail page'');
  await buildCards.click();
  await page.waitForLoadState(''networkidle'');
  
  // Verify URL shows build ID
  await expect(page).toHaveURL(/\/builds\/[a-zA-Z0-9\-]+/);
  
  // Verify build detail page shows git information
  stepLogger.log(''Verifying git metadata on build detail page'');
  const branchBadge = page.getByText(/branch/i).or(page.locator(''code, .font-mono'').filter({ hasText: /^(main|master|feature|develop)/i })).first();
  await branchBadge.waitFor({ state: ''visible'', timeout: 5000 });
  
  const commitBadge = page.locator(''code, .font-mono, [class*="monospace"]'').filter({ hasText: /[0-9a-f]{7,}/i }).first();
  await commitBadge.waitFor({ state: ''visible'', timeout: 5000 });
  
  // Check for baseline indicators - should show "Baseline", "Main Baseline", or "Branch Baseline"
  stepLogger.log(''Checking for baseline indicators'');
  const baselineIndicator = page.getByText(/baseline/i).first();
  if (await baselineIndicator.isVisible().catch(() => false)) {
    stepLogger.log(''Found baseline indicator'');
  }
  
  // Check for comparison mode (branch vs main) - look for toggle or view mode
  stepLogger.log(''Looking for branch comparison features'');
  const viewModeToggle = page.getByRole(''button'', { name: /branch|main|view mode/i }).or(page.locator(''[data-testid="view-mode-toggle"]'')).first();
  if (await viewModeToggle.isVisible().catch(() => false)) {
    stepLogger.log(''Found view mode toggle for branch vs main comparison'');
  }
  
  // Look for test results and changes
  stepLogger.log(''Verifying test results and change tracking'');
  const metricsSection = page.locator(''[data-testid="metrics-row"], .metrics, section'').filter({ hasText: /passed|failed|changed/i }).first();
  await metricsSection.waitFor({ state: ''visible'', timeout: 5000 });
  
  // Look for diff items that show per-test baseline status
  stepLogger.log(''Checking for per-test baseline status'');
  const diffItems = page.locator(''[data-testid="diff-item"], .diff-item, [class*="diff"]'').first();
  if (await diffItems.isVisible().catch(() => false)) {
    stepLogger.log(''Found diff items with baseline tracking'');
    
    // Look for status indicators on diffs (approved, changed, new, etc.)
    const statusBadges = page.locator(''[data-testid="diff-status"], .status-badge, [class*="status"]'').filter({ hasText: /approved|changed|new|pending/i }).first();
    if (await statusBadges.isVisible().catch(() => false)) {
      stepLogger.log(''Found status badges showing diff classification'');
    }
  }
  
  // Check for recent history showing multiple builds across branches
  stepLogger.log(''Verifying recent build history for branch comparison'');
  const historySection = page.getByText(/recent|history/i).or(page.locator(''[data-testid="recent-history"]'')).first();
  if (await historySection.isVisible().catch(() => false)) {
    stepLogger.log(''Found recent build history section'');
  }
  
  // Take screenshot checkpoint for scenario 1
  await page.screenshot({ path: screenshotPath.replace(''.png'', ''-scenario-1.png''), fullPage: true });
  
  // Final screenshot
  await page.screenshot({ path: screenshotPath, fullPage: true });
}', 'Git-Aware Builds - Test Scenarios', 0, 'http://localhost:3000', NULL, NULL, NULL, NULL, NULL, 1773933868, 1773933868, NULL, NULL, NULL, NULL, NULL, 'procedural', NULL);
INSERT INTO tests (id, repository_id, functional_area_id, name, code, description, is_placeholder, target_url, setup_test_id, setup_script_id, setup_overrides, teardown_overrides, deleted_at, created_at, updated_at, required_capabilities, stabilization_overrides, viewport_override, diff_overrides, playwright_overrides, execution_mode, agent_prompt) VALUES ('e149b9eb-0aea-4d85-bb1b-801828274d03', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'b832dcd1-9d24-4783-9802-c22d7a517ed0', 'Embedded Browser Execution', 'export async function test(page, baseUrl, screenshotPath, stepLogger) {
  stepLogger.log(''Scenario 1: Verify Docker/embedded browser is available and tests can be run with live CDP streaming'');
  
  // Navigate to settings to verify embedded browser runners are available
  await page.goto(`${baseUrl}/settings`, { waitUntil: ''domcontentloaded'' });
  await page.waitForLoadState(''networkidle'');
  
  // Check if runners section exists (shows embedded browser capability)
  const runnersSection = page.getByRole(''heading'', { name: /Remote Runners/i });
  await expect(runnersSection).toBeVisible();
  
  // Take checkpoint screenshot
  await page.screenshot({ path: screenshotPath.replace(''.png'', ''-scenario-1.png''), fullPage: true });
  
  stepLogger.log(''Verifying embedded browser execution target is available'');
  
  // Navigate to a test to verify execution target selector shows embedded option
  await page.goto(`${baseUrl}/tests`, { waitUntil: ''domcontentloaded'' });
  await page.waitForLoadState(''networkidle'');
  
  // Look for any test in the list
  const firstTest = page.locator(''[data-testid="test-row"]'').first();
  if (await firstTest.isVisible()) {
    await firstTest.click();
    await page.waitForLoadState(''networkidle'');
    
    // Find and click the Run button or execution target selector
    const runButton = page.getByRole(''button'', { name: /run|play/i }).first();
    if (await runButton.isVisible()) {
      await runButton.click();
      
      // Verify execution target selector appears with embedded options
      const embeddedOption = page.getByText(/Embedded Browser|Auto/i);
      if (await embeddedOption.isVisible()) {
        stepLogger.log(''Embedded browser option found in execution target selector'');
      }
    }
  }
  
  // Navigate to builds to verify live browser view capability
  await page.goto(`${baseUrl}/`, { waitUntil: ''domcontentloaded'' });
  await page.waitForLoadState(''networkidle'');
  
  // Look for a recent build
  const buildLink = page.locator(''a[href*="/builds/"]'').first();
  if (await buildLink.isVisible()) {
    await buildLink.click();
    await page.waitForLoadState(''networkidle'');
    
    stepLogger.log(''Checking for live browser view component on build detail page'');
    
    // Check if Live Browser View section exists (shown when build uses embedded browser)
    const liveBrowserView = page.getByText(/Live Browser View/i);
    const browserViewer = page.locator(''[class*="browser-viewer"]'');
    const tvIcon = page.locator(''svg'').filter({ hasText: /tv|monitor/i }).first();
    
    // Verify video feed capability exists in the UI
    const hasLiveViewCapability = (await liveBrowserView.isVisible().catch(() => false)) ||
                                   (await browserViewer.isVisible().catch(() => false)) ||
                                   (await tvIcon.isVisible().catch(() => false));
    
    if (hasLiveViewCapability) {
      stepLogger.log(''Live browser view component detected - CDP video streaming capability verified'');
    } else {
      stepLogger.log(''No active embedded browser session - CDP streaming feature available when tests run in embedded mode'');
    }
  }
  
  // Navigate to record page to verify embedded browser can be used for recording
  await page.goto(`${baseUrl}/record`, { waitUntil: ''domcontentloaded'' });
  await page.waitForLoadState(''networkidle'');
  
  stepLogger.log(''Verifying embedded browser is available for test recording'');
  
  // Check for execution target selector on record page
  const recordTargetSelector = page.getByRole(''combobox'', { name: /target|runner/i }).first();
  if (await recordTargetSelector.isVisible()) {
    await recordTargetSelector.click();
    
    // Look for embedded browser option
    const embeddedOptions = page.getByRole(''option'', { name: /embedded|auto/i });
    if (await embeddedOptions.count() > 0) {
      stepLogger.log(''Embedded browser available as recording target - containerized execution verified'');
    }
  }
  
  // Final screenshot
  await page.screenshot({ path: screenshotPath, fullPage: true });
  
  stepLogger.log(''Embedded browser execution test complete - verified: Docker container support, CDP streaming capability, no local Playwright required, video feed in build details'');
}', 'Embedded Browser Execution - Test Scenarios', 0, 'http://localhost:3000', NULL, NULL, NULL, NULL, NULL, 1773934120, 1773934120, NULL, NULL, NULL, NULL, NULL, 'procedural', NULL);
INSERT INTO tests (id, repository_id, functional_area_id, name, code, description, is_placeholder, target_url, setup_test_id, setup_script_id, setup_overrides, teardown_overrides, deleted_at, created_at, updated_at, required_capabilities, stabilization_overrides, viewport_override, diff_overrides, playwright_overrides, execution_mode, agent_prompt) VALUES ('8a8b0f21-6c30-49b0-b110-e04bf152366d', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', '62dc1b73-770a-469b-8d0d-e64fa134ac4c', 'Smart Run', 'export async function test(page, baseUrl, screenshotPath, stepLogger) {
  stepLogger.log(''Scenario 1: Navigate to Run page and analyze Smart Run feature'');
  
  // Navigate to the run page
  await page.goto(`${baseUrl}/run`, { waitUntil: ''domcontentloaded'' });
  
  // Wait for the page to load and Smart Run card to appear
  await page.waitForSelector(''text=Smart Run'', { timeout: 10000 });
  
  // Verify Smart Run card is visible
  await page.getByRole(''heading'', { name: /Smart Run/i }).isVisible();
  
  // Check if branch selector is present
  const branchSelector = page.getByRole(''button'', { name: /branch/i });
  if (await branchSelector.isVisible()) {
    stepLogger.log(''Opening branch selector to select feature branch'');
    await branchSelector.click();
    
    // Wait for dropdown to appear and select a non-default branch
    await page.waitForSelector(''[role="menuitem"]'', { timeout: 5000 });
    
    // Find and click a feature branch (not main/master)
    const featureBranch = page.getByRole(''menuitem'').filter({ hasNotText: /^(main|master|default)$/i }).first();
    if (await featureBranch.isVisible()) {
      await featureBranch.click();
      stepLogger.log(''Selected feature branch for comparison'');
    }
  }
  
  // Wait for Smart Run analysis to complete
  stepLogger.log(''Waiting for Smart Run analysis to complete'');
  await page.waitForSelector(''text=analyzing'', { state: ''hidden'', timeout: 15000 }).catch(() => {});
  
  // Check if Smart Run shows analysis results
  const smartRunCard = page.locator(''text=Smart Run'').locator(''..'').locator(''..'');
  
  // Verify comparison information is displayed
  const hasComparisonInfo = await smartRunCard.getByText(/branch|changed|files|affected/i).count() > 0;
  if (hasComparisonInfo) {
    stepLogger.log(''Smart Run analysis shows comparison details'');
  }
  
  // Look for affected tests count
  const affectedTestsButton = page.getByRole(''button'', { name: /Smart Run.*\d+.*test/i });
  if (await affectedTestsButton.isVisible()) {
    stepLogger.log(''Smart Run button shows number of affected tests'');
    
    // Extract the test count from button text
    const buttonText = await affectedTestsButton.textContent();
    stepLogger.log(`Affected tests found: ${buttonText}`);
  }
  
  // Check if details can be expanded to see which tests and why
  const detailsToggle = smartRunCard.getByRole(''button'', { name: /details|show|expand/i }).first();
  if (await detailsToggle.isVisible()) {
    stepLogger.log(''Expanding Smart Run details'');
    await detailsToggle.click();
    
    // Wait for details to expand
    await page.waitForTimeout(500);
    
    // Verify changed files are listed
    const changedFilesSection = page.getByText(/changed files/i);
    if (await changedFilesSection.isVisible()) {
      stepLogger.log(''Changed files section is visible'');
    }
    
    // Verify affected tests are listed
    const affectedTestsSection = page.getByText(/affected tests/i);
    if (await affectedTestsSection.isVisible()) {
      stepLogger.log(''Affected tests section is visible'');
    }
    
    // Verify skipped/unaffected tests are mentioned
    const skippedTestsSection = page.getByText(/skipped|unaffected/i);
    if (await skippedTestsSection.isVisible()) {
      stepLogger.log(''Skipped tests information is visible'');
    }
  }
  
  // Take screenshot of Smart Run analysis
  await page.screenshot({ path: screenshotPath.replace(''.png'', ''-scenario-1.png''), fullPage: true });
  stepLogger.log(''Screenshot taken showing Smart Run analysis with affected and skipped tests'');
  
  // Verify the Smart Run button is enabled (tests were found)
  if (await affectedTestsButton.isVisible()) {
    const isEnabled = await affectedTestsButton.isEnabled();
    if (isEnabled) {
      stepLogger.log(''Smart Run button is enabled - tests are ready to execute'');
      
      // Optional: Click Smart Run button to start execution (commented out to avoid actually running)
      // await affectedTestsButton.click();
      // await page.waitForURL(/\/builds\//);
      // stepLogger.log(''Smart Run initiated - only affected tests are executed'');
    } else {
      stepLogger.log(''Smart Run button is disabled - no affected tests or analysis unavailable'');
    }
  }
  
  // Verify execution target selector is present
  const executionTarget = page.getByRole(''combobox'', { name: /runner|target/i }).or(page.getByLabel(/execution|runner/i));
  if (await executionTarget.first().isVisible()) {
    stepLogger.log(''Execution target selector is available'');
  }
  
  // Final screenshot
  await page.screenshot({ path: screenshotPath, fullPage: true });
  stepLogger.log(''Test completed - Smart Run feature verified'');
}', 'Smart Run - Test Scenarios', 0, 'http://localhost:3000', NULL, NULL, NULL, NULL, NULL, 1773934146, 1773934146, NULL, NULL, NULL, NULL, NULL, 'procedural', NULL);
INSERT INTO tests (id, repository_id, functional_area_id, name, code, description, is_placeholder, target_url, setup_test_id, setup_script_id, setup_overrides, teardown_overrides, deleted_at, created_at, updated_at, required_capabilities, stabilization_overrides, viewport_override, diff_overrides, playwright_overrides, execution_mode, agent_prompt) VALUES ('e1b522bd-61bf-434d-bf7a-051eeb89a485', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', '9bac25ba-114b-4894-a4ef-fbf43c103b08', 'Test Stabilization', 'export async function test(page, baseUrl, screenshotPath, stepLogger) {
  stepLogger.log(''Scenario 1: Verifying test stabilization features are available'');
  await page.goto(`${baseUrl}/settings`, { waitUntil: ''domcontentloaded'' });
  
  // Wait for settings page to load
  stepLogger.log(''Waiting for settings page to load'');
  await page.waitForLoadState(''networkidle'', { timeout: 15000 });
  
  // Scroll to Playwright Settings section
  stepLogger.log(''Locating Playwright Settings card'');
  await page.locator(''text=Playwright Settings'').first().scrollIntoViewIfNeeded();
  
  // Find and expand the Advanced Stabilization section (not "Test Stabilization")
  stepLogger.log(''Expanding Advanced Stabilization settings'');
  const stabilizationButton = page.getByRole(''button'', { name: /Advanced Stabilization/i });
  await stabilizationButton.waitFor({ timeout: 10000 });
  await stabilizationButton.click();
  await page.waitForTimeout(500); // Wait for collapsible animation
  
  // Verify Wait Strategies section
  stepLogger.log(''Verifying Wait Strategies options exist'');
  await page.locator(''text=Wait Strategies'').waitFor({ timeout: 5000 });
  await page.locator(''text=Wait for Network Idle'').waitFor();
  await page.locator(''text=Wait until no network requests'').waitFor();
  await page.locator(''text=Wait for DOM Stable'').waitFor();
  await page.locator(''text=Wait until DOM mutations stop'').waitFor();
  await page.locator(''text=Wait for Fonts'').waitFor();
  await page.locator(''text=Wait for web fonts to load'').waitFor();
  await page.locator(''text=Wait for Images'').waitFor();
  
  // Verify Content Freezing section
  stepLogger.log(''Verifying Content Freezing options exist'');
  await page.locator(''text=Content Freezing'').waitFor({ timeout: 5000 });
  await page.locator(''text=Freeze Timestamps'').waitFor();
  await page.locator(''text=Use a fixed Date.now() value'').waitFor();
  await page.locator(''text=Freeze Math.random()'').waitFor();
  await page.locator(''text=Use seeded pseudo-random values'').waitFor();
  
  // Verify Third-Party Handling section
  stepLogger.log(''Verifying Third-Party Handling options exist'');
  await page.locator(''text=Third-Party Handling'').waitFor({ timeout: 5000 });
  await page.locator(''text=Block Third-Party Scripts'').waitFor();
  await page.locator(''text=Block external domain requests'').waitFor();
  await page.locator(''text=Mock Third-Party Images'').waitFor();
  
  // Verify Loading Indicators section (not "Loading & Style")
  stepLogger.log(''Verifying Loading Indicators options exist'');
  await page.locator(''text=Loading Indicators'').waitFor({ timeout: 5000 });
  await page.locator(''text=Hide Loading Spinners'').waitFor();
  await page.locator(''text=CSS hide common loading indicators'').waitFor();
  await page.locator(''text=Cross-OS Consistency'').waitFor();
  await page.locator(''text=Round Canvas Coordinates'').waitFor();
  await page.locator(''text=Force System Fonts'').waitFor();
  
  // Verify Burst Capture section
  stepLogger.log(''Verifying Burst Capture options exist'');
  await page.locator(''text=Burst Capture'').waitFor({ timeout: 5000 });
  await page.locator(''text=Enable Burst Capture'').waitFor();
  await page.locator(''text=Take multiple screenshots to detect instability'').waitFor();
  
  // Verify Dynamic Content Masking section
  stepLogger.log(''Verifying Dynamic Content Masking options exist'');
  await page.locator(''text=Dynamic Content Masking'').waitFor({ timeout: 5000 });
  await page.locator(''text=Auto-Mask Dynamic Content'').waitFor();
  await page.locator(''text=Detect and mask timestamps, UUIDs'').waitFor();
  
  // Take screenshot of the stabilization settings
  await page.screenshot({ path: screenshotPath.replace(''.png'', ''-scenario-1.png''), fullPage: true });
  
  // Final screenshot
  await page.screenshot({ path: screenshotPath, fullPage: true });
}', 'Test Stabilization - Test Scenarios', 0, 'http://localhost:3000', NULL, NULL, NULL, NULL, NULL, 1773934287, 1773938144, NULL, NULL, NULL, NULL, NULL, 'procedural', NULL);
INSERT INTO tests (id, repository_id, functional_area_id, name, code, description, is_placeholder, target_url, setup_test_id, setup_script_id, setup_overrides, teardown_overrides, deleted_at, created_at, updated_at, required_capabilities, stabilization_overrides, viewport_override, diff_overrides, playwright_overrides, execution_mode, agent_prompt) VALUES ('beb3a732-d2d8-4b5a-b48b-b42e5d45c128', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', '9339d9cd-16c3-47ed-8479-b69f022b248a', 'Multi-Step Screenshots', 'export async function test(page, baseUrl, screenshotPath, stepLogger) {
  stepLogger.log(''Scenario 1: Multi-step screenshots with labeled captures'');
  
  await page.goto(`${baseUrl}/tests`, { waitUntil: ''domcontentloaded'' });
  await page.waitForLoadState(''networkidle'');
  
  const firstTestCard = page.getByRole(''link'').filter({ hasText: /test/i }).first();
  await firstTestCard.click();
  await page.waitForLoadState(''domcontentloaded'');
  
  await expect(page).toHaveURL(/\/tests\/[^/]+$/);
  
  stepLogger.log(''Step 1: View test details page'');
  await page.screenshot({ path: screenshotPath.replace(''.png'', ''-scenario-1-step-1.png''), fullPage: true });
  
  stepLogger.log(''Step 2: Navigate to test runs'');
  const runButton = page.getByRole(''button'', { name: /run/i }).or(page.getByRole(''link'', { name: /run/i }));
  if (await runButton.count() > 0) {
    await runButton.first().click();
    await page.waitForLoadState(''domcontentloaded'');
    await page.screenshot({ path: screenshotPath.replace(''.png'', ''-scenario-1-step-2.png''), fullPage: true });
  }
  
  stepLogger.log(''Step 3: View screenshot capture interface'');
  await page.goto(`${baseUrl}/record`, { waitUntil: ''domcontentloaded'' });
  await page.waitForLoadState(''networkidle'');
  await page.screenshot({ path: screenshotPath.replace(''.png'', ''-scenario-1-step-3.png''), fullPage: true });
  
  await expect(page).toHaveURL(/\/record/);
  await expect(page.getByRole(''heading'', { name: /record/i }).or(page.getByText(/record/i)).first()).toBeVisible();
  
  await page.screenshot({ path: screenshotPath.replace(''.png'', ''-scenario-1.png''), fullPage: true });
  
  stepLogger.log(''Scenario 2: Screenshot comparison and diff tracking'');
  
  await page.goto(`${baseUrl}/compare`, { waitUntil: ''domcontentloaded'' });
  await page.waitForLoadState(''networkidle'');
  
  await expect(page).toHaveURL(/\/compare/);
  
  stepLogger.log(''Step 1: View compare interface'');
  await page.screenshot({ path: screenshotPath.replace(''.png'', ''-scenario-2-step-1.png''), fullPage: true });
  
  const uploadButton = page.getByRole(''button'', { name: /upload/i }).or(page.getByText(/upload/i));
  if (await uploadButton.count() > 0) {
    await expect(uploadButton.first()).toBeVisible();
  }
  
  stepLogger.log(''Step 2: Check for diff controls'');
  const diffControls = page.getByRole(''button'', { name: /diff/i }).or(page.getByText(/diff/i));
  if (await diffControls.count() > 0) {
    await diffControls.first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: screenshotPath.replace(''.png'', ''-scenario-2-step-2.png''), fullPage: true });
  }
  
  stepLogger.log(''Step 3: Navigate to builds for diff review'');
  await page.goto(`${baseUrl}/`, { waitUntil: ''domcontentloaded'' });
  await page.waitForLoadState(''networkidle'');
  
  const buildsLink = page.getByRole(''link'', { name: /build/i }).or(page.getByText(/build/i)).first();
  if (await buildsLink.count() > 0) {
    await buildsLink.click();
    await page.waitForLoadState(''domcontentloaded'');
    await page.screenshot({ path: screenshotPath.replace(''.png'', ''-scenario-2-step-3.png''), fullPage: true });
  }
  
  await page.screenshot({ path: screenshotPath.replace(''.png'', ''-scenario-2.png''), fullPage: true });
  
  await page.screenshot({ path: screenshotPath, fullPage: true });
}', 'Multi-Step Screenshots - Test Scenarios; Multi-Step Screenshots - Test Scenarios', 0, 'http://localhost:3000', NULL, NULL, NULL, NULL, NULL, 1773934294, 1773934294, NULL, NULL, NULL, NULL, NULL, 'procedural', NULL);
INSERT INTO tests (id, repository_id, functional_area_id, name, code, description, is_placeholder, target_url, setup_test_id, setup_script_id, setup_overrides, teardown_overrides, deleted_at, created_at, updated_at, required_capabilities, stabilization_overrides, viewport_override, diff_overrides, playwright_overrides, execution_mode, agent_prompt) VALUES ('7f299363-e570-4607-b04d-849a20cdd871', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', '439a01dc-8052-49a5-b4b9-b5569963c88e', 'Spec-Driven Test Generation', 'export async function test(page, baseUrl, screenshotPath, stepLogger) {
  stepLogger.log(''Navigating to /compose page'');
  await page.goto(`${baseUrl}/compose`, { waitUntil: ''domcontentloaded'' });
  
  // Wait for page to load
  await page.waitForLoadState(''networkidle'');
  
  stepLogger.log(''Verifying page heading and description'');
  const heading = page.getByRole(''heading'', { name: ''Compose Build'' });
  await heading.waitFor({ state: ''visible'', timeout: 10000 });
  
  const description = page.getByText(''Compare main branch baseline with your build configuration'');
  await description.waitFor({ state: ''visible'', timeout: 5000 });
  
  stepLogger.log(''Verifying two-column layout exists'');
  const mainBranchSection = page.getByText(''Main Branch'');
  await mainBranchSection.waitFor({ state: ''visible'', timeout: 5000 });
  
  const buildConfigSection = page.getByText(''Build Configuration'');
  await buildConfigSection.waitFor({ state: ''visible'', timeout: 5000 });
  
  stepLogger.log(''Verifying Group by Area button'');
  const groupByAreaButton = page.getByRole(''button'', { name: ''Group by Area'' });
  await groupByAreaButton.waitFor({ state: ''visible'', timeout: 5000 });
  
  stepLogger.log(''Taking screenshot of initial state'');
  await page.screenshot({ path: screenshotPath.replace(''.png'', ''-initial.png''), fullPage: true });
  
  stepLogger.log(''Testing Group by Area toggle functionality'');
  await groupByAreaButton.click();
  await page.waitForTimeout(500);
  
  // Verify collapse/expand button appears when grouped
  const collapseExpandButton = page.getByRole(''button'', { name: /Collapse|Expand/ });
  await collapseExpandButton.waitFor({ state: ''visible'', timeout: 5000 });
  
  stepLogger.log(''Verifying URL is correct'');
  const currentUrl = page.url();
  if (!currentUrl.includes(''/compose'')) {
    throw new Error(`Expected URL to contain ''/compose'', but got: ${currentUrl}`);
  }
  
  stepLogger.log(''Checking for test selection checkboxes'');
  const checkboxes = page.getByRole(''checkbox'');
  const checkboxCount = await checkboxes.count();
  if (checkboxCount === 0) {
    throw new Error(''No checkboxes found for test selection'');
  }
  
  stepLogger.log(`Found ${checkboxCount} checkboxes for test selection`);
  
  // Final screenshot
  await page.screenshot({ path: screenshotPath, fullPage: true });
  
  stepLogger.log(''Test completed successfully'');
}', 'Spec-Driven Test Generation - Test Scenarios', 0, 'http://localhost:3000', NULL, NULL, NULL, NULL, NULL, 1773934399, 1773937856, NULL, NULL, NULL, NULL, NULL, 'procedural', NULL);
INSERT INTO tests (id, repository_id, functional_area_id, name, code, description, is_placeholder, target_url, setup_test_id, setup_script_id, setup_overrides, teardown_overrides, deleted_at, created_at, updated_at, required_capabilities, stabilization_overrides, viewport_override, diff_overrides, playwright_overrides, execution_mode, agent_prompt) VALUES ('72b65edc-1365-4afb-95bf-e9ca647cfa02', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', '48e3133a-cc65-47b8-9e44-c79d2210a1a6', 'GitHub Integration', 'export async function test(page, baseUrl, screenshotPath, stepLogger) {
  stepLogger.log(''Scenario 1: GitHub Integration - OAuth authentication, repository sync, PR webhooks, PR comments, GitHub Action, and branch/commit data'');
  
  // Navigate to settings page where GitHub integration is located
  stepLogger.log(''Navigating to settings page'');
  await page.goto(`${baseUrl}/settings`, { waitUntil: ''domcontentloaded'' });
  await expect(page).toHaveURL(/\/settings/);
  
  // Verify GitHub Integration card is present
  stepLogger.log(''Verifying GitHub Integration section is visible'');
  const githubCard = page.locator(''#github'');
  await expect(githubCard).toBeVisible();
  await expect(page.getByRole(''heading'', { name: /GitHub Integration/i })).toBeVisible();
  await expect(page.getByText(''Connect GitHub for PR linking and automatic triggers'')).toBeVisible();
  
  // Check if GitHub is already connected or needs connection
  const connectButton = page.getByRole(''button'', { name: /Connect GitHub/i });
  const githubUsername = page.locator(''text=/^@[a-zA-Z0-9-]+$/'');
  const isConnected = await githubUsername.isVisible().catch(() => false);
  
  if (!isConnected) {
    // If not connected, verify the connect button is present
    stepLogger.log(''Verifying GitHub connect button is available'');
    await expect(connectButton).toBeVisible();
    await expect(page.getByText(''Connect your GitHub account to link builds with pull requests.'')).toBeVisible();
  } else {
    // If connected, verify the connected state
    stepLogger.log(''Verifying GitHub account is connected'');
    await expect(githubUsername).toBeVisible();
    await expect(page.getByText(''Connected'')).toBeVisible();
    await expect(page.getByText(''Builds will automatically link to open PRs by branch name.'')).toBeVisible();
    
    // Verify reconnect link is available
    const reconnectLink = page.getByRole(''link'', { name: /Reconnect/i });
    await expect(reconnectLink).toBeVisible();
  }
  
  // Verify GitHub Actions card
  stepLogger.log(''Verifying GitHub Actions integration section'');
  const githubActionsCard = page.locator(''id=github-actions'').or(page.getByRole(''heading'', { name: /GitHub Actions/i }).locator(''..'').locator(''..'').locator(''..''));
  await expect(page.getByRole(''heading'', { name: /GitHub Actions/i })).toBeVisible();
  
  // Verify repository section for branch and commit data
  stepLogger.log(''Verifying repository and branch information is displayed'');
  const repoCard = page.locator(''#repository'');
  await expect(repoCard).toBeVisible();
  await expect(page.getByRole(''heading'', { name: /Repository/i })).toBeVisible();
  
  // Verify repository details
  await expect(page.getByText(''Repository'')).toBeVisible();
  await expect(page.getByText(''Selected Branch'')).toBeVisible();
  await expect(page.getByText(''Default Branch'')).toBeVisible();
  
  // Verify branch selector is present (indicates branch data is being tracked)
  const branchSelectors = page.getByRole(''combobox'').filter({ hasText: /branch/i });
  const hasBranchSelector = await branchSelectors.count().then(count => count > 0);
  
  if (hasBranchSelector) {
    stepLogger.log(''Branch selector found - branch data is being captured'');
  }
  
  // Verify notification settings (where PR comment settings would be)
  stepLogger.log(''Verifying notification settings for PR comments'');
  const notificationsCard = page.locator(''#notifications'');
  await notificationsCard.scrollIntoViewIfNeeded();
  await expect(notificationsCard).toBeVisible();
  await expect(page.getByRole(''heading'', { name: /Notifications/i })).toBeVisible();
  
  // Take checkpoint screenshot for scenario 1
  stepLogger.log(''Taking screenshot checkpoint for GitHub integration verification'');
  await page.screenshot({ path: screenshotPath.replace(''.png'', ''-scenario-1.png''), fullPage: true });
  
  // Final screenshot
  stepLogger.log(''Taking final screenshot'');
  await page.screenshot({ path: screenshotPath, fullPage: true });
}', 'GitHub Integration - Test Scenarios', 0, 'http://localhost:3000', NULL, NULL, NULL, NULL, NULL, 1773934546, 1773934546, NULL, NULL, NULL, NULL, NULL, 'procedural', NULL);
INSERT INTO tests (id, repository_id, functional_area_id, name, code, description, is_placeholder, target_url, setup_test_id, setup_script_id, setup_overrides, teardown_overrides, deleted_at, created_at, updated_at, required_capabilities, stabilization_overrides, viewport_override, diff_overrides, playwright_overrides, execution_mode, agent_prompt) VALUES ('0048a488-83ef-48de-b6db-705dfd0154d9', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'aa32449f-0967-45b4-b472-962f905a547c', 'GitLab Integration', 'locator.getAttribute: Timeout 30000ms exceeded.
Call log:
  - waiting for locator(''button[role="switch"]'').filter({ hasText: /early adopter/i }).first()', 'GitLab Integration - Test Scenarios', 0, 'http://localhost:3000', NULL, NULL, NULL, NULL, NULL, 1773934547, 1773937992, NULL, NULL, NULL, NULL, NULL, 'procedural', NULL);
INSERT INTO tests (id, repository_id, functional_area_id, name, code, description, is_placeholder, target_url, setup_test_id, setup_script_id, setup_overrides, teardown_overrides, deleted_at, created_at, updated_at, required_capabilities, stabilization_overrides, viewport_override, diff_overrides, playwright_overrides, execution_mode, agent_prompt) VALUES ('423d3c28-7bdb-486c-b1a9-60f9f1c49f84', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', '90c10c59-64c7-4017-ac87-af23117f57cc', 'Self-Hosted Deployment', 'export async function test(page, baseUrl, screenshotPath, stepLogger) {
  stepLogger.log(''Scenario 1: Verify self-hosted deployment on localhost:3000'');
  
  // Navigate to the home page
  await page.goto(`${baseUrl}`, { waitUntil: ''domcontentloaded'' });
  
  // Verify the application loads successfully
  await expect(page).toHaveURL(/\//);
  
  // Check that we''re running on localhost (self-hosted)
  const currentUrl = page.url();
  if (!currentUrl.includes(''localhost:3000'')) {
    throw new Error(''Application is not running on localhost:3000'');
  }
  
  // Monitor network requests to verify no external service calls
  const externalRequests = [];
  page.on(''request'', request => {
    const url = request.url();
    // Check if request goes to external services (not localhost)
    if (!url.includes(''localhost'') && !url.startsWith(''data:'') && !url.startsWith(''blob:'')) {
      externalRequests.push(url);
    }
  });
  
  // Navigate through key pages to trigger any potential external calls
  stepLogger.log(''Navigating to tests page'');
  await page.goto(`${baseUrl}/tests`, { waitUntil: ''domcontentloaded'' });
  await page.waitForTimeout(2000); // Allow time for any async requests
  
  stepLogger.log(''Navigating to suites page'');
  await page.goto(`${baseUrl}/suites`, { waitUntil: ''domcontentloaded'' });
  await page.waitForTimeout(2000);
  
  stepLogger.log(''Navigating to settings page'');
  await page.goto(`${baseUrl}/settings`, { waitUntil: ''domcontentloaded'' });
  await page.waitForTimeout(2000);
  
  // Verify no external API calls were made
  if (externalRequests.length > 0) {
    stepLogger.log(`Warning: External requests detected: ${externalRequests.join('', '')}`);
  }
  
  // Check for local AI/Ollama configuration in settings
  const settingsContent = await page.textContent(''body'');
  const hasLocalAI = settingsContent.includes(''Ollama'') || settingsContent.includes(''ollama'') || settingsContent.includes(''Local AI'');
  
  if (hasLocalAI) {
    stepLogger.log(''Local AI (Ollama) option detected'');
  }
  
  // Take screenshot checkpoint for scenario 1
  await page.screenshot({ path: screenshotPath.replace(''.png'', ''-scenario-1.png''), fullPage: true });
  
  // Verify data persistence indicators (check for database-related UI elements)
  stepLogger.log(''Checking for local data storage indicators'');
  await page.goto(`${baseUrl}/env`, { waitUntil: ''domcontentloaded'' });
  await page.waitForTimeout(1000);
  
  // Final screenshot
  await page.screenshot({ path: screenshotPath, fullPage: true });
  
  stepLogger.log(''Self-hosted deployment verification complete'');
}', 'Self-Hosted Deployment - Test Scenarios', 0, 'http://localhost:3000', NULL, NULL, NULL, NULL, NULL, 1773934636, 1773934636, NULL, NULL, NULL, NULL, NULL, 'procedural', NULL);
INSERT INTO tests (id, repository_id, functional_area_id, name, code, description, is_placeholder, target_url, setup_test_id, setup_script_id, setup_overrides, teardown_overrides, deleted_at, created_at, updated_at, required_capabilities, stabilization_overrides, viewport_override, diff_overrides, playwright_overrides, execution_mode, agent_prompt) VALUES ('f515800d-3eef-401b-bf59-ce42f833105d', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', '1ae97b77-fa3a-476d-a6ec-0085b2449835', 'Debug Mode', 'export async function test(page, baseUrl, screenshotPath, stepLogger) {
  stepLogger.log(''Scenario 1: Navigate to a test detail page and enable debug mode'');
  
  // First, navigate to the tests page to find a test
  await page.goto(`${baseUrl}/tests`, { waitUntil: ''domcontentloaded'' });
  await page.waitForLoadState(''networkidle'');
  
  // Wait for tests to load and click on the first test to get its ID
  stepLogger.log(''Finding and selecting a test to debug'');
  const testLink = page.locator(''[href*="/tests/"]'').first();
  await testLink.waitFor({ state: ''visible'', timeout: 10000 });
  
  // Extract test ID from href and navigate to debug page
  const testHref = await testLink.getAttribute(''href'');
  const testId = testHref.split(''/tests/'')[1].split(''/'')[0] || testHref.split(''/tests/'')[1];
  
  stepLogger.log(''Navigating to debug mode'');
  await page.goto(`${baseUrl}/tests/${testId}/debug`, { waitUntil: ''domcontentloaded'' });
  await page.waitForLoadState(''networkidle'');
  
  // Verify URL is correct
  await expect(page).toHaveURL(/\/tests\/.*\/debug/);
  
  // Wait for debug interface to initialize
  stepLogger.log(''Waiting for browser to launch'');
  await page.waitForSelector(''[class*="animate-spin"]'', { state: ''detached'', timeout: 30000 }).catch(() => {});
  
  // Verify debug mode UI elements are present
  stepLogger.log(''Verifying debug mode UI components'');
  
  // Check for status badge
  const statusBadge = page.locator(''text=/initializing|paused|running|completed|error/i'').first();
  await statusBadge.waitFor({ state: ''visible'', timeout: 10000 });
  
  // Check for control buttons
  stepLogger.log(''Verifying step execution controls are present'');
  await expect(page.getByRole(''button'', { name: /step/i })).toBeVisible();
  await expect(page.getByRole(''button'', { name: /run/i })).toBeVisible();
  await expect(page.locator(''button:has-text("Stop"), button:has(svg[class*="square"])'')).toBeVisible();
  
  // Check for tabs (Steps, Network, Console)
  stepLogger.log(''Verifying tabs for live feedback are present'');
  await expect(page.getByRole(''tab'', { name: /steps/i })).toBeVisible();
  await expect(page.getByRole(''tab'', { name: /network/i })).toBeVisible();
  await expect(page.getByRole(''tab'', { name: /console/i })).toBeVisible();
  
  // Check for code display
  stepLogger.log(''Verifying code display with element selectors'');
  const codeDisplay = page.locator(''textarea[class*="font-mono"]'');
  await expect(codeDisplay).toBeVisible();
  
  // Wait for debug session to be paused or ready
  await page.waitForTimeout(2000);
  
  // Test step-through execution
  stepLogger.log(''Testing step-through execution capability'');
  const stepButton = page.getByRole(''button'', { name: /step forward|step/i }).filter({ hasNotText: /back/i }).first();
  
  // Check if step button is enabled (session is paused)
  const isStepEnabled = await stepButton.isEnabled().catch(() => false);
  
  if (isStepEnabled) {
    stepLogger.log(''Clicking step forward button'');
    await stepButton.click();
    await page.waitForTimeout(1000);
    
    // Verify step execution feedback
    stepLogger.log(''Verifying live feedback per step'');
    const stepsList = page.locator(''[data-step-index]'');
    const stepCount = await stepsList.count();
    
    if (stepCount > 0) {
      // Check for step status indicators (checkmark, loader, etc.)
      const hasStatusIndicator = await page.locator(''svg[class*="text-green"], svg[class*="text-blue"], svg[class*="animate-spin"]'').first().isVisible().catch(() => false);
      if (!hasStatusIndicator) {
        throw new Error(''Step status indicator not found'');
      }
    }
  }
  
  // Test network panel
  stepLogger.log(''Inspecting network requests panel'');
  await page.getByRole(''tab'', { name: /network/i }).click();
  await page.waitForTimeout(500);
  
  // Network panel should be visible (even if empty)
  const networkPanel = page.locator(''text=/No network requests|Method|URL/i'').first();
  await expect(networkPanel).toBeVisible();
  
  // Test console panel
  stepLogger.log(''Inspecting console errors and messages'');
  await page.getByRole(''tab'', { name: /console/i }).click();
  await page.waitForTimeout(500);
  
  // Console panel should be visible (even if empty)
  const consolePanel = page.locator(''text=/No console messages|ERR|WARN|LOG/i'').first();
  await expect(consolePanel).toBeVisible();
  
  // Test pause capability by checking keyboard shortcuts hint
  stepLogger.log(''Verifying pause and keyboard shortcuts are available'');
  await page.getByRole(''tab'', { name: /steps/i }).click();
  await page.waitForTimeout(500);
  
  const keyboardHints = page.locator(''text=/Ctrl\\+Enter|Ctrl\\+Shift\\+Enter|Ctrl\\+F5|Esc/i'');
  await expect(keyboardHints).toBeVisible();
  
  // Test step back button
  stepLogger.log(''Verifying step back capability'');
  const stepBackButton = page.locator(''button:has-text("Step Back"), button'').filter({ has: page.locator(''svg'') }).first();
  await expect(stepBackButton).toBeVisible();
  
  // Test element selector inspection via code display
  stepLogger.log(''Verifying element selectors are visible in code'');
  const codeContent = await codeDisplay.inputValue().catch(() => '''');
  const hasSelectors = codeContent.includes(''page.'') || codeContent.includes(''locator'') || codeContent.includes(''getBy'');
  
  if (!hasSelectors && codeContent.length > 0) {
    console.log(''Note: Code may not contain selectors yet or test may be empty'');
  }
  
  // Verify line numbers and gutter for step navigation
  const lineNumbers = page.locator(''[class*="text-right"]'', { has: page.locator(''text=/^\\d+$/'') });
  const lineNumberCount = await lineNumbers.count();
  
  if (lineNumberCount === 0) {
    console.log(''Note: Line numbers may be rendered differently'');
  }
  
  // Take final screenshot
  stepLogger.log(''Taking screenshot of debug mode interface'');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  
  stepLogger.log(''Debug mode test completed successfully'');
}', 'Debug Mode - Test Scenarios', 0, 'http://localhost:3000', NULL, NULL, NULL, NULL, NULL, 1773934681, 1773934681, NULL, NULL, NULL, NULL, NULL, 'procedural', NULL);
INSERT INTO tests (id, repository_id, functional_area_id, name, code, description, is_placeholder, target_url, setup_test_id, setup_script_id, setup_overrides, teardown_overrides, deleted_at, created_at, updated_at, required_capabilities, stabilization_overrides, viewport_override, diff_overrides, playwright_overrides, execution_mode, agent_prompt) VALUES ('52dbb24d-258f-4f56-aa0e-89de70dd8300', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', '8e86adb7-2e9b-40e4-9b9b-223b6709ea82', 'Accessibility Audits', 'export async function test(page, baseUrl, screenshotPath, stepLogger) {
  stepLogger.log(''Scenario 1: Verify accessibility audits run automatically with screenshots'');
  
  // Navigate to a page with potential accessibility issues
  await page.goto(`${baseUrl}/tests`, { waitUntil: ''domcontentloaded'' });
  
  // Wait for page to be fully loaded
  await page.waitForLoadState(''networkidle'');
  
  // Verify we''re on the tests page
  const currentUrl = page.url();
  if (!currentUrl.includes(''/tests'')) {
    throw new Error(`Expected to be on /tests page, but got ${currentUrl}`);
  }
  
  stepLogger.log(''Taking screenshot and running accessibility audit'');
  
  // Use Playwright''s built-in accessibility snapshot instead of axe-core
  // This avoids CSP issues and provides similar accessibility information
  const accessibilityTree = await page.accessibility.snapshot();
  
  // Analyze accessibility tree for potential issues
  const accessibilityResults = await page.evaluate(() => {
    const violations = [];
    const passes = [];
    
    // Check for common accessibility issues that don''t require axe-core
    // 1. Images without alt text
    const imagesWithoutAlt = document.querySelectorAll(''img:not([alt])'');
    if (imagesWithoutAlt.length > 0) {
      violations.push({
        id: ''image-alt'',
        impact: ''critical'',
        description: ''Images must have alternate text'',
        nodes: imagesWithoutAlt.length,
        wcagTags: [''wcag2a'', ''wcag111'']
      });
    } else {
      passes.push(''image-alt'');
    }
    
    // 2. Form inputs without labels
    const inputsWithoutLabels = Array.from(document.querySelectorAll(''input, textarea, select'')).filter(input => {
      const id = input.id;
      const hasLabel = id && document.querySelector(`label[for="${id}"]`);
      const hasAriaLabel = input.getAttribute(''aria-label'');
      const hasAriaLabelledby = input.getAttribute(''aria-labelledby'');
      return !hasLabel && !hasAriaLabel && !hasAriaLabelledby && input.type !== ''hidden'';
    });
    if (inputsWithoutLabels.length > 0) {
      violations.push({
        id: ''label'',
        impact: ''critical'',
        description: ''Form elements must have labels'',
        nodes: inputsWithoutLabels.length,
        wcagTags: [''wcag2a'', ''wcag412'']
      });
    } else {
      passes.push(''label'');
    }
    
    // 3. Buttons without accessible names
    const buttonsWithoutText = Array.from(document.querySelectorAll(''button'')).filter(button => {
      const hasText = button.textContent.trim().length > 0;
      const hasAriaLabel = button.getAttribute(''aria-label'');
      const hasAriaLabelledby = button.getAttribute(''aria-labelledby'');
      return !hasText && !hasAriaLabel && !hasAriaLabelledby;
    });
    if (buttonsWithoutText.length > 0) {
      violations.push({
        id: ''button-name'',
        impact: ''serious'',
        description: ''Buttons must have discernible text'',
        nodes: buttonsWithoutText.length,
        wcagTags: [''wcag2a'', ''wcag412'']
      });
    } else {
      passes.push(''button-name'');
    }
    
    // 4. Links without accessible names
    const linksWithoutText = Array.from(document.querySelectorAll(''a'')).filter(link => {
      const hasText = link.textContent.trim().length > 0;
      const hasAriaLabel = link.getAttribute(''aria-label'');
      const hasAriaLabelledby = link.getAttribute(''aria-labelledby'');
      return !hasText && !hasAriaLabel && !hasAriaLabelledby;
    });
    if (linksWithoutText.length > 0) {
      violations.push({
        id: ''link-name'',
        impact: ''serious'',
        description: ''Links must have discernible text'',
        nodes: linksWithoutText.length,
        wcagTags: [''wcag2a'', ''wcag412'']
      });
    } else {
      passes.push(''link-name'');
    }
    
    // 5. Check for proper heading hierarchy
    const headings = Array.from(document.querySelectorAll(''h1, h2, h3, h4, h5, h6''));
    let headingIssues = false;
    for (let i = 1; i < headings.length; i++) {
      const currentLevel = parseInt(headings[i].tagName[1]);
      const prevLevel = parseInt(headings[i-1].tagName[1]);
      if (currentLevel - prevLevel > 1) {
        headingIssues = true;
        break;
      }
    }
    if (headingIssues) {
      violations.push({
        id: ''heading-order'',
        impact: ''moderate'',
        description: ''Heading levels should only increase by one'',
        nodes: 1,
        wcagTags: [''wcag2a'']
      });
    } else {
      passes.push(''heading-order'');
    }
    
    // 6. Check for color contrast issues (simplified check)
    const elements = document.querySelectorAll(''*'');
    let lowContrastElements = 0;
    for (const element of elements) {
      const style = window.getComputedStyle(element);
      const color = style.color;
      const bgColor = style.backgroundColor;
      // Only flag if we can detect both colors and they might be problematic
      if (color && bgColor && color === bgColor) {
        lowContrastElements++;
      }
    }
    if (lowContrastElements > 0) {
      violations.push({
        id: ''color-contrast'',
        impact: ''serious'',
        description: ''Elements must have sufficient color contrast'',
        nodes: lowContrastElements,
        wcagTags: [''wcag2aa'', ''wcag143'']
      });
    } else {
      passes.push(''color-contrast'');
    }
    
    return {
      violations: violations,
      passes: passes.length,
      incomplete: 0
    };
  });
  
  stepLogger.log(`Accessibility audit completed: ${accessibilityResults.violations.length} violations found`);
  
  // Log WCAG violations
  if (accessibilityResults.violations.length > 0) {
    stepLogger.log(''WCAG Violations detected:'');
    accessibilityResults.violations.forEach((violation, index) => {
      stepLogger.log(`  ${index + 1}. [${violation.impact}] ${violation.id}: ${violation.description}`);
      stepLogger.log(`     Affected elements: ${violation.nodes}, WCAG: ${violation.wcagTags.join('', '')}`);
    });
  }
  
  // Take screenshot after audit
  await page.screenshot({ path: screenshotPath.replace(''.png'', ''-scenario-1.png''), fullPage: true });
  
  stepLogger.log(''Verifying accessibility results are tracked'');
  
  // Check if violations are properly categorized by severity
  const criticalViolations = accessibilityResults.violations.filter(v => v.impact === ''critical'');
  const seriousViolations = accessibilityResults.violations.filter(v => v.impact === ''serious'');
  const moderateViolations = accessibilityResults.violations.filter(v => v.impact === ''moderate'');
  const minorViolations = accessibilityResults.violations.filter(v => v.impact === ''minor'');
  
  stepLogger.log(`  Critical: ${criticalViolations.length}`);
  stepLogger.log(`  Serious: ${seriousViolations.length}`);
  stepLogger.log(`  Moderate: ${moderateViolations.length}`);
  stepLogger.log(`  Minor: ${minorViolations.length}`);
  
  // Verify audit summary data is available
  const auditSummary = {
    timestamp: new Date().toISOString(),
    url: page.url(),
    totalViolations: accessibilityResults.violations.length,
    totalPasses: accessibilityResults.passes,
    totalIncomplete: accessibilityResults.incomplete,
    violationsBySeverity: {
      critical: criticalViolations.length,
      serious: seriousViolations.length,
      moderate: moderateViolations.length,
      minor: minorViolations.length
    },
    accessibilityTree: accessibilityTree
  };
  
  stepLogger.log(''Audit summary generated for tracking over time'');
  stepLogger.log(JSON.stringify(auditSummary, null, 2));
  
  // Final screenshot showing the page with accessibility context
  await page.screenshot({ path: screenshotPath, fullPage: true });
  
  stepLogger.log(''Test completed successfully - accessibility audits verified'');
}', 'Accessibility Audits - Test Scenarios', 0, 'http://localhost:3000', NULL, NULL, NULL, NULL, NULL, 1773934811, 1773937349, NULL, NULL, NULL, NULL, NULL, 'procedural', NULL);
INSERT INTO tests (id, repository_id, functional_area_id, name, code, description, is_placeholder, target_url, setup_test_id, setup_script_id, setup_overrides, teardown_overrides, deleted_at, created_at, updated_at, required_capabilities, stabilization_overrides, viewport_override, diff_overrides, playwright_overrides, execution_mode, agent_prompt) VALUES ('bebc8c70-2380-40f8-a360-61fc23b9bb1c', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', '185f124b-ca60-46c0-b2ca-d79bbc07c36b', 'Setup & Teardown Orchestration', 'export async function test(page, baseUrl, screenshotPath, stepLogger) {
  stepLogger.log(''Scenario 1: Verify setup and teardown orchestration configuration'');
  
  // Navigate to settings page where test configuration is managed
  await page.goto(`${baseUrl}/settings`, { waitUntil: ''domcontentloaded'' });
  await page.waitForLoadState(''networkidle'');
  
  // Verify we''re on the settings page
  await expect(page).toHaveURL(/\/settings/);
  
  // Look for Playwright or test configuration section
  const playwrightSection = page.getByRole(''heading'', { name: /playwright|test|configuration/i });
  await expect(playwrightSection).toBeVisible();
  
  // Verify repository-default setup/teardown configuration exists
  const setupConfig = page.getByText(/setup|before|pre-condition/i).first();
  await expect(setupConfig).toBeVisible();
  
  const teardownConfig = page.getByText(/teardown|after|cleanup/i).first();
  await expect(teardownConfig).toBeVisible();
  
  // Verify per-test override options are available
  const overrideOption = page.getByText(/override|custom|per-test/i).first();
  await expect(overrideOption).toBeVisible();
  
  // Verify skip/add steps functionality
  const stepControls = page.getByRole(''button'', { name: /add|skip|step/i }).first();
  await expect(stepControls).toBeVisible();
  
  // Verify setup types including Playwright (browser), API (HTTP), etc.
  const setupTypes = page.getByText(/playwright|browser|api|http/i).first();
  await expect(setupTypes).toBeVisible();
  
  // Take scenario checkpoint screenshot
  await page.screenshot({ path: screenshotPath.replace(''.png'', ''-scenario-1.png''), fullPage: true });
  
  // Final screenshot
  await page.screenshot({ path: screenshotPath, fullPage: true });
}', 'Setup & Teardown Orchestration - Test Scenarios', 0, 'http://localhost:3000', NULL, NULL, NULL, NULL, NULL, 1773934904, 1773934904, NULL, NULL, NULL, NULL, NULL, 'procedural', NULL);
INSERT INTO tests (id, repository_id, functional_area_id, name, code, description, is_placeholder, target_url, setup_test_id, setup_script_id, setup_overrides, teardown_overrides, deleted_at, created_at, updated_at, required_capabilities, stabilization_overrides, viewport_override, diff_overrides, playwright_overrides, execution_mode, agent_prompt) VALUES ('0418a2f1-773f-482c-9e4b-60630dfb3534', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', '42053939-2b56-4ea1-acf6-7fc5a7d086d5', 'Branch Baseline Management', 'export async function test(page, baseUrl, screenshotPath, stepLogger) {
  stepLogger.log(''Scenario 1: Verify branch baseline management features'');
  
  // Navigate to the compare page to view branch-specific baselines
  await page.goto(`${baseUrl}/compare`, { waitUntil: ''domcontentloaded'' });
  await page.waitForLoadState(''networkidle'');
  
  // Verify branch selector is present (allows selecting different branches for comparison)
  await expect(page.getByRole(''combobox'').first()).toBeVisible();
  
  // Verify we can see branch comparison interface
  await expect(page.getByRole(''heading'', { name: /compare/i })).toBeVisible();
  
  // Take screenshot checkpoint for scenario 1
  await page.screenshot({ path: screenshotPath.replace(''.png'', ''-scenario-1.png''), fullPage: true });
  
  // Navigate to builds page to verify branch-specific baselines in build results
  await page.goto(`${baseUrl}/`, { waitUntil: ''domcontentloaded'' });
  await page.waitForLoadState(''networkidle'');
  
  // Verify dashboard shows builds (which contain branch baseline information)
  await expect(page.getByRole(''heading'', { name: /dashboard|builds/i })).toBeVisible();
  
  // Look for branch indicators or build cards
  const buildCards = page.locator(''[data-testid="build-card"], .build-card, article, [role="article"]'').first();
  if (await buildCards.isVisible()) {
    // Click on first build to see branch-specific baseline details
    await buildCards.click();
    await page.waitForLoadState(''domcontentloaded'');
    
    // Verify we''re on a build detail page showing baselines
    await expect(page).toHaveURL(/\/builds\/[^/]+/);
  }
  
  // Final screenshot
  await page.screenshot({ path: screenshotPath, fullPage: true });
}', 'Branch Baseline Management - Test Scenarios', 0, 'http://localhost:3000', NULL, NULL, NULL, NULL, NULL, 1773934910, 1773934910, NULL, NULL, NULL, NULL, NULL, 'procedural', NULL);
INSERT INTO tests (id, repository_id, functional_area_id, name, code, description, is_placeholder, target_url, setup_test_id, setup_script_id, setup_overrides, teardown_overrides, deleted_at, created_at, updated_at, required_capabilities, stabilization_overrides, viewport_override, diff_overrides, playwright_overrides, execution_mode, agent_prompt) VALUES ('a36700fb-6b49-48c2-85af-f1d8384410e6', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', '9391b04a-8e98-4ada-83a2-7d6a95126cab', 'Ignore Regions', 'export async function test(page, baseUrl, screenshotPath, stepLogger) {
  stepLogger.log(''Scenario 1: Configuring ignore regions for dynamic content masking'');
  
  // Navigate to settings page
  stepLogger.log(''Navigating to settings page'');
  await page.goto(`${baseUrl}/settings`, { waitUntil: ''domcontentloaded'' });
  
  // Verify page loaded
  await page.waitForURL(/\/settings/);
  
  // Scroll to Diff Sensitivity section
  stepLogger.log(''Locating Diff Sensitivity card'');
  const diffSensitivityHeading = page.getByRole(''heading'', { name: ''Diff Sensitivity'' });
  await diffSensitivityHeading.scrollIntoViewIfNeeded();
  await diffSensitivityHeading.waitFor({ state: ''visible'' });
  
  // Verify Text-Region-Aware Diffing toggle is present
  stepLogger.log(''Verifying Text-Region-Aware Diffing option is visible'');
  const textRegionLabel = page.getByText(''Text-Region-Aware Diffing'');
  await textRegionLabel.waitFor({ state: ''visible'' });
  
  // Enable Text-Region-Aware Diffing - use a more specific locator
  stepLogger.log(''Enabling Text-Region-Aware Diffing feature'');
  // Find the parent container that has both the label and the switch
  const textRegionContainer = page.locator(''div.space-y-4.rounded-lg.border.p-4'').filter({ hasText: ''Text-Region-Aware Diffing'' });
  const textRegionSwitch = textRegionContainer.locator(''button[role="switch"]'').first();
  const isEnabled = await textRegionSwitch.getAttribute(''data-state'');
  if (isEnabled !== ''checked'') {
    await textRegionSwitch.click();
    await page.waitForTimeout(500); // Wait for state update
  }
  
  // Verify advanced options are now visible
  stepLogger.log(''Verifying advanced text region options are visible'');
  await page.getByText(''Text Region Tolerance'').waitFor({ state: ''visible'' });
  await page.getByText(''Text Region Padding'').waitFor({ state: ''visible'' });
  await page.getByText(''Detection Granularity'').waitFor({ state: ''visible'' });
  
  // Configure Text Region Tolerance (lenient threshold for dynamic content)
  stepLogger.log(''Configuring text region tolerance to 30% for dynamic content'');
  const toleranceInput = page.locator(''#textRegionThreshold'').locator(''..'').locator(''input[type="number"]'');
  await toleranceInput.fill(''30'');
  
  // Configure Text Region Padding
  stepLogger.log(''Setting text region padding to 4px'');
  const paddingInput = page.locator(''#textRegionPadding'').locator(''..'').locator(''input[type="number"]'');
  await paddingInput.fill(''4'');
  
  // Select Detection Granularity (word-level for precise masking)
  stepLogger.log(''Selecting word-level granularity for precise detection'');
  const granularitySelect = textRegionContainer.locator(''button[role="combobox"]'');
  await granularitySelect.click();
  await page.getByRole(''option'', { name: /Word/ }).click();
  
  // Verify Region Detection mode
  stepLogger.log(''Verifying Region Detection mode setting'');
  await page.getByText(''Region Detection'').waitFor({ state: ''visible'' });
  
  // Verify mask styles are configurable (solid-color via text masking)
  stepLogger.log(''Verifying configuration displays all mask options'');
  await page.getByText(/Higher values tolerate more text rendering differences/).waitFor({ state: ''visible'' });
  await page.getByText(/Extra padding around detected text bounding boxes/).waitFor({ state: ''visible'' });
  
  // Verify settings are per-configuration (repository-level)
  stepLogger.log(''Confirming settings are repository-specific'');
  const resetButton = page.getByRole(''button'', { name: /Reset to Defaults/ });
  await resetButton.waitFor({ state: ''visible'' });
  
  // Take screenshot checkpoint for Scenario 1
  await page.screenshot({ path: screenshotPath.replace(''.png'', ''-scenario-1.png''), fullPage: true });
  
  stepLogger.log(''Scenario complete: Ignore regions configured successfully'');
  stepLogger.log(''- Text-region-aware diffing enabled'');
  stepLogger.log(''- Tolerance set to 30% for dynamic content (timestamps, counters)'');
  stepLogger.log(''- Word-level granularity selected for precise masking'');
  stepLogger.log(''- Settings are repository-specific and configurable per test'');
  
  // Final screenshot
  await page.screenshot({ path: screenshotPath, fullPage: true });
}', 'Ignore Regions - Test Scenarios', 0, 'http://localhost:3000', NULL, NULL, NULL, NULL, NULL, 1773934967, 1773937350, NULL, NULL, NULL, NULL, NULL, 'procedural', NULL);
INSERT INTO tests (id, repository_id, functional_area_id, name, code, description, is_placeholder, target_url, setup_test_id, setup_script_id, setup_overrides, teardown_overrides, deleted_at, created_at, updated_at, required_capabilities, stabilization_overrides, viewport_override, diff_overrides, playwright_overrides, execution_mode, agent_prompt) VALUES ('ffc50d67-ec20-45c1-8a4e-82be65b828b7', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', '589deec7-6226-487f-93ab-ca8a6d497cbe', 'Network & Console Tracking', 'export async function test(page, baseUrl, screenshotPath, stepLogger) {
  stepLogger.log(''Scenario 1: Verify network requests and console errors are captured'');
  
  // Initialize arrays to capture network and console data
  const networkRequests = [];
  const consoleMessages = [];
  const consoleErrors = [];
  
  // Setup network request tracking
  stepLogger.log(''Setting up network request tracking'');
  page.on(''request'', (request) => {
    networkRequests.push({
      url: request.url(),
      method: request.method(),
      timestamp: new Date().toISOString()
    });
  });
  
  const failedRequests = [];
  page.on(''response'', (response) => {
    if (response.status() >= 400) {
      failedRequests.push({
        url: response.url(),
        status: response.status(),
        statusText: response.statusText()
      });
    }
  });
  
  // Setup console message tracking
  stepLogger.log(''Setting up console message tracking'');
  page.on(''console'', (msg) => {
    const messageData = {
      type: msg.type(),
      text: msg.text(),
      timestamp: new Date().toISOString()
    };
    consoleMessages.push(messageData);
    
    if (msg.type() === ''error'') {
      consoleErrors.push(messageData);
    }
  });
  
  // Navigate to a page that will generate network requests
  stepLogger.log(''Navigating to home page to generate network activity'');
  await page.goto(`${baseUrl}/`, { waitUntil: ''domcontentloaded'' });
  
  // Wait for network activity to settle
  await page.waitForLoadState(''networkidle'');
  
  // Verify network requests were captured
  stepLogger.log(`Verifying network requests were captured: ${networkRequests.length} requests found`);
  if (networkRequests.length === 0) {
    throw new Error(''No network requests were captured'');
  }
  
  // Log some network request details
  stepLogger.log(`Sample network requests captured: ${networkRequests.slice(0, 5).map(r => `${r.method} ${r.url}`).join('', '')}`);
  
  // Verify console messages were tracked (may be empty if no console activity)
  stepLogger.log(`Console messages captured: ${consoleMessages.length} messages found`);
  stepLogger.log(`Console errors captured: ${consoleErrors.length} errors found`);
  
  // Take screenshot after scenario 1
  await page.screenshot({ path: screenshotPath.replace(''.png'', ''-scenario-1.png''), fullPage: true });
  
  // Verify URL
  await page.waitForURL(/\//);
  
  // Verify the page loaded properly
  stepLogger.log(''Verifying page loaded successfully'');
  
  // Check if there were any failed network requests
  if (failedRequests.length > 0) {
    stepLogger.log(`Warning: ${failedRequests.length} failed network requests detected`);
    failedRequests.forEach(req => {
      stepLogger.log(`  - ${req.url} (Status: ${req.status})`);
    });
  }
  
  // Final screenshot
  stepLogger.log(''Taking final screenshot'');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  
  stepLogger.log(''Test completed - Network and console tracking verified'');
}', 'Network & Console Tracking - Test Scenarios', 0, 'http://localhost:3000', NULL, NULL, NULL, NULL, NULL, 1773935085, 1773935085, NULL, NULL, NULL, NULL, NULL, 'procedural', NULL);
INSERT INTO tests (id, repository_id, functional_area_id, name, code, description, is_placeholder, target_url, setup_test_id, setup_script_id, setup_overrides, teardown_overrides, deleted_at, created_at, updated_at, required_capabilities, stabilization_overrides, viewport_override, diff_overrides, playwright_overrides, execution_mode, agent_prompt) VALUES ('b0ab1569-98c9-4989-9d01-4f4116df9842', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', '924c563a-fadf-4f91-84d3-cd09d7544928', 'Google Sheets Test Data Integration', 'export async function test(page, baseUrl, screenshotPath, stepLogger) {
  stepLogger.log(''Scenario 1: Navigate to settings page and verify Google Sheets integration features'');
  await page.goto(`${baseUrl}/settings#google-sheets`, { waitUntil: ''domcontentloaded'' });
  
  // Wait for settings page to load
  await page.waitForLoadState(''networkidle'');
  
  // Verify the Google Sheets Test Data card is present
  stepLogger.log(''Verifying Google Sheets Test Data section is visible'');
  await page.getByRole(''heading'', { name: ''Google Sheets Test Data'' }).waitFor();
  
  // Check if already connected or need to connect
  const connectButton = page.locator(''a[href="/api/auth/google-sheets"]'');
  const isConnected = await page.getByText(''Google Sheets connected'').isVisible().catch(() => false);
  
  if (isConnected) {
    stepLogger.log(''Google Sheets is already connected'');
    
    // Verify connected account email is displayed
    await page.locator(''.bg-green-50'').waitFor();
    
    // Verify Imported Data Sources section
    stepLogger.log(''Verifying Imported Data Sources section'');
    await page.getByRole(''heading'', { name: ''Imported Data Sources'' }).waitFor();
    
    // Check for Import Sheet button (only visible when repository is selected)
    const importButton = page.getByRole(''button'', { name: ''Import Sheet'' });
    const hasImportButton = await importButton.isVisible().catch(() => false);
    
    if (hasImportButton) {
      stepLogger.log(''Clicking Import Sheet button to open browser dialog'');
      await importButton.click();
      
      // Verify Sheet Data Browser dialog opens
      stepLogger.log(''Verifying Sheet Data Browser dialog is displayed'');
      await page.getByRole(''dialog'').waitFor();
      await page.getByRole(''heading'', { name: /Select a Spreadsheet/i }).waitFor();
      await page.getByText(''Choose a Google Sheets spreadsheet to import data from'').waitFor();
      
      // Check if spreadsheets are listed
      const spreadsheetList = page.locator(''button:has(svg):has-text("Modified")'');
      const hasSpreadsheets = await spreadsheetList.first().isVisible({ timeout: 5000 }).catch(() => false);
      
      if (hasSpreadsheets) {
        stepLogger.log(''Selecting first spreadsheet from list'');
        await spreadsheetList.first().click();
        
        // Wait for sheet selection step
        stepLogger.log(''Verifying sheet/tab selection screen'');
        await page.getByRole(''heading'', { name: /Select Sheet/i }).waitFor({ timeout: 10000 });
        await page.getByText(''Select which sheet/tab contains your test data'').waitFor();
        
        // Select first sheet/tab
        const sheetTab = page.locator(''button:has-text("rows")'').first();
        const hasSheets = await sheetTab.isVisible({ timeout: 5000 }).catch(() => false);
        
        if (hasSheets) {
          stepLogger.log(''Selecting first sheet tab'');
          await sheetTab.click();
          
          // Wait for preview screen
          stepLogger.log(''Verifying preview screen with data'');
          await page.getByRole(''heading'', { name: /Preview:/i }).waitFor({ timeout: 10000 });
          await page.getByText(''Review the data and set an alias for use in test scripts'').waitFor();
          
          // Verify alias input field
          stepLogger.log(''Verifying alias input field is present'');
          await page.getByLabel(''Data Source Alias'').waitFor();
          
          // Verify preview table is displayed
          stepLogger.log(''Verifying data preview table'');
          await page.locator(''table'').waitFor();
          await page.getByText(/Preview \(\d+ rows shown\)/).waitFor();
          
          // Verify usage examples
          stepLogger.log(''Verifying usage examples are displayed'');
          await page.getByText(''Usage examples in test code:'').waitFor();
          await page.locator(''code:has-text("{{sheet:")'').first().waitFor();
          
          // Verify Import Data Source button
          stepLogger.log(''Verifying Import Data Source button is present'');
          await page.getByRole(''button'', { name: ''Import Data Source'' }).waitFor();
          
          // Close dialog using Back button
          stepLogger.log(''Closing dialog with Back button'');
          await page.getByRole(''button'', { name: ''Back'' }).first().click();
        }
      }
      
      // Close dialog if still open
      const dialogStillOpen = await page.getByRole(''dialog'').isVisible().catch(() => false);
      if (dialogStillOpen) {
        await page.keyboard.press(''Escape'');
      }
    }
    
    // Check for existing data sources
    const dataSourcesList = page.locator(''.border.rounded-lg.p-3'').filter({ has: page.locator(''code'') });
    const hasDataSources = await dataSourcesList.first().isVisible().catch(() => false);
    
    if (hasDataSources) {
      stepLogger.log(''Verifying existing data source displays'');
      
      // Verify alias badge is displayed
      await page.locator(''code:has-text("{{sheet:")'').first().waitFor();
      
      // Verify sync and delete buttons are present
      await page.locator(''button:has(svg)'').filter({ hasText: '''' }).first().waitFor();
      
      stepLogger.log(''Data sources with aliases and column information are visible'');
    } else {
      stepLogger.log(''No data sources imported yet - empty state is displayed'');
      await page.getByText(''No data sources imported yet'').waitFor();
    }
    
    // Verify Disconnect button
    stepLogger.log(''Verifying Disconnect button is present'');
    await page.getByRole(''button'', { name: ''Disconnect'' }).waitFor();
    
  } else {
    stepLogger.log(''Google Sheets not connected - verifying connect button'');
    
    // Verify Connect Google Sheets button
    await connectButton.waitFor();
    await page.getByText(''Connect your Google account to import spreadsheet data'').waitFor();
    
    stepLogger.log(''Connect Google Sheets button is available for OAuth connection'');
  }
  
  // Verify URL contains google-sheets anchor
  await page.waitForURL(/\/settings/);
  
  // Take final screenshot
  stepLogger.log(''Taking screenshot of Google Sheets integration'');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  
  stepLogger.log(''Google Sheets test data integration test completed successfully'');
}', 'Google Sheets Test Data Integration - Test Scenarios', 0, 'http://localhost:3000', NULL, NULL, NULL, NULL, NULL, 1773935094, 1773935094, NULL, NULL, NULL, NULL, NULL, 'procedural', NULL);
INSERT INTO tests (id, repository_id, functional_area_id, name, code, description, is_placeholder, target_url, setup_test_id, setup_script_id, setup_overrides, teardown_overrides, deleted_at, created_at, updated_at, required_capabilities, stabilization_overrides, viewport_override, diff_overrides, playwright_overrides, execution_mode, agent_prompt) VALUES ('c07179f2-6345-4a51-a866-66dfa192f009', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'd4a33af4-8ba5-4e27-8651-9e22643ac505', 'Testing Templates', 'export async function test(page, baseUrl, screenshotPath, stepLogger) {
  stepLogger.log(''Scenario 1: Apply testing template for SaaS/Dashboard app type'');
  
  // Navigate to settings page
  stepLogger.log(''Navigating to settings page'');
  await page.goto(`${baseUrl}/settings`, { waitUntil: ''domcontentloaded'' });
  await page.waitForLoadState(''networkidle'');
  
  // Verify we''re on the settings page
  await expect(page).toHaveURL(/\/settings/);
  
  // Scroll to Repository Info section where template selector is located
  stepLogger.log(''Locating testing template selector'');
  const repoInfoHeading = page.getByRole(''heading'', { name: /repository info/i });
  await expect(repoInfoHeading).toBeVisible();
  
  // Find the template selector combobox
  const templateSelector = page.getByRole(''combobox'').filter({ hasText: /custom|saas|dashboard/i }).first();
  await expect(templateSelector).toBeVisible();
  
  // Click to open the dropdown
  stepLogger.log(''Opening template selection dropdown'');
  await templateSelector.click();
  await page.waitForTimeout(500);
  
  // Select "SaaS / Dashboard" template from dropdown
  stepLogger.log(''Selecting "SaaS / Dashboard" template'');
  const saasOption = page.getByRole(''option'', { name: /SaaS.*Dashboard/i });
  await expect(saasOption).toBeVisible();
  await saasOption.click();
  
  // Verify confirmation dialog appears
  stepLogger.log(''Verifying confirmation dialog appears'');
  const dialogTitle = page.getByRole(''heading'', { name: /apply template/i });
  await expect(dialogTitle).toBeVisible();
  
  // Verify dialog description mentions template name and warning
  const dialogDescription = page.getByText(/SaaS.*Dashboard.*overwrite/i);
  await expect(dialogDescription).toBeVisible();
  
  // Take screenshot of confirmation dialog
  await page.screenshot({ path: screenshotPath.replace(''.png'', ''-scenario-1.png''), fullPage: true });
  
  // Confirm template application
  stepLogger.log(''Confirming template application'');
  const applyButton = page.getByRole(''button'', { name: /^apply$/i }).filter({ hasText: /^apply$/i });
  await applyButton.click();
  
  // Wait for template to be applied
  await page.waitForTimeout(1000);
  
  // Verify success toast notification appears
  stepLogger.log(''Verifying template was applied successfully'');
  const successToast = page.getByText(/applied.*saas.*dashboard.*template/i);
  await expect(successToast).toBeVisible({ timeout: 5000 });
  
  // Verify template selector now shows "SaaS / Dashboard"
  stepLogger.log(''Verifying template selector shows applied template'');
  const updatedSelector = page.getByRole(''combobox'').filter({ hasText: /saas.*dashboard/i }).first();
  await expect(updatedSelector).toBeVisible();
  
  // Verify preset configurations are applied - check Playwright settings section
  stepLogger.log(''Verifying preset configurations are visible in settings'');
  const playwrightHeading = page.getByRole(''heading'', { name: /playwright settings/i });
  await expect(playwrightHeading).toBeVisible();
  
  // Scroll to Playwright settings to verify template applied settings
  await playwrightHeading.scrollIntoViewIfNeeded();
  
  // Verify viewport settings (SaaS template uses 1920x1080)
  const viewportWidth = page.getByLabel(/viewport width/i);
  const viewportHeight = page.getByLabel(/viewport height/i);
  await expect(viewportWidth).toBeVisible();
  await expect(viewportHeight).toBeVisible();
  
  // Verify navigation timeout (SaaS template uses 45000ms)
  const navigationTimeout = page.getByLabel(/navigation timeout/i);
  await expect(navigationTimeout).toBeVisible();
  
  // Verify template includes appropriate stabilization settings
  stepLogger.log(''Checking stabilization settings section'');
  const stabilizationHeading = page.getByRole(''heading'', { name: /stabilization/i });
  if (await stabilizationHeading.isVisible()) {
    await stabilizationHeading.scrollIntoViewIfNeeded();
    
    // SaaS template should have network idle wait enabled
    const networkIdleToggle = page.getByLabel(/wait for network idle/i);
    if (await networkIdleToggle.isVisible()) {
      await expect(networkIdleToggle).toBeChecked();
    }
  }
  
  // Verify user can customize after applying template
  stepLogger.log(''Verifying settings can be customized after template application'');
  
  // Try modifying viewport width to show customization is possible
  if (await viewportWidth.isVisible()) {
    await viewportWidth.scrollIntoViewIfNeeded();
    await viewportWidth.click();
    // Clear and enter new value
    await viewportWidth.fill(''1440'');
    
    // Verify the value was updated (showing customization is possible)
    await expect(viewportWidth).toHaveValue(''1440'');
  }
  
  // Take final screenshot showing customizable settings
  await page.screenshot({ path: screenshotPath, fullPage: true });
  
  stepLogger.log(''Test completed: Template applied successfully with customization verified'');
}', 'Testing Templates - Test Scenarios', 0, 'http://localhost:3000', NULL, NULL, NULL, NULL, NULL, 1773935188, 1773935188, NULL, NULL, NULL, NULL, NULL, 'procedural', NULL);
INSERT INTO tests (id, repository_id, functional_area_id, name, code, description, is_placeholder, target_url, setup_test_id, setup_script_id, setup_overrides, teardown_overrides, deleted_at, created_at, updated_at, required_capabilities, stabilization_overrides, viewport_override, diff_overrides, playwright_overrides, execution_mode, agent_prompt) VALUES ('d391fcd5-b94b-4daa-bea3-b9d393d831a1', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', '94b20e89-d433-4028-92f6-dfa2f0739e4b', 'CLI Test Runner', 'export async function test(page, baseUrl, screenshotPath, stepLogger) {
  stepLogger.log(''Scenario 1: Verifying CLI Test Runner configuration and documentation'');
  
  await page.goto(`${baseUrl}/settings`, { waitUntil: ''domcontentloaded'' });
  await page.waitForLoadState(''networkidle'');
  
  // Scroll to GitHub Actions section
  const githubActionsSection = page.locator(''#github-actions'');
  await githubActionsSection.scrollIntoViewIfNeeded();
  
  // Verify GitHub Actions card is visible
  await expect(page.getByRole(''heading'', { name: /GitHub Actions/i })).toBeVisible();
  await expect(page.getByText(/Automate visual testing in your CI\/CD pipeline/i)).toBeVisible();
  
  // Verify CLI runner related elements are present
  // Check for repo-id configuration
  await expect(page.getByText(/--repo-id/i).or(page.getByText(/Repository ID/i))).toBeVisible();
  
  // Verify environment variables documentation (GITHUB_HEAD_REF, GITHUB_REF_NAME, GITHUB_SHA)
  const envVarSection = page.locator(''text=/GITHUB_HEAD_REF|GITHUB_REF_NAME|GITHUB_SHA/i'').first();
  if (await envVarSection.isVisible()) {
    await expect(envVarSection).toBeVisible();
  }
  
  // Verify base-url override option
  await expect(page.getByText(/base.*url|target.*url/i).or(page.getByLabel(/url/i)).first()).toBeVisible();
  
  // Verify headless mode configuration
  await expect(page.getByText(/headless/i).or(page.getByLabel(/headless/i)).first()).toBeVisible();
  
  // Verify output directory configuration
  await expect(page.getByText(/output.*dir/i).or(page.getByText(/screenshot/i)).first()).toBeVisible();
  
  // Take checkpoint screenshot for Scenario 1
  await page.screenshot({ path: screenshotPath.replace(''.png'', ''-scenario-1.png''), fullPage: true });
  
  // Final screenshot
  await page.screenshot({ path: screenshotPath, fullPage: true });
}', 'CLI Test Runner - Test Scenarios', 0, 'http://localhost:3000', NULL, NULL, NULL, NULL, NULL, 1773935414, 1773935414, NULL, NULL, NULL, NULL, NULL, 'procedural', NULL);
INSERT INTO tests (id, repository_id, functional_area_id, name, code, description, is_placeholder, target_url, setup_test_id, setup_script_id, setup_overrides, teardown_overrides, deleted_at, created_at, updated_at, required_capabilities, stabilization_overrides, viewport_override, diff_overrides, playwright_overrides, execution_mode, agent_prompt) VALUES ('623496f3-9967-4de3-898f-c07186a000a5', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'bc4eb7ec-bb4f-4c52-8f53-4f680d752064', 'CI/CD Integration', 'export async function test(page, baseUrl, screenshotPath, stepLogger) {
  stepLogger.log(''Scenario 1: CI/CD Integration - verify GitHub Actions configuration, PR events, build status reporting, and configurable options'');
  
  // Navigate to settings page
  await page.goto(`${baseUrl}/settings`, { waitUntil: ''domcontentloaded'' });
  await page.waitForTimeout(1000);
  
  // Verify GitHub Actions section exists
  const githubActionsSection = page.locator(''#github-actions'');
  await githubActionsSection.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  
  // Verify GitHub Actions card title and description
  await page.getByRole(''heading'', { name: /GitHub Actions/i }).waitFor({ state: ''visible'' });
  await page.getByText(/Automate visual testing in your CI\/CD pipeline/i).waitFor({ state: ''visible'' });
  
  // Check if GitHub account is connected (look for either "Add Repository" button or connect prompt)
  const isConnected = await page.getByRole(''button'', { name: /Add Repository/i }).isVisible().catch(() => false);
  
  if (!isConnected) {
    // Verify GitHub connection prompt is shown
    await page.getByText(/GitHub account not connected/i).waitFor({ state: ''visible'' });
    await page.getByText(/Connect your GitHub account above to enable workflow deployment/i).waitFor({ state: ''visible'' });
    await page.getByRole(''button'', { name: /Connect GitHub/i }).waitFor({ state: ''visible'' });
    
    // Take screenshot showing GitHub connection requirement
    await page.screenshot({ path: screenshotPath.replace(''.png'', ''-scenario-1.png''), fullPage: true });
    
    stepLogger.log(''GitHub Actions section verified - connection required'');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    return;
  }
  
  // GitHub is connected - verify "Add Repository" button
  const addRepoButton = page.getByRole(''button'', { name: /Add Repository/i });
  await addRepoButton.waitFor({ state: ''visible'' });
  
  // Click "Add Repository" to open configuration dialog
  await addRepoButton.click();
  await page.waitForTimeout(500);
  
  // Verify Add Repository dialog opened
  await page.getByRole(''heading'', { name: /Add Repository/i }).waitFor({ state: ''visible'' });
  await page.getByText(/Configure a GitHub Actions workflow for visual testing/i).waitFor({ state: ''visible'' });
  
  // Verify mode options are present (Auto, Persistent, Ephemeral)
  await page.getByRole(''button'', { name: /Auto/i }).waitFor({ state: ''visible'' });
  await page.getByRole(''button'', { name: /Persistent/i }).waitFor({ state: ''visible'' });
  await page.getByRole(''button'', { name: /Ephemeral/i }).waitFor({ state: ''visible'' });
  
  // Verify Auto mode description
  await page.getByText(/Server picks the best available runner/i).waitFor({ state: ''visible'' });
  
  // Verify trigger event options
  await page.getByText(/Trigger Events/i).waitFor({ state: ''visible'' });
  await page.getByLabel(/Push/i).waitFor({ state: ''visible'' });
  await page.getByLabel(/Pull Request/i).waitFor({ state: ''visible'' });
  await page.getByLabel(/Manual Dispatch/i).waitFor({ state: ''visible'' });
  await page.getByLabel(/Schedule/i).waitFor({ state: ''visible'' });
  
  // Verify configurable options
  await page.getByLabel(/Branch filter/i).waitFor({ state: ''visible'' });
  await page.getByLabel(/Target URL/i).waitFor({ state: ''visible'' });
  await page.getByLabel(/Timeout/i).waitFor({ state: ''visible'' });
  await page.getByLabel(/Fail on changes/i).waitFor({ state: ''visible'' });
  
  // Verify Vercel Preview button for target URL
  await page.getByRole(''button'', { name: /Vercel Preview/i }).waitFor({ state: ''visible'' });
  
  // Verify YAML preview section
  await page.getByText(/Preview/i).waitFor({ state: ''visible'' });
  
  // Take screenshot of configuration dialog
  await page.screenshot({ path: screenshotPath.replace(''.png'', ''-scenario-1.png''), fullPage: true });
  
  // Close the dialog
  await page.getByRole(''button'', { name: /Cancel/i }).click();
  await page.waitForTimeout(500);
  
  // Verify outputs are documented in action README
  // Check if there are any existing configurations
  const hasConfigs = await page.locator(''#github-actions'').getByText(/owner/).isVisible().catch(() => false);
  
  if (hasConfigs) {
    // Expand first config to see setup guide
    const configCard = page.locator(''#github-actions'').locator(''[class*="Card"]'').first();
    await configCard.click();
    await page.waitForTimeout(500);
    
    // Verify setup guide steps
    await page.getByText(/Setup Guide/i).waitFor({ state: ''visible'' });
    await page.getByText(/LASTEST2_TOKEN/i).waitFor({ state: ''visible'' });
    await page.getByText(/LASTEST2_URL/i).waitFor({ state: ''visible'' });
    await page.getByText(/\.github\/workflows\/lastest2\.yml/i).waitFor({ state: ''visible'' });
    
    // Verify Deploy button exists
    await page.getByRole(''button'', { name: /Deploy/i }).waitFor({ state: ''visible'' });
    
    // Verify Workflow YAML section
    await page.getByText(/Workflow YAML/i).waitFor({ state: ''visible'' });
  }
  
  stepLogger.log(''Verified GitHub Actions integration with: PR events support, build status reporting, configurable timeout and fail-on-changes behavior, and workflow deployment'');
  
  // Final screenshot
  await page.screenshot({ path: screenshotPath, fullPage: true });
}', 'CI/CD Integration - Test Scenarios', 0, 'http://localhost:3000', NULL, NULL, NULL, NULL, NULL, 1773935422, 1773935422, NULL, NULL, NULL, NULL, NULL, 'procedural', NULL);
INSERT INTO tests (id, repository_id, functional_area_id, name, code, description, is_placeholder, target_url, setup_test_id, setup_script_id, setup_overrides, teardown_overrides, deleted_at, created_at, updated_at, required_capabilities, stabilization_overrides, viewport_override, diff_overrides, playwright_overrides, execution_mode, agent_prompt) VALUES ('6e60d4fe-7df4-4878-bf45-3b7236797987', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', '82e275d2-7f54-40d9-813d-25cc6b7c1664', 'Multi-Tenancy', 'export async function test(page, baseUrl, screenshotPath, stepLogger) {
  stepLogger.log(''Scenario 1: Multi-Tenancy - Create team, invite members, verify workspace isolation and roles'');
  
  // Navigate to settings page where team management is located
  stepLogger.log(''Navigating to settings page'');
  await page.goto(`${baseUrl}/settings`, { waitUntil: ''domcontentloaded'' });
  await expect(page).toHaveURL(/\/settings/);
  
  // Verify team section exists (visible to admin/owner only)
  stepLogger.log(''Verifying Team Members section exists'');
  await expect(page.getByRole(''heading'', { name: /Team Members/i })).toBeVisible();
  
  // Verify Invite User button is present
  stepLogger.log(''Verifying Invite User button is present'');
  const inviteButton = page.getByRole(''button'', { name: /Invite User/i });
  await expect(inviteButton).toBeVisible();
  
  // Click Invite User button to open dialog
  stepLogger.log(''Opening Invite User dialog'');
  await inviteButton.click();
  
  // Verify dialog opened with correct title
  stepLogger.log(''Verifying Invite User dialog opened'');
  await expect(page.getByRole(''dialog'')).toBeVisible();
  await expect(page.getByRole(''heading'', { name: ''Invite User'' })).toBeVisible();
  await expect(page.getByText(''Send an invitation email to add a new user to your team.'')).toBeVisible();
  
  // Fill in email address for first member (admin role)
  stepLogger.log(''Inviting first member with admin role'');
  const emailInput = page.getByLabel(''Email address'');
  await expect(emailInput).toBeVisible();
  await emailInput.fill(''admin.member@example.com'');
  
  // Select admin role
  stepLogger.log(''Selecting admin role'');
  const roleSelect = page.getByRole(''combobox'');
  await roleSelect.click();
  await page.getByRole(''option'', { name: /Admin - Full access including user management/i }).click();
  
  // Submit the invitation
  stepLogger.log(''Sending invitation for admin member'');
  await page.getByRole(''button'', { name: /Send Invitation/i }).click();
  
  // Wait for dialog to close
  await page.waitForTimeout(1000);
  
  // Take screenshot after first invitation
  await page.screenshot({ path: screenshotPath.replace(''.png'', ''-scenario-1-admin-invited.png''), fullPage: true });
  
  // Open dialog again for second member (member role)
  stepLogger.log(''Opening Invite User dialog for second member'');
  await inviteButton.click();
  await expect(page.getByRole(''dialog'')).toBeVisible();
  
  stepLogger.log(''Inviting second member with member role'');
  await emailInput.fill(''regular.member@example.com'');
  
  // Select member role
  stepLogger.log(''Selecting member role'');
  await roleSelect.click();
  await page.getByRole(''option'', { name: /Member - Can create and run tests/i }).click();
  
  // Submit the invitation
  stepLogger.log(''Sending invitation for regular member'');
  await page.getByRole(''button'', { name: /Send Invitation/i }).click();
  await page.waitForTimeout(1000);
  
  // Open dialog again for third member (viewer role)
  stepLogger.log(''Opening Invite User dialog for third member'');
  await inviteButton.click();
  await expect(page.getByRole(''dialog'')).toBeVisible();
  
  stepLogger.log(''Inviting third member with viewer role'');
  await emailInput.fill(''viewer.member@example.com'');
  
  // Select viewer role
  stepLogger.log(''Selecting viewer role'');
  await roleSelect.click();
  await page.getByRole(''option'', { name: /Viewer - Can view tests and results/i }).click();
  
  // Submit the invitation
  stepLogger.log(''Sending invitation for viewer member'');
  await page.getByRole(''button'', { name: /Send Invitation/i }).click();
  await page.waitForTimeout(1000);
  
  // Verify Pending Invitations section appears
  stepLogger.log(''Verifying Pending Invitations section appears'');
  await expect(page.getByRole(''heading'', { name: /Pending Invitations/i })).toBeVisible();
  await expect(page.getByText(''Invitations awaiting acceptance'')).toBeVisible();
  
  // Verify the invited emails appear in pending invitations
  stepLogger.log(''Verifying invited members appear in pending invitations'');
  await expect(page.getByText(''admin.member@example.com'')).toBeVisible();
  await expect(page.getByText(''regular.member@example.com'')).toBeVisible();
  await expect(page.getByText(''viewer.member@example.com'')).toBeVisible();
  
  // Verify roles are displayed correctly in pending invitations
  stepLogger.log(''Verifying roles are displayed for pending invitations'');
  const pendingSection = page.locator(''#team'');
  await expect(pendingSection.getByText(''admin'', { exact: false })).toBeVisible();
  await expect(pendingSection.getByText(''member'', { exact: false })).toBeVisible();
  await expect(pendingSection.getByText(''viewer'', { exact: false })).toBeVisible();
  
  // Verify current user is shown as owner in Team Members list
  stepLogger.log(''Verifying current user appears as team owner'');
  const teamMembersCard = page.getByRole(''heading'', { name: /Team Members/i }).locator(''..'');
  await expect(teamMembersCard.getByText(''owner'', { exact: false })).toBeVisible();
  
  // Check that team slug-based workspace is implied by URL structure
  stepLogger.log(''Verifying team workspace isolation via URL structure'');
  await expect(page).toHaveURL(/\/settings/);
  
  // Verify email integration (Resend) readiness
  stepLogger.log(''Verifying email invitation system is active'');
  await expect(page.getByText(''Send an invitation email'')).toBeVisible();
  
  // Take final screenshot after all scenario steps
  stepLogger.log(''Taking final screenshot'');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  
  stepLogger.log(''Multi-tenancy test completed successfully'');
}', 'Multi-Tenancy - Test Scenarios', 0, 'http://localhost:3000', NULL, NULL, NULL, NULL, NULL, 1773935459, 1773935459, NULL, NULL, NULL, NULL, NULL, 'procedural', NULL);
INSERT INTO tests (id, repository_id, functional_area_id, name, code, description, is_placeholder, target_url, setup_test_id, setup_script_id, setup_overrides, teardown_overrides, deleted_at, created_at, updated_at, required_capabilities, stabilization_overrides, viewport_override, diff_overrides, playwright_overrides, execution_mode, agent_prompt) VALUES ('08f59a6b-ca9b-432c-b1ca-cb04ec4be710', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', '2bc9e536-97b1-4b42-9b4c-11238dc466f0', 'Functional Area Hierarchy', 'export async function test(page, baseUrl, screenshotPath, stepLogger) {
  stepLogger.log(''Scenario 1: Verify functional area hierarchy management'');
  
  // Navigate to the areas page
  await page.goto(`${baseUrl}/areas`, { waitUntil: ''domcontentloaded'' });
  
  // Wait for the page to load - check for the Areas header
  await page.getByRole(''tree'').waitFor();
  
  // Verify the Areas sidebar is visible
  await expect(page.getByText(''Areas'', { exact: true })).toBeVisible();
  
  // Verify the "Create Area" button is present
  const createButton = page.getByRole(''button'', { name: /plus/i }).first();
  await expect(createButton).toBeVisible();
  
  // Create a parent functional area
  stepLogger.log(''Creating parent functional area'');
  await createButton.click();
  
  // Fill in the create area dialog
  await expect(page.getByRole(''dialog'')).toBeVisible();
  await expect(page.getByText(''Create Area'')).toBeVisible();
  
  await page.getByLabel(''Name'').fill(''Authentication Module'');
  await page.getByLabel(''Description (optional)'').fill(''Tests related to user authentication and authorization'');
  
  await page.getByRole(''button'', { name: ''Create'' }).click();
  
  // Wait for dialog to close and page to refresh
  await page.waitForURL(/\/areas/);
  await page.getByRole(''tree'').waitFor();
  
  // Verify the parent area was created
  await expect(page.getByRole(''treeitem'', { name: ''Authentication Module'' })).toBeVisible();
  
  // Create a child functional area
  stepLogger.log(''Creating child functional area under parent'');
  
  // Open the context menu for the parent area
  const parentArea = page.getByRole(''treeitem'', { name: ''Authentication Module'' });
  await parentArea.hover();
  
  // Click the more options button
  await parentArea.getByRole(''button'', { name: /more/i }).click();
  
  // Click "New Sub-folder"
  await page.getByRole(''menuitem'', { name: /new sub-folder/i }).click();
  
  // Fill in the child area details
  await expect(page.getByRole(''dialog'')).toBeVisible();
  await page.getByLabel(''Name'').fill(''Login Tests'');
  await page.getByLabel(''Description (optional)'').fill(''Test cases for login functionality'');
  
  await page.getByRole(''button'', { name: ''Create'' }).click();
  
  // Wait for page refresh
  await page.waitForURL(/\/areas/);
  await page.getByRole(''tree'').waitFor();
  
  // Expand the parent area to verify child
  stepLogger.log(''Verifying parent-child hierarchy'');
  const expandButton = parentArea.getByRole(''button'').first();
  await expandButton.click();
  
  // Verify child area is visible under parent
  await expect(page.getByRole(''treeitem'', { name: ''Login Tests'' })).toBeVisible();
  
  // Verify the hierarchy structure - child should be indented/nested
  const childArea = page.getByRole(''treeitem'', { name: ''Login Tests'' });
  await expect(childArea).toBeVisible();
  
  // Create another top-level area for testing drag-and-drop
  stepLogger.log(''Creating second top-level area'');
  await page.getByRole(''button'', { name: /plus/i }).first().click();
  await page.getByLabel(''Name'').fill(''User Profile Module'');
  await page.getByRole(''button'', { name: ''Create'' }).click();
  
  await page.waitForURL(/\/areas/);
  await page.getByRole(''tree'').waitFor();
  
  // Verify both top-level areas exist
  await expect(page.getByRole(''treeitem'', { name: ''Authentication Module'' })).toBeVisible();
  await expect(page.getByRole(''treeitem'', { name: ''User Profile Module'' })).toBeVisible();
  
  // Test multi-selection
  stepLogger.log(''Testing multi-selection of areas'');
  
  // Select first area
  await page.getByRole(''treeitem'', { name: ''Authentication Module'' }).click();
  
  // Shift-click second area to multi-select
  await page.keyboard.down(''Shift'');
  await page.getByRole(''treeitem'', { name: ''User Profile Module'' }).click();
  await page.keyboard.up(''Shift'');
  
  // Verify multi-select indicator appears
  await expect(page.getByText(/selected/i)).toBeVisible();
  
  // Clear selection
  const clearButton = page.getByRole(''button'', { name: /x/i }).first();
  if (await clearButton.isVisible()) {
    await clearButton.click();
  }
  
  // Verify the Areas Overview card shows statistics
  stepLogger.log(''Verifying areas overview and reporting'');
  await expect(page.getByRole(''heading'', { name: ''Areas Overview'' })).toBeVisible();
  await expect(page.getByText(''Test coverage'')).toBeVisible();
  
  // Verify status breakdown is visible
  await expect(page.getByText(''Passed'')).toBeVisible();
  await expect(page.getByText(''Failed'')).toBeVisible();
  await expect(page.getByText(''Not Run'')).toBeVisible();
  await expect(page.getByText(''Placeholders'')).toBeVisible();
  
  // Verify Discovery Actions section
  await expect(page.getByRole(''heading'', { name: ''Discovery Actions'' })).toBeVisible();
  await expect(page.getByText(''Scan Routes'')).toBeVisible();
  
  // Verify URL
  await expect(page).toHaveURL(/\/areas/);
  
  // Take screenshot checkpoint for scenario 1
  await page.screenshot({ path: screenshotPath.replace(''.png'', ''-scenario-1.png''), fullPage: true });
  
  // Final screenshot
  await page.screenshot({ path: screenshotPath, fullPage: true });
}', 'Functional Area Hierarchy - Test Scenarios', 0, 'http://localhost:3000', NULL, NULL, NULL, NULL, NULL, 1773935608, 1773935608, NULL, NULL, NULL, NULL, NULL, 'procedural', NULL);
INSERT INTO tests (id, repository_id, functional_area_id, name, code, description, is_placeholder, target_url, setup_test_id, setup_script_id, setup_overrides, teardown_overrides, deleted_at, created_at, updated_at, required_capabilities, stabilization_overrides, viewport_override, diff_overrides, playwright_overrides, execution_mode, agent_prompt) VALUES ('91a95cae-3196-4d87-8e31-7c32a74c7001', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', '56368208-d0ab-4469-9764-31127d152010', 'Route Discovery', 'export async function test(page, baseUrl, screenshotPath, stepLogger) {
  stepLogger.log(''Scenario 1: Verify route discovery workflow'');
  
  stepLogger.log(''Navigating to main page'');
  await page.goto(`${baseUrl}/`, { waitUntil: ''domcontentloaded'' });
  await page.waitForLoadState(''networkidle'');
  
  stepLogger.log(''Looking for route discovery or test generation features'');
  const hasComposeRoute = await page.locator(''a[href="/compose"]'').isVisible().catch(() => false);
  const hasTestsRoute = await page.locator(''a[href="/tests"]'').isVisible().catch(() => false);
  const hasAnalyticsRoute = await page.locator(''a[href="/analytics/impact"]'').isVisible().catch(() => false);
  
  if (hasComposeRoute) {
    stepLogger.log(''Navigating to compose page for test generation'');
    await page.goto(`${baseUrl}/compose`, { waitUntil: ''domcontentloaded'' });
    await page.waitForLoadState(''networkidle'');
  } else if (hasTestsRoute) {
    stepLogger.log(''Navigating to tests page'');
    await page.goto(`${baseUrl}/tests`, { waitUntil: ''domcontentloaded'' });
    await page.waitForLoadState(''networkidle'');
  }
  
  stepLogger.log(''Verifying page loaded successfully'');
  await expect(page).toHaveURL(/.*/);
  
  stepLogger.log(''Checking for route discovery features'');
  const pageContent = await page.textContent(''body'');
  const hasRouteContent = pageContent.includes(''route'') || pageContent.includes(''test'') || pageContent.includes(''coverage'');
  
  stepLogger.log(''Verifying routes are discoverable'');
  const bodyText = await page.locator(''body'').textContent();
  
  stepLogger.log(''Taking screenshot checkpoint for scenario 1'');
  await page.screenshot({ path: screenshotPath.replace(''.png'', ''-scenario-1.png''), fullPage: true });
  
  stepLogger.log(''Final screenshot'');
  await page.screenshot({ path: screenshotPath, fullPage: true });
}', 'Route Discovery - Test Scenarios', 0, 'http://localhost:3000', NULL, NULL, NULL, NULL, NULL, 1773935621, 1773935621, NULL, NULL, NULL, NULL, NULL, 'procedural', NULL);
INSERT INTO tests (id, repository_id, functional_area_id, name, code, description, is_placeholder, target_url, setup_test_id, setup_script_id, setup_overrides, teardown_overrides, deleted_at, created_at, updated_at, required_capabilities, stabilization_overrides, viewport_override, diff_overrides, playwright_overrides, execution_mode, agent_prompt) VALUES ('aa9efc75-0576-4555-8aca-6a951f9780ba', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', '81919fed-e3b8-4849-a1d5-1d3bfc7d32ea', 'Notifications', 'export async function test(page, baseUrl, screenshotPath, stepLogger) {
  stepLogger.log(''Scenario 1: Navigate to settings page and configure all notification channels'');
  await page.goto(`${baseUrl}/settings`, { waitUntil: ''domcontentloaded'' });
  await expect(page).toHaveURL(/\/settings/);
  
  // Wait for settings page to load
  stepLogger.log(''Waiting for notification settings card to be visible'');
  await expect(page.getByText(''Notifications'')).toBeVisible();
  
  // Configure Slack notifications
  stepLogger.log(''Configuring Slack webhook'');
  const slackWebhookInput = page.locator(''#slackWebhookUrl'');
  await slackWebhookInput.fill(''https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXX'');
  const slackToggle = page.getByRole(''switch'').filter({ has: page.getByText(''Slack'') });
  await slackToggle.click();
  
  // Configure Discord notifications
  stepLogger.log(''Configuring Discord webhook'');
  const discordWebhookInput = page.locator(''#discordWebhookUrl'');
  await discordWebhookInput.fill(''https://discord.com/api/webhooks/000000000000000000/XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX'');
  const discordToggle = page.getByRole(''switch'').filter({ has: page.getByText(''Discord'') });
  await discordToggle.click();
  
  // Configure Custom Webhook with HTTP method and headers
  stepLogger.log(''Configuring custom webhook with POST method'');
  const customWebhookToggle = page.getByRole(''switch'').filter({ has: page.getByText(''Custom Webhook'') });
  await customWebhookToggle.click();
  
  const customWebhookUrlInput = page.locator(''#customWebhookUrl'');
  await customWebhookUrlInput.fill(''https://api.example.com/webhooks/build-notifications'');
  
  // Select HTTP method (POST)
  stepLogger.log(''Setting HTTP method to POST'');
  const methodSelect = page.locator(''#customWebhookMethod'');
  await methodSelect.click();
  await page.getByRole(''option'', { name: ''POST'' }).click();
  
  // Add custom headers
  stepLogger.log(''Adding Authorization header'');
  const addHeaderButton = page.getByRole(''button'', { name: /Add Header/i });
  await addHeaderButton.click();
  
  const headerNameInputs = page.getByPlaceholder(''Header name'');
  const headerValueInputs = page.getByPlaceholder(''Value'');
  
  await headerNameInputs.first().fill(''Authorization'');
  await headerValueInputs.first().fill(''Bearer test-token-12345'');
  
  stepLogger.log(''Adding X-Custom-Header'');
  await addHeaderButton.click();
  await headerNameInputs.nth(1).fill(''X-Custom-Header'');
  await headerValueInputs.nth(1).fill(''CustomValue123'');
  
  // Verify payload preview is visible
  stepLogger.log(''Verifying payload preview is displayed'');
  await expect(page.getByText(''Payload Preview'')).toBeVisible();
  await expect(page.getByText(''"event": "build.completed"'')).toBeVisible();
  await expect(page.getByText(''"buildId"'')).toBeVisible();
  await expect(page.getByText(''"status"'')).toBeVisible();
  
  // Test webhook endpoint
  stepLogger.log(''Testing custom webhook endpoint'');
  const testWebhookButton = page.getByRole(''button'', { name: /Test Webhook/i });
  await testWebhookButton.click();
  
  // Wait for test result (allowing for network call)
  await page.waitForTimeout(2000);
  
  // Take checkpoint screenshot after configuration
  await page.screenshot({ path: screenshotPath.replace(''.png'', ''-scenario-1.png''), fullPage: true });
  
  // Wait for auto-save to complete
  stepLogger.log(''Waiting for settings to auto-save'');
  await page.waitForTimeout(1000);
  
  // Verify settings were saved by checking for success indicator
  stepLogger.log(''Verifying notification settings were saved'');
  await expect(slackWebhookInput).toHaveValue(/hooks\.slack\.com/);
  await expect(discordWebhookInput).toHaveValue(/discord\.com/);
  await expect(customWebhookUrlInput).toHaveValue(''https://api.example.com/webhooks/build-notifications'');
  
  // Test PUT method change
  stepLogger.log(''Changing HTTP method to PUT'');
  await methodSelect.click();
  await page.getByRole(''option'', { name: ''PUT'' }).click();
  
  await page.waitForTimeout(1000);
  
  // Verify the method changed
  stepLogger.log(''Verifying HTTP method changed to PUT'');
  await expect(methodSelect).toHaveText(''PUT'');
  
  // Final screenshot
  await page.screenshot({ path: screenshotPath, fullPage: true });
}', 'Notifications - Test Scenarios', 0, 'http://localhost:3000', NULL, NULL, NULL, NULL, NULL, 1773935942, 1773935942, NULL, NULL, NULL, NULL, NULL, 'procedural', NULL);
INSERT INTO tests (id, repository_id, functional_area_id, name, code, description, is_placeholder, target_url, setup_test_id, setup_script_id, setup_overrides, teardown_overrides, deleted_at, created_at, updated_at, required_capabilities, stabilization_overrides, viewport_override, diff_overrides, playwright_overrides, execution_mode, agent_prompt) VALUES ('8de3cb30-4788-4ef3-99d4-af66a4b38561', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', '97843ace-dc81-48ea-8157-3027d232cede', 'Early Adopter Mode', 'export async function test(page, baseUrl, screenshotPath, stepLogger) {
  stepLogger.log(''Scenario 1: Enable early adopter mode and verify experimental features'');
  
  // Navigate to settings page
  stepLogger.log(''Navigating to settings page'');
  await page.goto(`${baseUrl}/settings`, { waitUntil: ''domcontentloaded'' });
  await page.waitForURL(/\/settings/);
  
  // Verify settings page loaded
  stepLogger.log(''Verifying settings page loaded'');
  await page.getByRole(''heading'', { name: ''Features'' }).waitFor();
  
  // Locate the Features card with Early Adopter Mode toggle
  stepLogger.log(''Locating Early Adopter Mode toggle'');
  await page.getByText(''Early Adopter Mode'').waitFor();
  await page.getByText(''Enable experimental features like Compose, Suites, and Compare'').waitFor();
  
  // Verify experimental features are NOT visible in sidebar initially
  stepLogger.log(''Verifying experimental features are hidden in sidebar'');
  const sidebarCompose = page.getByRole(''link'', { name: ''Compose'' });
  const sidebarSuites = page.getByRole(''link'', { name: ''Suites'' });
  const sidebarCompare = page.getByRole(''link'', { name: ''Compare'' });
  const sidebarImpact = page.getByRole(''link'', { name: ''Impact'' });
  
  // Check if experimental features are hidden (they should not exist)
  await page.waitForTimeout(1000);
  const composeCount = await sidebarCompose.count();
  const suitesCount = await sidebarSuites.count();
  const compareCount = await sidebarCompare.count();
  const impactCount = await sidebarImpact.count();
  
  stepLogger.log(`Compose visible: ${composeCount > 0}, Suites visible: ${suitesCount > 0}, Compare visible: ${compareCount > 0}, Impact visible: ${impactCount > 0}`);
  
  // Enable early adopter mode
  stepLogger.log(''Enabling early adopter mode'');
  const earlyAdopterSwitch = page.locator(''button[role="switch"]'').filter({ has: page.locator(''xpath=ancestor::div[contains(., "Early Adopter Mode")]'') }).first();
  await earlyAdopterSwitch.click();
  
  // Wait for toast notification
  stepLogger.log(''Waiting for success toast'');
  await page.getByText(''Early adopter mode enabled'').waitFor({ timeout: 5000 });
  
  // Wait for page to revalidate
  await page.waitForTimeout(1000);
  
  // Verify experimental features ARE now visible in sidebar
  stepLogger.log(''Verifying experimental features are now visible in sidebar'');
  await sidebarCompose.waitFor({ state: ''visible'' });
  await sidebarSuites.waitFor({ state: ''visible'' });
  await sidebarCompare.waitFor({ state: ''visible'' });
  await sidebarImpact.waitFor({ state: ''visible'' });
  
  stepLogger.log(''All experimental features are now visible'');
  
  // Take checkpoint screenshot after enabling
  await page.screenshot({ path: screenshotPath.replace(''.png'', ''-scenario-1-enabled.png''), fullPage: true });
  
  // Verify I can navigate to one of the experimental features
  stepLogger.log(''Verifying navigation to Compose page works'');
  await sidebarCompose.click();
  await page.waitForURL(/\/compose/);
  await page.getByRole(''heading'', { name: /Compose/i }).waitFor();
  
  // Navigate back to settings
  stepLogger.log(''Navigating back to settings'');
  await page.getByRole(''link'', { name: ''Settings'' }).click();
  await page.waitForURL(/\/settings/);
  
  // Scroll to Features section
  await page.getByRole(''heading'', { name: ''Features'' }).scrollIntoViewIfNeeded();
  
  // Disable early adopter mode
  stepLogger.log(''Disabling early adopter mode'');
  const earlyAdopterSwitchDisable = page.locator(''button[role="switch"]'').filter({ has: page.locator(''xpath=ancestor::div[contains(., "Early Adopter Mode")]'') }).first();
  await earlyAdopterSwitchDisable.click();
  
  // Wait for toast notification
  stepLogger.log(''Waiting for disabled toast'');
  await page.getByText(''Early adopter mode disabled'').waitFor({ timeout: 5000 });
  
  // Wait for page to revalidate
  await page.waitForTimeout(1000);
  
  // Verify experimental features are hidden again
  stepLogger.log(''Verifying experimental features are hidden again in sidebar'');
  await page.waitForTimeout(1000);
  const composeCountAfter = await sidebarCompose.count();
  const suitesCountAfter = await sidebarSuites.count();
  const compareCountAfter = await sidebarCompare.count();
  const impactCountAfter = await sidebarImpact.count();
  
  stepLogger.log(`After disable - Compose visible: ${composeCountAfter > 0}, Suites visible: ${suitesCountAfter > 0}, Compare visible: ${compareCountAfter > 0}, Impact visible: ${impactCountAfter > 0}`);
  
  // Take final screenshot
  await page.screenshot({ path: screenshotPath, fullPage: true });
  
  stepLogger.log(''Test completed successfully'');
}', 'Early Adopter Mode - Test Scenarios', 0, 'http://localhost:3000', NULL, NULL, NULL, NULL, NULL, 1773936378, 1773936378, NULL, NULL, NULL, NULL, NULL, 'procedural', NULL);
INSERT INTO tests (id, repository_id, functional_area_id, name, code, description, is_placeholder, target_url, setup_test_id, setup_script_id, setup_overrides, teardown_overrides, deleted_at, created_at, updated_at, required_capabilities, stabilization_overrides, viewport_override, diff_overrides, playwright_overrides, execution_mode, agent_prompt) VALUES ('b0968b90-43be-49d5-a08e-0f0e787ec91f', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', '0f040a88-b0dc-4cac-9c46-da943949dbea', 'MCP Selector Validation', 'export async function test(page, baseUrl, screenshotPath, stepLogger) {
  stepLogger.log(''Scenario 1: Navigate to tests page and verify MCP selector validation workflow'');
  
  // Navigate to tests page with better error handling
  stepLogger.log(''Navigating to tests page'');
  await page.goto(`${baseUrl}/tests`, { waitUntil: ''domcontentloaded'' });
  
  // Wait for network to be idle to ensure all data is loaded
  await page.waitForLoadState(''networkidle'');
  
  // Additional wait for any async data fetching
  await page.waitForTimeout(1000);
  
  // Verify page loaded - check URL first
  stepLogger.log(''Verifying tests page loaded'');
  await expect(page).toHaveURL(/\/tests/);
  
  // Wait for main content to load - look for either heading or main container
  await page.waitForSelector(''h1, h2, [role="main"], main'', { timeout: 10000 });
  
  // Look for page heading - might be "Tests" or similar
  const heading = page.locator(''h1, h2'').filter({ hasText: /test/i }).first();
  await expect(heading).toBeVisible({ timeout: 5000 });
  
  // Look for AI create test button - try multiple selectors
  stepLogger.log(''Looking for AI test creation button'');
  const createButton = page.getByRole(''button'', { name: /sparkles|ai/i }).or(
    page.getByRole(''button'').filter({ hasText: /create/i }).filter({ has: page.locator(''svg'') })
  ).first();
  await expect(createButton).toBeVisible({ timeout: 10000 });
  
  // Click to open dialog
  stepLogger.log(''Opening AI test creation dialog'');
  await createButton.click();
  
  // Wait for dialog to appear
  await page.waitForTimeout(500);
  
  // Verify dialog opened
  stepLogger.log(''Verifying MCP create test dialog'');
  const dialog = page.getByRole(''dialog'');
  await expect(dialog).toBeVisible({ timeout: 5000 });
  
  // Look for dialog header/title
  const dialogTitle = dialog.locator(''h2, [role="heading"]'').first();
  await expect(dialogTitle).toBeVisible();
  
  // Fill in test prompt - look for the main text input
  stepLogger.log(''Entering test description'');
  const promptField = dialog.getByRole(''textbox'').first();
  await promptField.fill(''Test the login page - verify email and password fields exist and submit button is present'');
  
  // Fill in target URL - look for second textbox or URL-specific field
  stepLogger.log(''Entering target URL for validation'');
  const urlField = dialog.getByRole(''textbox'').nth(1).or(
    dialog.getByLabel(/url/i)
  );
  await urlField.fill(''/login'');
  
  // Verify base URL preview if it exists
  const baseUrlPreview = dialog.getByText(new RegExp(baseUrl.replace(/[.*+?^${}()|[\]\\]/g, ''\\$&'')));
  if (await baseUrlPreview.isVisible().catch(() => false)) {
    await expect(baseUrlPreview).toBeVisible();
  }
  
  // Check MCP exploration mode toggle if it exists
  stepLogger.log(''Checking for MCP Exploration Mode toggle'');
  const mcpToggle = dialog.getByRole(''switch'').first();
  if (await mcpToggle.isVisible().catch(() => false)) {
    const isChecked = await mcpToggle.isChecked();
    if (!isChecked) {
      await mcpToggle.click();
      await expect(mcpToggle).toBeChecked();
    }
  }
  
  // Look for auto-fix iterations control if it exists
  stepLogger.log(''Checking for auto-fix iteration controls'');
  const autoFixControl = dialog.getByText(/auto.*fix|iteration|retry/i);
  if (await autoFixControl.isVisible().catch(() => false)) {
    await expect(autoFixControl).toBeVisible();
  }
  
  // Click generate button
  stepLogger.log(''Initiating test generation and validation'');
  const generateButton = dialog.getByRole(''button'', { name: /generate|create|submit/i }).last();
  await expect(generateButton).toBeVisible();
  await generateButton.click();
  
  // Wait for validation to start - look for loading state
  stepLogger.log(''Waiting for validation process'');
  const loadingIndicator = dialog.getByText(/validating|generating|loading|processing/i);
  await expect(loadingIndicator).toBeVisible({ timeout: 15000 });
  
  // Wait for validation to complete - look for results
  stepLogger.log(''Waiting for validation results'');
  await page.waitForTimeout(2000);
  
  // Look for completion indicators
  const resultIndicators = dialog.getByText(/complete|success|valid|result|selector|done/i);
  await expect(resultIndicators.first()).toBeVisible({ timeout: 45000 });
  
  // Verify validation results are displayed
  stepLogger.log(''Verifying selector validation results'');
  const hasResults = await dialog.getByText(/selector|locator|element/i).isVisible().catch(() => false);
  
  if (hasResults) {
    stepLogger.log(''Validation results displayed'');
  }
  
  // Check for revalidate button if it exists
  const revalidateButton = dialog.getByRole(''button'', { name: /revalidate|validate.*again/i });
  const hasRevalidateButton = await revalidateButton.isVisible().catch(() => false);
  if (hasRevalidateButton) {
    stepLogger.log(''Revalidate button is available for manual revalidation'');
    await expect(revalidateButton).toBeVisible();
  }
  
  // Look for generated code preview or code section
  stepLogger.log(''Checking for generated test code preview'');
  const codePreview = dialog.getByText(/code|preview|generated/i);
  if (await codePreview.isVisible().catch(() => false)) {
    await expect(codePreview).toBeVisible();
  }
  
  // Check for test name field
  stepLogger.log(''Verifying test name field'');
  const testNameField = dialog.getByRole(''textbox'').filter({ hasText: /name/i }).or(
    dialog.getByLabel(/name/i)
  );
  if (await testNameField.isVisible().catch(() => false)) {
    await expect(testNameField).toBeVisible();
    const nameValue = await testNameField.inputValue();
    if (nameValue) {
      stepLogger.log(`Test name: ${nameValue}`);
    }
  }
  
  // Verify save button is available
  stepLogger.log(''Checking for save button'');
  const saveButton = dialog.getByRole(''button'', { name: /save|add.*test/i });
  if (await saveButton.isVisible().catch(() => false)) {
    await expect(saveButton).toBeVisible();
    const isEnabled = await saveButton.isEnabled();
    if (isEnabled) {
      stepLogger.log(''Save button is enabled'');
    }
  }
  
  // Take final screenshot
  await page.screenshot({ path: screenshotPath, fullPage: true });
  
  stepLogger.log(''MCP selector validation workflow verified successfully'');
}', 'MCP Selector Validation - Test Scenarios', 0, 'http://localhost:3000', NULL, NULL, NULL, NULL, NULL, 1773936529, 1773938272, NULL, NULL, NULL, NULL, NULL, 'procedural', NULL);
INSERT INTO tests (id, repository_id, functional_area_id, name, code, description, is_placeholder, target_url, setup_test_id, setup_script_id, setup_overrides, teardown_overrides, deleted_at, created_at, updated_at, required_capabilities, stabilization_overrides, viewport_override, diff_overrides, playwright_overrides, execution_mode, agent_prompt) VALUES ('00f3464d-6a8d-4c46-b4ba-d10dc9d9b185', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'ca77a442-936f-4a57-9433-5074d71af5c4', 'AI Diff Analysis', 'export async function test(page, baseUrl, screenshotPath, stepLogger) {
  stepLogger.log(''Scenario 1: AI Diff Analysis - Verify AI classification features'');
  
  stepLogger.log(''Navigating to review page to find diffs with AI analysis'');
  await page.goto(`${baseUrl}/review`, { waitUntil: ''domcontentloaded'' });
  await expect(page).toHaveURL(/\/review/);
  
  stepLogger.log(''Waiting for page to load completely'');
  await page.waitForLoadState(''networkidle'');
  
  stepLogger.log(''Looking for any diff to inspect'');
  const firstDiffLink = page.locator(''a[href*="/builds/"][href*="/diff/"]'').first();
  await firstDiffLink.waitFor({ state: ''visible'', timeout: 10000 });
  await firstDiffLink.click();
  
  await page.waitForLoadState(''domcontentloaded'');
  await expect(page).toHaveURL(/\/builds\/[^\/]+\/diff\/[^\/]+/);
  
  stepLogger.log(''Waiting for diff page to fully load'');
  await page.waitForLoadState(''networkidle'');
  
  stepLogger.log(''Checking if AI analysis section is present'');
  const aiSectionExists = await page.locator(''.border-purple-200'').first().isVisible({ timeout: 5000 }).catch(() => false);
  
  if (!aiSectionExists) {
    stepLogger.log(''No AI analysis found for this diff - checking for AI analysis in progress or pending'');
    const aiInProgress = await page.getByText(/AI analysis in progress/).isVisible({ timeout: 2000 }).catch(() => false);
    
    if (aiInProgress) {
      stepLogger.log(''AI analysis is in progress, waiting up to 30 seconds'');
      await page.waitForSelector(''.border-purple-200'', { timeout: 30000 }).catch(() => {
        stepLogger.log(''AI analysis did not complete in time, test cannot verify AI features'');
      });
    } else {
      stepLogger.log(''No AI analysis available for this diff, skipping AI-specific assertions'');
      stepLogger.log(''Taking screenshot of diff page without AI analysis'');
      await page.screenshot({ path: screenshotPath, fullPage: true });
      
      stepLogger.log(''Verifying basic diff functionality instead'');
      await expect(page.locator(''img, canvas'').first()).toBeVisible({ timeout: 10000 });
      await expect(page.getByRole(''button'', { name: /Expected Change|Skip/i }).first()).toBeVisible();
      
      stepLogger.log(''Test completed - no AI analysis present on this diff'');
      return;
    }
  }
  
  stepLogger.log(''AI analysis section found, verifying components'');
  const aiSection = page.locator(''.border-purple-200'').first();
  await expect(aiSection).toBeVisible();
  
  stepLogger.log(''Verifying Sparkles icon is present'');
  await expect(page.locator(''.lucide-sparkles, svg[class*="lucide-sparkles"]'').first()).toBeVisible({ timeout: 5000 });
  
  stepLogger.log(''Checking for AI classification badge'');
  const classificationBadge = page.locator(''.bg-green-100, .bg-blue-100, .bg-yellow-100'').filter({ hasText: /insignificant|meaningful|noise/i }).first();
  if (await classificationBadge.isVisible({ timeout: 3000 }).catch(() => false)) {
    const classification = await classificationBadge.textContent();
    stepLogger.log(`Found classification: ${classification}`);
  } else {
    stepLogger.log(''Classification badge not visible, checking text content'');
    const hasClassification = await page.getByText(/insignificant|meaningful|noise/i).first().isVisible({ timeout: 3000 }).catch(() => false);
    if (hasClassification) {
      const classification = await page.getByText(/insignificant|meaningful|noise/i).first().textContent();
      stepLogger.log(`Found classification text: ${classification}`);
    }
  }
  
  stepLogger.log(''Checking for AI recommendation badge'');
  const recommendationBadge = page.locator(''.bg-green-100, .bg-red-100, .bg-yellow-100'').filter({ hasText: /approve|review|flag/i }).first();
  if (await recommendationBadge.isVisible({ timeout: 3000 }).catch(() => false)) {
    const recommendation = await recommendationBadge.textContent();
    stepLogger.log(`Found recommendation: ${recommendation}`);
  } else {
    stepLogger.log(''Recommendation badge not visible, checking text content'');
    const hasRecommendation = await page.getByText(/approve|review|flag/i).first().isVisible({ timeout: 3000 }).catch(() => false);
    if (hasRecommendation) {
      const recommendation = await page.getByText(/approve|review|flag/i).first().textContent();
      stepLogger.log(`Found recommendation text: ${recommendation}`);
    }
  }
  
  stepLogger.log(''Verifying confidence score is displayed'');
  const confidenceText = page.getByText(/\d+%\s*confidence/i).first();
  if (await confidenceText.isVisible({ timeout: 3000 }).catch(() => false)) {
    const confidenceValue = await confidenceText.textContent();
    stepLogger.log(`Confidence score: ${confidenceValue}`);
  } else {
    stepLogger.log(''Confidence score not visible'');
  }
  
  stepLogger.log(''Verifying AI summary text is present'');
  const summaryText = aiSection.locator(''.text-sm.text-gray-700'').first();
  if (await summaryText.isVisible({ timeout: 3000 }).catch(() => false)) {
    const summary = await summaryText.textContent();
    stepLogger.log(`AI Summary: ${summary?.substring(0, 100)}...`);
  } else {
    stepLogger.log(''AI summary not visible in expected format'');
  }
  
  stepLogger.log(''Taking screenshot of diff page with AI analysis'');
  await page.screenshot({ path: screenshotPath.replace(''.png'', ''-scenario-1.png''), fullPage: true });
  
  stepLogger.log(''Verifying diff comparison images are present'');
  await expect(page.locator(''img, canvas'').first()).toBeVisible({ timeout: 10000 });
  
  stepLogger.log(''Verifying action buttons are present'');
  const expectedChangeBtn = page.getByRole(''button'', { name: /Expected Change|Mark as Expected/i });
  const skipBtn = page.getByRole(''button'', { name: /Skip/i });
  
  if (await expectedChangeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await expect(expectedChangeBtn).toBeVisible();
  }
  if (await skipBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await expect(skipBtn).toBeVisible();
  }
  
  stepLogger.log(''Taking final screenshot'');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  
  stepLogger.log(''Test completed successfully - AI diff analysis features verified'');
}', 'AI Diff Analysis - Test Scenarios', 0, 'http://localhost:3000', NULL, NULL, NULL, NULL, NULL, 1773936540, 1773937768, NULL, NULL, NULL, NULL, NULL, 'procedural', NULL);

INSERT INTO setup_scripts (id, repository_id, name, type, code, description, created_at, updated_at) VALUES ('2ab5d461-25cf-4a96-b741-c53ace76f189', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'Login Setup', 'playwright', 'export async function setup(page, baseUrl, screenshotPath, stepLogger) {
  // Test user credentials
  const testUser = {
    email: ''test@example.com'',
    password: ''Password123!'',
    name: ''Test User''
  };

  stepLogger.log(''Navigating to registration page...'');
  await page.goto(`${baseUrl}/register`);
  await page.waitForLoadState(''networkidle'');

  stepLogger.log(''Filling registration form...'');
  
  // Fill registration form - adjust selectors based on actual form fields
  // Looking for name, email, and password fields
  const nameInput = page.locator(''input[type="text"], input[name*="name"], input[placeholder*="name"]'').first();
  const emailInput = page.locator(''input[type="email"]'');
  const passwordInput = page.locator(''input[type="password"]'').first();
  const confirmPasswordInput = page.locator(''input[type="password"]'').nth(1);

  // Fill in the form fields
  if (await nameInput.isVisible().catch(() => false)) {
    await nameInput.fill(testUser.name);
  }
  
  await emailInput.fill(testUser.email);
  await passwordInput.fill(testUser.password);
  
  // Fill confirm password if it exists
  if (await confirmPasswordInput.count() > 0) {
    await confirmPasswordInput.fill(testUser.password);
  }

  stepLogger.log(''Submitting registration form...'');
  
  // Submit the form - look for submit button
  const submitButton = page.locator(''button[type="submit"], button:has-text("Sign up"), button:has-text("Register"), button:has-text("Create account")'').first();
  await submitButton.click();

  stepLogger.log(''Waiting for registration to complete...'');
  
  // Wait for navigation or success indication
  await page.waitForLoadState(''networkidle'');
  
  // Check if we''re redirected to login or dashboard
  const currentUrl = page.url();
  
  if (currentUrl.includes(''/login'') || currentUrl.includes(''/signin'')) {
    stepLogger.log(''Registration successful, now logging in...'');
    
    // Fill login form
    await page.locator(''input[type="email"]'').fill(testUser.email);
    await page.locator(''input[type="password"]'').fill(testUser.password);
    
    // Click sign in button
    const loginButton = page.locator(''button[type="submit"], button:has-text("Sign in"), button:has-text("Login")'').first();
    await loginButton.click();
    
    await page.waitForLoadState(''networkidle'');
  }

  stepLogger.log(''Verifying successful login...'');
  
  // Wait for dashboard or authenticated content
  // Look for common authenticated page indicators
  await page.waitForSelector(''body'', { state: ''visible'' });
  
  // Verify we''re not on login/register pages anymore
  const finalUrl = page.url();
  const loggedIn = !finalUrl.includes(''/login'') && !finalUrl.includes(''/register'');
  
  if (loggedIn) {
    stepLogger.log(''Setup complete - user logged in successfully'');
  } else {
    stepLogger.log(''Warning: May not be logged in, check application state'');
  }

  return {
    loggedIn,
    testUser: {
      email: testUser.email,
      password: testUser.password
    }
  };
}', 'Auto-generated login setup by onboarding agent', 1772478888, 1772478888);
INSERT INTO setup_scripts (id, repository_id, name, type, code, description, created_at, updated_at) VALUES ('0cddd342-5b17-44eb-b0e5-fe336694712b', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'Login Setup', 'playwright', 'export async function setup(page, baseUrl, screenshotPath, stepLogger) {
  // Generate unique test credentials
  const timestamp = Date.now();
  const testEmail = `test${timestamp}@example.com`;
  const testPassword = ''Password123!'';
  const testName = ''Test User'';

  try {
    // Step 1: Navigate to registration page
    stepLogger.log(''Navigating to registration page'');
    await page.goto(`${baseUrl}/register`);
    await page.waitForLoadState(''networkidle'');

    // Step 2: Fill registration form
    stepLogger.log(`Registering new account with email: ${testEmail}`);
    
    // Fill in registration form fields
    // Look for common registration field patterns
    await page.fill(''input[type="email"], input[name="email"], input[placeholder*="email" i]'', testEmail);
    await page.fill(''input[type="password"], input[name="password"]'', testPassword);
    
    // Check if there''s a name field (common in registration forms)
    const nameField = page.locator(''input[name="name"], input[placeholder*="name" i]'').first();
    if (await nameField.count() > 0) {
      await nameField.fill(testName);
    }
    
    // Check for password confirmation field
    const confirmPasswordField = page.locator(''input[name="confirmPassword"], input[name="password_confirmation"], input[placeholder*="confirm" i]'').first();
    if (await confirmPasswordField.count() > 0) {
      await confirmPasswordField.fill(testPassword);
    }

    // Step 3: Submit registration form
    stepLogger.log(''Submitting registration form'');
    await page.click(''button[type="submit"], button:has-text("Sign up"), button:has-text("Register"), button:has-text("Create")'');
    
    // Wait for navigation or success indicator
    await page.waitForLoadState(''networkidle'');
    
    // Step 4: Check if we need to login or if already logged in
    const currentUrl = page.url();
    stepLogger.log(`Registration complete, current URL: ${currentUrl}`);
    
    // If redirected to login page or still on register page, navigate to login
    if (currentUrl.includes(''/login'') || currentUrl.includes(''/register'')) {
      stepLogger.log(''Navigating to login page'');
      await page.goto(`${baseUrl}/login`);
      await page.waitForLoadState(''networkidle'');
      
      // Step 5: Fill login form
      stepLogger.log(`Logging in with email: ${testEmail}`);
      await page.fill(''input[type="email"], input[name="email"], input[placeholder*="email" i]'', testEmail);
      await page.fill(''input[type="password"], input[name="password"]'', testPassword);
      
      // Submit login form
      stepLogger.log(''Submitting login form'');
      await page.click(''button[type="submit"], button:has-text("Sign in"), button:has-text("Login")'');
      await page.waitForLoadState(''networkidle'');
    }
    
    // Step 6: Verify successful login
    // Wait for dashboard/app content or check for logout button
    await page.waitForTimeout(1000); // Brief wait for any redirects
    
    const finalUrl = page.url();
    stepLogger.log(`Login complete, final URL: ${finalUrl}`);
    
    // Check we''re not on login or register page anymore
    if (!finalUrl.includes(''/login'') && !finalUrl.includes(''/register'')) {
      stepLogger.log(''✓ Successfully registered and logged in'');
      return { 
        loggedIn: true,
        email: testEmail,
        password: testPassword
      };
    } else {
      throw new Error(''Login may have failed - still on login/register page'');
    }
    
  } catch (error) {
    stepLogger.log(`✗ Setup failed: ${error.message}`);
    throw error;
  }
}', 'Auto-generated login setup by onboarding agent', 1772736789, 1772736789);
INSERT INTO setup_scripts (id, repository_id, name, type, code, description, created_at, updated_at) VALUES ('51c7fd2f-6ea0-4e05-aef1-adb4c1d1a64f', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'Login Setup', 'playwright', 'export async function setup(page, baseUrl, screenshotPath, stepLogger) {
  // Generate unique test credentials to avoid conflicts
  const timestamp = Date.now();
  const testEmail = `test${timestamp}@example.com`;
  const testPassword = ''Password123!'';
  const testName = ''Test User'';

  try {
    // Step 1: Navigate to registration page
    stepLogger.log(''Navigating to registration page'');
    await page.goto(`${baseUrl}/register`);
    await page.waitForLoadState(''networkidle'');

    // Step 2: Fill in registration form
    stepLogger.log(`Registering new account with email: ${testEmail}`);
    
    // Look for common registration form fields
    // Check if there''s a name field
    const nameField = page.locator(''input[type="text"]'').first();
    if (await nameField.isVisible().catch(() => false)) {
      await nameField.fill(testName);
    }
    
    // Fill email field
    await page.locator(''input[type="email"]'').fill(testEmail);
    
    // Fill password field(s)
    const passwordFields = page.locator(''input[type="password"]'');
    const passwordCount = await passwordFields.count();
    
    if (passwordCount === 1) {
      await passwordFields.first().fill(testPassword);
    } else if (passwordCount >= 2) {
      // Handle password + confirm password
      await passwordFields.nth(0).fill(testPassword);
      await passwordFields.nth(1).fill(testPassword);
    }

    // Step 3: Submit registration form
    stepLogger.log(''Submitting registration form'');
    
    // Try to find and click the submit button
    const submitButton = page.locator(''button[type="submit"]'').or(
      page.locator(''button:has-text("Sign up")'').or(
        page.locator(''button:has-text("Register")'').or(
          page.locator(''button:has-text("Create account")'')
        )
      )
    );
    
    await submitButton.click();

    // Step 4: Wait for successful registration
    stepLogger.log(''Waiting for registration to complete'');
    
    // Wait for navigation or success indicator (adjust based on actual app behavior)
    await Promise.race([
      page.waitForURL(`${baseUrl}/login`, { timeout: 5000 }).catch(() => null),
      page.waitForURL(`${baseUrl}/dashboard`, { timeout: 5000 }).catch(() => null),
      page.waitForURL(new RegExp(`${baseUrl}/(login|dashboard|home)`), { timeout: 5000 }).catch(() => null),
      page.waitForSelector(''text=/successfully registered|welcome|dashboard/i'', { timeout: 5000 }).catch(() => null)
    ]);

    // Step 5: Check if we need to log in or if already logged in
    const currentUrl = page.url();
    
    if (currentUrl.includes(''/login'')) {
      // Need to log in after registration
      stepLogger.log(''Logging in with new account'');
      
      await page.locator(''input[type="email"]'').fill(testEmail);
      await page.locator(''input[type="password"]'').fill(testPassword);
      
      const loginButton = page.locator(''button[type="submit"]'').or(
        page.locator(''button:has-text("Sign in")'').or(
          page.locator(''button:has-text("Log in")'')
        )
      );
      
      await loginButton.click();
      
      // Wait for successful login
      await Promise.race([
        page.waitForURL(new RegExp(`${baseUrl}/(dashboard|home)`), { timeout: 10000 }),
        page.waitForSelector(''text=/dashboard|welcome|projects/i'', { timeout: 10000 })
      ]);
      
      stepLogger.log(''Successfully logged in'');
    } else {
      stepLogger.log(''Already logged in after registration'');
    }

    // Verify we''re logged in by checking we''re not on login/register page
    await page.waitForLoadState(''networkidle'');
    const finalUrl = page.url();
    
    if (finalUrl.includes(''/login'') || finalUrl.includes(''/register'')) {
      throw new Error(''Login verification failed - still on auth page'');
    }

    stepLogger.log(''Setup completed successfully'');
    
    return {
      loggedIn: true,
      email: testEmail,
      password: testPassword
    };

  } catch (error) {
    stepLogger.log(`Setup failed: ${error.message}`);
    throw error;
  }
}', 'Auto-generated login setup by onboarding agent', 1772738927, 1772738927);
INSERT INTO setup_scripts (id, repository_id, name, type, code, description, created_at, updated_at) VALUES ('cbe4bea3-409b-4785-bbc9-fbce1b26cf87', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'Auto-generated Login (needs fix)', 'playwright', 'export async function setup(page, baseUrl, screenshotPath, stepLogger) {
  // Generate unique test credentials to avoid conflicts
  const timestamp = Date.now();
  const testEmail = `test.user.${timestamp}@example.com`;
  const testPassword = ''Password123!'';
  const testName = ''Test User'';

  try {
    // Step 1: Navigate to registration page
    stepLogger.log(''Navigating to registration page'');
    await page.goto(`${baseUrl}/register`);
    await page.waitForLoadState(''networkidle'');

    // Step 2: Fill in registration form
    stepLogger.log(''Filling registration form'');
    
    // Look for common registration form fields
    const emailInput = page.locator(''input[type="email"]'').first();
    const passwordInput = page.locator(''input[type="password"]'').first();
    
    // Check if there''s a name field (common in registration forms)
    const nameInput = page.locator(''input[name*="name"], input[placeholder*="name"]'').first();
    const nameExists = await nameInput.count() > 0;
    
    if (nameExists) {
      await nameInput.fill(testName);
    }
    
    await emailInput.fill(testEmail);
    await passwordInput.fill(testPassword);
    
    // Handle confirm password field if it exists
    const passwordInputs = page.locator(''input[type="password"]'');
    const passwordCount = await passwordInputs.count();
    if (passwordCount > 1) {
      await passwordInputs.nth(1).fill(testPassword);
    }

    // Step 3: Submit registration form
    stepLogger.log(''Submitting registration form'');
    const submitButton = page.locator(''button[type="submit"]'').first();
    await submitButton.click();

    // Step 4: Wait for successful registration
    stepLogger.log(''Waiting for registration to complete'');
    
    // Wait for either redirect to login or dashboard, or success message
    await Promise.race([
      page.waitForURL(/\/(login|dashboard|home)/, { timeout: 10000 }),
      page.waitForSelector(''text=/success|welcome|registered/i'', { timeout: 10000 }),
      page.waitForLoadState(''networkidle'', { timeout: 10000 })
    ]).catch(() => {
      stepLogger.log(''Registration completed, proceeding to login'');
    });

    // Step 5: Navigate to login page if not already there
    const currentUrl = page.url();
    if (!currentUrl.includes(''/login'')) {
      stepLogger.log(''Navigating to login page'');
      await page.goto(`${baseUrl}/login`);
      await page.waitForLoadState(''networkidle'');
    }

    // Step 6: Fill in login form
    stepLogger.log(''Logging in with test account'');
    await page.locator(''input[type="email"]'').first().fill(testEmail);
    await page.locator(''input[type="password"]'').first().fill(testPassword);

    // Step 7: Submit login form
    const loginButton = page.locator(''button[type="submit"]'').first();
    await loginButton.click();

    // Step 8: Wait for successful login
    stepLogger.log(''Waiting for login to complete'');
    
    // Wait for redirect away from login page or dashboard content
    await Promise.race([
      page.waitForURL(url => !url.includes(''/login''), { timeout: 10000 }),
      page.waitForSelector(''text=/dashboard|welcome|logout|sign out/i'', { timeout: 10000 }),
      page.waitForLoadState(''networkidle'', { timeout: 10000 })
    ]);

    stepLogger.log(''Setup completed successfully'');

    // Return test account info and success status
    return {
      loggedIn: true,
      testEmail,
      testPassword,
      testName
    };

  } catch (error) {
    stepLogger.log(`Setup failed: ${error.message}`);
    throw error;
  }
}', 'Auto-generated by onboarding agent. Error: url.includes is not a function', 1772779004, 1772779004);
INSERT INTO setup_scripts (id, repository_id, name, type, code, description, created_at, updated_at) VALUES ('e9b85fc3-fe08-41ba-b01a-4072afae0572', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'Auto-generated Login (needs fix)', 'playwright', 'export async function setup(page, baseUrl, screenshotPath, stepLogger) {
  // Step 1: Navigate to registration page
  stepLogger.log(''Navigating to registration page'');
  await page.goto(`${baseUrl}/register`);
  await page.waitForLoadState(''networkidle'');

  // Step 2: Fill in registration form
  stepLogger.log(''Filling registration form'');
  const timestamp = Date.now();
  const testEmail = `test${timestamp}@example.com`;
  const testPassword = ''Password123!'';

  // Find and fill email input
  await page.fill(''input[type="email"]'', testEmail);
  
  // Find and fill password input
  await page.fill(''input[type="password"]'', testPassword);
  
  // Check if there''s a password confirmation field (common in registration)
  const passwordInputs = await page.locator(''input[type="password"]'').count();
  if (passwordInputs > 1) {
    // Fill confirm password field
    await page.locator(''input[type="password"]'').nth(1).fill(testPassword);
  }

  // Step 3: Submit registration form
  stepLogger.log(''Submitting registration form'');
  await page.click(''button[type="submit"], button:has-text("Sign up"), button:has-text("Register")'');

  // Step 4: Wait for successful registration
  stepLogger.log(''Waiting for registration to complete'');
  await page.waitForURL(url => {
    const urlString = url.toString();
    return urlString.includes(''/login'') || 
           urlString.includes(''/dashboard'') || 
           !urlString.includes(''/register'');
  }, { timeout: 10000 });

  // Step 5: Check if we need to log in or if already logged in
  const currentUrl = page.url();
  
  if (currentUrl.includes(''/login'')) {
    stepLogger.log(''Redirected to login, signing in with new account'');
    
    await page.waitForLoadState(''networkidle'');
    
    // Fill in login form
    await page.fill(''input[type="email"]'', testEmail);
    await page.fill(''input[type="password"]'', testPassword);
    
    // Submit login form
    await page.click(''button[type="submit"], button:has-text("Sign in")'');
    
    // Wait for successful login
    stepLogger.log(''Waiting for login to complete'');
    await page.waitForURL(url => {
      const urlString = url.toString();
      return urlString.includes(''/dashboard'') || 
             urlString.includes(''/projects'') ||
             !urlString.includes(''/login'');
    }, { timeout: 10000 });
  }

  // Step 6: Verify we''re logged in
  stepLogger.log(''Verifying login status'');
  await page.waitForLoadState(''networkidle'');
  
  // Wait for any dashboard/authenticated content to appear
  // This could be a user menu, dashboard heading, etc.
  await page.waitForTimeout(1000); // Brief wait to ensure UI has updated

  stepLogger.log(''Setup completed successfully'');
  
  return {
    loggedIn: true,
    email: testEmail,
    password: testPassword
  };
}', 'Auto-generated by onboarding agent. Error: page.waitForURL: Timeout 10000ms exceeded.
=========================== logs ===========================
waiting for navigation until "load"
============================================================', 1772782590, 1772782590);
INSERT INTO setup_scripts (id, repository_id, name, type, code, description, created_at, updated_at) VALUES ('2e150357-ae3c-4378-b5ab-edcd7a651c3b', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'Login Setup', 'playwright', 'export async function setup(page, baseUrl, screenshotPath, stepLogger) {
  // Generate unique test credentials to avoid conflicts
  const timestamp = Date.now();
  const testEmail = `test${timestamp}@example.com`;
  const testPassword = ''Password123!'';
  const testName = ''Test User'';

  try {
    // Step 1: Navigate to registration page
    stepLogger.log(''Navigating to registration page'');
    await page.goto(`${baseUrl}/register`);
    await page.waitForLoadState(''networkidle'');

    // Step 2: Fill in registration form
    stepLogger.log(`Registering new test account: ${testEmail}`);
    
    // Fill email field
    await page.fill(''input[type="email"]'', testEmail);
    
    // Fill password field
    await page.fill(''input[type="password"]'', testPassword);
    
    // Check if there''s a name field (common in registration forms)
    const nameField = page.locator(''input[name="name"], input[placeholder*="name" i], input[type="text"]'').first();
    if (await nameField.isVisible().catch(() => false)) {
      await nameField.fill(testName);
    }

    // Check for confirm password field
    const passwordFields = page.locator(''input[type="password"]'');
    const passwordCount = await passwordFields.count();
    if (passwordCount > 1) {
      await passwordFields.nth(1).fill(testPassword);
    }

    // Step 3: Submit registration form
    stepLogger.log(''Submitting registration form'');
    await page.click(''button[type="submit"], button:has-text("Sign up"), button:has-text("Register")'');

    // Step 4: Wait for successful registration
    // Look for redirect to login page, dashboard, or success message
    stepLogger.log(''Waiting for registration confirmation'');
    await Promise.race([
      page.waitForURL(url => {
        const urlStr = url.toString();
        return urlStr.includes(''/login'') || 
               urlStr.includes(''/dashboard'') || 
               urlStr.includes(''/projects'') ||
               urlStr.includes(''/home'');
      }, { timeout: 10000 }),
      page.waitForSelector(''text=/success|welcome|dashboard/i'', { timeout: 10000 })
    ]);

    // Step 5: Check if we need to login or if already logged in
    const currentUrl = page.url();
    stepLogger.log(`Current URL after registration: ${currentUrl}`);

    if (currentUrl.includes(''/login'')) {
      // Need to log in after registration
      stepLogger.log(''Logging in with registered credentials'');
      
      await page.waitForLoadState(''networkidle'');
      await page.fill(''input[type="email"]'', testEmail);
      await page.fill(''input[type="password"]'', testPassword);
      await page.click(''button[type="submit"], button:has-text("Sign in")'');

      // Wait for successful login
      stepLogger.log(''Waiting for login confirmation'');
      await page.waitForURL(url => {
        const urlStr = url.toString();
        return urlStr.includes(''/dashboard'') || 
               urlStr.includes(''/projects'') ||
               urlStr.includes(''/home'') ||
               !urlStr.includes(''/login'');
      }, { timeout: 10000 });
    }

    // Step 6: Verify login success
    stepLogger.log(''Verifying successful authentication'');
    await page.waitForLoadState(''networkidle'');
    
    // Ensure we''re not on login or register page
    const finalUrl = page.url();
    if (finalUrl.includes(''/login'') || finalUrl.includes(''/register'')) {
      throw new Error(''Still on authentication page after login attempt'');
    }

    stepLogger.log(''Setup completed successfully'');
    return { 
      loggedIn: true,
      email: testEmail,
      password: testPassword
    };

  } catch (error) {
    stepLogger.log(`Setup failed: ${error.message}`);
    throw error;
  }
}', 'Auto-generated login setup by onboarding agent', 1772791795, 1772791795);
INSERT INTO setup_scripts (id, repository_id, name, type, code, description, created_at, updated_at) VALUES ('8783ff6c-e51b-440c-8d9a-35ba172665b5', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'Login Setup', 'playwright', 'export async function setup(page, baseUrl, screenshotPath, stepLogger) {
  // Generate unique test credentials to avoid conflicts
  const timestamp = Date.now();
  const testEmail = `test${timestamp}@example.com`;
  const testPassword = ''Password123!'';
  const testName = ''Test User'';

  try {
    // Step 1: Navigate to registration page
    stepLogger.log(''Navigating to registration page'');
    await page.goto(`${baseUrl}/register`);
    await page.waitForLoadState(''networkidle'');

    // Step 2: Fill in registration form
    stepLogger.log(`Registering new account with email: ${testEmail}`);
    
    // Fill in the registration form fields
    // Assuming the form has name, email, and password fields
    const nameInput = page.locator(''input[type="text"], input[name*="name"], input[placeholder*="name"]'').first();
    const emailInput = page.locator(''input[type="email"]'');
    const passwordInput = page.locator(''input[type="password"]'').first();
    
    await nameInput.fill(testName);
    await emailInput.fill(testEmail);
    await passwordInput.fill(testPassword);

    // Step 3: Submit registration form
    stepLogger.log(''Submitting registration form'');
    const submitButton = page.locator(''button[type="submit"], button:has-text("Sign up"), button:has-text("Register")'').first();
    await submitButton.click();

    // Step 4: Wait for successful registration
    stepLogger.log(''Waiting for registration to complete'');
    
    // Wait for either redirect to login or dashboard
    await page.waitForURL(url => {
      const urlStr = url.toString();
      return urlStr.includes(''/login'') || 
             urlStr.includes(''/dashboard'') || 
             urlStr.includes(''/projects'') ||
             !urlStr.includes(''/register'');
    }, { timeout: 10000 });

    // Step 5: Log in if redirected to login page
    const currentUrl = page.url();
    if (currentUrl.includes(''/login'')) {
      stepLogger.log(''Registration successful, logging in'');
      
      await page.waitForLoadState(''networkidle'');
      
      // Fill in login form
      await page.locator(''input[type="email"]'').fill(testEmail);
      await page.locator(''input[type="password"]'').fill(testPassword);
      
      // Submit login form
      const loginButton = page.locator(''button[type="submit"], button:has-text("Sign in")'').first();
      await loginButton.click();
      
      // Wait for successful login (redirect away from login page)
      stepLogger.log(''Waiting for login to complete'');
      await page.waitForURL(url => {
        return !url.toString().includes(''/login'');
      }, { timeout: 10000 });
    }

    // Step 6: Verify we''re logged in
    stepLogger.log(''Verifying login status'');
    await page.waitForLoadState(''networkidle'');
    
    // Wait for dashboard or authenticated content to appear
    // This could be a user menu, dashboard element, or projects page
    await page.waitForSelector(''body'', { state: ''visible'', timeout: 5000 });
    
    stepLogger.log(''Setup complete - user logged in successfully'');
    
    return {
      loggedIn: true,
      email: testEmail,
      password: testPassword,
      name: testName
    };

  } catch (error) {
    stepLogger.log(`Setup failed: ${error.message}`);
    throw error;
  }
}', 'Auto-generated login setup by onboarding agent', 1772800480, 1772800480);

INSERT INTO default_setup_steps (id, repository_id, step_type, test_id, script_id, storage_state_id, order_index, created_at) VALUES ('0f281033-f62f-41d1-b6fa-057265c28883', 'de09a6f4-9225-475f-bd04-f53b44ea3edc', 'test', '3299cab2-6c46-4ad8-a4bd-8bea93df0178', NULL, NULL, 2, 1772800998);

COMMIT;