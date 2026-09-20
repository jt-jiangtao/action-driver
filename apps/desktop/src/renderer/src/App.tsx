import type { TaskProjection } from '@actiondriver/contracts'
import { useEffect, useState } from 'react'
import { Sidebar } from './components/Sidebar'
import type { TaskLayoutMode } from './components/BrowserPanel'
import type { AppServices } from './di/container'
import { HomePage } from './pages/HomePage'
import { TaskPage } from './pages/TaskPage'

export function App({
  services,
  initialRoute = 'home'
}: {
  services: AppServices
  initialRoute?: 'home' | 'task'
}) {
  const [route, setRoute] = useState<string>(initialRoute === 'home' ? '/' : '/tasks/hotel-task')
  const [task, setTask] = useState<TaskProjection | null>(() =>
    initialRoute === 'task' ? services.agentSessionRepository.getTask('hotel-task') : null
  )
  const [mode, setMode] = useState<TaskLayoutMode>('split')

  useEffect(
    () => services.agentSessionRepository.subscribe((projection) => setTask(projection)),
    [services]
  )

  const openHome = () => {
    setRoute('/')
    setMode('split')
  }

  const openTask = (taskId: string) => {
    const projection = services.agentSessionRepository.getTask(taskId)
    if (!projection) return
    setTask(projection)
    setRoute(`/tasks/${projection.id}`)
  }

  return (
    <div className="app-shell">
      <Sidebar active={route === '/' ? 'new' : 'task'} onNewTask={openHome} onOpenTask={openTask} />
      {route === '/' ? (
        <HomePage
          onSubmit={async (goal) => {
            const projection = await services.agentCommandService.submitGoal(goal)
            setTask(projection)
            setRoute(`/tasks/${projection.id}`)
          }}
        />
      ) : task ? (
        <TaskPage
          mode={mode}
          task={task}
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
