import { describe, expect, it, vi } from 'vitest'
import { resolveReaderAddress } from './public-address'
const url = new URL('https://example.com/')
const signal = () => new AbortController().signal
const lookup = async () => [{ address: '198.18.10.12', family: 4 as const }]
describe('Reader public address validation with Fake-IP DNS', () => {
  it('validates Fake-IP hostnames through fixed DoH without forwarding credentials', async () => {
    const calls: string[] = []
    const fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const endpoint = new URL(input)
      expect(endpoint.origin).toBe('https://cloudflare-dns.com')
      expect(endpoint.pathname).toBe('/dns-query')
      expect(endpoint.searchParams.get('name')).toBe('example.com')
      expect(new Headers(init?.headers).get('authorization')).toBeNull()
      expect(init?.redirect).toBe('manual')
      calls.push(endpoint.searchParams.get('type')!)
      return new Response(
        JSON.stringify({
          Status: 0,
          Answer:
            endpoint.searchParams.get('type') === 'A' ? [{ type: 1, data: '93.184.216.34' }] : []
        }),
        { headers: { 'content-type': 'application/dns-json' } }
      )
    })
    expect(await resolveReaderAddress(url, signal(), fetch, lookup)).toEqual({
      address: '93.184.216.34',
      family: 4
    })
    expect(calls.sort()).toEqual(['A', 'AAAA'])
  })
  it.each(['127.0.0.1', '192.168.1.1', '198.18.2.3', '::1', '::ffff:127.0.0.1'])(
    'rejects unsafe DoH results %s',
    async (address) => {
      const fetch = async () =>
        new Response(
          JSON.stringify({
            Status: 0,
            Answer: [{ type: address.includes(':') ? 28 : 1, data: address }]
          }),
          { headers: { 'content-type': 'application/dns-json' } }
        )
      await expect(resolveReaderAddress(url, signal(), fetch, lookup)).rejects.toThrow(
        'WEB_OPEN_URL_DENIED'
      )
    }
  )
  it('does not use DoH for a true private address or a mixed private/Fake-IP answer', async () => {
    const fetch = vi.fn()
    for (const addresses of [
      [{ address: '10.0.0.1', family: 4 as const }],
      [
        { address: '198.18.1.1', family: 4 as const },
        { address: '10.0.0.1', family: 4 as const }
      ]
    ]) {
      await expect(
        resolveReaderAddress(url, signal(), fetch, async () => addresses)
      ).rejects.toThrow('WEB_OPEN_URL_DENIED')
    }
    expect(fetch).not.toHaveBeenCalled()
  })
  it('keeps normal public DNS local and rejects unresolvable or malformed DoH', async () => {
    const fetch = vi.fn()
    expect(
      await resolveReaderAddress(url, signal(), fetch, async () => [
        { address: '93.184.216.34', family: 4 }
      ])
    ).toEqual({ address: '93.184.216.34', family: 4 })
    expect(fetch).not.toHaveBeenCalled()
    for (const body of [
      { Status: 3 },
      { Status: 0 },
      { Status: 0, Answer: [{ type: 1, data: 'bad' }] }
    ]) {
      await expect(
        resolveReaderAddress(
          url,
          signal(),
          async () =>
            new Response(JSON.stringify(body), {
              headers: { 'content-type': 'application/dns-json' }
            }),
          lookup
        )
      ).rejects.toThrow(/WEB_OPEN_(DNS_FAILED|URL_DENIED)/)
    }
  })
})
