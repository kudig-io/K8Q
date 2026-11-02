import { useState } from 'react'
import { createObjectsFromYaml } from '../data/dataSource'
import { useStore } from '../data/mock/store'
import { Modal } from './common'

/** 全局 YAML 创建入口:侧栏底部常驻,任何页面都可直接创建资源 */
export default function CreateResource({ onClose }: { onClose: () => void }) {
  const ns = useStore(s => s.namespace)
  const [yamlText, setYamlText] = useState('')
  const [result, setResult] = useState<{ created: string[]; errors: string[] } | null>(null)
  const [busy, setBusy] = useState(false)

  return (
    <Modal title="通过 YAML 创建资源" onClose={onClose} wide>
      <textarea
        className="yaml-input"
        spellCheck={false}
        autoFocus
        placeholder={'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: demo-app\n  namespace: prod-a\nspec:\n  replicas: 2\n  template:\n    spec:\n      containers:\n      - name: demo\n        image: nginx:1.27-alpine'}
        value={yamlText}
        onChange={e => setYamlText(e.target.value)}
      />
      <p className="dim" style={{ fontSize: 11, margin: '8px 0 0' }}>
        支持 --- 分隔的多文档 · 仅限注册表内的资源类型 · 未指定 namespace 时使用当前命名空间({ns})
      </p>
      {result && (
        <div className="create-result">
          {result.created.map(c => (
            <div key={c} className="ok-line">✓ 已创建 {c}</div>
          ))}
          {result.errors.map((e, i) => (
            <div key={i} className="err-line">✗ {e}</div>
          ))}
        </div>
      )}
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>关闭</button>
        <button
          className="btn primary"
          disabled={!yamlText.trim() || busy}
          onClick={() => {
            setBusy(true)
            void createObjectsFromYaml(yamlText)
              .then(r => {
                setResult(r)
                if (r.errors.length === 0 && r.created.length > 0) setYamlText('')
              })
              .finally(() => setBusy(false))
          }}
        >
          {busy ? '创建中…' : '创建'}
        </button>
      </div>
    </Modal>
  )
}