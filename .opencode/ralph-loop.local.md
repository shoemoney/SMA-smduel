---
active: true
iteration: 5
maxIterations: 100
---

lets do a infiniate improving loop each time ask a random state of the art vision enabled flash model (gemini 3.8 flash, latest glm, etc) to find 5 things to improve with reasons and suggestions take all feedback create milestones phases and todos. ask for feedback on all key elements of this game from an advisorial reviewer. provide them with any items they need to conduct a detailed review.  execute the plan then restart the loop with a new reviewer until you have asked all the vision enabled latest models on open router.  do not stop until i tell you to. 

## Log

Reviewers asked (5 of 82 vision models):
1. google/gemini-3.8-flash      -> title wordmark, constructor (3 bugs incl. one I missed), city motorway-through-wall
2. openai/gpt-5.4-mini         -> radar instrument, condition dashboard, player/opponent contrast, title hierarchy
3. qwen/qwen3.5-122b-a10b      -> road lane markings (carried x2), preview/menu contrast, radar rings (claim WRONG - checked)
4. deepseek/deepseek-v4.1-flash -> car silhouette in preview, empty-feed pill + route progress bar, radar weight
5. inclusionai/ling-3.0-flash-vl -> seed printed twice (FIXED); wall/radar/constructor claims all WRONG at full res
                                  -> root cause: 900px review images. Raised to 1280px.

RECURRING FALSE-FINDING CLASS: reviewers report radar rings/sweep, the city wall
and the constructor preview as missing/empty. In every case checked at full
resolution they are present. Cause was review-image downscale, not the UI.
A first fix attempt for the radar (mask-image rim ticks) corrupted the CSS and
stripped the chrome off every HUD panel - caught in a screenshot, reverted.

Tooling: `node tools/review.mjs --list | --model <id> --shots <dir>`
Reviews: .opencode/reviews/
