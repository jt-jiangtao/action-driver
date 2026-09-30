import type { AppApprovalDecision, ModelRef, TaskProjection } from '@action-driver/contracts'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode
} from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useQueryClient } from '@tanstack/react-query'
import { Sidebar } from './components/Sidebar'
import { AppNavigationProvider } from './components/navigation/AppNavigationControls'
import type { TaskLayoutMode } from './components/BrowserPanel'
import { useAppServices, useTaskStore, useTaskStoreApi } from './di/services-context'
import { HomePage } from './pages/HomePage'
import { SettingsPage } from './pages/SettingsPage'
import { TaskPage } from './pages/TaskPage'
import { MainPromptPage } from './pages/MainPromptPage'
import { SkillsPage } from './pages/SkillsPage'
import { ComputerUsePage } from './pages/ComputerUsePage'
import { ArchivedChatsPage } from './pages/ArchivedChatsPage'
import { initialAppRoute, type AppRoute, type InitialAppRoute } from './models/app-route'
import {
  createAppNavigationHistory,
  navigateAppHistory,
  travelAppHistory
} from './models/app-navigation-history'
import type { MainAppRoute } from './models/app-route'
import {
  failedModelSelection,
  findSelectedModel,
  loadingModelSelection,
  toModelSelectionProjection
} from './models/model-selection'
import type { ModelSelectionProjection } from './models/model-selection'
import type { RecentTaskSummary } from './models/task-catalog'
import { mergeSubmittedTask } from './models/recent-task-submission'
import { taskUsesComputerUse } from './services/agent-session/computer-use-guidance'
import { useComputerUseGuidance } from './hooks/use-computer-use-guidance'

const ACTIVE_TASK_ID_KEY = 'action-driver.active-task-id'

export function App({ initialRoute = 'home' }: { initialRoute?: InitialAppRoute }) {
  const services = useAppServices()
  const queryClient = useQueryClient()
  const restoredTaskId = useRef(initialRoute === 'home' ? readActiveTaskId() : null)
  const [history, setHistory] = useState(() =>
    createAppNavigationHistory(
      restoredTaskId.current
        ? { kind: 'task', taskId: restoredTaskId.current }
        : initialAppRoute(initialRoute)
    )
  )
  const route = history.entries[history.index]!
  const navigationRequestId = useRef(0)
  const setRoute = useCallback(
    (next: AppRoute) => setHistory((current) => navigateAppHistory(current, next)),
    []
  )
  const replaceRoute = useCallback(
    (next: AppRoute) =>
      setHistory((current) => ({
        ...current,
        entries: current.entries.map((entry, index) => (index === current.index ? next : entry))
      })),
    []
  )
  // The shell follows only what it routes on; streamed content re-renders the task page alone.
  const taskStore = useTaskStoreApi()
  const activeTask = useTaskStore(
    useShallow((state) => ({
      id: state.activeTask?.id ?? null,
      status: state.activeTask?.status ?? null,
      running: state.activeTask?.status === 'running',
      usesComputerUse: taskUsesComputerUse(state.activeTask)
    }))
  )
  useComputerUseGuidance(activeTask.id, activeTask.usesComputerUse)
  const [mode, setMode] = useState<TaskLayoutMode>('split')
  const taskModes = useRef(new Map<string, TaskLayoutMode>())
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [modelSelection, setModelSelection] =
    useState<ModelSelectionProjection>(loadingModelSelection)
  const [recentTasks, setRecentTasks] = useState<readonly RecentTaskSummary[]>([])
  const [recentTasksLoading, setRecentTasksLoading] = useState(true)
  const [recentTasksError, setRecentTasksError] = useState<string | null>(null)
  const [taskActionError, setTaskActionError] = useState<string | null>(null)
  const [busySessionId, setBusySessionId] = useState<string | null>(null)
  const busySessionRef = useRef<string | null>(null)
  const [navigationError, setNavigationError] = useState<string | null>(null)
  const modelRequestId = useRef(0)
  const taskRequestId = useRef(0)
  const previousActiveStatus = useRef<string | null>(null)

  useEffect(() => setNavigationError(null), [route])

  const loadModels = useCallback(
    async (selected: ModelRef | null = null) => {
      const requestId = ++modelRequestId.current
      setModelSelection(loadingModelSelection)
      try {
        const connections = await queryClient.fetchQuery({
          queryKey: ['model-connections'],
          queryFn: () => services.modelConnectionsService.list(),
          staleTime: 30_000,
          retry: false
        })
        if (requestId !== modelRequestId.current) return
        setModelSelection(toModelSelectionProjection(connections, selected))
      } catch (error) {
        if (requestId !== modelRequestId.current) return
        setModelSelection(failedModelSelection(error))
      }
    },
    [queryClient, services]
  )

  const loadRecentTasks = useCallback(async () => {
    const requestId = ++taskRequestId.current
    setRecentTasksLoading(true)
    try {
      const recent = await queryClient.fetchQuery({
        queryKey: ['recent-tasks'],
        queryFn: () => services.taskCatalog.listRecentTasks(),
        staleTime: 30_000,
        retry: false
      })
      if (requestId !== taskRequestId.current) return
      setRecentTasks(recent)
      setRecentTasksError(null)
      if (initialRoute === 'task' && requestId === 1 && recent[0]) {
        const restored = await services.taskCatalog.getTask(recent[0].id)
        if (requestId !== taskRequestId.current) return
        if (restored) {
          taskStore.getState().open(restored)
          replaceRoute({ kind: 'task', taskId: restored.id })
          rememberActiveTaskId(restored.id)
        }
      }
    } catch (error) {
      if (requestId !== taskRequestId.current) return
      if (requestId === 1) setRecentTasks([])
      setRecentTasksError(error instanceof Error ? error.message : '任务加载失败')
    } finally {
      if (requestId === taskRequestId.current) setRecentTasksLoading(false)
    }
  }, [initialRoute, queryClient, replaceRoute, services, taskStore])

  useEffect(() => {
    void loadModels()
    void loadRecentTasks()
  }, [loadModels, loadRecentTasks])

  useEffect(() => {
    const taskId = restoredTaskId.current
    if (!taskId) return
    let cancelled = false
    void services.taskCatalog
      .getTask(taskId)
      .then((restored) => {
        if (cancelled || restoredTaskId.current !== taskId) return
        if (restored) {
          taskStore.getState().open(restored)
          replaceRoute({ kind: 'task', taskId: restored.id })
        } else {
          restoredTaskId.current = null
          rememberActiveTaskId(null)
          replaceRoute({ kind: 'home' })
        }
      })
      .catch(() => {
        if (!cancelled && restoredTaskId.current === taskId) replaceRoute({ kind: 'home' })
      })
    return () => {
      cancelled = true
    }
  }, [replaceRoute, services, taskStore])

  useEffect(() => {
    const task = taskStore.getState().activeTask
    if (!task || task.status !== 'running') return
    void services.restoreTaskStream?.(task).catch((error: unknown) => {
      console.error('Failed to restore running task stream', error)
    })
  }, [services, taskStore, activeTask.id, activeTask.running])

  const openHome = () => {
    restoredTaskId.current = null
    rememberActiveTaskId(null)
    setRoute({ kind: 'home' })
  }

  const resolveTask = async (taskId: string): Promise<TaskProjection | null> => {
    try {
      return (
        services.agentSessionRepository.getTask(taskId) ??
        (await services.taskCatalog.getTask(taskId))
      )
    } catch {
      return null
    }
  }

  const openTask = async (taskId: string) => {
    const requestId = ++navigationRequestId.current
    const projection = await resolveTask(taskId)
    if (requestId !== navigationRequestId.current) return
    if (!projection) {
      setNavigationError('无法打开任务：该任务已不可用')
      return
    }
    setNavigationError(null)
    restoredTaskId.current = projection.id
    rememberActiveTaskId(projection.id)
    taskStore.getState().open(projection)
    setMode(taskModes.current.get(projection.id) ?? 'split')
    setRoute({ kind: 'task', taskId: projection.id })
  }

  const refreshRecentTasks = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['recent-tasks'], refetchType: 'none' })
    await loadRecentTasks()
  }, [loadRecentTasks, queryClient])

  useEffect(() => {
    const previous = previousActiveStatus.current
    previousActiveStatus.current = activeTask.status
    if (
      (previous === 'running' || previous === 'queued') &&
      activeTask.status !== 'running' &&
      activeTask.status !== 'queued'
    ) {
      void refreshRecentTasks()
    }
  }, [activeTask.status, refreshRecentTasks])

  const changeSession = async (sessionId: string, action: 'pin' | 'archive', value: boolean) => {
    if (busySessionRef.current) return
    busySessionRef.current = sessionId
    setBusySessionId(sessionId)
    setTaskActionError(null)
    try {
      if (action === 'pin') {
        if (!services.taskCatalog.setPinned) throw new Error('置顶功能暂不可用')
        await services.taskCatalog.setPinned(sessionId, value)
      } else {
        if (!services.taskCatalog.setArchived) throw new Error('归档功能暂不可用')
        await services.taskCatalog.setArchived(sessionId, value)
      }
      await refreshRecentTasks()
    } catch (error) {
      const detail = error as { code?: string; message?: string } | null
      setTaskActionError(
        error instanceof Error ? error.message : (detail?.message ?? '操作失败，请重试')
      )
      if (detail?.code === 'not-found') await refreshRecentTasks()
    } finally {
      busySessionRef.current = null
      setBusySessionId(null)
    }
  }

  const presentSubmittedTask = useCallback(
    (projection: TaskProjection, previousTaskId?: string) => {
      restoredTaskId.current = projection.id
      rememberActiveTaskId(projection.id)
      taskStore.getState().open(projection)
      const nextMode = previousTaskId ? (taskModes.current.get(previousTaskId) ?? 'split') : 'split'
      taskModes.current.set(projection.id, nextMode)
      setMode(nextMode)
      setRecentTasks((current) => mergeSubmittedTask(current, projection, previousTaskId))
      setRoute({ kind: 'task', taskId: projection.id })
    },
    [taskStore]
  )

  const readImage = useCallback(
    (sessionId: string, assetId: string) => services.imageAssets!.readImage(sessionId, assetId),
    [services]
  )
  const readOutputFile = useCallback(
    (sessionId: string, fileId: string, taskId: string) =>
      services.outputFiles!.readOutputFile(sessionId, fileId, taskId),
    [services]
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
      const task = taskStore.getState().activeTask
      if (!task) return
      const previousTaskId = task.id
      const projection = await services.agentCommandService.submitGoal({
        goal,
        sessionId: task.sessionId
      })
      presentSubmittedTask(projection, previousTaskId)
    },
    [presentSubmittedTask, services, taskStore]
  )

  // Task controls read the task when they run, so their identity survives streamed updates.
  const skillInvocationId = useCallback(() => {
    const task = taskStore.getState().activeTask
    return task && taskUsesComputerUse(task) ? task.id : 'browser-invocation'
  }, [taskStore])
  const pauseTask = useCallback(
    () => services.skillGateway.pause(skillInvocationId()),
    [services, skillInvocationId]
  )
  const resumeTask = useCallback(
    () => services.skillGateway.resume(skillInvocationId()),
    [services, skillInvocationId]
  )
  const takeOverTask = useCallback(
    () => services.skillGateway.takeOver(skillInvocationId()),
    [services, skillInvocationId]
  )
  const decideAppApproval = useCallback(
    async (requestId: string, decision: AppApprovalDecision) => {
      const task = taskStore.getState().activeTask
      if (task) await services.agentCommandService.decideAppApproval(task.id, requestId, decision)
    },
    [services, taskStore]
  )
  const interruptTask = useCallback(() => {
    const task = taskStore.getState().activeTask
    if (task) void services.agentCommandService.interrupt(task.id)
  }, [services, taskStore])
  const expandSidebar = useCallback(() => setSidebarCollapsed(false), [])
  const changeMode = useCallback(
    (next: TaskLayoutMode) => {
      const taskId = taskStore.getState().activeTask?.id
      if (taskId) taskModes.current.set(taskId, next)
      setMode(next)
    },
    [taskStore]
  )
  const selectModel = useCallback(
    (selected: ModelRef) => setModelSelection((current) => ({ ...current, selected })),
    []
  )

  const mainRoute: MainAppRoute =
    route.kind === 'settings' ||
    route.kind === 'main-prompt' ||
    route.kind === 'skills' ||
    route.kind === 'computer-use' ||
    route.kind === 'archived'
      ? route.returnTo
      : route

  const travel = async (delta: -1 | 1) => {
    const targetHistory = travelAppHistory(history, delta)
    if (targetHistory === history) return
    const requestId = ++navigationRequestId.current
    const target = targetHistory.entries[targetHistory.index]!
    if (target.kind === 'task') {
      const projection = await resolveTask(target.taskId)
      if (requestId !== navigationRequestId.current) return
      if (!projection) {
        setNavigationError('无法打开任务：该任务已不可用')
        return
      }
      setNavigationError(null)
      taskStore.getState().open(projection)
      setMode(taskModes.current.get(projection.id) ?? 'split')
      restoredTaskId.current = projection.id
      rememberActiveTaskId(projection.id)
    } else if (target.kind === 'home') {
      restoredTaskId.current = null
      rememberActiveTaskId(null)
    }
    if (requestId === navigationRequestId.current) setHistory(targetHistory)
  }
  const navigation = {
    canGoBack: history.index > 0,
    canGoForward: history.index < history.entries.length - 1,
    goBack: () => {
      void travel(-1)
    },
    goForward: () => {
      void travel(1)
    }
  }
  const withNavigation = (page: ReactNode) => (
    <AppNavigationProvider value={navigation}>
      {page}
      {navigationError ? (
        <p className="app-navigation-error" role="alert">
          {navigationError}
        </p>
      ) : null}
    </AppNavigationProvider>
  )

  const openSettings = () => {
    if (route.kind === 'settings') return
    setRoute({ kind: 'settings', returnTo: mainRoute })
  }

  const openMainPrompt = () => {
    if (route.kind === 'main-prompt') return
    setRoute({ kind: 'main-prompt', returnTo: mainRoute })
  }

  const openSkills = () => {
    if (route.kind === 'skills') return
    setRoute({ kind: 'skills', returnTo: mainRoute })
  }

  const openComputerUse = () => {
    if (route.kind === 'computer-use') return
    setRoute({ kind: 'computer-use', returnTo: mainRoute })
  }

  const openArchived = () => setRoute({ kind: 'archived', returnTo: mainRoute })

  if (route.kind === 'archived') {
    return withNavigation(
      <ArchivedChatsPage
        catalog={services.taskCatalog}
        onBack={() => setRoute(route.returnTo)}
        onOpenTask={(taskId) => void openTask(taskId)}
        onRestored={() => void refreshRecentTasks()}
        onOpenConnections={() => setRoute({ kind: 'settings', returnTo: route.returnTo })}
        onOpenMainPrompt={openMainPrompt}
        onOpenSkills={openSkills}
        onOpenComputerUse={openComputerUse}
      />
    )
  }

  if (route.kind === 'settings') {
    return withNavigation(
      <SettingsPage
        service={services.modelConnectionsService}
        onBack={() => {
          void loadModels(modelSelection.selected)
          setRoute(route.returnTo)
        }}
        onOpenMainPrompt={openMainPrompt}
        onOpenSkills={openSkills}
        onOpenComputerUse={openComputerUse}
        onOpenArchived={openArchived}
      />
    )
  }

  if (route.kind === 'main-prompt') {
    return withNavigation(
      <MainPromptPage
        service={services.agentFilesService}
        onBack={() => setRoute(route.returnTo)}
        onOpenConnections={() => setRoute({ kind: 'settings', returnTo: route.returnTo })}
        onOpenSkills={openSkills}
        onOpenComputerUse={openComputerUse}
        onOpenArchived={openArchived}
      />
    )
  }

  if (route.kind === 'skills') {
    return withNavigation(
      <SkillsPage
        service={services.agentFilesService}
        onBack={() => setRoute(route.returnTo)}
        onOpenConnections={() => setRoute({ kind: 'settings', returnTo: route.returnTo })}
        onOpenMainPrompt={openMainPrompt}
        onOpenComputerUse={openComputerUse}
        onOpenArchived={openArchived}
      />
    )
  }

  if (route.kind === 'computer-use') {
    // The runtime HTTP client exposes the always-allowed grants; the desktop adapter may not.
    const alwaysAllowed = services.agentCommandService as {
      listAlwaysAllowedApps?(): Promise<string[]>
      removeAlwaysAllowedApp?(bundleId: string): Promise<string[]>
    }
    return withNavigation(
      <ComputerUsePage
        onBack={() => setRoute(route.returnTo)}
        onOpenConnections={() => setRoute({ kind: 'settings', returnTo: route.returnTo })}
        onOpenMainPrompt={openMainPrompt}
        onOpenSkills={openSkills}
        onOpenComputerUse={openComputerUse}
        onOpenArchived={openArchived}
        {...(alwaysAllowed.listAlwaysAllowedApps
          ? { listAlwaysAllowedApps: () => alwaysAllowed.listAlwaysAllowedApps!() }
          : {})}
        {...(alwaysAllowed.removeAlwaysAllowedApp
          ? {
              removeAlwaysAllowedApp: (bundleId: string) =>
                alwaysAllowed.removeAlwaysAllowedApp!(bundleId)
            }
          : {})}
      />
    )
  }

  return withNavigation(
    <div className={`app-shell${sidebarCollapsed ? ' is-sidebar-collapsed' : ''}`}>
      {!sidebarCollapsed ? (
        <Sidebar
          active={route.kind === 'home' ? 'new' : 'task'}
          activeTaskId={route.kind === 'task' ? route.taskId : null}
          onCollapse={() => setSidebarCollapsed(true)}
          onNewTask={openHome}
          onOpenTask={(taskId) => void openTask(taskId)}
          onOpenSettings={openSettings}
          recentTasks={recentTasks}
          recentTasksLoading={recentTasksLoading}
          recentTasksError={recentTasksError}
          onRetryRecentTasks={() => void loadRecentTasks()}
          onPinTask={(sessionId, pinned) => void changeSession(sessionId, 'pin', pinned)}
          onArchiveTask={(sessionId) => void changeSession(sessionId, 'archive', true)}
          busySessionId={busySessionId}
          actionError={taskActionError}
        />
      ) : null}
      {route.kind === 'home' ? (
        <HomePage
          sidebarCollapsed={sidebarCollapsed}
          onExpandSidebar={() => setSidebarCollapsed(false)}
          modelSelection={modelSelection}
          onSelectModel={(selected) => setModelSelection((current) => ({ ...current, selected }))}
          onRetryModels={() => void loadModels(modelSelection.selected)}
          onSubmit={submitNewSession}
        />
      ) : activeTask.id ? (
        <ActiveTaskPage
          sidebarCollapsed={sidebarCollapsed}
          onExpandSidebar={expandSidebar}
          mode={mode}
          modelSelection={modelSelection}
          onSelectModel={selectModel}
          onModeChange={changeMode}
          onPause={pauseTask}
          onResume={resumeTask}
          onTakeOver={takeOverTask}
          onAppDecision={decideAppApproval}
          onInterrupt={interruptTask}
          readImage={services.imageAssets ? readImage : undefined}
          readOutputFile={services.outputFiles ? readOutputFile : undefined}
          onSubmit={submitContinuation}
        />
      ) : null}
    </div>
  )
}

/** The task page for the active task; the only part of the app that re-renders as it streams. */
function ActiveTaskPage(props: Omit<ComponentProps<typeof TaskPage>, 'task'>) {
  const task = useTaskStore((state) => state.activeTask)
  return task ? <TaskPage {...props} task={task} /> : null
}

function readActiveTaskId(): string | null {
  try {
    return globalThis.sessionStorage.getItem(ACTIVE_TASK_ID_KEY)
  } catch {
    return null
  }
}

function rememberActiveTaskId(taskId: string | null): void {
  try {
    if (taskId) globalThis.sessionStorage.setItem(ACTIVE_TASK_ID_KEY, taskId)
    else globalThis.sessionStorage.removeItem(ACTIVE_TASK_ID_KEY)
  } catch {
    // Navigation still works when session storage is unavailable.
  }
}
