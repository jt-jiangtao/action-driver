// A third-party fixture consumes only its injected public SDK context.
export async function activate(context) {
  context.subscriptions.add(context.api.contributions.register(
    { kind: 'capability', id: 'external-fixture.echo' },
    async (input, invocation) => input?.hang ? never() : ({ ...input, plugin: context.plugin.pluginId, call: invocation.callId })
  ))
}
export function never() { return new Promise(() => {}) }
