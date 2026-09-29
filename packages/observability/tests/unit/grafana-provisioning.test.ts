import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const configPath = (file: string) => resolve(process.cwd(), 'deploy/observability', file)

describe('local Grafana provisioning', () => {
  it('opens Explore for loopback-only anonymous Editor and loads the overview as home', async () => {
    const compose = await readFile(configPath('compose.yaml'), 'utf8')
    expect(compose).toContain('GF_AUTH_ANONYMOUS_ORG_ROLE: Editor')
    expect(compose).toContain('GF_DASHBOARDS_DEFAULT_HOME_DASHBOARD_PATH: /etc/grafana/dashboards/actiondriver.json')
    expect(compose).toContain('127.0.0.1:3000:3000')
  })

  it('provisions real ActionDriver log and metric queries without model content', async () => {
    const provider = await readFile(configPath('grafana/provisioning/dashboards/default.yaml'), 'utf8')
    const dashboard = JSON.parse(
      await readFile(configPath('grafana/dashboards/actiondriver.json'), 'utf8')
    ) as { uid: string; panels: Array<{ title: string; targets: Array<{ expr: string }> }> }
    expect(provider).toContain('/etc/grafana/dashboards')
    expect(dashboard.uid).toBe('actiondriver-overview')
    expect(dashboard.panels.map((panel) => panel.title)).toEqual([
      '调用量',
      '错误量',
      'P95 耗时',
      '应用日志'
    ])
    expect(dashboard.panels.flatMap((panel) => panel.targets.map((target) => target.expr))).toEqual([
      'sum by (transport) (increase(actiondriver_calls_total[$__range]))',
      'sum by (transport) (increase(actiondriver_calls_total{outcome="error"}[$__range]))',
      'histogram_quantile(0.95, sum by (le, transport) (increase(actiondriver_call_duration_milliseconds_bucket[$__range])))',
      '{service_name=~"actiondriver-(main|service)"}'
    ])
  })
})
