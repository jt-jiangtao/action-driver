// @vitest-environment node
import { test, expect } from 'vitest'
import {
  resolveOriginPolicy,
  resolveNetworkPolicy,
  networkDecision,
  accessPolicyDecision,
  parseOriginPattern
} from '../src/service-network-policy'
import { originalDocumentation } from './original-service'
const urls = [
  'https://example.com',
  'https://example.com:443',
  'https://child.example.com',
  'http://example.com',
  'https://example.com:444',
  'https://EXAMPLE.COM.',
  'https://例子.com',
  'file:///tmp/a',
  'invalid',
  'http://127.0.0.1',
  'http://[::1]'
]
test('strict origin patterns normalize protocol/ports/hosts and reject malformed wildcards', async () => {
  const base = await originalDocumentation()
  for (const pattern of [
    'https://example.com',
    'https://EXAMPLE.COM.:443',
    'https://*.example.com',
    'https://**.example.com',
    'https://foo?.example.com',
    'https://例子.com',
    'https://[::1]:443',
    'https://*例子.com',
    'https://example.com/path',
    ' https://example.com',
    'https://a..b',
    'https://user@example.com',
    'https://example.com:',
    'https://a%2ab.com',
    'https://*',
    'file://host',
    'https://example.com#x'
  ])
    expect(parseOriginPattern(pattern)).toEqual(base.baselineOriginPattern(pattern))
})
test('origin policies preserve deny dominance and canonical duplicate suppression', async () => {
  const base = await originalDocumentation()
  const policies = [
      undefined,
      {},
      { defaultOriginPolicy: { access: 'deny' } },
      {
        origins: {
          'https://**.example.com': { access: 'allow', persistentApproval: false },
          'https://child.example.com': { access: 'deny' }
        }
      },
      {
        origins: {
          'https://example.com': { access: 'allow' },
          'https://EXAMPLE.COM:443': { access: 'allow' }
        }
      },
      { origins: { 'https://*.example.com': { uploads: 'deny', accessApprovalLifetime: 'turn' } } }
    ],
    configs = [
      undefined,
      {},
      { default_origin_policy: { access: 'deny' } },
      {
        origins: {
          'https://example.com': { access: 'allow', full_cdp_access: 'deny', downloads: 'deny' }
        }
      }
    ]
  for (const policy of policies)
    for (const config of configs)
      for (const url of urls)
        expect(resolveOriginPolicy(policy as any, config as any, url)).toEqual(
          base.baselineOriginPolicy(policy, config, url)
        )
})
test('network enterprise allowlists combine user denied domains without allowing user widening', async () => {
  const base = await originalDocumentation()
  const requirements = [
      undefined,
      {},
      { requirements: { network: { enabled: false } } },
      {
        requirements: {
          network: {
            managedAllowedDomainsOnly: true,
            allowedDomains: ['Example.com'],
            deniedDomains: ['bad.example.com']
          }
        }
      },
      {
        requirements: {
          network: { domains: { '**.example.com': 'allow', 'blocked.example.com': 'deny' } }
        }
      }
    ],
    configs = [
      undefined,
      {},
      {
        config: {
          default_permissions: ' selected ',
          permissions: {
            selected: {
              network: {
                allowed_domains: ['elsewhere.net'],
                denied_domains: [' example.com ', 'EXAMPLE.COM']
              }
            }
          }
        }
      },
      {
        config: {
          default_permissions: 'selected',
          permissions: {
            selected: {
              network: { domains: { '*.example.com': 'allow', 'child.example.com': 'deny' } }
            }
          }
        }
      }
    ]
  for (const requirement of requirements)
    for (const config of configs) {
      const actual = resolveNetworkPolicy(requirement as any, config as any),
        original = base.baselineNetworkPolicy(requirement, config)
      expect(actual).toEqual(original)
      for (const url of urls)
        expect(networkDecision(url, actual)).toEqual(base.baselineNetworkDecision(url, original))
    }
})
test('access policy checks combine origins/network and fail closed when configuration is unavailable', async () => {
  const base = await originalDocumentation()
  for (const fail of [false, true]) {
    const config = {
      readRequirements: async () => {
        if (fail) throw Error('requirements')
        return { requirements: { network: { enabled: false } } }
      },
      readAll: async () => ({
        config: { browser_use: { origins: { 'https://example.com': { access: 'allow' } } } }
      })
    }
    for (const url of urls)
      expect(await accessPolicyDecision(url, config)).toEqual(
        await base.baselineAccessDecision(url, config)
      )
  }
})
test('malformed configuration and managed domain arrays remain unavailable, never silently become allow', async () => {
  const base = await originalDocumentation()
  for (const [requirements, all] of [
    [{}, {}],
    [{ requirements: { network: { allowedDomains: 'bad' } } }, { config: {} }],
    [{ requirements: { network: { allowedDomains: [123] } } }, { config: {} }]
  ]) {
    const config = { readRequirements: async () => requirements, readAll: async () => all }
    expect(await accessPolicyDecision('https://example.com', config)).toBe(
      await base.baselineAccessDecision('https://example.com', config)
    )
  }
})
