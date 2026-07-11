// Hand-off from the landing prompt to the playground composer. The text is the
// visitor's secret, so it rides sessionStorage (per-tab, cleared on read) and
// never the URL, which would persist it in browser history and in any copy of
// the link.
const KEY = 'peal:seal-draft';

export function putSealDraft(text: string): void {
  try {
    sessionStorage.setItem(KEY, text);
  } catch {
    // Private mode / storage disabled: the visitor just retypes in the app.
  }
}

/** Read and clear the pending draft, so a reload never resurrects a secret. */
export function takeSealDraft(): string | null {
  try {
    const text = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return text;
  } catch {
    return null;
  }
}
