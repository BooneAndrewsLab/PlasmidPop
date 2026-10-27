import { describe, expect, it } from 'vitest';
import { isIOSDevice, pickerAccept } from './pickerAccept';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const IPAD_AS_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const LINUX = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36';

describe('pickerAccept', () => {
  it('drops the extension list on an iPhone', () => {
    expect(pickerAccept('.gb,.fa', { userAgent: IPHONE, maxTouchPoints: 5 })).toBeUndefined();
  });
  it('drops it on an iPad that reports a Mac', () => {
    expect(pickerAccept('.gb', { userAgent: IPAD_AS_MAC, maxTouchPoints: 5 })).toBeUndefined();
  });
  it('keeps it on a real Mac and on other systems', () => {
    expect(pickerAccept('.gb', { userAgent: IPAD_AS_MAC, maxTouchPoints: 0 })).toBe('.gb');
    expect(pickerAccept('.gb', { userAgent: LINUX, maxTouchPoints: 10 })).toBe('.gb');
  });
  it('reads the current navigator by default', () => {
    expect(pickerAccept('.gb')).toBe('.gb');
    expect(isIOSDevice(LINUX, 0)).toBe(false);
  });
});
