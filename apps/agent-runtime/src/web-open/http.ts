import { request as httpRequest, type RequestOptions } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { Transform, Writable, type Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { TextDecoder } from 'node:util'
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib'
import ipaddr from 'ipaddr.js'
import {
  parsePublicUrl,
  resolvePublicAddress,
  type AddressLookup,
  type ResolvedAddress
} from './address'

const MAX_REDIRECTS = 3
const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_TRANSFER_BYTES = 2 * 1024 * 1024
const DEFAULT_DECODED_BYTES = 4 * 1024 * 1024

export type PageResponse = {
  statusCode: number
  headers: Record<string, string | string[] | undefined>
  body: Readable
  remoteAddress: string | undefined
  close(): void
}

export type PageRequest = (
  url: URL,
  address: ResolvedAddress,
  signal: AbortSignal
) => Promise<PageResponse>

export type ReadPublicHtmlOptions = {
  lookup?: AddressLookup
  request?: PageRequest
  signal?: AbortSignal
  timeoutMs?: number
  maxTransferBytes?: number
  maxDecodedBytes?: number
}

export function requestOptionsForAddress(
  url: URL,
  address: ResolvedAddress
): RequestOptions & { servername?: string } {
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  return {
    protocol: url.protocol,
    hostname,
    port: url.port || undefined,
    path: `${url.pathname}${url.search}`,
    method: 'GET',
    agent: false,
    ...(url.protocol === 'https:' && !ipaddr.isValid(hostname) ? { servername: hostname } : {}),
    headers: { Accept: 'text/html, application/xhtml+xml', 'Accept-Encoding': 'gzip, deflate, br' },
    lookup: (_hostname, options, callback) => {
      if (options.all) {
        callback(null, [{ address: address.address, family: address.family }])
      } else {
        callback(null, address.address, address.family)
      }
    }
  }
}

export function requestPage(
  url: URL,
  address: ResolvedAddress,
  signal: AbortSignal
): Promise<PageResponse> {
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
      requestOptionsForAddress(url, address),
      (response) => {
        resolve({
          statusCode: response.statusCode ?? 0,
          headers: response.headers,
          body: response,
          remoteAddress: response.socket.remoteAddress,
          close: () => response.destroy()
        })
      }
    )
    request.on('error', reject)
    if (signal.aborted) request.destroy(abortReason(signal))
    else
      signal.addEventListener('abort', () => request.destroy(abortReason(signal)), { once: true })
    request.end()
  })
}

export async function readPublicHtml(
  input: string,
  options: ReadPublicHtmlOptions = {}
): Promise<{ html: string; url: string }> {
  const controller = new AbortController()
  const onAbort = () => controller.abort(options.signal?.reason ?? new Error('WEB_OPEN_CANCELLED'))
  options.signal?.addEventListener('abort', onAbort, { once: true })
  if (options.signal?.aborted) onAbort()
  const timer = setTimeout(
    () => controller.abort(new Error('WEB_OPEN_TIMEOUT')),
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  )
  try {
    let url = parsePublicUrl(input)
    for (let redirects = 0; ; redirects += 1) {
      throwIfAborted(controller.signal)
      const address = await waitForAbort(
        resolvePublicAddress(url, options.lookup),
        controller.signal
      )
      throwIfAborted(controller.signal)
      const response = await (options.request ?? requestPage)(url, address, controller.signal)
      try {
        if (!sameAddress(response.remoteAddress, address.address)) {
          throw new Error('WEB_OPEN_URL_DENIED')
        }
        if (response.statusCode >= 300 && response.statusCode < 400) {
          if (redirects >= MAX_REDIRECTS) throw new Error('WEB_OPEN_REDIRECT_LIMIT')
          const location = header(response.headers.location)
          if (!location) throw new Error('WEB_OPEN_REDIRECT_INVALID')
          let target: URL
          try {
            target = new URL(location, url)
          } catch {
            throw new Error('WEB_OPEN_REDIRECT_INVALID')
          }
          url = parsePublicUrl(target.href)
          continue
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          throw new Error(`WEB_OPEN_HTTP_${response.statusCode}`)
        }
        const contentType = header(response.headers['content-type'])?.toLowerCase() ?? ''
        if (!/^(text\/html|application\/xhtml\+xml)(?:\s*;|\s*$)/.test(contentType)) {
          throw new Error('WEB_OPEN_CONTENT_UNSUPPORTED')
        }
        const bytes = await readBoundedBody(
          response,
          controller.signal,
          options.maxTransferBytes ?? DEFAULT_TRANSFER_BYTES,
          options.maxDecodedBytes ?? DEFAULT_DECODED_BYTES
        )
        return { html: decodeHtml(bytes, contentType), url: url.href }
      } finally {
        response.close()
      }
    }
  } catch (error) {
    if (controller.signal.aborted) throw abortReason(controller.signal)
    throw error
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onAbort)
  }
}

function decodeHtml(bytes: Buffer, contentType: string): string {
  const bom = bytes.subarray(0, 3)
  const bomEncoding =
    bom.length >= 3 && bom[0] === 0xef && bom[1] === 0xbb && bom[2] === 0xbf
      ? 'utf-8'
      : bom[0] === 0xff && bom[1] === 0xfe
        ? 'utf-16le'
        : bom[0] === 0xfe && bom[1] === 0xff
          ? 'utf-16be'
          : undefined
  const httpEncoding = contentType.match(/charset\s*=\s*["']?([^\s;"']+)/)?.[1]
  const prefix = bytes.subarray(0, 1_024).toString('latin1')
  const metaEncoding =
    prefix.match(/<meta\s+[^>]*charset\s*=\s*["']?([^\s;"'>]+)/i)?.[1] ??
    prefix.match(/<meta\s+[^>]*content\s*=\s*["'][^"']*charset\s*=\s*([^\s;"']+)/i)?.[1]
  try {
    return new TextDecoder(bomEncoding ?? httpEncoding ?? metaEncoding ?? 'utf-8').decode(bytes)
  } catch {
    return new TextDecoder('utf-8').decode(bytes)
  }
}

async function readBoundedBody(
  response: PageResponse,
  signal: AbortSignal,
  maxTransferBytes: number,
  maxDecodedBytes: number
): Promise<Buffer> {
  const contentLength = Number(header(response.headers['content-length']))
  if (contentLength > maxTransferBytes) throw new Error('WEB_OPEN_RESPONSE_LIMIT')
  const encoding = header(response.headers['content-encoding'])?.trim().toLowerCase() ?? 'identity'
  const decompressor =
    encoding === 'identity'
      ? null
      : encoding === 'gzip'
        ? createGunzip()
        : encoding === 'deflate'
          ? createInflate()
          : encoding === 'br'
            ? createBrotliDecompress()
            : null
  if (encoding !== 'identity' && !decompressor) {
    throw new Error('WEB_OPEN_CONTENT_UNSUPPORTED')
  }
  let transferred = 0
  let decoded = 0
  const chunks: Buffer[] = []
  const countTransfer = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      transferred += chunk.byteLength
      callback(transferred > maxTransferBytes ? new Error('WEB_OPEN_RESPONSE_LIMIT') : null, chunk)
    }
  })
  const collect = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      decoded += chunk.byteLength
      if (decoded > maxDecodedBytes) callback(new Error('WEB_OPEN_RESPONSE_LIMIT'))
      else {
        chunks.push(chunk)
        callback()
      }
    }
  })
  try {
    if (decompressor) {
      await pipeline(response.body, countTransfer, decompressor, collect, { signal })
    } else {
      await pipeline(response.body, countTransfer, collect, { signal })
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'WEB_OPEN_RESPONSE_LIMIT') throw error
    if (signal.aborted) throw abortReason(signal)
    throw new Error('WEB_OPEN_RESPONSE_INVALID')
  }
  return Buffer.concat(chunks, decoded)
}

function header(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function sameAddress(actual: string | undefined, expected: string): boolean {
  if (!actual) return false
  try {
    return ipaddr.process(actual).toString() === ipaddr.process(expected).toString()
  } catch {
    return false
  }
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('WEB_OPEN_CANCELLED')
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortReason(signal)
}

function waitForAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortReason(signal))
    const onAbort = () => reject(abortReason(signal))
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      }
    )
  })
}
