import type { BrowserSkillProjection, TaskProjection } from '@actiondriver/contracts'

export const mockBrowserSkillProjection: BrowserSkillProjection = {
  title: '杭州酒店 · 携程旅行',
  url: 'https://hotels.ctrip.com/hotels/list',
  status: 'running',
  target: { label: '选择入住日期', x: 146, y: 178, width: 220, height: 52 }
}

export const mockTaskFixture: TaskProjection = {
  id: 'hotel-task',
  sessionId: 'hotel-session',
  title: '预订周末去杭州的酒店',
  status: 'running',
  model: { connectionId: 'company-gateway', modelId: 'gpt-5.2' },
  messages: [
    {
      id: 'message-user',
      role: 'user',
      content: '帮我预订本周六到周日，杭州西湖附近评分 4.5 以上的酒店。'
    },
    {
      id: 'message-agent',
      role: 'agent',
      content: '我会在内嵌浏览器中查找符合条件的酒店，并在提交预订前请你确认。'
    }
  ],
  steps: [
    { id: 'observe', title: '观察页面', detail: '已识别酒店列表与筛选条件', state: 'success' },
    { id: 'open', title: '打开酒店列表', detail: '已进入杭州酒店结果页', state: 'success' },
    {
      id: 'dates',
      title: '填写入住日期',
      detail: '选择 4 月 12 日至 4 月 13 日',
      state: 'current'
    },
    { id: 'confirm', title: '等待用户确认', detail: '提交前请求确认', state: 'waiting' }
  ],
  browser: mockBrowserSkillProjection
}
