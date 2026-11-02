#!/usr/bin/env bash
# K8Q qwapp 打包脚本(qwapp-v2 / QwenWork 1.4 实测 schema)
# 用法:./qwapp/build.sh [输出目录]
# 流程:vite 单文件构建 → dist/ui/index.html → manifest 校验 → 打包 zip → SHA-256 摘要
#
# 包结构(与 QwenWork 运行时 normalizeQwenWorkAppManifest 对齐):
#   manifest.json                    type=qwenwork-app, manifestVersion=2
#   dist/main.mjs                    runtime.main 入口(占位)
#   dist/tool-catalog.json           kind=qwenwork.app-tool-catalog/v1
#   dist/ui/index.html               capabilities.views[0](id=main)的工作台视图
#   resources/agent/instructions.md  mainAgent.instructions
#   resources/agent/skills/*/SKILL.md

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT_DIR="${1:-$SCRIPT_DIR/out}"
mkdir -p "$OUT_DIR" "$SCRIPT_DIR/dist/ui"

MANIFEST="$SCRIPT_DIR/manifest.json"
if [[ ! -f "$MANIFEST" ]]; then
  echo "❌ 未找到 manifest.json:$MANIFEST" >&2
  exit 1
fi

APP_ID=$(node -e "console.log(require('$MANIFEST').id)")
VERSION=$(node -e "console.log(require('$MANIFEST').version)")

echo "📦 打包 qwapp:"
echo "   id      = $APP_ID"
echo "   version = $VERSION"

# 1. 构建自包含单文件工作台视图
echo "🔨 构建工作台视图(vite singlefile)…"
(cd "$ROOT_DIR" && SINGLEFILE=1 npm run build >/dev/null)
cp "$ROOT_DIR/dist/index.html" "$SCRIPT_DIR/dist/ui/index.html"
echo "   dist/ui/index.html = $(stat -f%z "$SCRIPT_DIR/dist/ui/index.html") bytes"

# 1.5 node 桥(runtime.main 入口)
cp "$SCRIPT_DIR/main-bridge.mjs" "$SCRIPT_DIR/dist/main.mjs"
echo "   dist/main.mjs      = $(stat -f%z "$SCRIPT_DIR/dist/main.mjs") bytes"

# 2. 按 QwenWork 运行时规则校验 manifest 必备字段与产物引用
node -e "
const fs = require('fs');
const path = require('path');
const m = require('$MANIFEST');
const fail = (msg) => { console.error('❌ ' + msg); process.exit(1); };

if (m.manifestVersion !== 2) fail('manifestVersion 必须为 2(当前 mainAgent 仅 v2 支持)');
if (m.type !== 'qwenwork-app') fail('type 必须为 qwenwork-app');
const ALLOWED = new Set(['manifestVersion','type','sdkProfile','id','name','displayName','version','description','author','icon','sdk','runtime','ui','entrypoints','capabilities','permissions','ext','target']);
if (m.manifestVersion === 2) ALLOWED.add('mainAgent');
for (const k of Object.keys(m)) if (!ALLOWED.has(k)) fail('manifest 包含未知字段: ' + k);
for (const k of ['id','name','version','sdk','runtime','permissions']) if (m[k] === undefined) fail('缺少必备字段: ' + k);
if (!Array.isArray(m.permissions) || m.permissions.length > 256) fail('permissions 必须是最多 256 项的数组(运行时强制)');
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(m.version)) fail('version 必须是标准 SemVer');
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(m.sdk?.version)) fail('sdk.version 必须是标准 SemVer');
if (!['qw','qwenwork'].includes(m.sdk?.global)) fail('sdk.global 仅支持 qw 或 qwenwork');
const rt = m.runtime;
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(rt?.minVersion ?? '')) fail('runtime.minVersion 必须是完整 SemVer');
if (rt.toolCatalog !== 'dist/tool-catalog.json') fail('runtime.toolCatalog 必须是 dist/tool-catalog.json');
if (rt.main?.entry !== 'dist/main.mjs') fail('runtime.main.entry 必须是 dist/main.mjs');
if (!['node','electron-main'].includes(rt.main?.executionMode)) fail('runtime.main.executionMode 仅支持 node 或 electron-main');
if (rt.main?.scope !== 'installation') fail('runtime.main.scope 仅支持 installation');
if (!['onDemand','startup'].includes(rt.main?.activation)) fail('runtime.main.activation 仅支持 onDemand 或 startup');
if (!['idle','resident'].includes(rt.main?.retention)) fail('runtime.main.retention 仅支持 idle 或 resident');
if (m.ui && m.ui.dir !== 'dist/ui') fail('ui.dir 必须是 dist/ui');
if (m.ui && !(m.capabilities?.views?.length > 0)) fail('声明 ui 时必须声明至少一个 capabilities.views');

const ma = m.mainAgent;
if (ma) {
  const MA_ALLOWED = new Set(['kind','id','version','instructions','tools','hostSkills','skills','subagents','presentation']);
  for (const k of Object.keys(ma)) if (!MA_ALLOWED.has(k)) fail('mainAgent 包含未知字段: ' + k);
  if (ma.kind !== 'qwenwork-main-agent') fail('mainAgent.kind 必须为 qwenwork-main-agent');
  if (ma.tools !== 'app') fail('mainAgent.tools 仅支持 app');
  if (!Array.isArray(ma.subagents)) fail('mainAgent.subagents 必须是数组(可为空)');
  if (!ma.presentation?.title) fail('mainAgent.presentation.title 必填');
  if (!Array.isArray(ma.presentation?.suggestedPrompts) || ma.presentation.suggestedPrompts.length > 8)
    fail('mainAgent.presentation.suggestedPrompts 必须是不超过 8 项的数组');
}

// 产物文件存在性(对应运行时 requireDeskComponentArtifact)
const root = '$SCRIPT_DIR';
const need = [rt.toolCatalog, rt.main.entry];
if (ma?.instructions) need.push(ma.instructions);
for (const v of m.capabilities?.views || []) need.push('dist/ui/' + (v.id === 'main' ? 'index.html' : v.id + '.html'));
const missing = need.filter(p => !fs.existsSync(path.resolve(root, p)));
if (missing.length) {
  console.error('❌ manifest 声明的产物不存在:');
  for (const x of missing) console.error('   - ' + x);
  process.exit(1);
}
if (ma?.skills?.directory) {
  const dir = path.resolve(root, ma.skills.directory);
  if (!fs.existsSync(dir) || !fs.readdirSync(dir).length) fail('mainAgent.skills.directory 不存在或为空: ' + ma.skills.directory);
}
for (const v of m.capabilities?.views || []) {
  if (v.resourceUri !== 'ui://' + m.id + '/' + v.id) fail('view ' + v.id + ' 的 resourceUri 必须是 ui://' + m.id + '/' + v.id);
}

// tool-catalog 基本校验(对应 normalizeToolCatalog)
const tc = JSON.parse(fs.readFileSync(path.resolve(root, rt.toolCatalog), 'utf8'));
if (tc.schemaVersion !== 1 || tc.kind !== 'qwenwork.app-tool-catalog/v1') fail('tool-catalog 的 schemaVersion/kind 不正确');
if (tc.appId !== m.id) fail('tool-catalog.appId 必须与 manifest.id 一致');
if (!Array.isArray(tc.tools)) fail('tool-catalog.tools 必须是数组');
if (tc.contract === undefined) fail('声明了 runtime.main,tool-catalog 必须包含 contract');
console.log('✅ manifest 与产物校验通过(qwapp-v2 运行时规则)');
"

# 3. 打包 zip
OUT_FILE="$OUT_DIR/${APP_ID}-${VERSION}.qwapp"
rm -f "$OUT_FILE"

cd "$SCRIPT_DIR"
zip -qr "$OUT_FILE" . \
  -x "out/*" \
  -x "*/.DS_Store" \
  -x ".DS_Store" \
  -x "build.sh"

# 4. SHA-256 摘要
DIGEST=$(shasum -a 256 "$OUT_FILE" | awk '{print $1}')
SIZE=$(stat -f%z "$OUT_FILE" 2>/dev/null || stat -c%s "$OUT_FILE")

cat > "$OUT_FILE.sha256.json" <<EOF
{
  "appId": "$APP_ID",
  "version": "$VERSION",
  "format": "qwapp-v2",
  "file": "$(basename "$OUT_FILE")",
  "size": $SIZE,
  "sha256": "$DIGEST",
  "builtAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

echo ""
echo "✅ 打包完成:"
echo "   $OUT_FILE"
echo "   size   = $SIZE bytes"
echo "   sha256 = $DIGEST"
echo ""
echo "📥 安装到千问办公:"
echo "   方式 1:把 .qwapp 文件拖入 QwenWork 窗口(或双击,由默认处理器打开)"
echo "   方式 2:在 QwenWork 对话中说「帮我安装这个 qwapp:${OUT_FILE}」"
