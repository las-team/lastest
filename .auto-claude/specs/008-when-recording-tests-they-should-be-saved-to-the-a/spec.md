# Specification: Fix Test Recording and Run Persistence to Active Repository

## Overview

This bug fix addresses an issue where test recordings and test runs are not being saved to the active repository. Currently, these artifacts are either not persisted correctly or are saved to an incorrect location. The task ensures that both test recordings and test run data are properly persisted to the active repository's designated storage location.

## Workflow Type

**Type**: bug_fix

**Rationale**: This is a corrective task addressing incorrect behavior in the test recording and run persistence mechanism. The expected functionality (saving to active repo) exists but is not working correctly, making this a bug fix rather than a new feature.

## Task Scope

### Services Involved
- **Core Test Infrastructure** (primary) - Test recording and execution logic
- **Repository Management** (integration) - Active repository detection and file system operations

### This Task Will:
- [ ] Identify current save location for test recordings
- [ ] Identify current save location for test runs
- [ ] Determine correct "active repository" resolution logic
- [ ] Fix test recording persistence to save to active repo
- [ ] Fix test run persistence to save to active repo
- [ ] Ensure consistent path resolution for both features

### Out of Scope:
- Changes to test recording format or structure
- Changes to test execution logic (beyond save location)
- Migration of existing recordings/runs from old locations
- UI/UX changes to test recording interface

## Service Context

### Core Test Infrastructure

**Tech Stack:**
- Language: TypeScript
- Framework: pnpm monorepo
- Key directories: To be identified during investigation

**Entry Point:** To be identified

**How to Run:**
```bash
# Commands to be determined based on codebase structure
pnpm install
pnpm test
```

**Port:** N/A (CLI/filesystem operations)

## Files to Modify

| File | Service | What to Change |
|------|---------|---------------|
| *To be identified* | Test Infrastructure | Update save path for test recordings |
| *To be identified* | Test Infrastructure | Update save path for test runs |
| *To be identified* | Repository Management | Ensure active repo detection is correct |

**Note**: Files will be identified during investigation phase by searching for:
- Test recording persistence logic
- Test run save operations
- Repository/workspace detection code
- File path resolution utilities

## Files to Reference

These files show patterns to follow:

| File | Pattern to Copy |
|------|----------------|
| *To be identified* | Repository root path resolution |
| *To be identified* | File system write operations with error handling |
| *To be identified* | Configuration for test artifact storage |

**Note**: Reference files will be identified by searching for existing patterns of:
- Git repository operations
- Workspace file management
- Test configuration

## Patterns to Follow

### Repository Root Resolution

**Key Points:**
- Determine the "active repository" using git root or workspace configuration
- Use absolute paths resolved from repository root
- Handle cases where no repository is active (error gracefully)

### File Persistence Pattern

**Key Points:**
- Create directories if they don't exist (e.g., `.test-recordings/`, `test-runs/`)
- Use atomic write operations to prevent corruption
- Handle write errors with meaningful error messages
- Follow project conventions for artifact storage locations

### Path Construction

**Key Points:**
- Build paths relative to repository root
- Use path utilities (e.g., `path.join()`) for cross-platform compatibility
- Validate paths before writing

## Requirements

### Functional Requirements

1. **Test Recording Persistence**
   - Description: When a test recording is created, it must be saved to a designated directory within the active repository
   - Acceptance: Test recordings appear in `<active-repo>/.test-recordings/` or similar project-standard location

2. **Test Run Persistence**
   - Description: When a test run completes, results must be saved to a designated directory within the active repository
   - Acceptance: Test run results appear in `<active-repo>/test-runs/` or similar project-standard location

3. **Active Repository Detection**
   - Description: System must correctly identify the active repository root
   - Acceptance: Repository root is detected via git root or workspace configuration

4. **Directory Creation**
   - Description: Storage directories are created automatically if they don't exist
   - Acceptance: First recording/run creates necessary directories without errors

### Edge Cases

1. **No Active Repository** - Display clear error message; do not attempt to save
2. **Write Permissions** - Handle permission errors gracefully with user-friendly messages
3. **Disk Space** - Handle low disk space scenarios without crashing
4. **Concurrent Writes** - Ensure multiple test runs don't corrupt each other's data
5. **Invalid Characters** - Sanitize filenames for cross-platform compatibility

## Implementation Notes

### DO
- Search codebase for existing test recording/run logic (grep for "recording", "test run", "save")
- Use existing repository detection utilities if available
- Follow TypeScript best practices for file I/O
- Add proper error handling and logging
- Use path utilities from Node.js `path` module
- Create timestamped or uniquely named files to avoid collisions

### DON'T
- Hardcode absolute paths
- Assume directories exist without checking
- Save to user home directory or temp directories
- Change the data format of recordings or runs
- Skip error handling for filesystem operations

## Development Environment

### Start Services

```bash
# Install dependencies
pnpm install

# Run tests to verify fix
pnpm test

# If there's a test recording command, it might be:
# pnpm test:record
# or similar - to be determined
```

### Service URLs
- N/A (filesystem/CLI operations)

### Required Environment Variables
- To be determined based on codebase investigation
- Likely none required for basic filesystem operations

## Success Criteria

The task is complete when:

1. [ ] Test recordings are saved to `<active-repo>/.test-recordings/` or project-standard location
2. [ ] Test runs are saved to `<active-repo>/test-runs/` or project-standard location
3. [ ] Active repository is correctly detected in all scenarios
4. [ ] Directories are created automatically if missing
5. [ ] Edge cases (no repo, permissions, etc.) handled gracefully
6. [ ] No console errors during normal operation
7. [ ] Existing tests still pass
8. [ ] Manual verification: Create a test recording and verify file location
9. [ ] Manual verification: Run tests and verify run data location

## QA Acceptance Criteria

**CRITICAL**: These criteria must be verified by the QA Agent before sign-off.

### Unit Tests
| Test | File | What to Verify |
|------|------|----------------|
| Repository detection | `**/repository.test.ts` or similar | Active repo correctly identified |
| Path resolution | `**/path.test.ts` or similar | Paths correctly resolved from repo root |
| Recording save | `**/recording.test.ts` or similar | Recordings saved to correct location |
| Run save | `**/test-run.test.ts` or similar | Test runs saved to correct location |

### Integration Tests
| Test | Services | What to Verify |
|------|----------|----------------|
| End-to-end recording | Test Infrastructure ↔ Filesystem | Recording created in active repo |
| End-to-end test run | Test Infrastructure ↔ Filesystem | Run data created in active repo |

### End-to-End Tests
| Flow | Steps | Expected Outcome |
|------|-------|------------------|
| Record and verify | 1. Trigger test recording 2. Check filesystem | Recording file exists in `<repo>/.test-recordings/` |
| Run and verify | 1. Execute test run 2. Check filesystem | Run data exists in `<repo>/test-runs/` |
| No repo scenario | 1. Run outside repository 2. Attempt recording | Clear error message, no crash |

### Filesystem Verification
| Check | Command | Expected |
|-------|---------|----------|
| Recording directory exists | `ls -la .test-recordings/` or similar | Directory created with recordings |
| Run directory exists | `ls -la test-runs/` or similar | Directory created with run data |
| Files have valid format | `cat <recording-file>` | Valid JSON/data format (unchanged) |

### Code Quality Verification
| Check | Method | Expected |
|-------|--------|----------|
| TypeScript compilation | `pnpm build` or `tsc` | No type errors |
| Linting | `pnpm lint` | No new lint errors |
| Existing tests | `pnpm test` | All tests pass |

### QA Sign-off Requirements
- [ ] Unit tests pass (if created/modified)
- [ ] Integration tests pass
- [ ] Manual test recording saves to active repo
- [ ] Manual test run saves to active repo
- [ ] No repository detection false positives
- [ ] Error messages are clear and actionable
- [ ] No regressions in existing test functionality
- [ ] Code follows established TypeScript patterns
- [ ] No hardcoded paths or magic strings
- [ ] Filesystem operations include proper error handling
- [ ] Documentation updated if storage locations changed

## Investigation Checklist

Since this is a bug fix requiring investigation, the implementer should:

1. [ ] Search for test recording code: `grep -r "record" --include="*.ts"`
2. [ ] Search for test run code: `grep -r "test run" --include="*.ts"`
3. [ ] Identify current save logic: Look for `fs.writeFile`, `writeFileSync`, etc.
4. [ ] Find repository detection: Search for git operations, workspace root
5. [ ] Review existing test storage: Check if `.test-recordings/` or similar exists
6. [ ] Identify the bug: Compare current save path vs. expected active repo path
7. [ ] Plan fix: Determine minimal changes to correct path resolution
8. [ ] Implement fix: Update save path logic
9. [ ] Test fix: Verify recordings and runs save correctly
10. [ ] Clean up: Ensure no hardcoded paths remain

## Notes for Implementer

**This is an investigation-heavy bug fix.** The context gathering phase did not identify specific files, which means:

1. You'll need to search the codebase to find test recording/run logic
2. The bug may be in path resolution, configuration, or repository detection
3. Focus on understanding the *current* behavior before making changes
4. The fix may be as simple as changing a path, or may require adding repository detection logic

**Start with these searches:**
- `grep -r "recording" --include="*.ts" --include="*.js"`
- `grep -r "test run" --include="*.ts" --include="*.js"`
- `grep -r "writeFile" --include="*.ts" --include="*.js"`
- Look for configuration files that might specify storage paths

**Common bug patterns:**
- Saving to `process.cwd()` instead of repository root
- Hardcoded paths to developer's local directory
- Missing repository root detection
- Using temp directories instead of project directories
