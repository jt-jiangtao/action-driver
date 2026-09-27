import { expect, it } from 'vitest'
import { EventQueue } from './event-queue'
it('keeps emitted progress before an error and refuses post-close events', async () => {
  const queue = new EventQueue<string>(2)
  queue.push('first'); queue.fail(new Error('lost'))
  expect(await queue.next()).toEqual({ value: 'first', done: false })
  await expect(queue.next()).rejects.toThrow('lost')
  expect(() => queue.push('late')).toThrow('closed')
})
it('rejects producer overflow and wakes blocked consumers on completion', async () => {
  const queue = new EventQueue<string>(1)
  queue.push('one')
  expect(() => queue.push('two')).toThrow('overflow')
  expect(await queue.next()).toEqual({ value: 'one', done: false })
  const waiting = queue.next(); queue.end()
  expect(await waiting).toEqual({ done: true, value: undefined })
})
