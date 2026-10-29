import { useState } from 'react'
import { Modal, relTime } from '../components/common'
import { createApp, current, rollbackRelease, rolloutRelease, useStore } from '../mock/store'
import type { NewAppInput } from '../mock/store'
import type { Release } from '../types'

function Wizard({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0)
  const [form, setForm] = useState<NewAppInput>({
    name: 'my-app',
    namespace: 'default',
    image: 'registry.internal/app/my-app:v1.0.0',
    replicas: 4,
    port: 8080,
    expose: 'ClusterIP',
  })
  const set = (k: keyof NewAppInput, v: string | number) => setForm(f => ({ ...f, [k]: v }))

  return (
    <Modal title="新建应用 · 创建向导" onClose={onClose}>
      <div className="wizard-steps">
        {['基本信息', '镜像与副本', '网络暴露'].map((s, i) => (
          <div key={s} className={`wizard-step${i === step ? ' active' : i < step ? ' done' : ''}`}>
            {i + 1}. {s}
          </div>
        ))}
      </div>

      {step === 0 && (
        <>
          <div className="field">
            <label>应用名称</label>
            <input value={form.name} onChange={e => set('name', e.target.value)} />
          </div>
          <div className="field">
            <label>命名空间</label>
            <select value={form.namespace} onChange={e => set('namespace', e.target.value)}>
              {['default', 'payment', 'search', 'middleware', 'observability'].map(ns => (
                <option key={ns}>{ns}</option>
              ))}
            </select>
          </div>
        </>
      )}

      {step === 1 && (
        <>
          <div className="field">
            <label>镜像地址</label>
            <input value={form.image} onChange={e => set('image', e.target.value)} />
          </div>
          <div className="field">
            <label>副本数: <b className="mono" style={{ color: 'var(--brand)' }}>{form.replicas}</b></label>
            <input type="range" min={1} max={12} value={form.replicas} onChange={e => set('replicas', Number(e.target.value))} />
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <div className="field">
            <label>容器端口</label>
            <input type="number" value={form.port} onChange={e => set('port', Number(e.target.value))} />
          </div>
          <div className="field">
            <label>暴露方式</label>
            <select value={form.expose} onChange={e => set('expose', e.target.value)}>
              <option>ClusterIP</option>
              <option>NodePort</option>
              <option>Ingress</option>
            </select>
          </div>
        </>
      )}

      <div className="modal-actions">
        {step > 0 && <button className="btn" onClick={() => setStep(step - 1)}>上一步</button>}
        {step < 2 ? (
          <button className="btn primary" onClick={() => setStep(step + 1)}>下一步</button>
        ) : (
          <button className="btn primary" onClick={() => { createApp(form); onClose() }}>创建并部署</button>
        )}
      </div>
    </Modal>
  )
}

export default function Releases() {
  useStore(s => s)
  const { releases } = current()
  const [selectedId, setSelectedId] = useState<string | null>(releases[0]?.id ?? null)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [rollbackTarget, setRollbackTarget] = useState<number | null>(null)
  const [newTag, setNewTag] = useState('')
  const [deployOpen, setDeployOpen] = useState(false)

  const sel: Release | undefined = releases.find(r => r.id === selectedId)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
        <h1 className="page-title" style={{ marginBottom: 4 }}>发布与生命周期 <span className="en">RELEASE LIFECYCLE</span></h1>
        <button className="btn primary" style={{ marginLeft: 'auto' }} onClick={() => setWizardOpen(true)}>+ 新建应用</button>
      </div>
      <p className="page-desc">应用级视角的部署、滚动发布与回滚 · 进度与副本状态实时联动(mock)</p>

      <div className="release-cards">
        {releases.map(r => {
          const pct = r.replicas ? (r.readyReplicas / r.replicas) * 100 : 0
          return (
            <div
              key={r.id}
              className={`card release-card${selectedId === r.id ? ' selected' : ''}`}
              onClick={() => setSelectedId(r.id)}
            >
              <div className="release-name">
                <span className={`dot${r.status === 'rolling' ? ' amber' : r.status === 'failed' ? ' red' : ''}`} />
                {r.name}
              </div>
              <div className="release-meta">
                {r.namespace} · rev {r.currentRevision} · {relTime(r.revisions[r.revisions.length - 1].deployedAt)}
              </div>
              <div className="release-health">
                <span className={`mini-bar${r.status === 'rolling' ? ' rolling' : ''}`}>
                  <i style={{ width: `${pct}%` }} />
                </span>
                <span style={{ color: r.status === 'rolling' ? 'var(--warn)' : 'var(--ok)' }}>
                  {r.readyReplicas}/{r.replicas}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {sel && (
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
            <h4 className="card-title" style={{ margin: 0 }}>版本历史 · {sel.name}</h4>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
              <button className="btn" onClick={() => { setNewTag(`v${Math.floor(Math.random() * 5) + 1}.${Math.floor(Math.random() * 20)}.${Math.floor(Math.random() * 10)}`); setDeployOpen(true) }}>
                发布新版本
              </button>
            </div>
          </div>
          {sel.status === 'rolling' && (
            <div style={{ marginBottom: 14 }}>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${(sel.readyReplicas / sel.replicas) * 100}%` }} />
              </div>
              <div className="mono dim" style={{ fontSize: 11, marginTop: 6 }}>
                滚动更新中… {sel.readyReplicas}/{sel.replicas} 副本就绪
              </div>
            </div>
          )}
          <table className="data">
            <thead>
              <tr><th>Revision</th><th>镜像 Tag</th><th>部署时间</th><th>操作人</th><th>备注</th><th></th></tr>
            </thead>
            <tbody>
              {[...sel.revisions].reverse().map(v => (
                <tr key={v.revision} style={{ cursor: 'default' }}>
                  <td className="mono" style={{ color: v.revision === sel.currentRevision ? 'var(--brand)' : undefined }}>
                    #{v.revision}{v.revision === sel.currentRevision && ' ← current'}
                  </td>
                  <td className="mono dim">{v.imageTag}</td>
                  <td className="mono dim">{new Date(v.deployedAt).toLocaleString('zh-CN', { hour12: false })}</td>
                  <td className="mono dim">{v.operator}</td>
                  <td className="dim">{v.note}</td>
                  <td>
                    {v.revision !== sel.currentRevision && sel.status !== 'rolling' && (
                      <button className="btn" style={{ padding: '4px 10px', fontSize: 11.5 }} onClick={() => setRollbackTarget(v.revision)}>
                        回滚到此版本
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rollbackTarget !== null && sel && (
        <Modal title={`回滚 ${sel.name}`} onClose={() => setRollbackTarget(null)}>
          <p className="dim" style={{ fontSize: 13, lineHeight: 1.7 }}>
            将回滚到 <b className="mono" style={{ color: 'var(--brand)' }}>revision #{rollbackTarget}</b>
            (镜像 <span className="mono">{sel.revisions.find(v => v.revision === rollbackTarget)?.imageTag}</span>)。
            回滚会作为一次新的 revision 记录,副本将逐个滚动替换。
          </p>
          <div className="modal-actions">
            <button className="btn" onClick={() => setRollbackTarget(null)}>取消</button>
            <button className="btn primary" onClick={() => { rollbackRelease(sel.id, rollbackTarget); setRollbackTarget(null) }}>确认回滚</button>
          </div>
        </Modal>
      )}

      {deployOpen && sel && (
        <Modal title={`发布新版本 · ${sel.name}`} onClose={() => setDeployOpen(false)}>
          <div className="field">
            <label>目标镜像 Tag</label>
            <input value={newTag} onChange={e => setNewTag(e.target.value)} />
          </div>
          <div className="modal-actions">
            <button className="btn" onClick={() => setDeployOpen(false)}>取消</button>
            <button className="btn primary" onClick={() => { rolloutRelease(sel.id, newTag); setDeployOpen(false) }}>开始滚动发布</button>
          </div>
        </Modal>
      )}

      {wizardOpen && <Wizard onClose={() => setWizardOpen(false)} />}
    </div>
  )
}
