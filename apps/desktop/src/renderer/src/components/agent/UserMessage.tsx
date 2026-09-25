import type { AgentMessageProjection } from '@actiondriver/contracts'
import { ConversationImage, type ImageReader } from './ConversationImage'

export function UserMessage({
  message,
  readImage
}: {
  message: AgentMessageProjection
  readImage?: ImageReader | undefined
}) {
  if (!message.parts?.some((part) => part.kind === 'image'))
    return <div className="user-message">{message.content}</div>
  return (
    <div className="user-message user-message-with-images">
      {[...message.parts]
        .sort((a, b) => Number(b.kind === 'image') - Number(a.kind === 'image'))
        .map((part, index) =>
          part.kind === 'image' ? (
            <ConversationImage
              key={`${part.asset.assetId}:${index}`}
              asset={part.asset}
              readImage={readImage}
            />
          ) : part.text.trim() ? (
            <span key={`text:${index}`}>{part.text}</span>
          ) : null
        )}
    </div>
  )
}
