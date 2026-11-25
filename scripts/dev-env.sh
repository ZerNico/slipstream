# Source this in a fresh shell before running pnpm here: `source scripts/dev-env.sh`
# Node 26 via fnm (version from .node-version) and pnpm 12 via corepack (from packageManager).
eval "$(fnm env --shell bash)" >/dev/null 2>&1
fnm use --install-if-missing >/dev/null 2>&1
pnpm() { corepack pnpm "$@"; }
[ -n "${BASH_VERSION:-}" ] && export -f pnpm
