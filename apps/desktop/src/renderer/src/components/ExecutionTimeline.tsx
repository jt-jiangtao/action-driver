import type { ExecutionStepProjection } from '@action-driver/contracts'
import { Timeline } from 'antd'

export function ExecutionTimeline({ steps }: { steps: ExecutionStepProjection[] }) {
  const completed = steps.filter((step) => step.state !== 'waiting').length
  return (
    <section className="execution-progress" aria-labelledby="execution-progress-title">
      <header>
        <h2 id="execution-progress-title">执行进度</h2>
        <span>
          {completed} / {steps.length}
        </span>
      </header>
      <Timeline
        className="execution-timeline"
        items={steps.map((step) => ({
          color:
            step.state === 'success'
              ? '#2fb67c'
              : step.state === 'current'
                ? '#5267f7'
                : step.state === 'failed'
                  ? '#e5484d'
                  : '#c4cad4',
          content: (
            <div className={`timeline-step timeline-step-${step.state}`}>
              <strong>{step.title}</strong>
              <span>{step.detail}</span>
            </div>
          )
        }))}
      />
    </section>
  )
}
