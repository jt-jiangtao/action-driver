import type { ModelRef, TaskProjection } from '@actiondriver/contracts'
import { useCallback, useEffect, useRef, useState } from 'react'
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
import {
  failedModelSelection,
  findSelectedModel,
  loadingModelSelection,
  toModelSelectionProjection
} from './models/model-selection'
import type { ModelSelectionProjection } from './models/model-selection'
import type { RecentTaskSummary } from './models/task-catalog'

export function App({ initialRoute = 'home' }: { initialRoute?: InitialAppRoute }) {
  const services = useAppServices()
  const [route, setRoute] = useState<AppRoute>(() => initialAppRoute(initialRoute))
  const [task, setTask] = useState<TaskProjection | null>(null)
  const [mode, setMode] = useState<TaskLayoutMode>('split')
  const [modelSelection, setModelSelection] =
    useState<ModelSelectionProjection>(loadingModelSelection)
  const [recentTasks, setRecentTasks] = useState<readonly RecentTaskSummary[]>([])
  const [recentTasksLoading, setRecentTasksLoading] = useState(true)
  const [recentTasksError, setRecentTasksError] = useState<string | null>(null)
  const modelRequestId = useRef(0)
  const taskRequestId = useRef(0)

  const loadModels = useCallback(
    async (selected: ModelRef | null = null) => {
      const requestId = ++modelRequestId.current
      setModelSelection(loadingModelSelection)
      try {
        const connections = await services.modelConnectionsService.list()
        if (requestId !== modelRequestId.current) return
        setModelSelection(toModelSelectionProjection(connections, selected))
      } catch (error) {
        if (requestId !== modelRequestId.current) return
        setModelSelection(failedModelSelection(error))
      }
    },
    [services]
  )

  const loadRecentTasks = useCallback(async () => {
    const requestId = ++taskRequestId.current
    setRecentTasksLoading(true)
    try {
      const recent = await services.taskCatalog.listRecentTasks()
      if (requestId !== taskRequestId.current) return
      setRecentTasks(recent)
      setRecentTasksError(null)
      if (initialRoute === 'task' && recent[0]) {
        setTask(await services.taskCatalog.getTask(recent[0].id))
        setRoute({ kind: 'task', taskId: recent[0].id })
      }
    } catch (error) {
      if (requestId !== taskRequestId.current) return
      setRecentTasks([])
      setRecentTasksError(error instanceof Error ? error.message : '任务加载失败')
    } finally {
      if (requestId === taskRequestId.current) setRecentTasksLoading(false)
    }
  }, [initialRoute, services])

  useEffect(() => {
    void loadModels()
    void loadRecentTasks()
  }, [loadModels, loadRecentTasks])

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

  const openTask = async (taskId: string) => {
    const projection =
      (await services.taskCatalog.getTask(taskId)) ??
      services.agentSessionRepository.getTask(taskId)
    if (!projection) return
    setTask(projection)
    setRoute({ kind: 'task', taskId: projection.id })
  }

  const presentSubmittedTask = useCallback(
    (projection: TaskProjection, previousTaskId?: string) => {
      setTask(projection)
      setRecentTasks((current) => [
        { id: projection.id, title: projection.title, state: 'default' },
        ...current.filter((item) => item.id !== projection.id && item.id !== previousTaskId)
      ])
      setRoute({ kind: 'task', taskId: projection.id })
    },
    []
  )

  const submitNewSession = useCallback(
    async (goal: string) => {
      const selected = findSelectedModel(modelSelection)
      if (!selected) throw new Error('请选择可用模型')
      const projection = await services.agentCommandService.submitGoal({
        goal,
        model: {
          connectionId: selected.connection.id,
          modelId: selected.model.id
        }
      })
      presentSubmittedTask(projection)
    },
    [modelSelection, presentSubmittedTask, services]
  )

  const submitContinuation = useCallback(
    async (goal: string) => {
      if (!task) return
      const previousTaskId = task.id
      const projection = await services.agentCommandService.submitGoal({
        goal,
        sessionId: task.sessionId
      })
      presentSubmittedTask(projection, previousTaskId)
    },
    [presentSubmittedTask, services, task]
  )

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
        onBack={() => {
          void loadModels(modelSelection.selected)
          setRoute(route.returnTo)
        }}
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
        modelLogService={services.modelLogService}
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
        onOpenTask={(taskId) => void openTask(taskId)}
        onOpenSettings={openSettings}
        recentTasks={recentTasks}
        recentTasksLoading={recentTasksLoading}
        recentTasksError={recentTasksError}
        onRetryRecentTasks={() => void loadRecentTasks()}
      />
      {route.kind === 'home' ? (
        <HomePage
          modelSelection={modelSelection}
          onSelectModel={(selected) => setModelSelection((current) => ({ ...current, selected }))}
          onRetryModels={() => void loadModels(modelSelection.selected)}
          onSubmit={submitNewSession}
        />
      ) : task ? (
        <TaskPage
          mode={mode}
          task={task}
          modelSelection={modelSelection}
          onSelectModel={(selected) => setModelSelection((current) => ({ ...current, selected }))}
          onModeChange={setMode}
          onPause={() => services.skillGateway.pause('browser-invocation')}
          onResume={() => services.skillGateway.resume('browser-invocation')}
          onTakeOver={() => services.skillGateway.takeOver('browser-invocation')}
          onInterrupt={() => void services.agentCommandService.interrupt(task.id)}
          onSubmit={submitContinuation}
        />
      ) : null}
    </div>
  )
}
