import { lookup as nodeLookup } from 'node:dns/promises'
import ipaddr from 'ipaddr.js'
import { record, requestProviderJson, type FetchLike } from '../provider-http.js'
import {
  isPublicAddress,
  resolvePublicAddress,
  type AddressLookup,
  type ResolvedAddress
} from './address.js'

const systemLookup: AddressLookup = (hostname) =>
  nodeLookup(hostname, { all: true, verbatim: true }) as Promise<ResolvedAddress[]>
const isFakeAddress = (address: string) =>
  /^198\.(?:18|19)\.\d{1,3}\.\d{1,3}$/.test(address) && ipaddr.isValid(address)

export async function resolveReaderAddress(
  url: URL,
  signal: AbortSignal,
  fetch: FetchLike,
  lookup: AddressLookup = systemLookup
): Promise<ResolvedAddress> {
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  if (ipaddr.isValid(hostname)) return resolvePublicAddress(url, lookup)
  let addresses: ResolvedAddress[]
  try {
    addresses = await lookup(hostname)
  } catch {
    throw new Error('WEB_OPEN_DNS_FAILED')
  }
  if (signal.aborted) throw signal.reason
  if (!addresses.some(({ address }) => isFakeAddress(address)))
    return resolvePublicAddress(url, async () => addresses)
  if (
    addresses.some(
      ({ address, family }) =>
        ![4, 6].includes(family) || (!isPublicAddress(address) && !isFakeAddress(address))
    )
  )
    throw new Error('WEB_OPEN_URL_DENIED')
  let answers: ResolvedAddress[]
  try {
    const batches = await Promise.all(
      ['A', 'AAAA'].map(async (type) => {
        const endpoint = new URL('https://cloudflare-dns.com/dns-query')
        endpoint.searchParams.set('name', hostname)
        endpoint.searchParams.set('type', type)
        const body = record(
          await requestProviderJson(
            fetch,
            endpoint.href,
            { method: 'GET', signal, headers: { Accept: 'application/dns-json' } },
            'WEB_OPEN',
            64 * 1024,
            'application/dns-json'
          )
        )
        if (
          !body ||
          body.Status !== 0 ||
          (body.Answer !== undefined && !Array.isArray(body.Answer))
        )
          throw new Error('WEB_OPEN_DNS_FAILED')
        return (body.Answer ?? ([] as unknown[])) as unknown[]
      })
    )
    answers = batches.flat().flatMap((answer) => {
      const value = record(answer)
      if (!value || ![1, 28].includes(value.type as number)) return []
      const address = value.data
      if (typeof address !== 'string' || !ipaddr.isValid(address) || !isPublicAddress(address))
        throw new Error('WEB_OPEN_URL_DENIED')
      const family = ipaddr.parse(address).kind() === 'ipv4' ? 4 : 6
      if (value.type !== (family === 4 ? 1 : 28)) throw new Error('WEB_OPEN_URL_DENIED')
      return [{ address, family } as ResolvedAddress]
    })
  } catch (error) {
    if (signal.aborted) throw signal.reason
    throw new Error(
      error instanceof Error && error.message === 'WEB_OPEN_URL_DENIED'
        ? 'WEB_OPEN_URL_DENIED'
        : 'WEB_OPEN_DNS_FAILED'
    )
  }
  if (!answers.length) throw new Error('WEB_OPEN_DNS_FAILED')
  return answers[0]!
}
