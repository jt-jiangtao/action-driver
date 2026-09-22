import type { TaskProjection } from '@actiondriver/contracts'
import { useEffect, useMemo, useState } from 'react'
import { Sidebar } from './components/Sidebar'
import type { TaskLayoutMode } from './components/BrowserPanel'
import { useAppServices } from './di/services-context'
import { HomePage } from './pages/HomePage'
import { SettingsPage } from './pages/SettingsPage'
import { LogsPage } from './pages/LogsPage'
import { TaskPage } from './pages/TaskPage'
import { MainPromptPage } from './pages/MainPromptPage'
import { SkillsPage } from './pages/SkillsPage'
import { initialAppRoute, type AppRoute, type InitialAppRoute } from './models/app-route'
import type { MainAppRoute } from './models/app-route'
import { defaultModelSelection, findSelectedModel } from './models/model-selection'

export function App({ initialRoute = 'home' }: { initialRoute?: InitialAppRoute }) {
  const services = useAppServices()
  const [route, setRoute] = useState<AppRoute>(() => initialAppRoute(initialRoute))
  const [task, setTask] = useState<TaskProjection | null>(() =>
    initialRoute === 'task' ? services.taskCatalog.getTask('hotel-task') : null
  )
  const [mode, setMode] = useState<TaskLayoutMode>('split')
  const [selectedModelId, setSelectedModelId] = useState(defaultModelSelection.selectedModelId)
  const modelSelection = useMemo(
    () => ({ ...defaultModelSelection, selectedModelId }),
    [selectedModelId]
  )

  useEffect(
    () =>
      services.agentSessionRepository.subscribe((projection) =>
        setTask((current) => (current?.id === projection.id ? projection : current))
      ),
    [services]
  )

  const openHome = () => {
    setRoute({ kind: 'home' })
    setMode('split')
  }

  const openTask = (taskId: string) => {
    const projection =
      services.taskCatalog.getTask(taskId) ?? services.agentSessionRepository.getTask(taskId)
    if (!projection) return
    setTask(projection)
    setRoute({ kind: 'task', taskId: projection.id })
  }

  const mainRoute: MainAppRoute =
    route.kind === 'settings' ||
    route.kind === 'main-prompt' ||
    route.kind === 'skills' ||
    route.kind === 'logs'
      ? route.returnTo
      : route

  const openSettings = () => {
    if (route.kind === 'settings') return
    setRoute({ kind: 'settings', returnTo: mainRoute })
  }

  const openLogs = () => {
    if (route.kind === 'logs') return
    setRoute({ kind: 'logs', returnTo: mainRoute })
  }

  const openMainPrompt = () => {
    if (route.kind === 'main-prompt') return
    setRoute({ kind: 'main-prompt', returnTo: mainRoute })
  }

  const openSkills = () => {
    if (route.kind === 'skills') return
    setRoute({ kind: 'skills', returnTo: mainRoute })
  }

  if (route.kind === 'settings') {
    return (
      <SettingsPage
        service={services.modelConnectionsService}
        onBack={() => setRoute(route.returnTo)}
        onOpenLogs={openLogs}
        onOpenMainPrompt={openMainPrompt}
        onOpenSkills={openSkills}
      />
    )
  }

  if (route.kind === 'main-prompt') {
    return (
      <MainPromptPage
        service={services.agentFilesService}
        onBack={() => setRoute(route.returnTo)}
        onOpenConnections={() => setRoute({ kind: 'settings', returnTo: route.returnTo })}
        onOpenSkills={openSkills}
        onOpenLogs={openLogs}
      />
    )
  }

  if (route.kind === 'skills') {
    return (
      <SkillsPage
        service={services.agentFilesService}
        onBack={() => setRoute(route.returnTo)}
        onOpenConnections={() => setRoute({ kind: 'settings', returnTo: route.returnTo })}
        onOpenMainPrompt={openMainPrompt}
        onOpenLogs={openLogs}
      />
    )
  }

  if (route.kind === 'logs') {
    return (
      <LogsPage
        service={services.interactionLogService}
        onBack={() => setRoute(route.returnTo)}
        onOpenConnections={() => setRoute({ kind: 'settings', returnTo: route.returnTo })}
        onOpenMainPrompt={openMainPrompt}
        onOpenSkills={openSkills}
      />
    )
  }

  return (
    <div className="app-shell">
      <Sidebar
        active={route.kind === 'home' ? 'new' : 'task'}
        activeTaskId={route.kind === 'task' ? route.taskId : null}
        onNewTask={openHome}
        onOpenTask={openTask}
        onOpenSettings={openSettings}
        recentTasks={services.taskCatalog.listRecentTasks()}
      />
      {route.kind === 'home' ? (
        <HomePage
          modelSelection={modelSelection}
          onSelectModel={setSelectedModelId}
          onSubmit={async (goal) => {
            const selected = findSelectedModel(modelSelection)
            if (!selected) throw new Error('请选择可用模型')
            const projection = await services.agentCommandService.submitGoal({
              goal,
              model: {
                connectionId: selected.connection.id,
                modelId: selected.model.id
              }
            })
            setTask(projection)
            setRoute({ kind: 'task', taskId: projection.id })
          }}
        />
      ) : task ? (
        <TaskPage
          mode={mode}
          task={task}
          modelSelection={modelSelection}
          onSelectModel={setSelectedModelId}
          onModeChange={setMode}
          onPause={() => services.skillGateway.pause('browser-invocation')}
          onResume={() => services.skillGateway.resume('browser-invocation')}
          onTakeOver={() => services.skillGateway.takeOver('browser-invocation')}
          onInterrupt={() => void services.agentCommandService.interrupt(task.id)}
        />
      ) : null}
    </div>
  )
}
