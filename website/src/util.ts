// Small helpers for rendering the made-up screens.

/** Lets a long path break after its slashes (a zero-width space), instead of in the middle of a name. */
export const softPath = (s: string) => s.replace(/\//g, '/\u200b')
