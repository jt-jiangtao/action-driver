import { e2eId } from '../../../apps/desktop/src/renderer/src/testing/e2e-id'

declare const task: { id: string }

export const valid = (
  <>
    <button data-testid="e2e/home/composer/send#button" type="button">Send</button>
    <button
      data-testid={e2eId('e2e/shared/sidebar/tasks/:task-id#button', { 'task-id': task.id })}
      type="button"
    >
      Open
    </button>
  </>
)
