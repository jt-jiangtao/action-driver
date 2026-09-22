export type MainAppRoute = { kind: 'home' } | { kind: 'task'; taskId: string }

export type AppRoute =
  | MainAppRoute
  | { kind: 'settings'; returnTo: MainAppRoute }
  | { kind: 'main-prompt'; returnTo: MainAppRoute }
  | { kind: 'skills'; returnTo: MainAppRoute }
  | { kind: 'logs'; returnTo: MainAppRoute }

export type InitialAppRoute = 'home' | 'task' | 'settings' | 'main-prompt' | 'skills' | 'logs'

export function initialAppRoute(route: InitialAppRoute): AppRoute {
  if (route === 'task') return { kind: 'task', taskId: 'hotel-task' }
  if (route === 'settings') return { kind: 'settings', returnTo: { kind: 'home' } }
  if (route === 'main-prompt') return { kind: 'main-prompt', returnTo: { kind: 'home' } }
  if (route === 'skills') return { kind: 'skills', returnTo: { kind: 'home' } }
  if (route === 'logs') return { kind: 'logs', returnTo: { kind: 'home' } }
  return { kind: 'home' }
}
