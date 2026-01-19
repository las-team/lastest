Repo wrapper
    Repo selector under Github integrations
    All data after on the UI is repo specific and is stored in the DB that way

Repo overview screen n sidebar
    For repo select baseline - what are we testing against 
    For repo list open branches - show what's tested and what's not 
        display as gh tree view

When recording tests
    Scan playwright recording options and put them on UI - tucked away behind a setting putton
    Enable multi-input recording for reliability (cursor position, cursor movement, selection id, label) when run 1 or the other
    Enable await scutiny level
    Under settings have the default setting under playwright configurable

When comparison is run 
    a) take last run tests for the run, show timestamp
    b) fix image display 
    c) option to run if no runs so far
    d) option to re-run as if there has been a run
    e) maintain a run queue, toast messages, progressbar

Determining test coverage
    AI
        check routes in repo/branch
        check functional specification in repo/branch
        make sure to check all sidebar elements and functions
        upload functional specifications manually and try to derive scenarios from that

Having AI write tests
    Use MCP to "record them"
    assertions to fail them

## bugs


