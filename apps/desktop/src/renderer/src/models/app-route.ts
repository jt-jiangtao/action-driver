export type MainAppRoute = { kind: 'home' } | { kind: 'task'; taskId: string }

export type AppRoute =
  | MainAppRoute
  | { kind: 'settings'; returnTo: MainAppRoute }
  | { kind: 'logs'; returnTo: MainAppRoute }

export type InitialAppRoute = 'home' | 'task' | 'settings'

export function initialAppRoute(route: InitialAppRoute): AppRoute {
  if (route === 'task') return { kind: 'task', taskId: 'hotel-task' }
  if (route === 'settings') return { kind: 'settings', returnTo: { kind: 'home' } }
  return { kind: 'home' }
}
