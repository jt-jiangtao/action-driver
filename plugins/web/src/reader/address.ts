import { lookup as nodeLookup } from 'node:dns/promises'
import ipaddr from 'ipaddr.js'

export type ResolvedAddress = { address: string; family: 4 | 6 }
export type AddressLookup = (hostname: string) => Promise<ResolvedAddress[]>

const defaultLookup: AddressLookup = (hostname) =>
  nodeLookup(hostname, { all: true, verbatim: true }) as Promise<ResolvedAddress[]>

export function isPublicAddress(address: string): boolean {
  try {
    return ipaddr.process(address).range() === 'unicast'
  } catch {
    return false
  }
}

export function parsePublicUrl(input: string): URL {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new Error('WEB_OPEN_URL_DENIED')
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !hostname ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === 'localhost.localdomain' ||
    url.username ||
    url.password ||
    input.length > 2_048 ||
    (ipaddr.isValid(hostname) && !isPublicAddress(hostname))
  ) {
    throw new Error('WEB_OPEN_URL_DENIED')
  }
  url.hash = ''
  return url
}

export async function resolvePublicAddress(
  url: URL,
  lookup: AddressLookup = defaultLookup
): Promise<ResolvedAddress> {
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  if (ipaddr.isValid(hostname)) {
    if (!isPublicAddress(hostname)) throw new Error('WEB_OPEN_URL_DENIED')
    return { address: hostname, family: ipaddr.parse(hostname).kind() === 'ipv4' ? 4 : 6 }
  }
  let addresses: ResolvedAddress[]
  try {
    addresses = await lookup(hostname)
  } catch {
    throw new Error('WEB_OPEN_DNS_FAILED')
  }
  if (
    addresses.length === 0 ||
    addresses.some(({ address, family }) => ![4, 6].includes(family) || !isPublicAddress(address))
  ) {
    throw new Error('WEB_OPEN_URL_DENIED')
  }
  return addresses[0]!
}
