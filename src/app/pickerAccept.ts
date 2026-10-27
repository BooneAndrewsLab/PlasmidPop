/**
 * Whether the device is an iPhone or iPad. iPadOS reports a desktop Mac user
 * agent, so a "Mac" with a touch screen counts too.
 */
export function isIOSDevice(userAgent: string, maxTouchPoints: number): boolean {
  return (
    /\b(iPhone|iPad|iPod)\b/.test(userAgent) ||
    (/\bMacintosh\b/.test(userAgent) && maxTouchPoints > 1)
  );
}

/**
 * The `accept` for a file picker. iOS turns an extension list into file
 * types and leaves a file whose extension it has no type for (`.gb`, `.ape`)
 * greyed out and unselectable, so there the picker is left unfiltered; the
 * app decides each file's format from its content anyway (issue 294).
 */
export function pickerAccept(
  accept: string,
  env: { readonly userAgent: string; readonly maxTouchPoints: number } = currentEnv(),
): string | undefined {
  return isIOSDevice(env.userAgent, env.maxTouchPoints) ? undefined : accept;
}

function currentEnv(): { readonly userAgent: string; readonly maxTouchPoints: number } {
  if (typeof navigator === 'undefined') return { userAgent: '', maxTouchPoints: 0 };
  return { userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints ?? 0 };
}
