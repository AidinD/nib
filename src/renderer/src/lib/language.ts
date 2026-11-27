/*
 * Which language a recording is transcribed in - chosen when it is transcribed,
 * not when it is recorded.
 *
 * The two whisper models are language-specific, so the choice is real, but it
 * belongs to the transcription: that runs after the recording stops, on a click
 * on the block, and the block is where the language can be seen and changed. So
 * starting a recording asks nothing (which is what lets Ctrl+Alt+, record on a
 * single Enter), a new recording is labelled with the language last transcribed
 * in, and a wrong one is put right on the block - before transcribing, or by
 * transcribing again in the other. See DECISIONS 2026-11-27.
 *
 * Per machine, in localStorage, like the other view preferences: every window
 * shares the origin, so the quick-record prompt and the main window agree.
 */

export type Language = 'sv' | 'en'

const KEY = 'nib.language'

/** The language last transcribed in, Swedish until there is one. */
export function lastLanguage(): Language {
  try {
    return window.localStorage.getItem(KEY) === 'en' ? 'en' : 'sv'
  } catch {
    return 'sv'
  }
}

export function rememberLanguage(language: Language): void {
  try {
    window.localStorage.setItem(KEY, language)
  } catch {
    // Remembering is a convenience; the choice in hand still applies.
  }
}

export function otherLanguage(language: Language): Language {
  return language === 'en' ? 'sv' : 'en'
}

export function languageName(language: Language): string {
  return language === 'en' ? 'English' : 'Svenska'
}
