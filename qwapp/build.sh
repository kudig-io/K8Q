#!/usr/bin/env bash
# K8Q qwapp 打包脚本
# 用法:./qwapp/build.sh [输出目录]
# 流程:vite 单文件构建 → qwapp/views/workbench.html → 打包 zip → SHA-256 摘要

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT_DIR="${1:-$SCRIPT_DIR/dist}"
mkdir -p "$OUT_DIR" "$SCRIPT_DIR/views"

MANIFEST="$SCRIPT_DIR/manifest.json"
if [[ ! -f "$MANIFEST" ]]; then
  echo "❌ 未找到 manifest.json:$MANIFEST" >&2
  exit 1
fi

APP_ID=$(node -e "console.log(require('$MANIFEST').appId)")
VERSION=$(node -e "console.log(require('$MANIFEST').version)")
FORMAT=$(node -e "console.log(require('$MANIFEST').format)")

echo "📦 打包 qwapp:"
echo "   appId   = $APP_ID"
echo "   version = $VERSION"
echo "   format  = $FORMAT"

# 1. 构建自包含单文件工作台视图
echo "🔨 构建工作台视图(vite singlefile)…"
(cd "$ROOT_DIR" && SINGLEFILE=1 npm run build >/dev/null)
cp "$ROOT_DIR/dist/index.html" "$SCRIPT_DIR/views/workbench.html"
echo "   views/workbench.html = $(stat -f%z "$SCRIPT_DIR/views/workbench.html") bytes"

# 2. 校验 manifest 必备字段与文件引用
node -e "
const fs = require('fs');
const path = require('path');
const m = require('$MANIFEST');
for (const k of ['appId','name','version','format','manifestVersion','mainAgent']) {
  if (m[k] === undefined || m[k] === null) {
    console.error('❌ manifest.json 缺少必备字段:' + k);
    process.exit(1);
  }
}
if (!['qwapp-v2','qwapp-v3'].includes(m.format)) {
  console.error('❌ format 必须是 qwapp-v2 或 qwapp-v3,当前:' + m.format);
  process.exit(1);
}
const ma = m.mainAgent;
for (const k of ['id','version','instructions','capabilities','presentation']) {
  if (ma[k] === undefined) {
    console.error('❌ mainAgent 缺少必备字段:' + k);
    process.exit(1);
  }
}
const root = '$SCRIPT_DIR';
const missing = [];
function check(p, label) {
  if (!p) return;
  if (!fs.existsSync(path.resolve(root, p))) missing.push(label + ': ' + p);
}
check(ma.instructions, 'mainAgent.instructions');
if (ma.skills?.directory) check(ma.skills.directory, 'mainAgent.skills.directory');
for (const v of ma.views || []) check(v.entry, 'view[' + v.viewId + '].entry');
for (const c of ma.capabilities?.commands || []) check(c.entry, 'command[' + c.name + '].entry');
if (missing.length) {
  console.error('❌ manifest 引用了不存在的文件:');
  for (const x of missing) console.error('   - ' + x);
  process.exit(1);
}
console.log('✅ manifest 与文件引用校验通过');
"

# 3. 打包 zip
OUT_FILE="$OUT_DIR/${APP_ID}-${VERSION}.qwapp"
rm -f "$OUT_FILE"

cd "$SCRIPT_DIR"
zip -qr "$OUT_FILE" . \
  -x "dist/*" \
  -x "*/.DS_Store" \
  -x ".DS_Store" \
  -x "build.sh" \
  -x "README.md"

# 4. SHA-256 摘要
DIGEST=$(shasum -a 256 "$OUT_FILE" | awk '{print $1}')
SIZE=$(stat -f%z "$OUT_FILE" 2>/dev/null || stat -c%s "$OUT_FILE")

cat > "$OUT_FILE.sha256.json" <<EOF
{
  "appId": "$APP_ID",
  "version": "$VERSION",
  "format": "$FORMAT",
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
echo "   方式 1:把 .qwapp 文件拖入 QwenWork 窗口"
echo "   方式 2:在 QwenWork 对话中说「帮我安装这个 qwapp:${OUT_FILE}」"
