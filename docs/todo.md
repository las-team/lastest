intent /home/ewyct/dev/lastest2/docs/targeted-ui-spec.md
dash /home/ewyct/.claude/plans/proud-yawning-noodle.md
repo /home/ewyct/.claude/plans/replicated-forging-fountain.md
compare /home/ewyct/.claude/plans/partitioned-bouncing-metcalfe.md
playwright settings /home/ewyct/.claude/plans/replicated-tinkering-papert.md
Determining test coverage /home/ewyct/.claude/plans/zazzy-tinkering-backus.md

--------
## started
Change the runs screen to a 2 column layout the right side showing the builds that have been run. Show a nice summary card for each. It should be possible to open them 

when showing a branch - this is true for the runs and the compare pages
    make sure the header sizes are uniform
    even non-run tests (that are available for the branch) are shown (with a grey icon)
    when a test has multiple steps/assertions/screenshots when clicking on it it should show them in order (timeline-ish look)

Implement the OCR feature to identify the selected UI element's text label


## features
Route scan - where does it lok for routes? -it seems to be fixated on the lastest2 repo instead of the selected one

Branch checkout & test run flow /home/ewyct/.claude/plans/breezy-riding-crane.md

## ideas
Firecrawl?
Research playwrights comparison options, how they work?
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
functional areas should be unique - if added again than merged into the previous value in a case-insensitive manner for the given repo
auto-generated tests shouldnt be duplicated but updated if re-generated
have the drizzle studio linked from the settings

when recording tests they should be saved to the active repo - same for runs
http://localhost:3000/builds/d6cdd584-82b5-4750-bdff-0d41e79ba825 should be possible to click the top menu elements to filter down the list