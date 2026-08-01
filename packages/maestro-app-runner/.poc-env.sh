# Source this to get a working Maestro + Node 24 + JDK 17 environment for the PoC.
# Reason these are needed:
#   - Maestro 2.8.0 requires JDK 17+ (system java is 13); openjdk@17 is keg-only.
#   - Repo/pnpm/Expo/RN need Node >=20; the login shell has node 16. Pin fnm's 24
#     by its concrete install path so it always wins over the login-shell node.
export JAVA_HOME="/opt/homebrew/opt/openjdk@17"
export PATH="/Users/offblck/.local/share/fnm/node-versions/v24.15.0/installation/bin:$JAVA_HOME/bin:$HOME/.maestro/bin:$PATH"
export MAESTRO_CLI_NO_ANALYTICS=1
