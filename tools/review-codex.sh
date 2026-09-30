#!/usr/bin/env bash
# Advisory reviewer: Codex CLI running gpt-6.1-sol, driving the real app.
#
# WHY THIS EXISTS. For 82 iterations the loop handed a vision model a set of
# DOWNSCALED STILLS and asked it to critique a live WebGPU application. Every
# recurring false-finding class in the log traces to that one decision: the
# radar, the constructor schematic and the city wall were each reported
# "missing" dozens of times and were present at full resolution every time.
# Raising the capture width from 900px to 1280px reduced it and did not remove
# it, because a still is the wrong instrument. This reviewer gets a browser.
#
# AUTH. `gpt-6.1-sol` is reached through OpenRouter rather than the ChatGPT
# subscription: the subscription hit its usage cap (resets 2026-10-04) and the
# stored OpenAI API key is out of quota, so neither native path could run a
# single call. The provider block is additive in ~/.codex/config.toml and
# `model_provider` is passed explicitly, so no other codex invocation changes.
# Revert with: git-free — delete the [model_providers.openrouter] block, or
# restore ~/.codex/auth.json if you swap the key.
#
# Usage:
#   tools/review-codex.sh                    # review the live deployment
#   tools/review-codex.sh http://localhost:5173/smduel/
#   BASE=... tools/review-codex.sh
set -uo pipefail

# Classify a written answer. Exposed via `--classify FILE` so the rule can be
# tested against real saved reviews instead of being trusted because it reads
# correctly — the log's standing rule that writing a check is not the same as
# knowing it works.
#
# Prints one of: BLOCKED, NOVERDICT, or FINDINGS:<n>, and returns 0 for a
# usable review (including a legitimate zero), 2 for an unusable one.
classify_review() {
  local f="$1"
  if grep -q "REVIEW-VERDICT:[[:space:]]*BLOCKED" "$f"; then echo BLOCKED; return 2; fi
  local n
  n=$(grep -oE "REVIEW-VERDICT:[[:space:]]*[0-9]+" "$f" | tail -1 | grep -oE "[0-9]+")
  if [ -z "$n" ]; then echo NOVERDICT; return 2; fi
  echo "FINDINGS:$n"; return 0
}

if [ "${1:-}" = "--classify" ]; then
  classify_review "$2"
  exit $?
fi


BASE="${1:-${BASE:-https://arcade.shoemoney.com/smduel/}}"
SEED="${SEED:-a11ce5ee}"
OUT=".opencode/reviews/codex-$(date +%Y%m%d-%H%M%S).md"
mkdir -p .opencode/reviews

PROMPT=$(cat <<'PROMPT'
You are the advisory reviewer for a small WebGPU driving game. Your job is to
find things that are actually wrong with it, ranked by how much they hurt a
player, and to say what you would do about each one.

# The application

A top-down driving game. You start in a city, take a job, build a car, then
drive a highway. It is a CANVAS application: the world is rendered with WebGPU
into a single <canvas>, and almost none of the game is DOM.

Reach any screen directly:

    <BASE>?screen=title&seed=a11ce5ee
    <BASE>?screen=controls&seed=a11ce5ee
    <BASE>?screen=driver&seed=a11ce5ee
    <BASE>?screen=constructor&seed=a11ce5ee
    <BASE>?screen=city&seed=a11ce5ee
    <BASE>?screen=arena&seed=a11ce5ee
    <BASE>?screen=road&seed=a11ce5ee
    <BASE>?screen=fleet&seed=a11ce5ee

where <BASE> is given below. The screens are also reachable by playing: the
title screen is pure DOM, and the others are reached by driving.

# How to review it

SCOPE: the three GAMEPLAY screens — arena, road, city. The title, driver and
constructor were covered by the previous pass, and long MCP-driven runs keep
dying partway through, so this pass takes fewer screens and finishes.

Use the browser tools. Do NOT review from the repository source alone and do
NOT review from a description — a canvas game cannot be judged by reading its
code, and every confident wrong finding in this project's history came from
reviewing something other than the running thing.

1. Open each screen at the URL above.
2. Take a SCREENSHOT of each one and actually look at it. A screenshot at the
   device pixel ratio, not a thumbnail.
3. Where a finding would be about something that changes over time or on
   interaction, DRIVE IT: move the car, open the constructor, select rows,
   change bodies. A single still cannot show you what happens when you press
   something, and several of the worst findings in this project's history are
   screenshots judging a state that only exists after an interaction.
4. Before you report anything as ABSENT, MISSING, EMPTY or NOT IMPLEMENTED,
   go and look for it properly and confirm it in the source if the frame is
   ambiguous. Absence claims are the single most over-reported category here.

# Things this project has deliberately decided, so you do not report them as
# defects. Each of these has been argued at length and the decision stands:

- The radar DOES have concentric range rings, a rotating sweep, a crosshair,
  and a triangular player marker. On a practice arena with no opponents it
  shows nothing, and that is correct reporting rather than a missing feature.
  It does not dim itself when empty, on purpose: an instrument that changes
  weight teaches the player to distrust it.
- The constructor preview IS a schematic, not the gameplay car sprite, and it
  is meant to be. It shows armour zones — where on the chassis the points you
  buy land — which a top-down car sprite physically cannot carry. It is
  generated from the selected body, so changing body changes its proportions.
- The city buildings are deliberately desaturated and pulled toward the
  ground's slate colour, so the map reads as one environment rather than a
  collage of mismatched source art. Asking for per-building colour reverses a
  deliberate fix.
- The arena is an unbounded field with no collision. There is no wall, and
  that is deliberate: a painted wall that does not block you lies.
- The progress bar reads empty at the start of a route because zero miles have
  been driven. The speedometer reads 0 because the car is stationary.
- The ten "(empty)" weapon rows are addressed by index — you type 0-9 to
  select — so they cannot be collapsed or reordered.

# What I want

Things that are genuinely wrong, most damaging first. For each:

- WHICH SCREEN, and where on it (top-left, on the panel headed CONDITION, etc.)
- WHAT IS WRONG — what a player would experience
- WHY IT MATTERS — what it costs them
- WHAT YOU WOULD DO — concrete and specific, and say if it is a code change
  or new art

Also tell me, separately, anything that is a real gap in the game as a whole
rather than a defect in one screen.

You are also welcome to disagree with the decisions listed above. If you think
one of them is wrong, say so and make the case — that is useful information,
not a rules violation. But do not report a deliberate decision as if it were
an oversight.

Be concrete. "Improve the contrast" is not a finding. "The CONDITION panel's
numbers are #9fb0c2 on a #101418 surface at 6.2:1, below AA for body text, and
they sit next to a 6px bar that carries the same value more legibly" is a
finding.

Write your review as markdown. Start your reply with "##" and nothing else.

# The verdict line, and it is the most important instruction here

End your reply with a line of exactly this form:

    REVIEW-VERDICT: <number>

where <number> is how many findings you are reporting — 0 is a legitimate and
useful answer, and this script treats it as a real result rather than a
failure.

If you could NOT actually inspect the running game — no browser, the host did
not resolve, a screenshot you needed never arrived — then write

    REVIEW-VERDICT: BLOCKED

instead, and say in one line what stopped you. That is a real and useful
answer: this script will report it as a failed review and the loop will not
count it, which is exactly right, because a review that did not happen is not a
review that found nothing.

Do NOT substitute an opinion, a guess, or a reading of the repository for a
review you could not perform. Reporting BLOCKED costs a round; guessing costs
the loop a finding that was never established, which is far more expensive and
has already happened many times in this project's history.
PROMPT
)

echo "reviewing: $BASE"
echo "writing:    $OUT"

# `-o` is essential and was not the first attempt: `codex exec` streams its whole
# tool trace — every prompt echo, every grep, every MCP call, plus ~500 lines of
# the user's own AGENTS.md/skills library — to stdout, and the actual review is
# buried somewhere in the middle of it. The first run of this script produced a
# 69KB file containing the project's memory index and a `src/ui/input.ts` grep,
# and no review. The trace goes to a log; the ANSWER goes to the review file.
TRACE="${OUT%.md}.trace.log"

# ISOLATED HOME. Without this the run is unusable, and it is worth recording
# exactly why rather than as "codex was flaky".
#
# The first two runs died with no answer. The trace showed the agent
# mid-review, having already spent its budget: the run reported "Exceeded
# skills context budget ... 537 additional skills were not included", then
# dumped ~500 lines of the user's AGENTS.md, the RTK rules, Poteto mode, the
# Unslop skill and a project memory index into the context, and the last
# reasoning step before it stopped was literally "Assessing token budget".
# A trivial prompt ("Reply with exactly: MODEL OK") costs 25,773 tokens before
# the model has done anything.
#
# So the reviewer's real problem was never the browser, the screenshots or the
# model: it was arriving to the question with a library's worth of someone
# else's instructions in the window. An isolated HOME removes them. The three
# things the review genuinely needs are copied in and nothing else:
#   auth.json  - the ChatGPT credentials (the OpenRouter provider reads
#                OPENROUTER_API_KEY from the environment, not from here)
#   config.toml- openrouter provider + the two browser MCP servers
#   skills/    - deliberately NOT copied. That is the whole point.
CUI_HOME="$PWD/.opencode/codex-home"
rm -rf "$CUI_HOME"; mkdir -p "$CUI_HOME/.codex"
cp /Users/shoemoney/.codex/auth.json "$CUI_HOME/.codex/auth.json"
chmod 600 "$CUI_HOME/.codex/auth.json"
cat > "$CUI_HOME/.codex/config.toml" <<'CUIEOF'
model = "openai/gpt-6.1-sol"
approval_policy = "never"
sandbox_mode = "workspace-write"
service_tier = "default"
model_verbosity = "medium"
model_reasoning_summary = "concise"

# NETWORK IS NOT OPTIONAL FOR A REVIEWER, and leaving it off made a whole round
# silently worthless.
#
# A review of a WEB APPLICATION that cannot reach the web is not a review. With
# this unset, the sandbox blocked DNS, so `npx @playwright/mcp@latest` could not
# be fetched, so the MCP server never started, so the session had no browser
# tools at all — and the fallback shell could not resolve arcade.shoemoney.com
# either. One cause produced three different-looking symptoms ("no browser MCP
# tools are exposed", "could not resolve host", "Chrome exited with SIGABRT"),
# which is why it read as three problems.
#
# The filesystem sandbox is left exactly as it was: the reviewer still cannot
# write outside the workspace. This grants network and nothing else, so the
# reviewer can do the one thing it exists to do without gaining the ability to
# modify the build it is reviewing.
[sandbox_workspace_write]
network_access = true

# No [features] skills/memories/chronicle here, and no skills directory: the
# 537-skill context tax is what killed the first two runs.
[features]
skills = false
memories = false

[model_providers.openrouter]
name = "OpenRouter"
base_url = "https://openrouter.ai/api/v1"
env_key = "OPENROUTER_API_KEY"
wire_api = "responses"

# Screenshots and interaction. Every tool that takes INPUT needs its own
# `approval_mode` — the session runs with `approval_policy = "never"`, and a
# playwright tool left on its default answers "MCP tool call requires approval,
# but approval policy is never" and FAILS. A review run died exactly there, on
# `browser_click`, after having already navigated and screenshotted three
# screens. The stock user config only exempts `browser_navigate`, which is why
# navigation worked and clicking did not.
[mcp_servers.playwright]
command = "npx"
args = ["@playwright/mcp@latest"]

[mcp_servers.playwright.tools.browser_navigate]
approval_mode = "approve"
[mcp_servers.playwright.tools.browser_click]
approval_mode = "approve"
[mcp_servers.playwright.tools.browser_type]
approval_mode = "approve"
[mcp_servers.playwright.tools.browser_press_key]
approval_mode = "approve"
[mcp_servers.playwright.tools.browser_fill_form]
approval_mode = "approve"
[mcp_servers.playwright.tools.browser_evaluate]
approval_mode = "approve"
[mcp_servers.playwright.tools.browser_snapshot]
approval_mode = "approve"
[mcp_servers.playwright.tools.browser_take_screenshot]
approval_mode = "approve"
[mcp_servers.playwright.tools.browser_wait_for]
approval_mode = "approve"

# Computer use — DISABLED in the user's own config (`enabled = false`), which is
# why a review relying on it would have had neither tool. Enabled here, and
# pointed at absolute paths because the stock config uses a relative command
# with cwd="." that only resolves from ~/.codex.
[mcp_servers.computer-use]
command = "/Users/shoemoney/.codex/computer-use/Codex Computer Use.app/Contents/SharedSupport/SkyComputerUseClient.app/Contents/MacOS/SkyComputerUseClient"
args = ["mcp"]
cwd = "/Users/shoemoney/.codex/computer-use"
enabled = true
startup_timeout_sec = 60
CUIEOF

echo "isolated home: $CUI_HOME"

# RETRY WITH BACKOFF, and the reason is the fourth thing that went wrong.
#
# Every earlier run died silently at ~130s having done real work. The cause was
# not the model, the context window, or the browser: OpenRouter rate-limits
# `openai/gpt-6.1-sol` upstream, and a computer-use loop issues a lot of calls
# in quick succession, which is exactly the pattern that trips it. Codex
# reconnects 5 times and then gives up. `-o` only writes the final message on a
# CLEAN completion, so a run killed this way writes nothing at all — which is
# why the symptom was "codex produced no review" three separate times and the
# reason only appeared by reading the tail of a trace nobody would have thought
# to look at.
#
# The limit is bursty, not a quota: a trivial call right after a failed run
# succeeds, and a direct POST to the same model succeeds while codex is being
# rate-limited. So the fix is to retry, not to change the model.
#
# `-o` truncates its target at the start of each attempt, so a stale answer from
# a partial run can never be mistaken for a fresh one.
ATTEMPT=0
MAX_ATTEMPTS="${MAX_ATTEMPTS:-6}"
while :; do
  ATTEMPT=$((ATTEMPT + 1))
  : > "$OUT"
  echo "attempt $ATTEMPT/$MAX_ATTEMPTS ..."
  HOME="$CUI_HOME" codex exec \
    -m openai/gpt-6.1-sol \
    -c model_provider=openrouter \
    -c model_reasoning_effort=high \
    -o "$OUT" \
    "$PROMPT (the live deployment to review is: $BASE — use $BASE?screen=NAME&seed=$SEED for each screen)" \
    > "$TRACE" 2>&1

  if [ -s "$OUT" ]; then
    # A non-empty answer is NOT a review. The previous version of this check
    # accepted any output, so a reply that said "I could not reach the game"
    # was recorded as a successful review — the log's own "a healthy signal
    # standing in for a fact", in the one tool whose job is producing evidence
    # about the build. The verdict line makes the distinction machine-checkable:
    #   REVIEW-VERDICT: <n>     n findings, and 0 is a real result
    #   REVIEW-VERDICT: BLOCKED the reviewer could not inspect the game
    #   (no line at all)        an old-format answer; treat as unusable
    if classify_review "$OUT" > /dev/null; then
      break
    fi
    echo "  $(classify_review "$OUT") — the reviewer did not produce a usable review"
    BLOCKED=1
    break
  fi
  if grep -qi "rate limit" "$TRACE"; then
    echo "  rate limited upstream; backing off $((ATTEMPT * 45))s"
    sleep $((ATTEMPT * 45))
  else
    echo "  no answer, and NOT a rate limit — see $TRACE"
  fi
  [ "$ATTEMPT" -ge "$MAX_ATTEMPTS" ] && break
done

echo
if [ "${BLOCKED:-0}" = "1" ]; then
  # Deliberately a non-zero exit and a distinct message: the loop must be able to
  # tell "the reviewer looked and found nothing" from "the reviewer never
  # looked", because only one of those is evidence about the build.
  echo "REVIEW BLOCKED after $ATTEMPT attempt(s) — $OUT"
  exit 2
fi
if [ -s "$OUT" ]; then
  echo "review written to $OUT ($(wc -c < "$OUT") bytes) after $ATTEMPT attempt(s)"
else
  echo "NO ANSWER AFTER $ATTEMPT ATTEMPTS — see $TRACE"
  exit 1
fi
# The trace is the only evidence of HOW the review went, and this script used to
# contain a duplicated leftover block whose own `> "$TRACE"` redirect truncated
# an 188KB diagnostic down to one line of shell error. A successful run that
# leaves no trace has silently thrown away its own evidence.
if [ ! -s "$TRACE" ]; then
  echo "WARNING: $TRACE is empty — the review's diagnostic evidence was destroyed"
  exit 1
fi
exit 0
