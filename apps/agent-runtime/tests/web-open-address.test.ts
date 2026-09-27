import { describe, expect, it } from 'vitest'
import { isPublicAddress, parsePublicUrl, resolvePublicAddress } from '../src/web-open/address'

describe('tools_local_web_open public address policy', () => {
  it('accepts only credential-free HTTP(S) URLs with public literal addresses', () => {
    expect(parsePublicUrl('https://example.com/article').href).toBe('https://example.com/article')
    expect(parsePublicUrl('http://8.8.8.8/').hostname).toBe('8.8.8.8')
    for (const url of [
      'file:///etc/passwd',
      'http://localhost:8080/',
      'http://sub.localhost/',
      'http://127.0.0.1/',
      'http://192.168.1.1/',
      'http://169.254.169.254/',
      'http://[::1]/',
      'http://[::ffff:127.0.0.1]/',
      'https://user:password@example.com/',
      'https://user@example.com/'
    ]) {
      expect(() => parsePublicUrl(url), url).toThrow('WEB_OPEN_URL_DENIED')
    }
  })

  it('rejects all non-public IP classes, including mapped and reserved ranges', () => {
    for (const address of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '192.168.0.1',
      '169.254.1.1',
      '100.64.0.1',
      '192.0.2.1',
      '224.0.0.1',
      '0.0.0.0',
      '::1',
      'fe80::1',
      'fc00::1',
      '2001:db8::1',
      '::ffff:192.168.1.1'
    ]) {
      expect(isPublicAddress(address), address).toBe(false)
    }
    expect(isPublicAddress('8.8.8.8')).toBe(true)
    expect(isPublicAddress('2606:4700:4700::1111')).toBe(true)
  })

  it('rejects a DNS answer if any candidate is non-public', async () => {
    const lookup = async () => [
      { address: '8.8.8.8', family: 4 as const },
      { address: '127.0.0.1', family: 4 as const }
    ]
    await expect(
      resolvePublicAddress(parsePublicUrl('https://example.com'), lookup)
    ).rejects.toThrow('WEB_OPEN_URL_DENIED')
  })

  it('returns one vetted address for connection without resolving again', async () => {
    let calls = 0
    const selected = await resolvePublicAddress(parsePublicUrl('https://example.com'), async () => {
      calls += 1
      return [{ address: '2606:4700:4700::1111', family: 6 }]
    })
    expect(selected).toEqual({ address: '2606:4700:4700::1111', family: 6 })
    expect(calls).toBe(1)
  })
})
