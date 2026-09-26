import type { AppApprovalDecision, ModelRef, TaskProjection } from '@actiondriver/contracts'
import { useCallback, useEffect, useRef, useState, type ComponentProps } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useQueryClient } from '@tanstack/react-query'
import { Sidebar } from './components/Sidebar'
import type { TaskLayoutMode } from './components/BrowserPanel'
import { useAppServices, useTaskStore, useTaskStoreApi } from './di/services-context'
import { HomePage } from './pages/HomePage'
import { SettingsPage } from './pages/SettingsPage'
import { TaskPage } from './pages/TaskPage'
import { MainPromptPage } from './pages/MainPromptPage'
import { SkillsPage } from './pages/SkillsPage'
import { ComputerUsePage } from './pages/ComputerUsePage'
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
import type { ComposerAttachments } from './components/AgentComposer'
import { taskUsesComputerUse, useComputerUseGuidance } from './services/computer-use-guidance'

const ACTIVE_TASK_ID_KEY = 'actiondriver.active-task-id'

export function App({ initialRoute = 'home' }: { initialRoute?: InitialAppRoute }) {
  const services = useAppServices()
  const queryClient = useQueryClient()
  const restoredTaskId = useRef(initialRoute === 'home' ? readActiveTaskId() : null)
  const [route, setRoute] = useState<AppRoute>(() =>
    restoredTaskId.current
      ? { kind: 'task', taskId: restoredTaskId.current }
      : initialAppRoute(initialRoute)
  )
  // The shell follows only what it routes on; streamed content re-renders the task page alone.
  const taskStore = useTaskStoreApi()
  const activeTask = useTaskStore(
    useShallow((state) => ({
      id: state.activeTask?.id ?? null,
      running: state.activeTask?.status === 'running',
      usesComputerUse: taskUsesComputerUse(state.activeTask)
    }))
  )
  useComputerUseGuidance(activeTask.id, activeTask.usesComputerUse)
  const [mode, setMode] = useState<TaskLayoutMode>('split')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
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
      if (initialRoute === 'task' && recent[0]) {
        const restored = await services.taskCatalog.getTask(recent[0].id)
        if (requestId !== taskRequestId.current) return
        if (restored) {
          taskStore.getState().open(restored)
          setRoute({ kind: 'task', taskId: restored.id })
          rememberActiveTaskId(restored.id)
        }
      }
    } catch (error) {
      if (requestId !== taskRequestId.current) return
      setRecentTasks([])
      setRecentTasksError(error instanceof Error ? error.message : '任务加载失败')
    } finally {
      if (requestId === taskRequestId.current) setRecentTasksLoading(false)
    }
  }, [initialRoute, queryClient, services, taskStore])

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
          setRoute({ kind: 'task', taskId: restored.id })
        } else {
          restoredTaskId.current = null
          rememberActiveTaskId(null)
          setRoute({ kind: 'home' })
        }
      })
      .catch(() => {
        if (!cancelled && restoredTaskId.current === taskId) setRoute({ kind: 'home' })
      })
    return () => {
      cancelled = true
    }
  }, [services, taskStore])

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
    setMode('split')
  }

  const openTask = async (taskId: string) => {
    const projection =
      services.agentSessionRepository.getTask(taskId) ??
      (await services.taskCatalog.getTask(taskId))
    if (!projection) return
    restoredTaskId.current = projection.id
    rememberActiveTaskId(projection.id)
    taskStore.getState().open(projection)
    setRoute({ kind: 'task', taskId: projection.id })
  }

  const presentSubmittedTask = useCallback(
    (projection: TaskProjection, previousTaskId?: string) => {
      restoredTaskId.current = projection.id
      rememberActiveTaskId(projection.id)
      taskStore.getState().open(projection)
      setRecentTasks((current) => [
        { id: projection.id, title: projection.title, state: 'default' },
        ...current.filter((item) => item.id !== projection.id && item.id !== previousTaskId)
      ])
      setRoute({ kind: 'task', taskId: projection.id })
    },
    [taskStore]
  )

  const stageImages = useCallback(
    async (files: File[] = []): Promise<string[]> => {
      if (files.length === 0) return []
      if (!services.imageAssets) throw new Error('图片上传暂不可用')
      const staged = await Promise.all(files.map((file) => services.imageAssets!.uploadImage(file)))
      return staged.map((asset) => asset.assetId)
    },
    [services]
  )
  const stageInputFiles = useCallback(
    async (files: File[] = []): Promise<string[]> => {
      if (files.length === 0) return []
      if (!services.inputFiles) throw new Error('文件上传暂不可用')
      const staged = await Promise.all(
        files.map((file) => services.inputFiles!.uploadInputFile(file))
      )
      return staged.map((file) => file.fileId)
    },
    [services]
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
    async (goal: string, attachments?: ComposerAttachments) => {
      const selected = findSelectedModel(modelSelection)
      if (!selected) throw new Error('请选择可用模型')
      const imageFiles = attachments?.images ?? []
      const documentFiles = attachments?.documents ?? []
      if (documentFiles.length > 0 && !services.inputFiles) throw new Error('文件上传暂不可用')
      const imageAssetIds = await stageImages(imageFiles)
      const inputFileIds = services.inputFiles
        ? await stageInputFiles([...documentFiles, ...imageFiles])
        : []
      const projection = await services.agentCommandService.submitGoal({
        goal,
        ...(imageAssetIds.length ? { imageAssetIds } : {}),
        ...(inputFileIds.length ? { inputFileIds } : {}),
        model: {
          connectionId: selected.connection.id,
          modelId: selected.model.id
        }
      })
      presentSubmittedTask(projection)
    },
    [modelSelection, presentSubmittedTask, services, stageImages, stageInputFiles]
  )

  const submitContinuation = useCallback(
    async (goal: string, attachments?: ComposerAttachments) => {
      const task = taskStore.getState().activeTask
      if (!task) return
      const imageFiles = attachments?.images ?? []
      const documentFiles = attachments?.documents ?? []
      if (documentFiles.length > 0 && !services.inputFiles) throw new Error('文件上传暂不可用')
      const imageAssetIds = await stageImages(imageFiles)
      const inputFileIds = services.inputFiles
        ? await stageInputFiles([...documentFiles, ...imageFiles])
        : []
      const previousTaskId = task.id
      const projection = await services.agentCommandService.submitGoal({
        goal,
        ...(imageAssetIds.length ? { imageAssetIds } : {}),
        ...(inputFileIds.length ? { inputFileIds } : {}),
        sessionId: task.sessionId
      })
      presentSubmittedTask(projection, previousTaskId)
    },
    [presentSubmittedTask, services, stageImages, stageInputFiles, taskStore]
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
  const selectModel = useCallback(
    (selected: ModelRef) => setModelSelection((current) => ({ ...current, selected })),
    []
  )

  const mainRoute: MainAppRoute =
    route.kind === 'settings' || route.kind === 'main-prompt' || route.kind === 'skills' || route.kind === 'computer-use'
      ? route.returnTo
      : route

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

  if (route.kind === 'settings') {
    return (
      <SettingsPage
        service={services.modelConnectionsService}
        onBack={() => {
          void loadModels(modelSelection.selected)
          setRoute(route.returnTo)
        }}
        onOpenMainPrompt={openMainPrompt}
        onOpenSkills={openSkills}
        onOpenComputerUse={openComputerUse}
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
        onOpenComputerUse={openComputerUse}
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
        onOpenComputerUse={openComputerUse}
      />
    )
  }

  if (route.kind === 'computer-use') {
    // The runtime HTTP client exposes the always-allowed grants; the desktop adapter may not.
    const alwaysAllowed = services.agentCommandService as {
      listAlwaysAllowedApps?(): Promise<string[]>
      removeAlwaysAllowedApp?(bundleId: string): Promise<string[]>
    }
    return <ComputerUsePage onBack={() => setRoute(route.returnTo)}
      onOpenConnections={() => setRoute({ kind: 'settings', returnTo: route.returnTo })}
      onOpenMainPrompt={openMainPrompt} onOpenSkills={openSkills}
      onOpenComputerUse={openComputerUse}
      {...(alwaysAllowed.listAlwaysAllowedApps
        ? { listAlwaysAllowedApps: () => alwaysAllowed.listAlwaysAllowedApps!() }
        : {})}
      {...(alwaysAllowed.removeAlwaysAllowedApp
        ? { removeAlwaysAllowedApp: (bundleId: string) => alwaysAllowed.removeAlwaysAllowedApp!(bundleId) }
        : {})} />
  }

  return (
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
        />
      ) : null}
      {route.kind === 'home' ? (
        <HomePage
          sidebarCollapsed={sidebarCollapsed}
          onExpandSidebar={() => setSidebarCollapsed(false)}
          modelSelection={modelSelection}
          onSelectModel={(selected) => setModelSelection((current) => ({ ...current, selected }))}
          onRetryModels={() => void loadModels(modelSelection.selected)}
          onOpenModelSettings={openSettings}
          onSubmit={submitNewSession}
        />
      ) : activeTask.id ? (
        <ActiveTaskPage
          onOpenModelSettings={openSettings}
          sidebarCollapsed={sidebarCollapsed}
          onExpandSidebar={expandSidebar}
          mode={mode}
          modelSelection={modelSelection}
          onSelectModel={selectModel}
          onModeChange={setMode}
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
