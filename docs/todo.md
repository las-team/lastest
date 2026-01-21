intent /home/ewyct/dev/lastest2/docs/targeted-ui-spec.md
dash /home/ewyct/.claude/plans/proud-yawning-noodle.md
repo /home/ewyct/.claude/plans/replicated-forging-fountain.md
compare /home/ewyct/.claude/plans/partitioned-bouncing-metcalfe.md
playwright settings /home/ewyct/.claude/plans/replicated-tinkering-papert.md
Determining test coverage /home/ewyct/.claude/plans/zazzy-tinkering-backus.md

--------
## started
Changed sensitivity slider
    When viewing a build like http://localhost:3000/builds/dd06c677-0d62-4cb0-a236-8983f63aa041 there should be a slider-like control to define when a pixel difference for the build - that would persist as a repo-level setting, among unchanged, flaky, changed. default should be 
        unachanged <1%
        flaky <10%
        changed >10%

## features

UI & UX 
    Use the frontend design skill and subagent for this
    Revise frontend and make sure you havent steered far and try to use standard shadcn css where possible
    make sure every page has a clear primary action if there are more than one. If you cant decide ask me a question about it

AI
    see example from /home/ewyct/dev/lastest and research competitors on how they design UI around AI 
    Add local claude -p command and OpenRouter API key as options
    1. Determining routes
        On the repo page in addition to Scan routes there should be a AI scan routes option
    2. Fix tests that failed - accessible from the tests screen and from the build screen as well
    3. Enhance tests - avalaible from the tests screen 
    4. Create new tests w AI - request prompt from user and have the ai write a test for that - check prompt samples in referred project
    5. Create new tests w MCP 
    
    
    
    Determining test coverage
            check routes in repo/branch
            check functional specification in repo/branch
            make sure to check all sidebar elements and functions
            upload functional specifications manually and try to derive scenarios from that

    Having AI write tests
        Use MCP to "record them"
        assertions to fail them



Implement the OCR feature to identify the selected UI element's text label

## ideas
Firecrawl?
Research playwrights comparison options, how they work?
Approve reject changes or create ticket -> gh issue

## bugs
