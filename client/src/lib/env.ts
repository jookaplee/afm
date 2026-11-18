/** Standalone build: runs entirely in the browser (no API server), e.g. as a hosted demo. */
export const STANDALONE = import.meta.env.VITE_STANDALONE === 'true';

/** Hosted standalone pages can't start file downloads, so CSV export is hidden there. */
export const CAN_DOWNLOAD = !STANDALONE;
