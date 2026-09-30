/**
 * Zeroes the ignition switch's crank duration for the whole suite.
 *
 * The driver's "Create Driver" control turns a key for 420ms before it builds
 * the driver, which is the behaviour the control exists for. Six integration
 * files boot through that button and assert on the constructor screen on the
 * very next line, so at the production duration every one of them becomes a
 * test that waits on wall-clock time — and a wall-clock wait is a flake waiting
 * for a loaded machine. This repo has spent a dozen iterations removing that
 * class of failure.
 *
 * So the duration is a seam (see `setIgnitionCrankMs`) and the suite closes it.
 * The deferral is not thereby unproven: `controls.test.ts` sets a real non-zero
 * duration back and asserts that the callback does not fire early, that a
 * second click during the crank does not fire it twice, and that the button
 * locks while cranking.
 */
import { setIgnitionCrankMs } from '@/ui/controls';

setIgnitionCrankMs(0);
