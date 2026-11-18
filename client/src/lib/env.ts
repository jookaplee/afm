/** Standalone build: runs entirely in the browser (no API server), e.g. as a hosted demo. */
export const STANDALONE = import.meta.env.VITE_STANDALONE === 'true';

/**
 * Shown inside a claude.ai viewer, which provides `window.claude` before any
 * script runs. The viewer owns the theme and blocks file downloads there.
 */
export const IN_CLAUDE_VIEWER = typeof window !== 'undefined' && 'claude' in window;

/** CSV export works everywhere except inside the claude.ai viewer. */
export const CAN_DOWNLOAD = !IN_CLAUDE_VIEWER;

/** The in-app theme switch is hidden where the host page sets the theme. */
export const OWN_THEME = !IN_CLAUDE_VIEWER;
