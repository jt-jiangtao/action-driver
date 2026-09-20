import type { AgentMessageProjection } from '@actiondriver/contracts'
import { Folder, PanelRight } from 'lucide-react'

export function TaskHeader({
  title,
  browserCollapsed,
  onExpandBrowser
}: {
  title: string
  browserCollapsed: boolean
  onExpandBrowser(): void
}) {
  return (
    <header className="task-header">
      <Folder />
      <strong>{title}</strong>
      {browserCollapsed ? (
        <button className="icon-button" aria-label="展开浏览器" onClick={onExpandBrowser}>
          <PanelRight />
        </button>
      ) : null}
    </header>
  )
}

export function ConversationMessages({ messages }: { messages: AgentMessageProjection[] }) {
  const userMessage = messages.find((message) => message.role === 'user')
  const agentMessage = messages.find((message) => message.role === 'agent')
  return (
    <>
      {userMessage ? <div className="user-message">{userMessage.content}</div> : null}
      {agentMessage ? <p className="agent-message">{agentMessage.content}</p> : null}
    </>
  )
}
