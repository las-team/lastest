intent /home/ewyct/dev/lastest2/docs/targeted-ui-spec.md
dash /home/ewyct/.claude/plans/proud-yawning-noodle.md
repo /home/ewyct/.claude/plans/replicated-forging-fountain.md
compare /home/ewyct/.claude/plans/partitioned-bouncing-metcalfe.md
playwright settings /home/ewyct/.claude/plans/replicated-tinkering-papert.md

--------
## features
Implement the OCR feature to identify the selected UI element's text label

Firecrawl?

Drizzle studio - backend view and editor

Test recording
    When recording tests there should be a create assertion button to make sure the test have been executed up until that point e.g. pageload

Determining test coverage
    check routes in repo/branch
    check sidabar elements/routes
    use nlp
    check /home/ewyct/dev/lastest how it does for manual route search
    add progress bar component on tests page
    Also add to dashboard
    Add scan button to Repo page so it can be started from there
    Add a "Add routes as test areas" button to the tests page
    Add "Add basic tests" button next to it, that should generate basic visit route and screenshot, assert it worked test based on a template

Running tests
    Run all tests should only be possible when the branch is selected
    When running tests it should check if you have the proper branch checked out and try to check it out before proceeding. This should be the case the runs menu and the comparison page launched runs as well - so all runs. When there are pending changes they should be stashed and popped after the run. This should pop toast messages to notify the user.
    When a run finishes it should pop a toast to notify the user.
    Is this possible w the gh connection to identify the downloaded content and using the user's computer? Is extra info needed from them? If no repo down we need to ask for working folder, clone, and ask for run commands? NLP search repo for run commmands?

when showing a branch - this is true for the runs and the compare pages
    make sure the header sizes are uniform
    even non-run tests (that are available for the branch) are shown (with a grey icon)
    when a test has multiple steps/assertions/screenshots when clicking on it it should show them in order (timeline-ish look)

Compare visually
    Research playwrights comp options, how they work?
    use pixdiff and comparison screen with a slider based comparison from  /home/ewyct/dev/visual-testing-research

Approve reject changes or create ticket -> gh issue

AI
    Use local claude -p and OpenRouter API key
    Determining test coverage
            check routes in repo/branch
            check functional specification in repo/branch
            make sure to check all sidebar elements and functions
            upload functional specifications manually and try to derive scenarios from that

    Having AI write tests
        Use MCP to "record them"
        assertions to fail them

## bugs
refresh icon on next ot the repo selector - out of sidebar
when recording tests they should be saved to the active repo - same for runs
