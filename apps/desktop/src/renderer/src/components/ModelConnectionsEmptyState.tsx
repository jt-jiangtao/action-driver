import { AppIcon } from './ui/AppIcon'

export function ModelConnectionsEmptyState({ onAdd }: { onAdd(): void }) {
  return (
    <section className="model-empty-state">
      <div className="model-empty-icon" aria-hidden="true">
        <AppIcon name="boxes" />
        <AppIcon className="model-empty-plus" name="plus" />
      </div>
      <h2>还没有模型集</h2>
      <p>添加模型集后，即可统一启用和管理任务所需的模型。</p>
      <ol className="model-empty-guide">
        <li>
          <span>1</span>
          <div>
            <strong>连接模型服务</strong>
            <p>填写名称、接口地址和密钥</p>
          </div>
        </li>
        <li>
          <span>2</span>
          <div>
            <strong>选择并测试模型</strong>
            <p>发现模型后手动测试并保存</p>
          </div>
        </li>
      </ol>
      <button
        className="primary-button model-empty-add"
        type="button"
        aria-label="添加模型集"
        onClick={onAdd}
      >
        <AppIcon name="plus" />
        添加模型集
      </button>
      <a href="#supported-protocols">查看支持的接口协议</a>
    </section>
  )
}
