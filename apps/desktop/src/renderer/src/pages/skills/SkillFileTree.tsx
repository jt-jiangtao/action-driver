import { AppIcon } from '../../components/ui/AppIcon'
import type { AgentFileNode } from '../../models/agent-files'
import { e2eId } from '../../testing/e2e-id'

export function SkillFileTree({
  nodes,
  selectedPath,
  onSelect,
  nested = false
}: {
  nodes: AgentFileNode[]
  selectedPath: string | null
  onSelect(path: string): void
  nested?: boolean
}) {
  return (
    <ul
      className="skill-file-tree"
      role={nested ? 'group' : 'tree'}
      {...(!nested ? { 'aria-label': 'Skill 文件' } : {})}
    >
      {nodes.map((node) => (
        <li key={node.path} role="none">
          {node.kind === 'file' ? (
            <button
              type="button"
              data-testid={e2eId('e2e/settings/skills/files/:path#button', {
                path: encodeURIComponent(node.path)
              })}
              role="treeitem"
              aria-selected={selectedPath === node.path}
              className={selectedPath === node.path ? 'is-selected' : ''}
              onClick={() => onSelect(node.path)}
            >
              <AppIcon name="code" />
              <span>{node.name}</span>
            </button>
          ) : (
            <>
              <div className="skill-tree-folder" role="treeitem" aria-expanded="true">
                <AppIcon name="chevron-down" />
                <AppIcon name="folder" />
                <span>{node.name}</span>
              </div>
              {node.children ? (
                <div className="skill-tree-children">
                  <SkillFileTree
                    nodes={node.children}
                    selectedPath={selectedPath}
                    onSelect={onSelect}
                    nested
                  />
                </div>
              ) : null}
            </>
          )}
        </li>
      ))}
    </ul>
  )
}
