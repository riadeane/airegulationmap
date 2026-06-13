// Shared clipboard write with the non-HTTPS fallback (preview servers).
// Used by the cite popover and the panel's source-list copy.

export async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    // Ephemeral textarea + execCommand is deprecated but still broadly
    // supported and works when the Clipboard API isn't available.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (e) {
    console.warn('[clipboard] copy failed', e);
    return false;
  }
}
