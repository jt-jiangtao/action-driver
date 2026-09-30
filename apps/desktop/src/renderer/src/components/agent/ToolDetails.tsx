import { useMemo, useRef } from 'react'
import { useScrollFade } from '../scroll-fade'
import {
  projectToolDetails,
  type ToolDetailField,
  type ToolDetails as Details,
  type ToolPresentation
} from '@action-driver/plugin-contracts'
import { presentations as commands } from '@action-driver/command-plugin/presentation'
import { presentations as web } from '@action-driver/web-plugin/presentation'
import { presentations as skills } from '@action-driver/skills-plugin/presentation'
import { presentations as images } from '@action-driver/image-generation-plugin/presentation'
import { presentations as computer } from '@action-driver/computer-use-plugin/presentation'
import type { ToolInvocationProjection } from '@action-driver/contracts'
import { ReadOnlyCode } from '../ReadOnlyCode'
import { ConversationImage, useImagePreview, type ImageReader } from './ConversationImage'

const legacyPresentations: Record<string, ToolPresentation> = {
  ...commands,
  ...web,
  ...skills,
  ...images,
  ...computer
}
export const TOOL_DETAILS_MAX_HEIGHT = 640

function legacyValue(raw: string | undefined, output = false): unknown {
  if (raw === undefined) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    // An incomplete serialized envelope is not a useful text output.
    if (output && !/^\s*(?:\[|\{)/.test(raw)) return { stdout: raw, content: raw }
    return undefined
  }
}
export function toolPresentation(tool: ToolInvocationProjection): ToolPresentation | undefined {
  return tool.presentation ?? legacyPresentations[tool.toolId.replace(/@\d+$/, '')]
}
export function toolDetails(tool: ToolInvocationProjection): Details {
  return (
    tool.details ??
    projectToolDetails(
      toolPresentation(tool),
      legacyValue(tool.rawInput),
      legacyValue(tool.rawOutput, true)
    )
  )
}

function safeLink(value: string): boolean {
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
  } catch {
    return false
  }
}
function FieldValue({
  field,
  readImage,
  onOpen,
  onUrlChange
}: {
  field: ToolDetailField
  readImage?: ImageReader | undefined
  onOpen?: ((assetId: string) => void) | undefined
  onUrlChange?: ((assetId: string, url: string | null) => void) | undefined
}) {
  if (field.kind === 'code')
    return (
      <ReadOnlyCode
        value={field.value}
        language={field.language ?? 'plaintext'}
        constrainHeight={false}
      />
    )
  if (field.kind === 'image' && field.asset)
    return (
      <ConversationImage
        asset={field.asset}
        readImage={readImage}
        onOpen={onOpen}
        onUrlChange={onUrlChange}
      />
    )
  if (field.kind === 'link' && safeLink(field.value))
    return (
      <a
        href={field.value}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="e2e/tasks/detail/activity/web-open/source#link"
        onClick={(event) => {
          event.preventDefault()
          void window.productDesktop.externalLinks
            .open(field.value)
            .catch((error) => console.error('[tool-details] Failed to open link:', error))
        }}
      >
        {field.value}
      </a>
    )
  return <p>{field.value}</p>
}

export function commandPreview(details: Details): string {
  const source =
    details.input.find((field) => field.kind === 'code')?.value ??
    details.input
      .filter((field) => field.kind !== 'image' && field.kind !== 'link')
      .map((field) => field.value)
      .join(' ')
  const args = details.input
    .filter((field) => /^参数(?: |$)/.test(field.label))
    .map((field) => field.value)
  return [source, ...args].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
}
function terminalTranscript(
  input: ToolDetailField[],
  output: ToolDetailField[]
): { text: string; language: string } {
  const source = input.find((field) => field.kind === 'code')
  const args = input
    .filter((field) => /^参数(?: |$)/.test(field.label))
    .map((field) => (/\s/.test(field.value) ? JSON.stringify(field.value) : field.value))
  const text = source
    ? `${source.language === 'shell' ? '$ ' : ''}${source.value}${source.label === '命令' && args.length ? ` ${args.join(' ')}` : ''}`
    : input.map((field) => `${field.label}：${field.value}`).join('\n')
  const extraInputs =
    source && source.label !== '命令'
      ? input
          .filter((field) => field !== source && field.kind !== 'image' && field.kind !== 'link')
          .map((field) => `${field.label}：${field.value}`)
      : []
  const streams = [
    ...new Set(
      output
        .filter((field) => field.kind !== 'image' && field.kind !== 'link')
        .map((field) => field.value.trimEnd())
        .filter(Boolean)
    )
  ]
  return {
    text: [text, extraInputs.join('\n'), ...streams].filter(Boolean).join('\n\n'),
    language: source?.language ?? 'plaintext'
  }
}

/** One semantic surface and one scroll boundary, regardless of plugin or tool type. */
export function ToolDetails({
  details,
  summary,
  resultSummary,
  errorSummary,
  truncated,
  readImage
}: {
  details: Details
  summary: string
  resultSummary?: string | undefined
  errorSummary?: string | undefined
  truncated?: boolean | undefined
  readImage?: ImageReader | undefined
}) {
  const input: ToolDetailField[] = details.input.length
    ? details.input
    : summary
      ? [{ label: '摘要', kind: 'text' as const, value: summary }]
      : []
  const output: ToolDetailField[] = details.output.length
    ? details.output
    : resultSummary
      ? [{ label: '结果摘要', kind: 'text' as const, value: resultSummary }]
      : []
  const assets = useMemo(
    () =>
      [...details.input, ...details.output].flatMap((field) => (field.asset ? [field.asset] : [])),
    [details]
  )
  const imagePreview = useImagePreview(assets)
  const footer = output.filter((field) => field.placement === 'footer')
  const bodyOutput = output.filter((field) => field.placement !== 'footer')
  const terminal = details.layout === 'terminal' ? terminalTranscript(input, bodyOutput) : null
  const ref = useRef<HTMLDivElement>(null)
  useScrollFade(ref, { deps: [details, summary, resultSummary, errorSummary] })
  return (
    <div className="activity-tool-details-shell">
      <div
        ref={ref}
        className="activity-tool-details"
        role="region"
        aria-label="工具详情"
        style={{ maxHeight: TOOL_DETAILS_MAX_HEIGHT, overflowY: 'auto' }}
      >
        {terminal ? (
          <>
            <ReadOnlyCode
              value={terminal.text}
              language={terminal.language}
              constrainHeight={false}
            />
            {[...input, ...bodyOutput]
              .filter((field) => field.kind === 'image' || field.kind === 'link')
              .map((field, index) => (
                <div className="tool-details-field" key={`${field.label}:${index}`}>
                  <span>{field.label}</span>
                  <FieldValue
                    field={field}
                    readImage={readImage}
                    onOpen={imagePreview.open}
                    onUrlChange={imagePreview.reportUrl}
                  />
                </div>
              ))}
          </>
        ) : (
          (
            [
              ['输入', input],
              ['输出', bodyOutput]
            ] as const
          ).map(([title, fields]) =>
            fields.length ? (
              <section className="tool-details-section" aria-label={title} key={title}>
                <dl>
                  {fields.map((field, index) => (
                    <div
                      className={`tool-details-field is-${field.kind}`}
                      key={`${field.label}:${index}`}
                    >
                      <dt>{field.label}</dt>
                      <dd>
                        <FieldValue
                          field={field}
                          readImage={readImage}
                          onOpen={imagePreview.open}
                          onUrlChange={imagePreview.reportUrl}
                        />
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ) : null
          )
        )}
        {truncated || details.truncated ? (
          <p className="tool-details-truncated">内容已截断</p>
        ) : null}
      </div>
      {footer.length || errorSummary ? (
        <footer className="tool-details-footer">
          <span className="tool-details-error" role={errorSummary ? 'alert' : undefined}>
            {errorSummary}
          </span>
          <span className="tool-details-exit" style={{ textAlign: 'right' }}>
            {footer.map((field, index) => (
              <span key={`${field.label}:${index}`}>
                {field.label} {field.value}
              </span>
            ))}
          </span>
        </footer>
      ) : null}
      {imagePreview.preview}
    </div>
  )
}
